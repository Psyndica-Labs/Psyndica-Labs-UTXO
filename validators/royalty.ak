//// Royalty Distribution Validator
////
//// This validator enforces royalty split logic for music NFT revenue distribution.
//// It operates as a worker in the supervision tree, with deterministic execution
//// guaranteeing the same result for identical inputs.
////
//// Failure Modes (Crash Fast):
//// - Invalid datum structure → immediate rejection
//// - Share percentages don't sum to 100% → rejection
//// - Unauthorized admin action → rejection
//// - Locked config modification attempt → rejection

use aiken/crypto.{blake2b_256}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use types.{
  AdminWithdraw, BasisPoints, Distribute, LockConfig, PubKeyHash,
  RoyaltyDatum, RoyaltyDatumV1, RoyaltyRecipient, RoyaltyRedeemer, UpdateConfig,
  calculate_payout, validate_shares,
}

// ============================================================================
// Validator Entry Point
// ============================================================================

/// Main validator function following EUTXO predicate pattern:
/// (Datum, Redeemer, ScriptContext) → Bool
validator royalty {
  spend(
    datum_opt: Option<RoyaltyDatum>,
    redeemer: RoyaltyRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    // Crash fast: datum must be present and valid
    expect Some(datum) = datum_opt
    
    when datum is {
      RoyaltyDatumV1 { version, nft_policy_id, recipients, admin, is_locked } -> {
        // Find our own input to get the locked value
        expect Some(own_input) = find_input(tx.inputs, own_ref)
        let own_value = own_input.output.value
        let own_address = own_input.output.address
        
        when redeemer is {
          Distribute -> {
            // Verify distribution outputs match recipient shares
            validate_distribution(
              tx.outputs,
              recipients,
              lovelace_of(own_value),
              own_address,
            )
          }
          
          UpdateConfig { new_recipients } -> {
            // Admin only, not locked, valid new shares
            and {
              is_signed_by(tx, admin),
              !is_locked,
              validate_shares(new_recipients),
              has_continuing_output(
                tx.outputs,
                own_address,
                RoyaltyDatumV1 {
                  version,
                  nft_policy_id,
                  recipients: new_recipients,
                  admin,
                  is_locked,
                },
              ),
            }
          }
          
          LockConfig -> {
            // Admin only, produce locked output
            and {
              is_signed_by(tx, admin),
              !is_locked,
              has_continuing_output(
                tx.outputs,
                own_address,
                RoyaltyDatumV1 {
                  version,
                  nft_policy_id,
                  recipients,
                  admin,
                  is_locked: True,
                },
              ),
            }
          }
          
          AdminWithdraw -> {
            // Emergency withdrawal - admin only
            is_signed_by(tx, admin)
          }
        }
      }
    }
  }

  else(_) {
    fail @"Unsupported purpose"
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/// Validate that outputs correctly distribute funds to recipients
fn validate_distribution(
  outputs: List<Output>,
  recipients: List<RoyaltyRecipient>,
  total_lovelace: Int,
  script_address: Address,
) -> Bool {
  // Check each recipient receives their correct share
  validate_recipient_outputs(outputs, recipients, total_lovelace)
}

/// Recursively validate each recipient gets their share
fn validate_recipient_outputs(
  outputs: List<Output>,
  recipients: List<RoyaltyRecipient>,
  total_lovelace: Int,
) -> Bool {
  when recipients is {
    [] -> True
    [recipient, ..rest] -> {
      let expected_amount = calculate_payout(total_lovelace, recipient.share_bps)
      
      // Check minimum threshold if specified
      let meets_minimum = when recipient.min_threshold is {
        None -> True
        Some(min) -> expected_amount >= min
      }
      
      // Find output paying to recipient (skip if below minimum)
      let has_valid_output = if meets_minimum {
        has_output_to_recipient(outputs, recipient.address, expected_amount)
      } else {
        True // Skip payment if below threshold
      }
      
      has_valid_output && validate_recipient_outputs(outputs, rest, total_lovelace)
    }
  }
}

/// Check if an output exists paying at least the expected amount to recipient
fn has_output_to_recipient(
  outputs: List<Output>,
  recipient: PubKeyHash,
  expected_amount: Int,
) -> Bool {
  when outputs is {
    [] -> False
    [output, ..rest] -> {
      let is_recipient = when output.address.payment_credential is {
        VerificationKey(hash) -> hash == recipient
        Script(_) -> False
      }
      
      if is_recipient && lovelace_of(output.value) >= expected_amount {
        True
      } else {
        has_output_to_recipient(rest, recipient, expected_amount)
      }
    }
  }
}

/// Verify transaction is signed by the specified key
fn is_signed_by(tx: Transaction, pkh: PubKeyHash) -> Bool {
  list_has(tx.extra_signatories, pkh)
}

/// Check for continuing output with updated datum
fn has_continuing_output(
  outputs: List<Output>,
  address: Address,
  expected_datum: RoyaltyDatum,
) -> Bool {
  when outputs is {
    [] -> False
    [output, ..rest] -> {
      let address_matches = output.address == address
      let datum_matches = when output.datum is {
        InlineDatum(data) -> {
          expect datum: RoyaltyDatum = data
          datum == expected_datum
        }
        _ -> False
      }
      
      if address_matches && datum_matches {
        True
      } else {
        has_continuing_output(rest, address, expected_datum)
      }
    }
  }
}

/// Find input by output reference
fn find_input(inputs: List<Input>, ref: OutputReference) -> Option<Input> {
  when inputs is {
    [] -> None
    [input, ..rest] ->
      if input.output_reference == ref {
        Some(input)
      } else {
        find_input(rest, ref)
      }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

test validate_shares_sums_correctly() {
  let recipients = [
    RoyaltyRecipient {
      address: #"00000000000000000000000000000000000000000000000000000001",
      share_bps: 7000,
      min_threshold: None,
    },
    RoyaltyRecipient {
      address: #"00000000000000000000000000000000000000000000000000000002",
      share_bps: 3000,
      min_threshold: None,
    },
  ]
  validate_shares(recipients)
}

test validate_shares_rejects_invalid() {
  let recipients = [
    RoyaltyRecipient {
      address: #"00000000000000000000000000000000000000000000000000000001",
      share_bps: 5000,
      min_threshold: None,
    },
    RoyaltyRecipient {
      address: #"00000000000000000000000000000000000000000000000000000002",
      share_bps: 3000,
      min_threshold: None,
    },
  ]
  !validate_shares(recipients)
}

test calculate_payout_correct() {
  // 70% of 1,000,000 lovelace = 700,000
  calculate_payout(1_000_000, 7000) == 700_000
}
