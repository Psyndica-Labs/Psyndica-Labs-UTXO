# Psyndica-Labs-UTXO

EUTXO-based royalty distribution system for music NFTs on Cardano, with cross-chain Bitcoin integration via Cardinal Protocol.

## Architecture Overview

This system implements the Extended UTXO model following Erlang's "let it crash" supervision tree philosophy:

```
                    ┌─────────────────────┐
                    │   Off-chain         │
                    │   Supervisor        │
                    │   (TypeScript/Mesh) │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────▼──────┐    ┌───────▼───────┐   ┌──────▼──────┐
    │   Royalty   │    │     HTLC      │   │ Governance  │
    │  Validator  │    │   Validator   │   │  Validator  │
    │  (Worker)   │    │   (Worker)    │   │  (Worker)   │
    └─────────────┘    └───────────────┘   └─────────────┘
```

### Core Principles

1. **Isolation & Message-Passing**: Each component is an isolated process communicating via typed messages (datums, redeemers)
2. **Deterministic Execution**: Pure predicates `(Datum, Redeemer, ScriptContext) → Bool`
3. **Fail Fast**: Invalid states crash immediately; supervisors handle recovery
4. **Parallel Validation**: Non-conflicting transactions validate concurrently

## Project Structure

```
├── aiken.toml              # Aiken project configuration
├── lib/
│   └── types.ak            # Shared type definitions
├── validators/
│   ├── royalty.ak          # Royalty distribution validator
│   └── htlc.ak             # Cross-chain HTLC validator
└── offchain/
    ├── package.json        # Node.js dependencies
    ├── tsconfig.json       # TypeScript configuration
    └── src/
        ├── types.ts        # Off-chain type definitions
        ├── royalty-builder.ts  # Royalty transaction builder
        ├── htlc-builder.ts     # HTLC transaction builder
        └── index.ts        # Module exports
```

## On-chain Validators (Aiken)

### Royalty Distribution Validator

Enforces royalty splits for music NFT revenue:

```aiken
validator royalty_distribution {
  spend(datum: RoyaltyConfig, redeemer: RoyaltyRedeemer, ctx: ScriptContext) {
    when redeemer is {
      Distribute -> validate_distribution(datum, ctx)
      UpdateConfig { new_config } -> validate_config_update(datum, new_config, ctx)
      EmergencyWithdraw -> validate_emergency_withdrawal(datum, ctx)
      ClaimShare { recipient_index } -> validate_claim(datum, recipient_index, ctx)
    }
  }
}
```

**Datum Structure:**
- `nft_policy_id`: NFT this config applies to
- `recipients`: List of (address, share_bp, min_threshold)
- `version`: For migration support
- `admin_key`: Configuration authority
- `lock_until`: Optional timelock

**Redeemer Actions:**
| Action | Description | Requirements |
|--------|-------------|---------------|
| `Distribute` | Push payments to all recipients | Timelock passed |
| `ClaimShare` | Pull individual share | Recipient signature |
| `UpdateConfig` | Modify configuration | Admin signature, version++ |
| `EmergencyWithdraw` | Recover locked funds | Admin signature, 7-day delay |

### HTLC Validator

Atom swaps for Bitcoin integration via Cardinal Protocol:

```aiken
validator htlc {
  spend(datum: HTLCDatum, redeemer: HTLCRedeemer, ctx: ScriptContext) {
    when redeemer is {
      Claim { secret } -> sha256(secret) == datum.secret_hash && before_timeout(ctx)
      Refund -> after_timeout(ctx) && to_refund_address(ctx)
    }
  }
}
```

## Off-chain SDK (TypeScript)

### Installation

```bash
cd offchain
npm install
npm run build
```

### Usage Example

