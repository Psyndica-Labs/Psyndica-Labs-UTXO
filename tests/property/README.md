# Property-Based Testing

Property-based tests verify invariants that must hold for all valid inputs.

## Key Properties

### Royalty Distribution

```aiken
/// Property: Total distributed equals total received minus script minimum
/// ∀ recipients, total_in:
///   sum(payouts) + min_balance == total_in
```

```aiken
/// Property: Each recipient receives proportional share
/// ∀ recipient in recipients:
///   payout(recipient) == total * share_bps / 10000
```

```aiken
/// Property: Shares always sum to 100%
/// ∀ valid_datum:
///   sum(datum.recipients.map(r => r.share_bps)) == 10000
```

### Escrow (HTLC)

```aiken
/// Property: Claim only succeeds with correct secret
/// ∀ secret, datum:
///   claim_succeeds(secret, datum) ⟺ sha2_256(secret) == datum.secret_hash
```

```aiken
/// Property: Refund only after deadline
/// ∀ tx_time, datum:
///   refund_succeeds(tx_time, datum) ⟹ tx_time >= datum.deadline + grace_period
```

```aiken
/// Property: State transitions are deterministic
/// ∀ datum, redeemer, context:
///   validate(datum, redeemer, context) is pure
```

### Governance

```aiken
/// Property: Votes cannot exceed token balance
/// ∀ vote_tx:
///   vote_amount <= voter_token_balance
```

```aiken
/// Property: Proposal execution requires quorum and threshold
/// ∀ proposal:
///   execute_succeeds(proposal) ⟹ 
///     (votes_for + votes_against >= quorum) ∧
///     (votes_for * 10000 / total_votes >= threshold_bps)
```

## Using Aiken Fuzz

The project includes `aiken-lang/fuzz` for property-based testing:

```aiken
use aiken/fuzz.{and_then, bytearray_between, int_between, label, map}

test prop_shares_sum_to_100(recipients via fuzz_recipients()) {
  validate_shares(recipients)
}

fn fuzz_recipients() -> Fuzzer<List<RoyaltyRecipient>> {
  // Generate list of recipients with random but valid shares
  // that sum to exactly 10000
  ...
}
```

## Running Property Tests

```bash
# Run with increased iterations
aiken check --seed 42 --property-max-success 1000
```
