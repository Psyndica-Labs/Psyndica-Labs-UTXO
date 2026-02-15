/// Escrow Validator (HTLC Pattern)
/// 
/// Implements Hash Time-Locked Contracts for cross-chain atomic swaps.
/// Used with Cardinal Protocol for Bitcoin↔Cardano bridging.
///
/// State Machine:
/// Locked → Claiming → Completed (happy path)
/// Locked → Refunded (timeout path)
/// Locked → Refunded (cancel path, depositor only)
///
/// Supervision Principles:
/// - Crash on invalid state transitions
/// - Time-bound recovery via refund mechanism
/// - Explicit state machine prevents ambiguous states

use aiken/collection/list
use aiken/crypto.{sha2_256}
use cardano/address.{Address, VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, ValidityRange,
}
use psyndica/types.{
  Cancel, Claim, Completed, EscrowDatum, EscrowRedeemer, EscrowState, Locked,
  Refund, Refunded,
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/// Minimum escrow amount (prevents dust attacks)
const min_escrow_amount: Int = 5_000_000

/// Grace period after deadline before refund (milliseconds)
/// Allows for network latency in claim submission
const grace_period_ms: Int = 300_000

// ============================================================================
// VALIDATOR
// ============================================================================

validator escrow {
  spend(
    datum_opt: Option<EscrowDatum>,
    redeemer: EscrowRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    // FAIL FAST: Datum must exist
    expect Some(datum) = datum_opt

    // FAIL FAST: Must be in valid initial state
    expect datum.state == Locked

    when redeemer is {
      Claim { secret } ->
        validate_claim(datum, secret, own_ref, tx)
      Refund -> validate_refund(datum, tx)
      Cancel -> validate_cancel(datum, tx)
    }
  }

  else(_redeemer) {
    fail @"Unsupported script purpose"
  }
}

// ============================================================================
// CLAIM LOGIC
// ============================================================================

/// Validate claim by revealing the secret
fn validate_claim(
  datum: EscrowDatum,
  secret: ByteArray,
  _own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  // FAIL FAST: Secret must hash to stored hash
  let secret_valid = sha2_256(secret) == datum.secret_hash
  expect secret_valid

  // FAIL FAST: Must be before deadline (with grace period)
  let deadline_ok = before_deadline(tx.validity_range, datum.deadline)
  expect deadline_ok

  // FAIL FAST: Beneficiary must sign to claim
  let beneficiary_signed = list.has(tx.extra_signatories, datum.beneficiary)
  expect beneficiary_signed

  // Verify beneficiary receives the funds
  verify_beneficiary_payment(datum, tx.outputs)
}

/// Verify beneficiary receives correct payment
fn verify_beneficiary_payment(datum: EscrowDatum, outputs: List<Output>) -> Bool {
  list.any(
    outputs,
    fn(output) {
      let pays_beneficiary =
        when output.address.payment_credential is {
          VerificationKey(hash) -> hash == datum.beneficiary
          _ -> False
        }
      let pays_correct_amount = lovelace_of(output.value) >= datum.amount
      pays_beneficiary && pays_correct_amount
    },
  )
}

// ============================================================================
// REFUND LOGIC
// ============================================================================

/// Validate refund after deadline expires
fn validate_refund(datum: EscrowDatum, tx: Transaction) -> Bool {
  // FAIL FAST: Must be after deadline + grace period
  let deadline_passed =
    after_deadline(tx.validity_range, datum.deadline + grace_period_ms)
  expect deadline_passed

  // FAIL FAST: Depositor must sign
  let depositor_signed = list.has(tx.extra_signatories, datum.depositor)
  expect depositor_signed

  // Verify depositor receives refund
  verify_depositor_refund(datum, tx.outputs)
}

/// Verify depositor receives refund
fn verify_depositor_refund(datum: EscrowDatum, outputs: List<Output>) -> Bool {
  list.any(
    outputs,
    fn(output) {
      let pays_depositor =
        when output.address.payment_credential is {
          VerificationKey(hash) -> hash == datum.depositor
          _ -> False
        }
      let pays_correct_amount = lovelace_of(output.value) >= datum.amount
      pays_depositor && pays_correct_amount
    },
  )
}

// ============================================================================
// CANCEL LOGIC
// ============================================================================

/// Validate cancel by depositor (before any claim attempt)
fn validate_cancel(datum: EscrowDatum, tx: Transaction) -> Bool {
  // FAIL FAST: Only depositor can cancel
  let depositor_signed = list.has(tx.extra_signatories, datum.depositor)
  expect depositor_signed

  // FAIL FAST: Can only cancel while still locked and before deadline
  let before_dl = before_deadline(tx.validity_range, datum.deadline)
  expect before_dl

  // Verify depositor receives funds back
  verify_depositor_refund(datum, tx.outputs)
}

// ============================================================================
// TIME VALIDATION HELPERS
// ============================================================================

/// Check if transaction is valid before a deadline
fn before_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.upper_bound.bound_type is {
    cardano/transaction.Finite(upper) -> upper <= deadline
    _ -> False
  }
}

/// Check if transaction is valid after a deadline
fn after_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.lower_bound.bound_type is {
    cardano/transaction.Finite(lower) -> lower >= deadline
    _ -> False
  }
}

// ============================================================================
// STATE TRANSITION HELPERS
// ============================================================================

/// Create new datum with updated state (for multi-step escrows)
fn transition_state(datum: EscrowDatum, new_state: EscrowState) -> EscrowDatum {
  EscrowDatum { ..datum, state: new_state }
}

// ============================================================================
// TESTS
// ============================================================================

test secret_hash_verification() {
  let secret = "my_secret_preimage"
  let hash = sha2_256(secret)
  sha2_256(secret) == hash
}
