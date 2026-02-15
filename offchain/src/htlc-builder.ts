/**
 * HTLC Transaction Builder
 * 
 * Implements off-chain transaction assembly for Hash Time-Locked Contracts.
 * Used for cross-chain atomic swaps with Bitcoin via Cardinal Protocol.
 */

import {
  MeshTxBuilder,
  IFetcher,
  ISubmitter,
  UTxO,
  serializePlutusScript,
  PlutusScript,
  mConStr0,
  mConStr1,
  stringToHex,
} from '@meshsdk/core';
import {
  HTLCDatum,
  HTLCRedeemer,
  Result,
  TransactionBuildError,
  TransactionErrorCode,
} from './types.js';
import { createHash } from 'crypto';

// ============================================================================
// Transaction Builder
// ============================================================================

/**
 * Builder for HTLC transactions
 */
export class HTLCTransactionBuilder {
  private readonly meshTxBuilder: MeshTxBuilder;
  private readonly fetcher: IFetcher;
  private readonly submitter: ISubmitter;
  private readonly scriptCbor: string;
  private readonly scriptAddress: string;

  constructor(config: {
    fetcher: IFetcher;
    submitter: ISubmitter;
    script: PlutusScript;
    networkId: 0 | 1;
  }) {
    this.fetcher = config.fetcher;
    this.submitter = config.submitter;
    this.scriptCbor = config.script.code;
    
    const serialized = serializePlutusScript(config.script, undefined, config.networkId);
    this.scriptAddress = serialized.address;
    
    this.meshTxBuilder = new MeshTxBuilder({
      fetcher: config.fetcher,
      submitter: config.submitter,
    });
  }

