/// Royalty Distribution Validator
/// 
/// Implements the core royalty distribution logic for Psyndica music NFTs.
/// Follows EUTXO principles: pure predicate validation, explicit state transitions.
/// 
/// Supervision Model:
/// - This validator is a "worker" in the supervision tree
/// - On invalid state: crash (return False) immediately
/// - Off-chain supervisor handles recovery and retry logic

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use types.{
  BasisPoints, ClaimShare, Distribute, EmergencyWithdraw, RoyaltyConfig,
  RoyaltyRedeemer, RoyaltyRecipient, UpdateConfig, calculate_share,
  max_basis_points, validate_shares,
}

// ============================================================================
// Constants
// ============================================================================

/// Minimum ADA that must remain in the contract (protocol minimum)
const min_utxo_lovelace: Int = 2_000_000

/// Emergency withdrawal timelock period (7 days in milliseconds)
const emergency_timelock_ms: Int = 604_800_000

// ============================================================================
// Main Validator
// ============================================================================

/// Main validator entry point
/// Pure predicate: (Datum, Redeemer, ScriptContext) → Bool
validator royalty_distribution {
  spend(
    datum: Option<RoyaltyConfig>,
    redeemer: RoyaltyRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // Fail fast: datum must exist
    expect Some(config) = datum

    when redeemer is {
      Distribute -> validate_distribution(config, own_ref, tx)
      UpdateConfig { new_config } ->
        validate_config_update(config, new_config, tx)
      EmergencyWithdraw -> validate_emergency_withdrawal(config, tx)
      ClaimShare { recipient_index } ->
        validate_claim(config, recipient_index, own_ref, tx)
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Distribution Logic
// ============================================================================

/// Validate that royalties are distributed correctly to all recipients
fn validate_distribution(
  config: RoyaltyConfig,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  // Check timelock if present
  let timelock_passed = check_timelock(config, tx)

  // Find our input UTXO
  expect Some(own_input) = find_own_input(own_ref, tx.inputs)

  // Calculate total available for distribution
  let total_available = lovelace_of(own_input.output.value) - min_utxo_lovelace

  // Verify each recipient receives correct share
  let all_paid =
    list.all(
      config.recipients,
      fn(recipient) {
        let expected_amount = calculate_share(total_available, recipient.share_bp)
        verify_payment_to_recipient(recipient, expected_amount, tx.outputs)
      },
    )

  // Verify contract UTXO is recreated with remaining funds
  let continuing_output_valid =
    verify_continuing_output(config, own_input.output.address, tx.outputs)

  timelock_passed && all_paid && continuing_output_valid
}

/// Verify that a recipient receives their expected payment
fn verify_payment_to_recipient(
  recipient: RoyaltyRecipient,
  expected_amount: Int,
  outputs: List<Output>,
) -> Bool {
  // Skip if amount is below threshold
  if expected_amount < recipient.min_threshold {
    True
  } else {
    // Find output paying to recipient
    let payment_found =
      list.any(
        outputs,
        fn(output) {
          when output.address.payment_credential is {
            VerificationKey(vkh) ->
              vkh == recipient.address && lovelace_of(output.value) >= expected_amount
            Script(_) -> False
          }
        },
      )
    payment_found
  }
}

/// Verify the contract UTXO continues with correct state
fn verify_continuing_output(
  config: RoyaltyConfig,
  script_address: Address,
  outputs: List<Output>,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      // Must pay back to same script address
      let same_address = output.address == script_address

      // Must have minimum UTXO
      let has_min_value = lovelace_of(output.value) >= min_utxo_lovelace

      // Must preserve config (or allow accumulation of new funds)
      let datum_preserved =
        when output.datum is {
          InlineDatum(d) -> {
            expect output_config: RoyaltyConfig = d
            output_config == config
          }
          _ -> False
        }

      same_address && has_min_value && datum_preserved
    },
  )
}

// ============================================================================
// Configuration Update Logic
// ============================================================================

/// Validate configuration update (admin only)
fn validate_config_update(
  old_config: RoyaltyConfig,
  new_config: RoyaltyConfig,
  tx: Transaction,
) -> Bool {
  // Must be signed by admin
  let admin_signed = list.has(tx.extra_signatories, old_config.admin_key)

  // New config must have valid shares (sum to 100%)
  let shares_valid = validate_shares(new_config.recipients)

  // Version must increment
  let version_valid = new_config.version == old_config.version + 1

  // NFT policy must remain unchanged (prevents hijacking)
  let nft_preserved =
    new_config.nft_policy_id == old_config.nft_policy_id && new_config.nft_asset_name == old_config.nft_asset_name

  admin_signed && shares_valid && version_valid && nft_preserved
}

// ============================================================================
// Emergency Withdrawal Logic
// ============================================================================

/// Validate emergency withdrawal (admin only, with timelock)
fn validate_emergency_withdrawal(config: RoyaltyConfig, tx: Transaction) -> Bool {
  // Must be signed by admin
  let admin_signed = list.has(tx.extra_signatories, config.admin_key)

  // Must have passed emergency timelock (measured from lock_until)
  let emergency_time_passed =
    when config.lock_until is {
      Some(lock_time) -> {
        let emergency_deadline = lock_time + emergency_timelock_ms
        check_time_passed(emergency_deadline, tx)
      }
      None -> False
    }

  admin_signed && emergency_time_passed
}

// ============================================================================
// Claim Logic (Pull-based distribution)
// ============================================================================

/// Validate individual share claim
fn validate_claim(
  config: RoyaltyConfig,
  recipient_index: Int,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  // Get recipient at index (fail fast if out of bounds)
  expect Some(recipient) = list.at(config.recipients, recipient_index)

  // Claimant must sign
  let claimant_signed = list.has(tx.extra_signatories, recipient.address)

  // Calculate their share from the UTXO
  expect Some(own_input) = find_own_input(own_ref, tx.inputs)
  let total_available = lovelace_of(own_input.output.value) - min_utxo_lovelace
  let claim_amount = calculate_share(total_available, recipient.share_bp)

  // Verify payment to claimant
  let payment_valid =
    verify_payment_to_recipient(recipient, claim_amount, tx.outputs)

  claimant_signed && payment_valid
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Find our own input UTXO
fn find_own_input(own_ref: OutputReference, inputs: List<Input>) -> Option<Input> {
  list.find(inputs, fn(input) { input.output_reference == own_ref })
}

/// Check if timelock has passed (if present)
fn check_timelock(config: RoyaltyConfig, tx: Transaction) -> Bool {
  when config.lock_until is {
    Some(lock_time) -> check_time_passed(lock_time, tx)
    None -> True
  }
}

/// Check if a specific time has passed
fn check_time_passed(deadline: Int, tx: Transaction) -> Bool {
  when tx.validity_range.lower_bound.bound_type is {
    Finite(tx_earliest) -> tx_earliest >= deadline
    _ -> False
  }
}

// ============================================================================
// Tests
// ============================================================================

test validate_shares_correct() {
  let recipients =
    [
      RoyaltyRecipient { address: #"aa", share_bp: 5000, min_threshold: 1000000 },
      RoyaltyRecipient { address: #"bb", share_bp: 3000, min_threshold: 1000000 },
      RoyaltyRecipient { address: #"cc", share_bp: 2000, min_threshold: 1000000 },
    ]
  validate_shares(recipients)
}

test validate_shares_incorrect() {
  let recipients =
    [
      RoyaltyRecipient { address: #"aa", share_bp: 5000, min_threshold: 1000000 },
      RoyaltyRecipient { address: #"bb", share_bp: 3000, min_threshold: 1000000 },
    ]
  !validate_shares(recipients)
}

test calculate_share_correct() {
  // 50% of 1,000,000 lovelace
  let result = calculate_share(1_000_000, 5000)
  result == 500_000
}

test calculate_share_handles_rounding() {
  // 33.33% of 100 lovelace - should round down
  let result = calculate_share(100, 3333)
  result == 33
}
