/**
 * Royalty Transaction Builder
 * 
 * Builds transactions for interacting with the Royalty validator.
 * Implements the off-chain supervision pattern for transaction construction
 * and validation before submission.
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
  RoyaltyDatum,
  RoyaltyRedeemer,
  RoyaltyRecipient,
  TransactionResult,
  BuilderConfig,
  validateShares,
  calculatePayout,
  PubKeyHash,
  PolicyId,
} from '../types/index.js';
import { datumToPlutusData, redeemerToPlutusData } from '../utils/cbor.js';

/**
 * Configuration for the royalty builder
 */
export interface RoyaltyBuilderConfig extends BuilderConfig {
  /** Compiled validator script CBOR */
  validatorCbor: string;
}

/**
 * Parameters for creating a new royalty UTXO
 */
export interface CreateRoyaltyParams {
  /** NFT policy ID this royalty config applies to */
  nftPolicyId: PolicyId;
  /** List of royalty recipients with their shares */
  recipients: RoyaltyRecipient[];
  /** Admin public key hash */
  admin: PubKeyHash;
  /** Initial funding amount in lovelace */
  initialFunding: bigint;
}

/**
 * Parameters for distributing royalties
 */
export interface DistributeParams {
  /** UTXO reference containing royalty funds */
  utxoRef: { txHash: string; outputIndex: number };
  /** Current datum from the UTXO */
  currentDatum: RoyaltyDatum;
}

/**
 * Builder for Royalty validator transactions
 */
export class RoyaltyBuilder {
  private config: RoyaltyBuilderConfig;
  private fetcher: IFetcher;
  private submitter: ISubmitter;
  private validatorAddress: string;

  constructor(
    config: RoyaltyBuilderConfig,
    fetcher: IFetcher,
    submitter: ISubmitter,
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.submitter = submitter;
    
    // Derive validator address from script
    const script: PlutusScript = {
      version: 'V3',
      code: config.validatorCbor,
    };
    this.validatorAddress = serializePlutusScript(script, undefined, 0).address;
  }

  /**
   * Create a new royalty configuration UTXO
   * 
   * This initializes a new royalty split configuration that can
   * receive and distribute funds according to the specified shares.
   */
  async buildCreateRoyalty(
    wallet: MeshWallet,
    params: CreateRoyaltyParams,
  ): Promise<string> {
    // Validate shares before building transaction
    if (!validateShares(params.recipients)) {
      throw new Error('Royalty shares must sum to exactly 10000 basis points (100%)');
    }

    const datum: RoyaltyDatum = {
      version: 1,
      nftPolicyId: params.nftPolicyId,
      recipients: params.recipients,
      admin: params.admin,
      isLocked: false,
    };

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const txBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      submitter: this.submitter,
    });

    const unsignedTx = await txBuilder
      .txOut(this.validatorAddress, [{ unit: 'lovelace', quantity: params.initialFunding.toString() }])
      .txOutInlineDatumValue(datumToPlutusData(datum))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Build a distribution transaction
   * 
   * Distributes accumulated royalties to all recipients according
   * to their configured shares.
   */
  async buildDistribute(
    wallet: MeshWallet,
    params: DistributeParams,
  ): Promise<string> {
    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();
    
    // Fetch the script UTXO
    const scriptUtxo = await this.fetcher.fetchUTxOs(
      params.utxoRef.txHash,
      params.utxoRef.outputIndex,
    );
    
    if (!scriptUtxo || scriptUtxo.length === 0) {
      throw new Error('Royalty UTXO not found');
    }

    const royaltyUtxo = scriptUtxo[0];
    const totalLovelace = BigInt(
      royaltyUtxo.output.amount.find(a => a.unit === 'lovelace')?.quantity || '0'
    );

    const redeemer: RoyaltyRedeemer = { type: 'Distribute' };

    const txBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      submitter: this.submitter,
    });

    // Start building transaction
    let tx = txBuilder
      .spendingPlutusScriptV3()
      .txIn(
        params.utxoRef.txHash,
        params.utxoRef.outputIndex,
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemerToPlutusData(redeemer))
      .txInScript(this.config.validatorCbor);

    // Add outputs for each recipient
    for (const recipient of params.currentDatum.recipients) {
      const payoutAmount = calculatePayout(totalLovelace, recipient.shareBps);
      
      // Skip if below minimum threshold
      if (recipient.minThreshold && payoutAmount < recipient.minThreshold) {
        continue;
      }

      // Create output to recipient
      tx = tx.txOut(
        recipient.address,
        [{ unit: 'lovelace', quantity: payoutAmount.toString() }]
      );
    }

    const unsignedTx = await tx
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Build an update configuration transaction
   * 
   * Updates the royalty recipients (admin only, if not locked).
   */
  async buildUpdateConfig(
    wallet: MeshWallet,
    params: DistributeParams,
    newRecipients: RoyaltyRecipient[],
  ): Promise<string> {
    // Validate new shares
    if (!validateShares(newRecipients)) {
      throw new Error('New royalty shares must sum to exactly 10000 basis points');
    }

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const redeemer: RoyaltyRedeemer = {
      type: 'UpdateConfig',
      newRecipients,
    };

    const newDatum: RoyaltyDatum = {
      ...params.currentDatum,
      recipients: newRecipients,
    };

    // Fetch current UTXO value to preserve it
    const scriptUtxo = await this.fetcher.fetchUTxOs(
      params.utxoRef.txHash,
      params.utxoRef.outputIndex,
    );
    
    if (!scriptUtxo || scriptUtxo.length === 0) {
      throw new Error('Royalty UTXO not found');
    }

    const currentValue = scriptUtxo[0].output.amount;

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
      .txOut(this.validatorAddress, currentValue)
      .txOutInlineDatumValue(datumToPlutusData(newDatum))
      .requiredSignerHash(params.currentDatum.admin)
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Build a lock configuration transaction
   * 
   * Permanently locks the royalty configuration (admin only).
   */
  async buildLockConfig(
    wallet: MeshWallet,
    params: DistributeParams,
  ): Promise<string> {
    if (params.currentDatum.isLocked) {
      throw new Error('Configuration is already locked');
    }

    const utxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const redeemer: RoyaltyRedeemer = { type: 'LockConfig' };

    const newDatum: RoyaltyDatum = {
      ...params.currentDatum,
      isLocked: true,
    };

    const scriptUtxo = await this.fetcher.fetchUTxOs(
      params.utxoRef.txHash,
      params.utxoRef.outputIndex,
    );
    
    if (!scriptUtxo || scriptUtxo.length === 0) {
      throw new Error('Royalty UTXO not found');
    }

    const currentValue = scriptUtxo[0].output.amount;

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
      .txOut(this.validatorAddress, currentValue)
      .txOutInlineDatumValue(datumToPlutusData(newDatum))
      .requiredSignerHash(params.currentDatum.admin)
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return unsignedTx;
  }

  /**
   * Get the validator script address
   */
  getValidatorAddress(): string {
    return this.validatorAddress;
  }
}
