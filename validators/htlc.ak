/// Hash Time-Locked Contract (HTLC) Validator
/// 
/// Implements atomic swaps for cross-chain integration with Bitcoin
/// via the Cardinal Protocol. Enables trustless exchange of tokens
/// between Cardano and Bitcoin networks.
/// 
/// Supervision Model:
/// - Worker validator: crashes on invalid secret or expired timeout
/// - Bitcoin-side HTLC must use matching secret_hash
/// - Off-chain coordinator monitors both chains for completion

use aiken/collection/list
use aiken/crypto.{sha2_256}
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets.{quantity_of}
use cardano/transaction.{Output, OutputReference, Transaction}
use types.{Claim, HTLCDatum, HTLCRedeemer, Refund}

// ============================================================================
// Main Validator
// ============================================================================

/// HTLC validator entry point
/// Two possible outcomes:
/// 1. Claim: Recipient provides secret preimage matching hash
/// 2. Refund: Timeout passes, funds return to refund_address
validator htlc {
  spend(
    datum: Option<HTLCDatum>,
    redeemer: HTLCRedeemer,
    _own_ref: OutputReference,
    tx: Transaction,
  ) {
    // Fail fast: datum must exist
    expect Some(htlc_data) = datum

    when redeemer is {
      Claim { secret } -> validate_claim(htlc_data, secret, tx)
      Refund -> validate_refund(htlc_data, tx)
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Claim Logic
// ============================================================================

/// Validate claim with secret preimage
fn validate_claim(htlc_data: HTLCDatum, secret: ByteArray, tx: Transaction) -> Bool {
  // Verify secret hashes to expected value (fail fast on mismatch)
  let secret_valid = sha2_256(secret) == htlc_data.secret_hash

  // Verify claim is before timeout
  let not_expired = check_time_before(htlc_data.timeout, tx)

  // Verify recipient receives the tokens
  let payment_valid = verify_token_payment(htlc_data, htlc_data.recipient, tx.outputs)

  secret_valid && not_expired && payment_valid
}

// ============================================================================
// Refund Logic
// ============================================================================

/// Validate refund after timeout
fn validate_refund(htlc_data: HTLCDatum, tx: Transaction) -> Bool {
  // Verify timeout has passed
  let timeout_passed = check_time_after(htlc_data.timeout, tx)

  // Verify refund address receives the tokens
  let refund_valid =
    verify_token_payment(htlc_data, htlc_data.refund_address, tx.outputs)

  timeout_passed && refund_valid
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Verify that specified address receives the HTLC tokens
fn verify_token_payment(
  htlc_data: HTLCDatum,
  recipient: ByteArray,
  outputs: List<Output>,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      // Check recipient address
      let correct_recipient =
        when output.address.payment_credential is {
          VerificationKey(vkh) -> vkh == recipient
          _ -> False
        }

      // Check token amount
      let correct_amount =
        quantity_of(output.value, htlc_data.token_policy, htlc_data.token_name) >= htlc_data.token_amount

      correct_recipient && correct_amount
    },
  )
}

/// Check if current time is before deadline
fn check_time_before(deadline: Int, tx: Transaction) -> Bool {
  when tx.validity_range.upper_bound.bound_type is {
    Finite(tx_latest) -> tx_latest < deadline
    _ -> False
  }
}

/// Check if current time is after deadline
fn check_time_after(deadline: Int, tx: Transaction) -> Bool {
  when tx.validity_range.lower_bound.bound_type is {
    Finite(tx_earliest) -> tx_earliest >= deadline
    _ -> False
  }
}

// ============================================================================
// Tests
// ============================================================================

test secret_hash_verification() {
  let secret = "my_secret_preimage"
  let expected_hash = sha2_256(secret)
  sha2_256(secret) == expected_hash
}

test wrong_secret_fails() {
  let correct_secret = "correct_secret"
  let wrong_secret = "wrong_secret"
  let expected_hash = sha2_256(correct_secret)
  sha2_256(wrong_secret) != expected_hash
}
