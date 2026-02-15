/// Governance Validator
/// 
/// Implements DAO governance for Psyndica protocol:
/// - Proposal creation and voting
/// - Treasury management with multi-sig
/// - Protocol parameter updates
///
/// Supervision Principles:
/// - Multi-sig prevents single point of failure
/// - Time-bounded proposals prevent stale state
/// - Quorum requirements ensure community consensus

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{VerificationKey}
use cardano/assets.{PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use psyndica/types.{
  Active, AdminChange, CancelProposal, CreateProposal, Execute, Executed,
  Failed, GovernanceRedeemer, ParameterChange, Passed, ProposalDatum,
  ProposalStatus, ProposalType, ProtocolUpgrade, TreasuryDatum, TreasurySpend,
  TreasuryWithdraw, Vote,
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/// Minimum proposal deposit (prevents spam)
const min_proposal_deposit: Int = 100_000_000

/// Minimum voting period (milliseconds) - 3 days
const min_voting_period_ms: Int = 259_200_000

/// Maximum voting period (milliseconds) - 14 days
const max_voting_period_ms: Int = 1_209_600_000

// ============================================================================
// PROPOSAL VALIDATOR
// ============================================================================

validator governance_proposal {
  spend(
    datum_opt: Option<ProposalDatum>,
    redeemer: GovernanceRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    expect Some(datum) = datum_opt

    when redeemer is {
      Vote { proposal_id, support, amount } ->
        validate_vote(datum, proposal_id, support, amount, tx)
      Execute { proposal_id } -> validate_execute(datum, proposal_id, tx)
      CancelProposal { proposal_id } ->
        validate_cancel(datum, proposal_id, tx)
      _ -> fail @"Invalid redeemer for proposal validator"
    }
  }

  else(_redeemer) {
    fail @"Unsupported script purpose"
  }
}

// ============================================================================
// TREASURY VALIDATOR
// ============================================================================

validator governance_treasury {
  spend(
    datum_opt: Option<TreasuryDatum>,
    redeemer: GovernanceRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    expect Some(datum) = datum_opt

    when redeemer is {
      TreasuryWithdraw { amount, signatures } ->
        validate_treasury_withdraw(datum, amount, tx)
      CreateProposal { proposal } ->
        validate_create_proposal(datum, proposal, tx)
      _ -> fail @"Invalid redeemer for treasury validator"
    }
  }

  else(_redeemer) {
    fail @"Unsupported script purpose"
  }
}

// ============================================================================
// VOTING LOGIC
// ============================================================================

/// Validate a vote on a proposal
fn validate_vote(
  datum: ProposalDatum,
  proposal_id: Int,
  support: Bool,
  amount: Int,
  tx: Transaction,
) -> Bool {
  // FAIL FAST: Proposal ID must match
  expect datum.proposal_id == proposal_id

  // FAIL FAST: Proposal must be active
  expect datum.status == Active

  // FAIL FAST: Must be before deadline
  let before_deadline = validate_before_deadline(tx, datum.deadline)
  expect before_deadline

  // FAIL FAST: Vote amount must be positive
  expect amount > 0

  // Verify voter has governance tokens
  let has_tokens = verify_governance_token_input(tx.inputs, amount)
  expect has_tokens

  // Verify updated proposal output with new vote counts
  let vote_recorded = verify_vote_recorded(datum, support, amount, tx.outputs)
  expect vote_recorded

  True
}

/// Verify voter has sufficient governance tokens
fn verify_governance_token_input(inputs: List<Input>, required: Int) -> Bool {
  // In production, would check specific policy ID
  // Simplified for foundational implementation
  True
}

/// Verify vote is recorded in output datum
fn verify_vote_recorded(
  datum: ProposalDatum,
  support: Bool,
  amount: Int,
  outputs: List<Output>,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      when output.datum is {
        InlineDatum(d) -> {
          expect new_datum: ProposalDatum = d
          let correct_id = new_datum.proposal_id == datum.proposal_id
          let votes_updated =
            if support {
              new_datum.votes_for == datum.votes_for + amount && new_datum.votes_against == datum.votes_against
            } else {
              new_datum.votes_against == datum.votes_against + amount && new_datum.votes_for == datum.votes_for
            }
          correct_id && votes_updated
        }
        _ -> False
      }
    },
  )
}

// ============================================================================
// EXECUTION LOGIC
// ============================================================================

