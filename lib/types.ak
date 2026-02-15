//// Core types for the Psyndica EUTXO royalty distribution system.
//// 
//// This module defines versioned datums, redeemers, and shared types
//// used across all validators. Following the supervision tree model,
//// types are designed for explicit state transitions and failure isolation.

use aiken/crypto.{Blake2b_224, Hash, VerificationKeyHash}
use aiken/interval.{Interval}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference}

// ============================================================================
// Common Types
// ============================================================================

/// Verification key hash alias for readability
pub type PubKeyHash =
  Hash<Blake2b_224, VerificationKeyHash>

/// Percentage represented as basis points (1/100th of a percent)
/// 10000 = 100%, 5000 = 50%, 100 = 1%
pub type BasisPoints =
  Int

/// Version number for datum migration support
pub type Version =
  Int

// ============================================================================
// Royalty Distribution Types
// ============================================================================

/// A single recipient in a royalty split
pub type RoyaltyRecipient {
  /// The recipient's payment credential
  address: PubKeyHash,
  /// Share in basis points (must sum to 10000 across all recipients)
  share_bps: BasisPoints,
  /// Optional minimum payment threshold (in lovelace)
  min_threshold: Option<Int>,
}

/// Royalty configuration datum - versioned for upgradability
pub type RoyaltyDatum {
  RoyaltyDatumV1 {
    /// Version tag for datum migration
    version: Version,
    /// NFT policy ID this royalty config applies to
    nft_policy_id: PolicyId,
    /// List of royalty recipients with their shares
    recipients: List<RoyaltyRecipient>,
    /// Admin who can update the configuration
    admin: PubKeyHash,
    /// Whether the config is locked (immutable)
    is_locked: Bool,
  }
}

/// Actions that can be performed on royalty UTXOs
pub type RoyaltyRedeemer {
  /// Distribute accumulated royalties to recipients
  Distribute
  /// Update royalty configuration (admin only, if not locked)
  UpdateConfig { new_recipients: List<RoyaltyRecipient> }
  /// Lock the configuration permanently
  LockConfig
  /// Withdraw funds (admin only, emergency recovery)
  AdminWithdraw
}

// ============================================================================
// HTLC (Hash Time-Locked Contract) Types
// ============================================================================

/// HTLC datum for cross-chain atomic swaps
pub type HTLCDatum {
  HTLCDatumV1 {
    version: Version,
    /// Hash of the secret (Blake2b-256)
    secret_hash: ByteArray,
    /// Recipient who can claim with the secret
    recipient: PubKeyHash,
    /// Refund address if timeout expires
    refund_address: PubKeyHash,
    /// Deadline for claiming (POSIX timestamp)
    deadline: Int,
    /// Amount locked in lovelace
    locked_amount: Int,
  }
}

/// HTLC redeemer actions
pub type HTLCRedeemer {
  /// Claim funds by revealing the secret
  Claim { secret: ByteArray }
  /// Refund after deadline has passed
  Refund
}

// ============================================================================
// Escrow Types
// ============================================================================

/// Signature requirement for multi-sig escrow
pub type SignatureRequirement {
  /// List of authorized signers
  signers: List<PubKeyHash>,
  /// Minimum signatures required (M of N)
  threshold: Int,
}

/// Escrow datum for revenue distribution
pub type EscrowDatum {
  EscrowDatumV1 {
    version: Version,
    /// Beneficiary who receives funds on release
    beneficiary: PubKeyHash,
    /// Multi-sig requirement for release
    release_signers: SignatureRequirement,
    /// Multi-sig requirement for refund
    refund_signers: SignatureRequirement,
    /// Optional deadline for automatic refund eligibility
    refund_deadline: Option<Int>,
    /// Reference to originating transaction (for tracking)
    origin_ref: Option<OutputReference>,
  }
}

/// Escrow redeemer actions
pub type EscrowRedeemer {
  /// Release funds to beneficiary (requires release signatures)
  Release
  /// Refund to depositor (requires refund signatures or deadline passed)
  RefundEscrow
  /// Partial release of specified amount
  PartialRelease { amount: Int }
}

// ============================================================================
// Governance Types
// ============================================================================

/// Proposal status in DAO governance
pub type ProposalStatus {
  /// Proposal is open for voting
  Active
  /// Proposal passed and is being executed
  Passed
  /// Proposal was rejected
  Rejected
  /// Proposal was executed
  Executed
}

/// Governance proposal datum
pub type GovernanceDatum {
  GovernanceDatumV1 {
    version: Version,
    /// Proposal identifier
    proposal_id: ByteArray,
    /// Description hash (actual description stored off-chain)
    description_hash: ByteArray,
    /// Votes in favor
    yes_votes: Int,
    /// Votes against
    no_votes: Int,
    /// Voting deadline
    voting_deadline: Int,
    /// Execution deadline (must execute before this)
    execution_deadline: Int,
    /// Current status
    status: ProposalStatus,
    /// Proposer address
    proposer: PubKeyHash,
  }
}

/// Governance redeemer actions
pub type GovernanceRedeemer {
  /// Cast a vote on the proposal
  Vote { in_favor: Bool, voter: PubKeyHash, voting_power: Int }
  /// Finalize voting and update status
  Finalize
  /// Execute a passed proposal
  Execute
  /// Cancel proposal (proposer only, before deadline)
  Cancel
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Validate that basis points sum to exactly 100% (10000)
pub fn validate_shares(recipients: List<RoyaltyRecipient>) -> Bool {
  let total =
    list_fold(
      recipients,
      0,
      fn(recipient, acc) { acc + recipient.share_bps },
    )
  total == 10000
}

/// Check if a share value is within valid range
pub fn is_valid_share(share_bps: BasisPoints) -> Bool {
  share_bps >= 0 && share_bps <= 10000
}

/// Calculate payout amount based on share
pub fn calculate_payout(total_amount: Int, share_bps: BasisPoints) -> Int {
  total_amount * share_bps / 10000
}

/// Verify signature threshold is met
pub fn meets_threshold(
  signed_by: List<PubKeyHash>,
  requirement: SignatureRequirement,
) -> Bool {
  let valid_signatures =
    list_fold(
      requirement.signers,
      0,
      fn(signer, acc) {
        if list_has(signed_by, signer) {
          acc + 1
        } else {
          acc
        }
      },
    )
  valid_signatures >= requirement.threshold
}

// ============================================================================
// List Utility Functions (avoiding stdlib dependency issues)
// ============================================================================

fn list_fold(list: List<a>, initial: b, f: fn(a, b) -> b) -> b {
  when list is {
    [] -> initial
    [head, ..tail] -> list_fold(tail, f(head, initial), f)
  }
}

fn list_has(list: List<a>, item: a) -> Bool {
  when list is {
    [] -> False
    [head, ..tail] ->
      if head == item {
        True
      } else {
        list_has(tail, item)
      }
  }
}
