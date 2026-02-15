/**
 * Escrow Transaction Builders
 * 
 * Off-chain transaction construction for the HTLC escrow validator.
 * Supports cross-chain atomic swaps with Cardinal Protocol.
 */

import { createHash } from 'crypto';
import type {
  EscrowDatum,
  EscrowRedeemer,
  EscrowState,
  TransactionResult,
  Result,
  Lovelace,
  VerificationKeyHash,
  POSIXTime,
} from '../types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum escrow amount (matches on-chain constant) */
const MIN_ESCROW_AMOUNT = 5_000_000n;

/** Grace period after deadline in milliseconds (matches on-chain) */
const GRACE_PERIOD_MS = 300_000;

// ============================================================================
// DATUM SERIALIZATION
// ============================================================================

/**
 * Serialize EscrowDatum to Plutus Data
 */
export function serializeEscrowDatum(datum: EscrowDatum): string {
  const stateIndex = escrowStateToIndex(datum.state);
  
  return JSON.stringify({
    constructor: 0,
    fields: [
      { bytes: datum.depositor },
      { bytes: datum.beneficiary },
      { bytes: datum.secretHash },
      { int: datum.deadline },
      { int: Number(datum.amount) },
      { constructor: stateIndex, fields: [] },
      datum.btcTxRef 
        ? { constructor: 0, fields: [{ bytes: datum.btcTxRef }] }
        : { constructor: 1, fields: [] },
    ],
  });
}

/**
 * Map escrow state to constructor index
 */
function escrowStateToIndex(state: EscrowState): number {
  const stateMap: Record<EscrowState, number> = {
    Locked: 0,
    Claiming: 1,
    Completed: 2,
    Refunded: 3,
  };
  return stateMap[state];
}

/**
 * Serialize EscrowRedeemer to Plutus Data
 */
export function serializeEscrowRedeemer(redeemer: EscrowRedeemer): string {
  switch (redeemer.type) {
    case 'Claim':
      return JSON.stringify({
        constructor: 0,
        fields: [{ bytes: redeemer.secret }],
      });
    
    case 'Refund':
      return JSON.stringify({ constructor: 1, fields: [] });
    
    case 'Cancel':
      return JSON.stringify({ constructor: 2, fields: [] });
  }
}

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

/**
 * Build transaction to create a new escrow
 * 
 * @param depositor - Depositor's verification key hash
 * @param beneficiary - Beneficiary's verification key hash
 * @param secret - The secret preimage (will be hashed)
 * @param amount - Amount to escrow in lovelace
 * @param deadline - Claim deadline (POSIX timestamp in ms)
 * @param btcTxRef - Optional Bitcoin transaction reference
 * @param scriptAddress - Escrow script address
 * @param depositorAddress - Depositor's wallet address for funding
 */
