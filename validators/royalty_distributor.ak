/// Royalty Distributor Validator
/// 
/// Implements the core royalty distribution logic for music NFTs.
/// Following supervision tree principles:
/// - Pure predicate: (Datum, Redeemer, ScriptContext) → Bool
/// - Fail fast on invalid inputs
/// - Explicit state transitions
///
/// Revenue Flow:
/// 1. Streaming platforms send ADA to script address
/// 2. Anyone can trigger Distribute to pay out recipients
/// 3. Admin can update configuration or emergency withdraw

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash, blake2b_256}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use psyndica/types.{
  AdminWithdraw, Distribute, RoyaltyDatum, RoyaltyRedeemer, RoyaltyRecipient,
  UpdateConfig, calculate_payout, validate_shares,
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/// Minimum ADA that must remain in the script (prevents accidental drain)
const min_script_balance: Int = 2_000_000

/// Minimum distribution amount (gas efficiency threshold)
const min_distribution: Int = 5_000_000

// ============================================================================
// VALIDATOR
// ============================================================================

validator royalty_distributor {
  spend(
    datum_opt: Option<RoyaltyDatum>,
    redeemer: RoyaltyRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    // FAIL FAST: Datum must exist
    expect Some(datum) = datum_opt

    when redeemer is {
      Distribute -> validate_distribution(datum, own_ref, tx)
      UpdateConfig { new_recipients } ->
        validate_config_update(datum, new_recipients, tx)
      AdminWithdraw -> validate_admin_withdraw(datum, tx)
    }
  }

  else(_redeemer) {
    fail @"Unsupported script purpose"
  }
}

// ============================================================================
// DISTRIBUTION LOGIC
// ============================================================================

/// Validate that royalties are distributed correctly to all recipients
fn validate_distribution(
  datum: RoyaltyDatum,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  // Find our own input
  let own_input = find_own_input(tx.inputs, own_ref)
  let input_value = lovelace_of(own_input.output.value)

  // Calculate distributable amount (total - minimum balance)
  let distributable = input_value - min_script_balance

  // FAIL FAST: Must have enough to distribute
  expect distributable >= min_distribution

  // Verify each recipient receives their correct share
  let all_paid =
    list.all(
      datum.recipients,
      fn(recipient) {
        verify_recipient_payment(recipient, distributable, tx.outputs)
      },
    )

  // Verify script output maintains minimum balance with same datum
  let script_continues =
    verify_continuing_output(own_input.output.address, datum, tx.outputs)

  all_paid && script_continues
}

/// Verify a single recipient received their correct payment
fn verify_recipient_payment(
  recipient: RoyaltyRecipient,
  total: Int,
  outputs: List<Output>,
) -> Bool {
  let expected_amount = calculate_payout(total, recipient.share_bps)

  // Skip if below minimum payout (will accumulate for next distribution)
  if expected_amount < recipient.min_payout {
    True
  } else {
    // Find output paying this recipient
    list.any(
      outputs,
      fn(output) {
        let pays_correct_address =
          match_recipient_address(output.address, recipient.address)
        let pays_correct_amount = lovelace_of(output.value) >= expected_amount
        pays_correct_address && pays_correct_amount
      },
    )
  }
}

/// Check if output address matches recipient's verification key hash
fn match_recipient_address(addr: Address, vkh: VerificationKeyHash) -> Bool {
  when addr.payment_credential is {
    VerificationKey(hash) -> hash == vkh
    Script(_) -> False
  }
}

/// Verify the script continues with correct datum and minimum balance
fn verify_continuing_output(
  script_addr: Address,
  datum: RoyaltyDatum,
  outputs: List<Output>,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      let correct_address = output.address == script_addr
      let has_min_balance = lovelace_of(output.value) >= min_script_balance
      let has_correct_datum =
        when output.datum is {
          InlineDatum(d) -> {
            expect new_datum: RoyaltyDatum = d
            // Datum must be unchanged during distribution
            datum == new_datum
          }
          _ -> False
        }
      correct_address && has_min_balance && has_correct_datum
    },
  )
}

// ============================================================================
// CONFIGURATION UPDATE LOGIC
// ============================================================================

/// Validate admin can update recipient configuration
fn validate_config_update(
  datum: RoyaltyDatum,
  new_recipients: List<RoyaltyRecipient>,
  tx: Transaction,
) -> Bool {
  // FAIL FAST: Admin must sign
  let admin_signed = list.has(tx.extra_signatories, datum.admin)
  expect admin_signed

  // FAIL FAST: New shares must sum to 100%
  let valid_shares = validate_shares(new_recipients)
  expect valid_shares

  // FAIL FAST: Must have at least one recipient
  let has_recipients = !list.is_empty(new_recipients)
  expect has_recipients

  True
}

// ============================================================================
// ADMIN WITHDRAW LOGIC
// ============================================================================

/// Validate emergency admin withdrawal
fn validate_admin_withdraw(datum: RoyaltyDatum, tx: Transaction) -> Bool {
  // Only admin can withdraw
  list.has(tx.extra_signatories, datum.admin)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Find our own input in the transaction
fn find_own_input(inputs: List<Input>, own_ref: OutputReference) -> Input {
  expect Some(input) =
    list.find(inputs, fn(input) { input.output_reference == own_ref })
  input
}

// ============================================================================
// TESTS
// ============================================================================

// Unit tests are in lib/types.ak
// Integration tests use the transaction simulator
