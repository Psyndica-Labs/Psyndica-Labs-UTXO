//// Hash Time-Locked Contract (HTLC) Validator
////
//// This validator enables cross-chain atomic swaps between Bitcoin and Cardano
//// through the Cardinal Protocol. It locks funds that can be claimed by revealing
//// a secret (hash preimage) or refunded after a timeout.
////
//// Cross-Chain Flow:
//// 1. Alice locks BTC in Bitcoin HTLC with hash(secret)
//// 2. Bob locks ADA in this Cardano HTLC with same hash(secret)
//// 3. Alice claims ADA by revealing secret → Bob learns secret
//// 4. Bob claims BTC using revealed secret
////
//// Failure Modes (Crash Fast):
//// - Invalid secret (hash mismatch) → rejection
//// - Claim after deadline → rejection
//// - Refund before deadline → rejection

use aiken/crypto.{blake2b_256}
use cardano/address.{Address, VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, ValidityRange,
}
use psyndica/types.{
  Claim, HTLCDatum, HTLCDatumV1, HTLCRedeemer, PubKeyHash, Refund,
}

// ============================================================================
// Validator Entry Point
// ============================================================================

/// HTLC validator predicate
validator htlc {
  spend(
    datum_opt: Option<HTLCDatum>,
    redeemer: HTLCRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    // Crash fast: datum must exist
    expect Some(datum) = datum_opt
    
    when datum is {
      HTLCDatumV1 {
        version,
        secret_hash,
        recipient,
        refund_address,
        deadline,
        locked_amount,
      } -> {
        when redeemer is {
          Claim { secret } -> {
            // Verify secret hashes to expected value
            let computed_hash = blake2b_256(secret)
            let hash_valid = computed_hash == secret_hash
            
            // Verify transaction signed by recipient
            let signed_by_recipient = is_signed_by(tx, recipient)
            
            // Verify deadline has NOT passed (can only claim before deadline)
            let before_deadline = tx_before_deadline(tx.validity_range, deadline)
            
            // Verify output goes to recipient with at least locked amount
            let output_valid = has_output_to_address(
              tx.outputs,
              recipient,
              locked_amount,
            )
            
            and {
              hash_valid,
              signed_by_recipient,
              before_deadline,
              output_valid,
            }
          }
          
          Refund -> {
            // Verify deadline HAS passed
            let after_deadline = tx_after_deadline(tx.validity_range, deadline)
            
            // Verify transaction signed by refund address
            let signed_by_refunder = is_signed_by(tx, refund_address)
            
            // Verify output goes to refund address
            let output_valid = has_output_to_address(
              tx.outputs,
              refund_address,
              locked_amount,
            )
            
            and {
              after_deadline,
              signed_by_refunder,
              output_valid,
            }
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
// Time Validation Helpers
// ============================================================================

/// Check if transaction validity range is entirely before deadline
fn tx_before_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.upper_bound.bound_type is {
    Finite(upper) -> upper < deadline
    _ -> False // Unbounded upper bound is not allowed
  }
}

/// Check if transaction validity range is entirely after deadline
fn tx_after_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.lower_bound.bound_type is {
    Finite(lower) -> lower >= deadline
    _ -> False // Unbounded lower bound is not allowed
  }
}

// ============================================================================
// Transaction Validation Helpers
// ============================================================================

/// Verify transaction is signed by the specified key
fn is_signed_by(tx: Transaction, pkh: PubKeyHash) -> Bool {
  list_has(tx.extra_signatories, pkh)
}

/// Check if an output pays to the specified address
fn has_output_to_address(
  outputs: List<Output>,
  recipient: PubKeyHash,
  min_amount: Int,
) -> Bool {
  when outputs is {
    [] -> False
    [output, ..rest] -> {
      let is_recipient = when output.address.payment_credential is {
        VerificationKey(hash) -> hash == recipient
        _ -> False
      }
      
      if is_recipient && lovelace_of(output.value) >= min_amount {
        True
      } else {
        has_output_to_address(rest, recipient, min_amount)
      }
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

test hash_preimage_verification() {
  // Test that blake2b_256 produces consistent results
  let secret = "test_secret_123"
  let hash1 = blake2b_256(secret)
  let hash2 = blake2b_256(secret)
  hash1 == hash2
}

test different_secrets_produce_different_hashes() {
  let secret1 = "secret_one"
  let secret2 = "secret_two"
  blake2b_256(secret1) != blake2b_256(secret2)
}
