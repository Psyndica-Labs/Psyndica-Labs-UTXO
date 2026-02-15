/**
 * Psyndica EUTXO Off-chain Types
 * 
 * TypeScript representations of on-chain datum and redeemer structures.
 * These types mirror the Aiken types exactly for serialization compatibility.
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

/** Hex-encoded 28-byte verification key hash */
export type VerificationKeyHash = string;

/** Hex-encoded policy ID (28 bytes) */
export type PolicyId = string;

/** Hex-encoded token name */
export type TokenName = string;

/** Lovelace amount (1 ADA = 1,000,000 lovelace) */
export type Lovelace = bigint;

/** POSIX timestamp in milliseconds */
export type POSIXTime = number;

// ============================================================================
// ROYALTY DISTRIBUTION TYPES
// ============================================================================

/**
 * Royalty recipient configuration
 * Mirrors: RoyaltyRecipient in types.ak
 */
export interface RoyaltyRecipient {
  /** Payment credential hash (artist/collaborator wallet) */
  address: VerificationKeyHash;
  /** Share in basis points (0-10000, where 10000 = 100%) */
  shareBps: number;
  /** Minimum payout threshold in lovelace */
  minPayout: Lovelace;
}

/**
 * Royalty distribution datum
 * Mirrors: RoyaltyDatum in types.ak
 */
export interface RoyaltyDatum {
  /** NFT policy ID this royalty config applies to */
  nftPolicyId: PolicyId;
  /** Token name for specific NFT (or empty for collection-wide) */
  nftTokenName: TokenName;
  /** List of royalty recipients with shares */
  recipients: RoyaltyRecipient[];
  /** Creator/admin who can update configuration */
  admin: VerificationKeyHash;
  /** Protocol version for upgrades */
  protocolVersion: number;
}

/**
 * Royalty redeemer actions
 * Mirrors: RoyaltyRedeemer in types.ak
 */
export type RoyaltyRedeemer =
  | { type: 'Distribute' }
  | { type: 'UpdateConfig'; newRecipients: RoyaltyRecipient[] }
  | { type: 'AdminWithdraw' };

// ============================================================================
// ESCROW TYPES
// ============================================================================

/**
 * Escrow state machine states
 * Mirrors: EscrowState in types.ak
 */
export type EscrowState = 'Locked' | 'Claiming' | 'Completed' | 'Refunded';

/**
 * Escrow datum for HTLC contracts
 * Mirrors: EscrowDatum in types.ak
 */
export interface EscrowDatum {
  /** Party depositing funds */
  depositor: VerificationKeyHash;
  /** Party receiving funds on successful claim */
  beneficiary: VerificationKeyHash;
  /** SHA256 hash of the secret */
  secretHash: string;
  /** Claim deadline (POSIX timestamp in ms) */
  deadline: POSIXTime;
  /** Amount in lovelace */
  amount: Lovelace;
  /** Current state */
  state: EscrowState;
  /** Bitcoin transaction reference for Cardinal bridge */
  btcTxRef?: string;
}

/**
 * Escrow redeemer actions
 * Mirrors: EscrowRedeemer in types.ak
 */
export type EscrowRedeemer =
  | { type: 'Claim'; secret: string }
  | { type: 'Refund' }
  | { type: 'Cancel' };

// ============================================================================
// GOVERNANCE TYPES
// ============================================================================

/**
 * Proposal status
 * Mirrors: ProposalStatus in types.ak
 */
export type ProposalStatus = 
  | 'Active'
  | 'Passed'
  | 'Failed'
  | 'Executed'
  | 'Cancelled';

/**
 * Admin action types
 */
export type AdminAction = 'Add' | 'Remove';

/**
 * Proposal type variants
 * Mirrors: ProposalType in types.ak
 */
export type ProposalType =
  | { type: 'ParameterChange'; paramKey: string; newValue: string }
  | { type: 'TreasurySpend'; recipient: VerificationKeyHash; amount: Lovelace }
  | { type: 'AdminChange'; target: VerificationKeyHash; action: AdminAction }
  | { type: 'ProtocolUpgrade'; newVersion: number };

/**
 * Governance proposal datum
 * Mirrors: ProposalDatum in types.ak
 */
export interface ProposalDatum {
  /** Unique proposal identifier */
  proposalId: number;
  /** Proposal type and parameters */
  proposalType: ProposalType;
  /** Proposer address */
  proposer: VerificationKeyHash;
  /** Voting deadline */
  deadline: POSIXTime;
  /** Current status */
  status: ProposalStatus;
  /** Votes for (in governance tokens) */
  votesFor: bigint;
  /** Votes against */
  votesAgainst: bigint;
  /** Quorum required */
  quorum: bigint;
  /** Required approval threshold (basis points) */
  thresholdBps: number;
}

/**
 * Treasury datum
 * Mirrors: TreasuryDatum in types.ak
 */
export interface TreasuryDatum {
  /** List of admin verification key hashes */
  admins: VerificationKeyHash[];
  /** Minimum signatures required */
  minSignatures: number;
  /** Total ADA held */
  totalAda: Lovelace;
  /** Governance token policy ID */
  govTokenPolicy: PolicyId;
}

/**
 * Governance redeemer actions
 * Mirrors: GovernanceRedeemer in types.ak
 */
export type GovernanceRedeemer =
  | { type: 'CreateProposal'; proposal: ProposalType }
  | { type: 'Vote'; proposalId: number; support: boolean; amount: bigint }
  | { type: 'Execute'; proposalId: number }
  | { type: 'CancelProposal'; proposalId: number }
  | { type: 'TreasuryWithdraw'; amount: Lovelace; signatures: string[] };

// ============================================================================
// SUPERVISION TREE TYPES
// ============================================================================

/**
 * Process status for supervision tree
 * Mirrors: ProcessStatus in types.ak
 */
export type ProcessStatus =
  | { type: 'Running' }
  | { type: 'Crashed'; errorCode: number; message: string }
  | { type: 'Restarting' }
  | { type: 'Stopped' };

/**
 * Supervision strategy (Erlang-style)
 * Mirrors: SupervisionStrategy in types.ak
 */
export type SupervisionStrategy =
  | 'OneForOne'   // Restart only crashed process
  | 'OneForAll'   // Restart all children
  | 'RestForOne'; // Restart crashed + all after it

/**
 * Configuration for a supervised process
 */
export interface SupervisedProcessConfig {
  /** Unique process identifier */
  id: string;
  /** Maximum restart attempts before escalating */
  maxRestarts: number;
  /** Time window for restart counting (ms) */
  restartWindow: number;
  /** Backoff strategy for restarts */
  backoffMs: number;
}

/**
 * Supervisor configuration
 */
export interface SupervisorConfig {
  /** Supervision strategy */
  strategy: SupervisionStrategy;
  /** Child process configurations */
  children: SupervisedProcessConfig[];
  /** Maximum restarts before supervisor crashes */
  maxRestarts: number;
  /** Time window for supervisor restart counting */
  restartWindow: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Transaction building result
 */
export interface TransactionResult {
  /** Unsigned transaction CBOR */
  unsignedTx: string;
  /** Estimated fee in lovelace */
  fee: Lovelace;
  /** UTXOs consumed */
  inputs: string[];
  /** UTXOs created */
  outputs: string[];
}
