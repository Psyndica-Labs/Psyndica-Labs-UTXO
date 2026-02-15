/**
 * Off-chain type definitions matching on-chain Aiken types.
 * 
 * These types are used for transaction building and must serialize
 * to CBOR that matches the on-chain validator expectations.
 */

// ============================================================================
// Common Types
// ============================================================================

/** Verification key hash (28 bytes) */
export type PubKeyHash = string;

/** Basis points (1/100th of a percent, 10000 = 100%) */
export type BasisPoints = number;

/** Datum version for migration support */
export type Version = number;

/** Policy ID (28 bytes hex) */
export type PolicyId = string;

/** Transaction output reference */
export interface OutputReference {
  transactionId: string;
  outputIndex: number;
}

// ============================================================================
// Royalty Distribution Types
// ============================================================================

/** A single recipient in a royalty split */
export interface RoyaltyRecipient {
  /** The recipient's payment credential */
  address: PubKeyHash;
  /** Share in basis points (must sum to 10000 across all recipients) */
  shareBps: BasisPoints;
  /** Optional minimum payment threshold (in lovelace) */
  minThreshold?: bigint;
}

/** Royalty configuration datum */
export interface RoyaltyDatumV1 {
  version: Version;
  nftPolicyId: PolicyId;
  recipients: RoyaltyRecipient[];
  admin: PubKeyHash;
  isLocked: boolean;
}

export type RoyaltyDatum = RoyaltyDatumV1;

/** Royalty redeemer types */
export type RoyaltyRedeemer = 
  | { type: 'Distribute' }
  | { type: 'UpdateConfig'; newRecipients: RoyaltyRecipient[] }
  | { type: 'LockConfig' }
  | { type: 'AdminWithdraw' };

// ============================================================================
// HTLC Types
// ============================================================================

/** HTLC datum for cross-chain atomic swaps */
export interface HTLCDatumV1 {
  version: Version;
  /** Hash of the secret (32 bytes hex) */
  secretHash: string;
  /** Recipient who can claim with the secret */
  recipient: PubKeyHash;
  /** Refund address if timeout expires */
  refundAddress: PubKeyHash;
  /** Deadline for claiming (POSIX timestamp in milliseconds) */
  deadline: bigint;
  /** Amount locked in lovelace */
  lockedAmount: bigint;
}

export type HTLCDatum = HTLCDatumV1;

/** HTLC redeemer types */
export type HTLCRedeemer =
  | { type: 'Claim'; secret: string }
  | { type: 'Refund' };

// ============================================================================
// Escrow Types
// ============================================================================

/** Signature requirement for multi-sig escrow */
export interface SignatureRequirement {
  /** List of authorized signers */
  signers: PubKeyHash[];
  /** Minimum signatures required (M of N) */
  threshold: number;
}

/** Escrow datum for revenue distribution */
export interface EscrowDatumV1 {
  version: Version;
  /** Beneficiary who receives funds on release */
  beneficiary: PubKeyHash;
  /** Multi-sig requirement for release */
  releaseSigners: SignatureRequirement;
  /** Multi-sig requirement for refund */
  refundSigners: SignatureRequirement;
  /** Optional deadline for automatic refund eligibility */
  refundDeadline?: bigint;
  /** Reference to originating transaction */
  originRef?: OutputReference;
}

export type EscrowDatum = EscrowDatumV1;

/** Escrow redeemer types */
export type EscrowRedeemer =
  | { type: 'Release' }
  | { type: 'RefundEscrow' }
  | { type: 'PartialRelease'; amount: bigint };

// ============================================================================
// Transaction Builder Configuration
// ============================================================================

/** Network configuration */
export type Network = 'mainnet' | 'preprod' | 'preview' | 'custom';

/** Builder configuration */
export interface BuilderConfig {
  network: Network;
  /** Blockfrost project ID or custom provider */
  blockfrostProjectId?: string;
  /** Custom node URL for custom network */
  customNodeUrl?: string;
}

/** Transaction result */
export interface TransactionResult {
  txHash: string;
  txCbor: string;
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that royalty shares sum to exactly 100% (10000 basis points)
 */
export function validateShares(recipients: RoyaltyRecipient[]): boolean {
  const total = recipients.reduce((acc, r) => acc + r.shareBps, 0);
  return total === 10000;
}

/**
 * Calculate payout amount based on share
 */
export function calculatePayout(totalAmount: bigint, shareBps: BasisPoints): bigint {
  return (totalAmount * BigInt(shareBps)) / 10000n;
}

/**
 * Validate signature threshold is achievable
 */
export function validateThreshold(requirement: SignatureRequirement): boolean {
  return requirement.threshold > 0 && 
         requirement.threshold <= requirement.signers.length;
}