```typescript
import { RoyaltyTransactionBuilder, RoyaltyConfig } from '@psyndica/royalty-offchain';

// Initialize builder
const builder = new RoyaltyTransactionBuilder({
  fetcher: blockfrostProvider,
  submitter: blockfrostProvider,
  script: compiledScript,
  networkId: 0, // testnet
});

// Configure royalty split
const config: RoyaltyConfig = {
  nftPolicyId: 'abc123...',
  nftAssetName: 'MusicNFT001',
  recipients: [
    { address: 'artist_vkh', shareBp: 7000, minThreshold: 2000000n },   // 70%
    { address: 'label_vkh', shareBp: 2000, minThreshold: 2000000n },    // 20%
    { address: 'platform_vkh', shareBp: 1000, minThreshold: 2000000n }, // 10%
  ],
  version: 1,
  adminKey: 'admin_vkh',
  lockUntil: null,
};

// Build distribution transaction
const result = await builder.buildDistribution({
  royaltyUtxo: contractUtxo,
  config,
  changeAddress: userAddress,
});

if (result.ok) {
  const signedTx = await wallet.signTx(result.value);
  const txHash = await wallet.submitTx(signedTx);
}
```

### Cross-chain Atomic Swap

```typescript
import { HTLCTransactionBuilder, generateAtomicSwapParams } from '@psyndica/royalty-offchain';

// Generate swap parameters
const swapParams = generateAtomicSwapParams({
  cardanoOffer: { tokenPolicy: 'policy', tokenName: 'TOKEN', amount: 1000000n },
  bitcoinExpect: { amount: 100000n, address: 'bc1q...' },
  initiator: 'cardano_addr',
  counterparty: 'counterparty_addr',
  cardanoTimeoutMs: 7200000, // 2 hours
  bitcoinTimeoutMs: 3600000, // 1 hour (must be shorter)
});

// Create Cardano HTLC
const htlcBuilder = new HTLCTransactionBuilder({ ... });
const createResult = await htlcBuilder.buildCreate({
  datum: swapParams.cardanoHTLC,
  fundingUtxos,
  changeAddress,
});
```

## Development

### Prerequisites

- [Aiken](https://aiken-lang.org/) >= 1.0.0
- Node.js >= 18
- npm >= 9

### Build Validators

```bash
aiken build
aiken check
```

### Run Tests

```bash
# On-chain (Aiken)
aiken test

# Off-chain (TypeScript)
cd offchain
npm test
npm run test:coverage
```

### Type Check

```bash
cd offchain
npm run typecheck
npm run lint
```

## Supervision Tree Model

### Failure Handling

| Failure Type | On-chain Response | Off-chain Recovery |
|--------------|-------------------|--------------------|
| Invalid datum | Crash (return False) | Log, alert supervisor |
| Redeemer mismatch | Crash immediately | Rebuild transaction |
| Insufficient funds | Reject transaction | Queue, wait for inputs |
| Network partition | N/A | Exponential backoff retry |
| Timeout | N/A | Configurable retry limits |

### Recursive Self-Improvement

The system follows a continuous improvement loop:

1. **Observe**: Execute logic, collect metrics (tx success rate, gas efficiency)
2. **Adapt**: Analyze failures, propose minimal changes
3. **Grow**: Validate improvements, merge changes, update supervision tree

## Growth Metrics

- Transaction success rate: target >99%
- Average validation cost: minimize execution units
- Test coverage: enumerate all redeemer paths
- Cross-chain bridge uptime: Cardinal/Rosen availability

## Multi-Layer Stack

```
┌─────────────────────────────────────────────┐
│              Midnight Layer                 │  Privacy (ZK proofs)
│         (Sensitive royalty data)            │
├─────────────────────────────────────────────┤
│              Cardano Layer                  │  Smart Contracts
│    (Royalty distribution, Governance)       │  (Aiken validators)
├─────────────────────────────────────────────┤
│              Bitcoin Layer                  │  Settlement
│     (HTLC, Cardinal Protocol bridge)        │  (Immutable security)
└─────────────────────────────────────────────┘
```

## License

Apache-2.0
