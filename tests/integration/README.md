# Integration Tests

This directory contains integration tests for the Psyndica EUTXO validators.

## Test Structure

```
tests/
├── integration/
│   ├── royalty_distributor_test.ak   # Royalty distribution scenarios
│   ├── escrow_test.ak                # HTLC escrow scenarios
│   └── governance_test.ak            # Governance voting scenarios
└── property/
    └── README.md                      # Property-based testing guide
```

## Running Tests

```bash
# Run all Aiken tests
aiken check

# Run specific test module
aiken check --match "royalty"
```

## Test Coverage Goals

Following the Recursive Self-Improvement Protocol:

1. **Transaction success rate target: >99%**
2. **All redeemer paths enumerated**
3. **Edge cases for time-based validation**
4. **Datum version migration paths**

## Integration Test Scenarios

### Royalty Distributor
- [ ] Distribute with exact shares
- [ ] Distribute with minimum payout filtering
- [ ] Config update by admin
- [ ] Config update rejected for non-admin
- [ ] Admin emergency withdraw
- [ ] Multiple distributions accumulating

### Escrow (HTLC)
- [ ] Create escrow with valid parameters
- [ ] Claim with correct secret
- [ ] Claim rejected with wrong secret
- [ ] Claim rejected after deadline
- [ ] Refund after deadline + grace period
- [ ] Cancel by depositor before deadline
- [ ] Cancel rejected after deadline

### Governance
- [ ] Create proposal with deposit
- [ ] Vote with governance tokens
- [ ] Execute passed proposal
- [ ] Reject proposal below quorum
- [ ] Treasury multi-sig withdrawal
