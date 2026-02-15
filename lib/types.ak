/// Core types for Psyndica royalty distribution
/// Following EUTXO principles: all state is explicit in datum structures

use aiken/collection/list

/// Verification key hash for identifying participants
pub type VerificationKeyHash =
  ByteArray

/// Policy ID for tokens
pub type PolicyId =
  ByteArray

/// Asset name for tokens
pub type AssetName =
  ByteArray

/// Basis points for percentage calculations (1 bp = 0.01%)
/// Using integer math avoids floating point non-determinism
pub type BasisPoints =
  Int

/// Maximum basis points (100% = 10000 bp)
pub const max_basis_points: Int = 10000

/// Represents a single royalty recipient with their share
pub type RoyaltyRecipient {
  /// Payment address (verification key hash)
  address: VerificationKeyHash,
  /// Share in basis points (e.g., 2500 = 25%)
  share_bp: BasisPoints,
  /// Minimum payment threshold in lovelace
  min_threshold: Int,
}

/// Configuration for royalty distribution
/// Immutable once set - state transitions require new UTXO
pub type RoyaltyConfig {
  /// NFT policy ID this config applies to
  nft_policy_id: PolicyId,
  /// NFT asset name
  nft_asset_name: AssetName,
  /// List of recipients and their shares
  recipients: List<RoyaltyRecipient>,
  /// Version for datum migration support
  version: Int,
  /// Admin key for configuration updates
  admin_key: VerificationKeyHash,
  /// Lock time for time-based releases (POSIX ms)
  lock_until: Option<Int>,
}

/// Actions that can be performed on royalty UTXOs
pub type RoyaltyRedeemer {
  /// Distribute accumulated royalties to recipients
  Distribute
  /// Update configuration (admin only)
  UpdateConfig { new_config: RoyaltyConfig }
  /// Emergency withdrawal (admin only, with timelock)
  EmergencyWithdraw
  /// Claim individual share (for pull-based distribution)
  ClaimShare { recipient_index: Int }
}

/// HTLC (Hash Time-Locked Contract) for cross-chain atomic swaps
/// Used for Cardinal Protocol integration with Bitcoin
pub type HTLCDatum {
  /// Recipient on successful swap
  recipient: VerificationKeyHash,
  /// Refund address on timeout
  refund_address: VerificationKeyHash,
  /// Hash of the secret
  secret_hash: ByteArray,
  /// Timeout in POSIX milliseconds
  timeout: Int,
  /// Token to be transferred
  token_policy: PolicyId,
  token_name: AssetName,
  token_amount: Int,
}

/// HTLC redemption actions
pub type HTLCRedeemer {
  /// Claim with secret preimage
  Claim { secret: ByteArray }
  /// Refund after timeout
  Refund
}

/// Governance voting datum for DAO treasury
pub type GovernanceDatum {
  /// Proposal being voted on
  proposal_id: ByteArray,
  /// Required threshold (basis points of total supply)
  threshold_bp: BasisPoints,
  /// Voting deadline
  deadline: Int,
  /// Current yes votes in token units
  yes_votes: Int,
  /// Current no votes in token units
  no_votes: Int,
  /// Treasury action if passed
  action: TreasuryAction,
}

/// Actions the DAO can execute
pub type TreasuryAction {
  /// Transfer tokens to address
  Transfer { to: VerificationKeyHash, amount: Int }
  /// Update royalty configuration
  UpdateRoyalty { config_ref: ByteArray }
  /// Mint governance tokens
  MintTokens { amount: Int }
}

/// Governance voting redeemers
pub type GovernanceRedeemer {
  /// Cast vote
  Vote { amount: Int, direction: Bool }
  /// Execute passed proposal
  Execute
  /// Cancel expired proposal
  Cancel
}

/// Payment channel state for streaming payments
pub type ChannelDatum {
  /// Channel participants
  party_a: VerificationKeyHash,
  party_b: VerificationKeyHash,
  /// Current balance split [party_a_balance, party_b_balance]
  balances: (Int, Int),
  /// Sequence number for state updates
  sequence: Int,
  /// Dispute deadline after challenge
  dispute_deadline: Option<Int>,
  /// Channel timeout for force-close
  channel_timeout: Int,
}

/// Payment channel redeemers
pub type ChannelRedeemer {
  /// Cooperative close with both signatures
  CooperativeClose
  /// Initiate dispute with state proof
  InitiateDispute { new_balances: (Int, Int), new_sequence: Int }
  /// Finalize dispute after timeout
  FinalizeDispute
  /// Force close after channel timeout
  ForceClose
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Validate that shares sum to exactly 100% (10000 basis points)
pub fn validate_shares(recipients: List<RoyaltyRecipient>) -> Bool {
  let total =
    list.foldl(recipients, 0, fn(r, acc) { acc + r.share_bp })
  total == max_basis_points
}

/// Calculate payment amount from total based on basis points
pub fn calculate_share(total: Int, share_bp: BasisPoints) -> Int {
  total * share_bp / max_basis_points
}

/// Check if recipient meets minimum threshold
pub fn meets_threshold(amount: Int, recipient: RoyaltyRecipient) -> Bool {
  amount >= recipient.min_threshold
}
