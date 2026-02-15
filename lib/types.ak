/// Psyndica EUTXO Types
/// Implements versioned datum wrappers following Erlang supervision tree principles:
/// - Isolated state per component
/// - Explicit state transitions
/// - Backward-compatible datum versioning

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}

// ============================================================================
// VERSIONING WRAPPER
// Enables datum migration without breaking existing UTXOs
// ============================================================================

/// Version wrapper for forward-compatible datum evolution
/// When upgrading datum structure:
/// 1. Create new version variant
/// 2. Update validators to handle both versions
/// 3. Migrate UTXOs through spend-and-recreate pattern
pub type VersionedDatum<a> {
  V1(a)
  V2 { data: a, migration_metadata: ByteArray }
}

/// Extract inner datum regardless of version
pub fn unwrap_versioned<a>(versioned: VersionedDatum<a>) -> a {
  when versioned is {
    V1(data) -> data
    V2 { data, .. } -> data
  }
}

// ============================================================================
// ROYALTY DISTRIBUTION TYPES
// Core types for music NFT royalty splits
// ============================================================================

/// Represents a single royalty recipient with their share
/// Share is expressed in basis points (1/100th of a percent)
/// 10000 basis points = 100%
pub type RoyaltyRecipient {
  /// Payment credential hash (artist/collaborator wallet)
  address: VerificationKeyHash,
  /// Share in basis points (0-10000)
  share_bps: Int,
  /// Minimum payout threshold in lovelace (prevents dust outputs)
  min_payout: Int,
}

/// Datum for royalty distribution UTXOs
pub type RoyaltyDatum {
  /// NFT policy ID this royalty config applies to
  nft_policy_id: PolicyId,
  /// Token name for specific NFT (or empty for collection-wide)
  nft_token_name: ByteArray,
  /// List of royalty recipients with shares
  recipients: List<RoyaltyRecipient>,
  /// Creator/admin who can update configuration
  admin: VerificationKeyHash,
  /// Version for protocol upgrades
  protocol_version: Int,
}

/// Redeemer actions for royalty distributor
pub type RoyaltyRedeemer {
  /// Distribute accumulated royalties to recipients
  Distribute
  /// Update royalty configuration (admin only)
  UpdateConfig { new_recipients: List<RoyaltyRecipient> }
  /// Withdraw funds back to admin (emergency recovery)
  AdminWithdraw
}

// ============================================================================
// ESCROW TYPES
// HTLC-style escrow for cross-chain atomic swaps (Cardinal Protocol)
// ============================================================================

/// Escrow state machine states
pub type EscrowState {
  /// Funds locked, awaiting claim or timeout
  Locked
  /// Claim initiated, awaiting confirmation
  Claiming
  /// Escrow completed successfully
  Completed
  /// Escrow cancelled/refunded
  Refunded
}

/// Datum for escrow UTXOs (HTLC pattern)
pub type EscrowDatum {
  /// Party depositing funds (seller/sender)
  depositor: VerificationKeyHash,
  /// Party receiving funds on successful claim (buyer/receiver)
  beneficiary: VerificationKeyHash,
  /// Hash of the secret (SHA256)
  secret_hash: ByteArray,
  /// Deadline for claim (POSIX timestamp in milliseconds)
  deadline: Int,
  /// Amount in lovelace
  amount: Int,
  /// Current state machine state
  state: EscrowState,
  /// Bitcoin transaction ID for Cardinal bridge reference
  btc_tx_ref: Option<ByteArray>,
}

/// Redeemer actions for escrow
pub type EscrowRedeemer {
  /// Claim funds by revealing secret
  Claim { secret: ByteArray }
  /// Refund after deadline expires
  Refund
  /// Cancel before any claim attempt (depositor only, before deadline)
  Cancel
}

// ============================================================================
// GOVERNANCE TYPES
// DAO voting and treasury management
// ============================================================================

/// Proposal status
pub type ProposalStatus {
  /// Open for voting
  Active
  /// Voting period ended, awaiting execution
  Passed
  /// Voting period ended, insufficient votes
  Failed
  /// Proposal executed
  Executed
  /// Proposal cancelled
  Cancelled
}

/// Types of governance proposals
pub type ProposalType {
  /// Update protocol parameters
  ParameterChange { param_key: ByteArray, new_value: ByteArray }
  /// Treasury withdrawal
  TreasurySpend { recipient: VerificationKeyHash, amount: Int }
  /// Add/remove admin
  AdminChange { target: VerificationKeyHash, action: AdminAction }
  /// Upgrade protocol version
  ProtocolUpgrade { new_version: Int }
}

