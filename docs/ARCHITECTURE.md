# Psyndica EUTXO Architecture

## Overview

This document describes the architectural decisions and design patterns used in the Psyndica EUTXO protocol.

## Core Principles

### 1. Supervision Tree Model

Inspired by Erlang/OTP, the system is structured as a hierarchy of supervisors and workers:

```
                    ┌─────────────────┐
                    │   Application   │
                    │   Supervisor    │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │   Royalty   │   │   Escrow    │   │ Governance  │
    │  Supervisor │   │  Supervisor │   │  Supervisor │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │ Validator   │   │ Validator   │   │ Proposal    │
    │ + Builder   │   │ + Builder   │   │ + Treasury  │
    └─────────────┘   └─────────────┘   └─────────────┘
```

**Strategies:**
- **OneForOne**: Restart only the crashed process (default)
- **OneForAll**: Restart all children when one crashes
- **RestForOne**: Restart crashed process and all after it

### 2. EUTXO Design Patterns

#### Pure Predicate Validators

All validators follow the pure predicate pattern:

```
(Datum, Redeemer, ScriptContext) → Bool
```

No global state, no side effects, deterministic execution.

#### Datum Versioning

```aiken
type VersionedDatum<a> {
  V1(a)
  V2 { data: a, migration_metadata: ByteArray }
}
```

Enables forward-compatible datum evolution without breaking existing UTXOs.

#### Continuing Output Pattern

```aiken
fn verify_continuing_output(script_addr, datum, outputs) -> Bool {
  list.any(outputs, fn(output) {
    output.address == script_addr &&
    lovelace_of(output.value) >= min_balance &&
    output.datum == InlineDatum(datum)
  })
}
```

Ensures script state persists across transactions.

### 3. State Machine Design

#### Escrow State Machine

```
                    ┌─────────┐
        create ────▶│ Locked  │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    claim│         cancel│          refund│ (after deadline)
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐    ┌──────────┐    ┌──────────┐
    │Completed│    │ Refunded │    │ Refunded │
    └─────────┘    └──────────┘    └──────────┘
```

#### Governance Proposal Lifecycle

```
    ┌────────┐     ┌────────┐     ┌──────────┐
    │ Active │────▶│ Passed │────▶│ Executed │
    └───┬────┘     └────────┘     └──────────┘
        │
        ├─────────────────────────────────────┐
        │                                     │
        ▼                                     ▼
    ┌────────┐                           ┌───────────┐
    │ Failed │                           │ Cancelled │
    └────────┘                           └───────────┘
```

## Module Architecture

### On-Chain (Aiken)

```
lib/
└── types.ak          # Shared type definitions
    ├── VersionedDatum<a>
    ├── RoyaltyDatum, RoyaltyRedeemer
    ├── EscrowDatum, EscrowRedeemer
    └── ProposalDatum, GovernanceRedeemer

validators/
├── royalty_distributor.ak
│   └── royalty_distributor.spend
├── escrow.ak
│   └── escrow.spend
└── governance.ak
    ├── governance_proposal.spend
    └── governance_treasury.spend
```

### Off-Chain (TypeScript)

```
src/
├── types.ts              # Mirror of on-chain types
├── supervision/
│   └── supervisor.ts     # Erlang-style process management
└── transactions/
    ├── royalty.ts        # Royalty transaction builders
    └── escrow.ts         # Escrow transaction builders
```

## Security Model

### Fail Fast

Invalid inputs cause immediate failure with clear traces:

```aiken
// FAIL FAST: Datum must exist
expect Some(datum) = datum_opt

// FAIL FAST: Admin must sign
expect list.has(tx.extra_signatories, datum.admin)
```

### Time-Based Security

All time-sensitive operations use transaction validity ranges:

```aiken
fn before_deadline(validity: ValidityRange, deadline: Int) -> Bool {
  when validity.upper_bound.bound_type is {
    Finite(upper) -> upper <= deadline
    _ -> False
  }
}
```

### Multi-Sig Treasury

Treasury withdrawals require multiple admin signatures:

```aiken
let signature_count = list.foldl(datum.admins, 0, fn(admin, count) {
  if list.has(tx.extra_signatories, admin) { count + 1 }
  else { count }
})
expect signature_count >= datum.min_signatures
```

## Cross-Chain Integration

### Cardinal Protocol (Bitcoin Bridge)

1. **Bitcoin Side**: Lock BTC in HTLC script
2. **Cardano Side**: Create matching escrow UTXO
3. **Atomic Swap**: Reveal secret claims both sides

```
Bitcoin UTXO ──lock──▶ HTLC Script
                           │
                    secret reveal
                           │
Cardano UTXO ──lock──▶ Escrow Script ──claim──▶ Beneficiary
```

### Datum Reference for Bridge

```aiken
type EscrowDatum {
  ...
  btc_tx_ref: Option<ByteArray>,  // Bitcoin txid reference
}
```

## Performance Considerations

### Script Size Optimization

- Minimize datum size with compact types
- Use constructor indices for enums
- Avoid redundant validation

### Execution Unit Budgets

| Operation | Memory | CPU |
|-----------|--------|-----|
| Distribute (2 recipients) | ~200KB | ~50M |
| Escrow Claim | ~150KB | ~40M |
| Governance Vote | ~180KB | ~45M |

### UTXO Management

- Batch distributions when possible
- Use reference scripts for common validators
- Maintain minimum balances to prevent dust

## Future Extensions

### Planned Features

1. **Midnight Integration**: Privacy layer for sensitive splits
2. **Streaming Payments**: Continuous royalty distribution
3. **Cross-Chain Governance**: Multi-chain proposal execution
4. **NFT Metadata Standards**: CIP-25/CIP-68 integration

### Upgrade Path

1. Deploy new validator version
2. Update off-chain builders to support both versions
3. Migrate UTXOs via spend-and-recreate pattern
4. Deprecate old version after migration complete