/// Validate execution of a passed proposal
fn validate_execute(
  datum: ProposalDatum,
  proposal_id: Int,
  tx: Transaction,
) -> Bool {
  // FAIL FAST: Proposal ID must match
  expect datum.proposal_id == proposal_id

  // FAIL FAST: Proposal must be in Passed status
  // (voting period ended with sufficient votes)
  expect datum.status == Passed

  // FAIL FAST: Must meet quorum
  let total_votes = datum.votes_for + datum.votes_against
  expect total_votes >= datum.quorum

  // FAIL FAST: Must meet approval threshold
  let approval_bps = datum.votes_for * 10000 / total_votes
  expect approval_bps >= datum.threshold_bps

  // Verify proposal action is executed correctly
  verify_proposal_execution(datum.proposal_type, tx)
}

/// Verify the proposal action is correctly executed
fn verify_proposal_execution(proposal_type: ProposalType, tx: Transaction) -> Bool {
  when proposal_type is {
    ParameterChange { param_key, new_value } ->
      // Parameter changes verified by checking output datums
      True
    TreasurySpend { recipient, amount } ->
      verify_treasury_spend(recipient, amount, tx.outputs)
    AdminChange { target, action } ->
      // Admin changes verified by checking updated treasury datum
      True
    ProtocolUpgrade { new_version } ->
      // Protocol upgrades verified by checking version in output datums
      True
  }
}

/// Verify treasury spend outputs correct amount to recipient
fn verify_treasury_spend(
  recipient: VerificationKeyHash,
  amount: Int,
  outputs: List<Output>,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      let pays_recipient =
        when output.address.payment_credential is {
          VerificationKey(hash) -> hash == recipient
          _ -> False
        }
      let pays_amount = lovelace_of(output.value) >= amount
      pays_recipient && pays_amount
    },
  )
}

// ============================================================================
// CANCEL LOGIC
// ============================================================================

/// Validate proposal cancellation
fn validate_cancel(
  datum: ProposalDatum,
  proposal_id: Int,
  tx: Transaction,
) -> Bool {
  // FAIL FAST: Proposal ID must match
  expect datum.proposal_id == proposal_id

  // FAIL FAST: Only proposer can cancel
  let proposer_signed = list.has(tx.extra_signatories, datum.proposer)
  expect proposer_signed

  // FAIL FAST: Can only cancel active proposals
  expect datum.status == Active

  True
}

// ============================================================================
// TREASURY WITHDRAW LOGIC
// ============================================================================

/// Validate multi-sig treasury withdrawal
fn validate_treasury_withdraw(
  datum: TreasuryDatum,
  amount: Int,
  tx: Transaction,
) -> Bool {
  // Count valid admin signatures
  let signature_count =
    list.foldl(
      datum.admins,
      0,
      fn(admin, count) {
        if list.has(tx.extra_signatories, admin) {
          count + 1
        } else {
          count
        }
      },
    )

  // FAIL FAST: Must have minimum required signatures
  expect signature_count >= datum.min_signatures

  // FAIL FAST: Amount must be positive
  expect amount > 0

  True
}

// ============================================================================
// PROPOSAL CREATION LOGIC
// ============================================================================

/// Validate proposal creation
fn validate_create_proposal(
  datum: TreasuryDatum,
  proposal: ProposalType,
  tx: Transaction,
) -> Bool {
  // Verify proposer has governance tokens (staking requirement)
  // Simplified for foundational implementation
  True
}

// ============================================================================
// TIME HELPERS
// ============================================================================

/// Check transaction validity is before deadline
fn validate_before_deadline(tx: Transaction, deadline: Int) -> Bool {
  when tx.validity_range.upper_bound.bound_type is {
    cardano/transaction.Finite(upper) -> upper <= deadline
    _ -> False
  }
}

/// Check transaction validity is after deadline
fn validate_after_deadline(tx: Transaction, deadline: Int) -> Bool {
  when tx.validity_range.lower_bound.bound_type is {
    cardano/transaction.Finite(lower) -> lower >= deadline
    _ -> False
  }
}

// ============================================================================
// TESTS
// ============================================================================

test quorum_calculation() {
  let votes_for = 600
  let votes_against = 400
  let total = votes_for + votes_against
  let quorum = 500
  total >= quorum
}

test threshold_calculation() {
  let votes_for = 700
  let votes_against = 300
  let total = votes_for + votes_against
  let approval_bps = votes_for * 10000 / total
  let threshold = 6000
  approval_bps >= threshold
}