pub type AdminAction {
  Add
  Remove
}

/// Governance proposal datum
pub type ProposalDatum {
  /// Unique proposal identifier
  proposal_id: Int,
  /// Proposal type and parameters
  proposal_type: ProposalType,
  /// Proposer address
  proposer: VerificationKeyHash,
  /// Voting deadline (POSIX timestamp)
  deadline: Int,
  /// Current status
  status: ProposalStatus,
  /// Votes for (in governance tokens)
  votes_for: Int,
  /// Votes against (in governance tokens)
  votes_against: Int,
  /// Quorum required (in governance tokens)
  quorum: Int,
  /// Required approval percentage (basis points)
  threshold_bps: Int,
}

/// Treasury datum for DAO funds
pub type TreasuryDatum {
  /// List of admin verification key hashes (multi-sig)
  admins: List<VerificationKeyHash>,
  /// Minimum signatures required for withdrawal
  min_signatures: Int,
  /// Total ADA held (tracked for convenience)
  total_ada: Int,
  /// Governance token policy ID
  gov_token_policy: PolicyId,
}

/// Redeemer for governance actions
pub type GovernanceRedeemer {
  /// Create new proposal
  CreateProposal { proposal: ProposalType }
  /// Cast vote on proposal
  Vote { proposal_id: Int, support: Bool, amount: Int }
  /// Execute passed proposal
  Execute { proposal_id: Int }
  /// Cancel proposal (proposer only)
  CancelProposal { proposal_id: Int }
  /// Treasury withdrawal (multi-sig)
  TreasuryWithdraw { amount: Int, signatures: List<ByteArray> }
}

// ============================================================================
// SUPERVISION TREE TYPES
// Off-chain process coordination
// ============================================================================

/// Process status for supervision tree
pub type ProcessStatus {
  Running
  Crashed { error_code: Int, message: ByteArray }
  Restarting
  Stopped
}

/// Supervision strategy (Erlang-style)
pub type SupervisionStrategy {
  /// Restart only the crashed process
  OneForOne
  /// Restart all child processes
  OneForAll
  /// Restart crashed process and all processes started after it
  RestForOne
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/// Validate that royalty shares sum to exactly 10000 basis points (100%)
pub fn validate_shares(recipients: List<RoyaltyRecipient>) -> Bool {
  let total = list_sum_shares(recipients, 0)
  total == 10000
}

fn list_sum_shares(recipients: List<RoyaltyRecipient>, acc: Int) -> Int {
  when recipients is {
    [] -> acc
    [recipient, ..rest] -> list_sum_shares(rest, acc + recipient.share_bps)
  }
}

/// Check if share is within valid range
pub fn valid_share(share_bps: Int) -> Bool {
  share_bps >= 0 && share_bps <= 10000
}

/// Calculate payout amount from total based on share
pub fn calculate_payout(total: Int, share_bps: Int) -> Int {
  total * share_bps / 10000
}

// ============================================================================
// TESTS
// ============================================================================

test validate_shares_exact_100_percent() {
  let recipients =
    [
      RoyaltyRecipient {
        address: #"00112233445566778899aabbccddeeff00112233445566778899aabb",
        share_bps: 5000,
        min_payout: 1000000,
      },
      RoyaltyRecipient {
        address: #"ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544",
        share_bps: 5000,
        min_payout: 1000000,
      },
    ]
  validate_shares(recipients)
}

test validate_shares_multiple_recipients() {
  let recipients =
    [
      RoyaltyRecipient {
        address: #"00112233445566778899aabbccddeeff00112233445566778899aabb",
        share_bps: 7000,
        min_payout: 1000000,
      },
      RoyaltyRecipient {
        address: #"ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544",
        share_bps: 2000,
        min_payout: 500000,
      },
      RoyaltyRecipient {
        address: #"aabbccddeeff00112233445566778899aabbccddeeff001122334455",
        share_bps: 1000,
        min_payout: 500000,
      },
    ]
  validate_shares(recipients)
}

test calculate_payout_50_percent() {
  calculate_payout(1000000, 5000) == 500000
}

test calculate_payout_small_share() {
  calculate_payout(10000000, 250) == 250000
}
