/**
 * HTLC Transaction Builder
 * 
 * Builds transactions for Hash Time-Locked Contracts enabling
 * cross-chain atomic swaps with Bitcoin via Cardinal Protocol.
 */

import {
  MeshTxBuilder,
  IFetcher,
  ISubmitter,
  MeshWallet,
  serializePlutusScript,
  PlutusScript,
} from '@meshsdk/core';
import {
  HTLCDatum,
  HTLCRedeemer,
  BuilderConfig,
  PubKeyHash,
} from '../types/index.js';
import { datumToPlutusData, redeemerToPlutusData, blake2b256 } from '../utils/cbor.js';

/**
 * Configuration for HTLC builder
 */
export interface HTLCBuilderConfig extends BuilderConfig {
  /** Compiled HTLC validator CBOR */
  validatorCbor: string;
}

/**
 * Parameters for creating a new HTLC
 */
export interface CreateHTLCParams {
  /** Hash of the secret (32 bytes hex) */
  secretHash: string;
  /** Recipient who can claim with the secret */
  recipient: PubKeyHash;
  /** Refund address if timeout expires */
  refundAddress: PubKeyHash;
  /** Deadline for claiming (POSIX timestamp in milliseconds) */
  deadline: bigint;
  /** Amount to lock in lovelace */
  amount: bigint;
}

/**
 * Parameters for claiming from HTLC
 */
export interface ClaimHTLCParams {
  /** UTXO reference of the HTLC */
  utxoRef: { txHash: string; outputIndex: number };
  /** Current datum from the UTXO */
  currentDatum: HTLCDatum;
  /** The secret preimage that hashes to secretHash */
  secret: string;
}

/**
 * Parameters for refunding HTLC
 */
export interface RefundHTLCParams {
  /** UTXO reference of the HTLC */
  utxoRef: { txHash: string; outputIndex: number };
  /** Current datum from the UTXO */
  currentDatum: HTLCDatum;
}

/**
 * Builder for HTLC validator transactions
 */
export class HTLCBuilder {
  private config: HTLCBuilderConfig;
  private fetcher: IFetcher;
  private submitter: ISubmitter;
  private validatorAddress: string;

  constructor(
    config: HTLCBuilderConfig,
    fetcher: IFetcher,
    submitter: ISubmitter,
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.submitter = submitter;

    const script: PlutusScript = {
      version: 'V3',
      code: config.validatorCbor,
    };
    this.validatorAddress = serializePlutusScript(script, undefined, 0).address;
  }

  /**
   * Create a new HTLC for cross-chain atomic swap
   * 
   * Flow:
   * 1. Counterparty creates HTLC on Bitcoin with hash(secret)
   * 2. This creates matching HTLC on Cardano
   * 3. Counterparty can claim by revealing secret
   */
  async buildCreateHTLC(
    wallet: MeshWallet,
    params: CreateHTLCParams,
  ): Promise<string> {
    // Validate deadline is in the future
    if (params.deadline <= BigInt(Date.now())) {
      throw new Error('HTLC deadline must be in the future');
    }

    const datum: HTLCDatum = {
      version: 1,
      secretHash: params.secretHash,
      recipient: params.recipient,
      refundAddress: params.refundAddress,
      deadline: params.deadline,
      lockedAmount: params.amount,
    };

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const txBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      submitter: this.submitter,
    });

    const unsignedTx = await txBuilder
      .txOut(this.validatorAddress, [{ unit: 'lovelace', quantity: params.amount.toString() }])
      .txOutInlineDatumValue(datumToPlutusData(datum))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Claim HTLC funds by revealing the secret
   * 
   * The secret must hash to the secretHash in the datum.
   * Transaction must be submitted before the deadline.
   */
  async buildClaim(
    wallet: MeshWallet,
    params: ClaimHTLCParams,
  ): Promise<string> {
    // Verify secret locally before building transaction
    const computedHash = blake2b256(params.secret);
    if (computedHash !== params.currentDatum.secretHash) {
      throw new Error('Secret does not match the hash in the HTLC');
    }

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const redeemer: HTLCRedeemer = {
      type: 'Claim',
      secret: params.secret,
    };

    const txBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      submitter: this.submitter,
    });

    // Set validity interval to expire before deadline
    const now = Date.now();
    const ttl = Math.min(
      Number(params.currentDatum.deadline) - 1000, // 1 second before deadline
      now + 3600000, // Max 1 hour
    );

    const unsignedTx = await txBuilder
      .spendingPlutusScriptV3()
      .txIn(params.utxoRef.txHash, params.utxoRef.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemerToPlutusData(redeemer))
      .txInScript(this.config.validatorCbor)
      .txOut(
        params.currentDatum.recipient,
        [{ unit: 'lovelace', quantity: params.currentDatum.lockedAmount.toString() }]
      )
      .requiredSignerHash(params.currentDatum.recipient)
      .invalidHereafter(ttl)
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Refund HTLC after deadline has passed
   * 
   * Only available after the deadline, returns funds to refund address.
   */
  async buildRefund(
    wallet: MeshWallet,
    params: RefundHTLCParams,
  ): Promise<string> {
    const now = Date.now();
    if (BigInt(now) < params.currentDatum.deadline) {
      throw new Error('Cannot refund HTLC before deadline');
    }

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const redeemer: HTLCRedeemer = { type: 'Refund' };

    const txBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      submitter: this.submitter,
    });

    const unsignedTx = await txBuilder
      .spendingPlutusScriptV3()
      .txIn(params.utxoRef.txHash, params.utxoRef.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemerToPlutusData(redeemer))
      .txInScript(this.config.validatorCbor)
      .txOut(
        params.currentDatum.refundAddress,
        [{ unit: 'lovelace', quantity: params.currentDatum.lockedAmount.toString() }]
      )
      .requiredSignerHash(params.currentDatum.refundAddress)
      .invalidBefore(Number(params.currentDatum.deadline))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Generate a secret hash from a secret preimage
   * Utility for creating new HTLCs
   */
  static generateSecretHash(secret: string): string {
    return blake2b256(secret);
  }

  /**
   * Get the validator script address
   */
  getValidatorAddress(): string {
    return this.validatorAddress;
  }
}
