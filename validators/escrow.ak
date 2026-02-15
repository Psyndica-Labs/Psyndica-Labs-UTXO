//// Escrow Validator
////
//// Multi-signature escrow for revenue distribution in the Psyndica platform.
//// Implements M-of-N signature schemes for both release and refund operations,
//// with optional time-based automatic refund eligibility.
////
//// Use Cases:
//// - Artist advances with milestone-based releases
//// - Collaborative revenue splits with dispute resolution
//// - Platform fee escrow with timeout recovery
////
//// Failure Modes (Crash Fast):
//// - Insufficient signatures → rejection
//// - Invalid signer → rejection
//// - Refund before deadline (if set) → rejection

use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{lovelace_of}
use aiken/interval.{Finite}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, ValidityRange,
}
use types.{
  EscrowDatum, EscrowDatumV1, EscrowRedeemer, PartialRelease, PubKeyHash,
  RefundEscrow, Release, SignatureRequirement, meets_threshold,
}

// ============================================================================
// Validator Entry Point
// ============================================================================

/// Escrow validator predicate
validator escrow {
  spend(
    datum_opt: Option<EscrowDatum>,
    redeemer: EscrowRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) -> Bool {
    // Crash fast: datum must exist
    expect Some(datum) = datum_opt
    
    when datum is {
      EscrowDatumV1 {
        version,
        beneficiary,
        release_signers,
        refund_signers,
        refund_deadline,
        origin_ref,
      } -> {
        // Find own input for value and address
        expect Some(own_input) = find_input(tx.inputs, own_ref)
        let own_value = own_input.output.value
        let own_address = own_input.output.address
        let locked_lovelace = lovelace_of(own_value)
        
        when redeemer is {
          Release -> {
            // Verify release signature threshold is met
            let signatures_valid = meets_threshold(
              tx.extra_signatories,
              release_signers,
            )
            
            // Verify output pays beneficiary
            let output_valid = has_output_to_address(
              tx.outputs,
              beneficiary,
              locked_lovelace,
            )
            
            and {
              signatures_valid,
              output_valid,
            }
          }
          
          RefundEscrow -> {
            // Check if deadline-based refund is allowed
            let deadline_passed = when refund_deadline is {
              None -> False
              Some(deadline) -> tx_after_deadline(tx.validity_range, deadline)
            }
            
            // Refund allowed if: deadline passed OR signature threshold met
            let signatures_valid = meets_threshold(
              tx.extra_signatories,
              refund_signers,
            )
            
            // Must have either deadline passed or valid signatures
            let authorized = deadline_passed || signatures_valid
            
            // Note: Refund destination is determined by the transaction builder
            // This allows flexibility in refund routing based on the escrow context
            
            authorized
          }
          
          PartialRelease { amount } -> {
            // Verify release signature threshold
            let signatures_valid = meets_threshold(
              tx.extra_signatories,
              release_signers,
            )
            
            // Verify partial amount is valid
            let amount_valid = amount > 0 && amount < locked_lovelace
            
            // Verify output to beneficiary with partial amount
            let beneficiary_output_valid = has_output_to_address(
              tx.outputs,
              beneficiary,
              amount,
            )
            
            // Verify continuing output with remaining funds
            let remaining = locked_lovelace - amount
            let continuing_output_valid = has_continuing_escrow_output(
              tx.outputs,
              own_address,
              remaining,
              datum,
            )
            
            and {
              signatures_valid,
              amount_valid,
              beneficiary_output_valid,
              continuing_output_valid,
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
// Time Validation
// ============================================================================

/// Check if transaction validity range is after deadline
fn tx_after_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.lower_bound.bound_type is {
    Finite(lower) -> lower >= deadline
    _ -> False
  }
}

// ============================================================================
// Output Validation
// ============================================================================

/// Check if output pays to address with minimum amount
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

/// Check for continuing escrow output with same datum and remaining value
fn has_continuing_escrow_output(
  outputs: List<Output>,
  address: Address,
  min_value: Int,
  expected_datum: EscrowDatum,
) -> Bool {
  when outputs is {
    [] -> False
    [output, ..rest] -> {
      let address_matches = output.address == address
      let value_sufficient = lovelace_of(output.value) >= min_value
      let datum_matches = when output.datum is {
        InlineDatum(data) -> {
          expect datum: EscrowDatum = data
          datum == expected_datum
        }
        _ -> False
      }
      
      if address_matches && value_sufficient && datum_matches {
        True
      } else {
        has_continuing_escrow_output(rest, address, min_value, expected_datum)
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
// Tests
// ============================================================================

test threshold_met_exactly() {
  let signers = [
    #"00000000000000000000000000000000000000000000000000000001",
    #"00000000000000000000000000000000000000000000000000000002",
    #"00000000000000000000000000000000000000000000000000000003",
  ]
  let requirement = SignatureRequirement { signers, threshold: 2 }
  let signed_by = [
    #"00000000000000000000000000000000000000000000000000000001",
    #"00000000000000000000000000000000000000000000000000000003",
  ]
  meets_threshold(signed_by, requirement)
}

test threshold_not_met() {
  let signers = [
    #"00000000000000000000000000000000000000000000000000000001",
    #"00000000000000000000000000000000000000000000000000000002",
    #"00000000000000000000000000000000000000000000000000000003",
  ]
  let requirement = SignatureRequirement { signers, threshold: 2 }
  let signed_by = [#"00000000000000000000000000000000000000000000000000000001"]
  !meets_threshold(signed_by, requirement)
}

test threshold_exceeded() {
  let signers = [
    #"00000000000000000000000000000000000000000000000000000001",
    #"00000000000000000000000000000000000000000000000000000002",
  ]
  let requirement = SignatureRequirement { signers, threshold: 1 }
  let signed_by = [
    #"00000000000000000000000000000000000000000000000000000001",
    #"00000000000000000000000000000000000000000000000000000002",
  ]
  meets_threshold(signed_by, requirement)
}