export async function buildCreateEscrowTransaction(
  depositor: VerificationKeyHash,
  beneficiary: VerificationKeyHash,
  secret: string,
  amount: Lovelace,
  deadline: POSIXTime,
  btcTxRef: string | undefined,
  scriptAddress: string,
  depositorAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate amount
    if (amount < MIN_ESCROW_AMOUNT) {
      return {
        success: false,
        error: new Error(
          `Amount ${amount} below minimum ${MIN_ESCROW_AMOUNT}`
        ),
      };
    }
    
    // Validate deadline is in future
    if (deadline <= Date.now()) {
      return {
        success: false,
        error: new Error('Deadline must be in the future'),
      };
    }
    
    // Hash the secret
    const secretHash = hashSecret(secret);
    
    // Create datum
    const datum: EscrowDatum = {
      depositor,
      beneficiary,
      secretHash,
      deadline,
      amount,
      state: 'Locked',
      btcTxRef,
    };
    
    const result: TransactionResult = {
      unsignedTx: '', // Would contain actual CBOR
      fee: 250_000n,
      inputs: ['depositorUtxo#0'],
      outputs: ['escrowOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Build transaction to claim escrow by revealing secret
 * 
 * @param escrowUtxo - The escrow UTXO
 * @param datum - Current escrow datum
 * @param secret - The secret preimage
 * @param beneficiaryAddress - Beneficiary's wallet address
 */
export async function buildClaimEscrowTransaction(
  escrowUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  datum: EscrowDatum,
  secret: string,
  beneficiaryAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate state
    if (datum.state !== 'Locked') {
      return {
        success: false,
        error: new Error(`Cannot claim escrow in state: ${datum.state}`),
      };
    }
    
    // Validate secret
    const secretHash = hashSecret(secret);
    if (secretHash !== datum.secretHash) {
      return {
        success: false,
        error: new Error('Invalid secret: hash does not match'),
      };
    }
    
    // Validate deadline
    const now = Date.now();
    if (now > datum.deadline) {
      return {
        success: false,
        error: new Error('Claim deadline has passed'),
      };
    }
    
    const result: TransactionResult = {
      unsignedTx: '',
      fee: 300_000n,
      inputs: [`${escrowUtxo.txHash}#${escrowUtxo.outputIndex}`],
      outputs: ['beneficiaryOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Build transaction to refund escrow after deadline
 * 
 * @param escrowUtxo - The escrow UTXO
 * @param datum - Current escrow datum
 * @param depositorAddress - Depositor's wallet address
 */
export async function buildRefundEscrowTransaction(
  escrowUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  datum: EscrowDatum,
  depositorAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate state
    if (datum.state !== 'Locked') {
      return {
        success: false,
        error: new Error(`Cannot refund escrow in state: ${datum.state}`),
      };
    }
    
    // Validate deadline has passed (with grace period)
    const now = Date.now();
    const refundableTime = datum.deadline + GRACE_PERIOD_MS;
    
    if (now < refundableTime) {
      const waitMs = refundableTime - now;
      return {
        success: false,
        error: new Error(
          `Must wait ${Math.ceil(waitMs / 1000)} more seconds for refund`
        ),
      };
    }
    
    const result: TransactionResult = {
      unsignedTx: '',
      fee: 250_000n,
      inputs: [`${escrowUtxo.txHash}#${escrowUtxo.outputIndex}`],
      outputs: ['depositorOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Build transaction to cancel escrow (depositor only, before deadline)
 * 
 * @param escrowUtxo - The escrow UTXO
 * @param datum - Current escrow datum
 * @param depositorAddress - Depositor's wallet address
 */
export async function buildCancelEscrowTransaction(
  escrowUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  datum: EscrowDatum,
  depositorAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate state
    if (datum.state !== 'Locked') {
      return {
        success: false,
        error: new Error(`Cannot cancel escrow in state: ${datum.state}`),
      };
    }
    
    // Validate deadline hasn't passed
    const now = Date.now();
    if (now >= datum.deadline) {
      return {
        success: false,
        error: new Error('Cannot cancel after deadline - use refund instead'),
      };
    }
    
    const result: TransactionResult = {
      unsignedTx: '',
      fee: 250_000n,
      inputs: [`${escrowUtxo.txHash}#${escrowUtxo.outputIndex}`],
      outputs: ['depositorOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Hash secret using SHA256 (matches on-chain sha2_256)
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Generate a random secret for escrow
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Calculate safe deadline (current time + duration)
 * 
 * @param durationMs - Duration in milliseconds
 */
export function calculateDeadline(durationMs: number): POSIXTime {
  return Date.now() + durationMs;
}

/**
 * Validate escrow datum for creation
 */
export function validateEscrowDatum(datum: EscrowDatum): Result<void> {
  // Validate amount
  if (datum.amount < MIN_ESCROW_AMOUNT) {
    return {
      success: false,
      error: new Error(`Amount below minimum: ${datum.amount}`),
    };
  }
  
  // Validate deadline
  if (datum.deadline <= Date.now()) {
    return {
      success: false,
      error: new Error('Deadline must be in the future'),
    };
  }
  
  // Validate secret hash length (SHA256 = 32 bytes = 64 hex chars)
  if (datum.secretHash.length !== 64) {
    return {
      success: false,
      error: new Error('Invalid secret hash length'),
    };
  }
  
  // Validate addresses
  if (datum.depositor.length !== 56) {
    return {
      success: false,
      error: new Error('Invalid depositor address length'),
    };
  }
  
  if (datum.beneficiary.length !== 56) {
    return {
      success: false,
      error: new Error('Invalid beneficiary address length'),
    };
  }
  
  return { success: true, value: undefined };
}