  /**
   * Create a new HTLC
   * 
   * Locks tokens that can be claimed with secret preimage or
   * refunded after timeout.
   */
  async buildCreate(params: {
    datum: HTLCDatum;
    fundingUtxos: UTxO[];
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      // Validate timeout is in the future
      const now = Date.now();
      if (params.datum.timeout <= now) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'HTLC timeout must be in the future',
            TransactionErrorCode.INVALID_DATUM
          ),
        };
      }

      // Validate secret hash length (SHA-256 = 32 bytes = 64 hex chars)
      if (params.datum.secretHash.length !== 64) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Secret hash must be 32 bytes (64 hex characters)',
            TransactionErrorCode.INVALID_DATUM
          ),
        };
      }

      this.meshTxBuilder.reset();

      // Add funding inputs
      for (const utxo of params.fundingUtxos) {
        this.meshTxBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex
        );
      }

      // Create HTLC output
      const htlcDatum = this.serializeHTLCDatum(params.datum);
      
      // Build token output
      const assets = [{
        unit: params.datum.tokenPolicy + params.datum.tokenName,
        quantity: params.datum.tokenAmount.toString(),
      }];
      
      this.meshTxBuilder
        .txOut(this.scriptAddress, assets)
        .txOutInlineDatumValue(htlcDatum);

      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build HTLC create transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  /**
   * Claim HTLC with secret preimage
   * 
   * Reveals the secret to claim the locked tokens.
   * Must be called before timeout expires.
   */
  async buildClaim(params: {
    htlcUtxo: UTxO;
    datum: HTLCDatum;
    secret: string;
    recipientAddress: string;
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      // Verify secret hashes to expected value
      const secretHash = sha256(params.secret);
      if (secretHash !== params.datum.secretHash) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Secret does not match expected hash',
            TransactionErrorCode.INVALID_REDEEMER
          ),
        };
      }

      // Verify claim is before timeout
      const now = Date.now();
      if (now >= params.datum.timeout) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'HTLC has expired, use refund instead',
            TransactionErrorCode.TIMEOUT
          ),
        };
      }

      this.meshTxBuilder.reset();

      // Spend HTLC with claim redeemer
      this.meshTxBuilder
        .spendingPlutusScriptV3()
        .txIn(
          params.htlcUtxo.input.txHash,
          params.htlcUtxo.input.outputIndex
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr0([stringToHex(params.secret)])) // Claim redeemer
        .txInScript(this.scriptCbor);

      // Pay tokens to recipient
      const assets = [{
        unit: params.datum.tokenPolicy + params.datum.tokenName,
        quantity: params.datum.tokenAmount.toString(),
      }];
      
      this.meshTxBuilder.txOut(params.recipientAddress, assets);

      // Set validity interval (must end before timeout)
      this.meshTxBuilder.invalidHereafter(params.datum.timeout - 1);
      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build HTLC claim transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  /**
   * Refund HTLC after timeout
   * 
   * Returns tokens to refund address after timeout expires.
   */
  async buildRefund(params: {
    htlcUtxo: UTxO;
    datum: HTLCDatum;
    refundAddress: string;
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      // Verify timeout has passed
      const now = Date.now();
      if (now < params.datum.timeout) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'HTLC has not expired yet',
            TransactionErrorCode.TIMEOUT
          ),
        };
      }

      this.meshTxBuilder.reset();

      // Spend HTLC with refund redeemer
      this.meshTxBuilder
        .spendingPlutusScriptV3()
        .txIn(
          params.htlcUtxo.input.txHash,
          params.htlcUtxo.input.outputIndex
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr1([])) // Refund redeemer
        .txInScript(this.scriptCbor);

      // Pay tokens to refund address
      const assets = [{
        unit: params.datum.tokenPolicy + params.datum.tokenName,
        quantity: params.datum.tokenAmount.toString(),
      }];
      
      this.meshTxBuilder.txOut(params.refundAddress, assets);

      // Set validity interval (must start after timeout)
      this.meshTxBuilder.invalidBefore(params.datum.timeout);
      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build HTLC refund transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Serialize HTLCDatum to Plutus data format
   */
  private serializeHTLCDatum(datum: HTLCDatum): object {
    return {
      constructor: 0,
      fields: [
        stringToHex(datum.recipient),
        stringToHex(datum.refundAddress),
        datum.secretHash,
        datum.timeout,
        stringToHex(datum.tokenPolicy),
        stringToHex(datum.tokenName),
        datum.tokenAmount,
      ],
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate SHA-256 hash of data
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random secret for HTLC
 */
export function generateSecret(length: number = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Calculate timeout for HTLC (current time + duration in milliseconds)
 */
export function calculateTimeout(durationMs: number): number {
  return Date.now() + durationMs;
}

// ============================================================================
// Cross-Chain Coordination (Cardinal Protocol Integration)
// ============================================================================

/**
 * Parameters for creating an atomic swap
 */
export interface AtomicSwapParams {
  /** Cardano side: what we're offering */
  cardanoOffer: {
    tokenPolicy: string;
    tokenName: string;
    amount: bigint;
  };
  /** Bitcoin side: what we expect */
  bitcoinExpect: {
    amount: bigint; // in satoshis
    address: string; // Bitcoin address
  };
  /** Swap participants */
  initiator: string; // Cardano address
  counterparty: string; // Cardano address
  /** Timeout durations */
  cardanoTimeoutMs: number;
  bitcoinTimeoutMs: number;
}

/**
 * Generate HTLC parameters for atomic swap
 * 
 * Creates matching parameters for Cardano and Bitcoin HTLCs
 * following the atomic swap protocol.
 */
export function generateAtomicSwapParams(params: AtomicSwapParams): {
  secret: string;
  secretHash: string;
  cardanoHTLC: HTLCDatum;
  bitcoinTimeout: number;
} {
  // Generate secret (initiator keeps this until Bitcoin side is funded)
  const secret = generateSecret(32);
  const secretHash = sha256(secret);
  
  // Cardano HTLC (locked by initiator)
  const cardanoHTLC: HTLCDatum = {
    recipient: params.counterparty,
    refundAddress: params.initiator,
    secretHash,
    timeout: calculateTimeout(params.cardanoTimeoutMs),
    tokenPolicy: params.cardanoOffer.tokenPolicy,
    tokenName: params.cardanoOffer.tokenName,
    tokenAmount: params.cardanoOffer.amount,
  };
  
  // Bitcoin timeout should be shorter to ensure initiator can refund
  // if counterparty doesn't complete their side
  const bitcoinTimeout = calculateTimeout(params.bitcoinTimeoutMs);
  
  return {
    secret,
    secretHash,
    cardanoHTLC,
    bitcoinTimeout,
  };
}

/**
 * Atomic swap protocol steps:
 * 
 * 1. Initiator generates secret and secretHash
 * 2. Initiator creates Cardano HTLC (longer timeout)
 * 3. Counterparty verifies Cardano HTLC and creates Bitcoin HTLC (shorter timeout)
 * 4. Initiator claims Bitcoin HTLC (reveals secret)
 * 5. Counterparty uses revealed secret to claim Cardano HTLC
 * 
 * Failure scenarios:
 * - If step 3 never happens: Initiator refunds Cardano HTLC after timeout
 * - If step 4 never happens: Counterparty refunds Bitcoin HTLC, then Initiator refunds Cardano HTLC
 * - If step 5 never happens: Counterparty eventually claims using on-chain revealed secret
 */
