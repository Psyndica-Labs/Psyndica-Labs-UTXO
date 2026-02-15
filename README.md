# Psyndica EUTXO Protocol

> **Supervision Tree Architecture for Music NFT Royalty Distribution**

A production-ready EUTXO smart contract system implementing Erlang-style supervision tree principles for royalty distribution, cross-chain atomic swaps, and DAO governance on Cardano.

## Overview

Psyndica enables automated, trustless royalty distribution for music NFTs:

1. **Artists** mint NFTs and configure royalty splits
2. **Streaming platforms** send revenue to the royalty contract
3. **Anyone** can trigger distribution to pay artists their shares
4. **Governance** allows community parameter updates

### Architecture Principles

Following Erlang's "let it crash" philosophy:

- **Isolation**: Each validator is a pure predicate with isolated state
- **Fail Fast**: Invalid inputs crash immediately with clear error traces
- **Supervision**: Off-chain processes restart with clean state on failure
- **Determinism**: All state transitions are explicit and reproducible

## Quick Start

### Prerequisites

- [Aiken](https://aiken-lang.org) v1.1.0+
- Node.js 18+
- Cardano testnet wallet

### Build & Test

```bash
# Build Aiken validators
aiken build

# Run all tests
aiken check

# Build off-chain SDK
cd offchain && npm install && npm run build
```

## Project Structure

```
├── aiken.toml                 # Aiken project configuration
├── lib/
│   └── types.ak               # Core datum/redeemer types
├── validators/
│   ├── royalty_distributor.ak # Royalty split validator
│   ├── escrow.ak              # HTLC for cross-chain swaps
│   └── governance.ak          # DAO voting & treasury
├── offchain/
│   └── src/
│       ├── types.ts           # TypeScript type definitions
│       ├── supervision/       # Erlang-style process management
│       └── transactions/      # Transaction builders
└── tests/
    ├── integration/           # End-to-end test scenarios
    └── property/              # Property-based tests
```

## Validators

### Royalty Distributor

Manages royalty splits for music NFTs:

| Redeemer | Description |
|----------|-------------|
| `Distribute` | Pay out accumulated royalties to all recipients |
| `UpdateConfig` | Admin updates recipient configuration |
| `AdminWithdraw` | Emergency recovery by admin |

### Escrow (HTLC)

Hash Time-Locked Contracts for cross-chain atomic swaps:

| Redeemer | Description |
|----------|-------------|
| `Claim { secret }` | Beneficiary claims by revealing secret |
| `Refund` | Depositor refunds after deadline + grace period |
| `Cancel` | Depositor cancels before deadline |

### Governance

DAO voting and treasury management:

| Redeemer | Description |
|----------|-------------|
| `CreateProposal` | Submit new governance proposal |
| `Vote` | Cast votes with governance tokens |
| `Execute` | Execute passed proposal |
| `TreasuryWithdraw` | Multi-sig treasury withdrawal |

## Off-chain SDK

```typescript
import {
  buildDistributeTransaction,
  Supervisor,
  type RoyaltyDatum,
} from '@psyndica/utxo-sdk';

const result = await buildDistributeTransaction(
  scriptUtxo,
  datum,
  scriptAddress,
  changeAddress,
);
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed documentation.

## License

Apache-2.0

---

Built with ❤️ by Psyndica Labs
