/**
 * Off-chain type definitions mirroring on-chain datum structures
 * 
 * These types are used for transaction building and must serialize
 * to the exact CBOR format expected by the on-chain validators.
 */

/** Verification key hash (28 bytes) */
export type VerificationKeyHash = string;

/** Policy ID (28 bytes) */
export type PolicyId = string;

/** Asset name (up to 32 bytes) */
export type AssetName = string;

/** Basis points for percentage calculations */
export type BasisPoints = number;

/** Maximum basis points (100% = 10000) */
export const MAX_BASIS_POINTS = 10000;

/** Minimum UTXO lovelace required by protocol */
export const MIN_UTXO_LOVELACE = 2_000_000n;

/**
 * Represents a single royalty recipient with their share
 */
export interface RoyaltyRecipient {
  /** Payment address (verification key hash) */
  address: VerificationKeyHash;
  /** Share in basis points (e.g., 2500 = 25%) */
  shareBp: BasisPoints;
  /** Minimum payment threshold in lovelace */
  minThreshold: bigint;
}

/**
 * Configuration for royalty distribution (on-chain datum)
 */
export interface RoyaltyConfig {
  /** NFT policy ID this config applies to */
  nftPolicyId: PolicyId;
  /** NFT asset name */
  nftAssetName: AssetName;
  /** List of recipients and their shares */
  recipients: RoyaltyRecipient[];
  /** Version for datum migration support */
  version: number;
  /** Admin key for configuration updates */
  adminKey: VerificationKeyHash;
  /** Lock time for time-based releases (POSIX ms) */
  lockUntil: number | null;
}

/**
 * Actions that can be performed on royalty UTXOs
 */
export type RoyaltyRedeemer =
  | { type: 'Distribute' }
  | { type: 'UpdateConfig'; newConfig: RoyaltyConfig }
  | { type: 'EmergencyWithdraw' }
  | { type: 'ClaimShare'; recipientIndex: number };

/**
 * HTLC datum for cross-chain atomic swaps
 */
export interface HTLCDatum {
  /** Recipient on successful swap */
  recipient: VerificationKeyHash;
  /** Refund address on timeout */
  refundAddress: VerificationKeyHash;
  /** Hash of the secret (SHA-256) */
  secretHash: string;
  /** Timeout in POSIX milliseconds */
  timeout: number;
  /** Token policy ID */
  tokenPolicy: PolicyId;
  /** Token asset name */
  tokenName: AssetName;
  /** Token amount */
  tokenAmount: bigint;
}

/**
 * HTLC redemption actions
 */
export type HTLCRedeemer =
  | { type: 'Claim'; secret: string }
  | { type: 'Refund' };

/**
 * Governance proposal datum
 */
export interface GovernanceDatum {
  proposalId: string;
  thresholdBp: BasisPoints;
  deadline: number;
  yesVotes: bigint;
  noVotes: bigint;
  action: TreasuryAction;
}

/**
 * Treasury actions that can be executed by governance
 */
export type TreasuryAction =
  | { type: 'Transfer'; to: VerificationKeyHash; amount: bigint }
  | { type: 'UpdateRoyalty'; configRef: string }
  | { type: 'MintTokens'; amount: bigint };

/**
 * Result type for transaction building operations
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Error types for transaction building
 */
export class TransactionBuildError extends Error {
  constructor(
    message: string,
    public readonly code: TransactionErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TransactionBuildError';
  }
}

export enum TransactionErrorCode {
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_DATUM = 'INVALID_DATUM',
  INVALID_REDEEMER = 'INVALID_REDEEMER',
  UTXO_NOT_FOUND = 'UTXO_NOT_FOUND',
  SCRIPT_ERROR = 'SCRIPT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_SHARES = 'INVALID_SHARES',
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate that shares sum to exactly 100% (10000 basis points)
 */
export function validateShares(recipients: RoyaltyRecipient[]): boolean {
  const total = recipients.reduce((acc, r) => acc + r.shareBp, 0);
  return total === MAX_BASIS_POINTS;
}

/**
 * Calculate payment amount from total based on basis points
 */
export function calculateShare(total: bigint, shareBp: BasisPoints): bigint {
  return (total * BigInt(shareBp)) / BigInt(MAX_BASIS_POINTS);
}

/**
 * Check if recipient meets minimum threshold
 */
export function meetsThreshold(amount: bigint, recipient: RoyaltyRecipient): boolean {
  return amount >= recipient.minThreshold;
}
