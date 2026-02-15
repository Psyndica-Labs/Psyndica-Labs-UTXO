# Psyndica EUTXO

A multi-layer blockchain system for music NFT royalty distribution built on the Extended UTXO model. This system enables transparent, programmable royalty splits with cross-chain capabilities bridging Bitcoin and Cardano.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Psyndica Platform                             │
├─────────────────────────────────────────────────────────────────────┤
│  Off-Chain SDK (TypeScript/Mesh)                                     │
│  ├── Transaction Builders                                            │
│  ├── Wallet Integration                                              │
│  └── State Machine Orchestration                                     │
├─────────────────────────────────────────────────────────────────────┤
│  On-Chain Validators (Aiken)                                         │
│  ├── RoyaltyValidator    - Enforces royalty split distribution      │
│  ├── HTLCValidator       - Cross-chain atomic swaps                 │
│  └── EscrowValidator     - Multi-sig revenue escrow                 │
├─────────────────────────────────────────────────────────────────────┤
│  Settlement Layers                                                   │
│  ├── Cardano            - Smart contract execution                  │
│  ├── Bitcoin (Cardinal) - Settlement & security                     │
│  └── Midnight           - Privacy layer (future)                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Principles

### 1. Supervision Tree Architecture

Following Erlang's "let it crash" philosophy:
- **Workers**: Validator scripts, transaction logic
- **Supervisors**: Off-chain validation, test harnesses
- Failures isolate and propagate upward for recovery

### 2. Deterministic Execution

EUTXO validators are pure predicates:
```
(Datum, Redeemer, ScriptContext) → Bool
```
- No global mutable state
- Parallel transaction validation
- Same inputs always produce same outputs

### 3. Versioned Datums

All datums include version tags for migration support:
```aiken
pub type RoyaltyDatum {
  RoyaltyDatumV1 {
    version: Version,
    // ... fields
  }
}
```

## Project Structure

```
psyndica-utxo/
├── aiken.toml              # Aiken project configuration
├── lib/
│   └── types.ak            # Shared types (datums, redeemers)
├── validators/
│   ├── royalty.ak          # Royalty distribution validator
│   ├── htlc.ak             # Hash Time-Locked Contract validator
│   └── escrow.ak           # Multi-sig escrow validator
├── offchain/
│   ├── package.json        # Node.js dependencies
│   ├── tsconfig.json       # TypeScript configuration
│   └── src/
│       ├── index.ts        # SDK entry point
│       ├── types/          # TypeScript type definitions
│       ├── builders/       # Transaction builders
│       └── utils/          # CBOR serialization, hashing
└── README.md
```

## Validators

### RoyaltyValidator

Enforces programmable royalty splits for music NFT revenue.

**Datum Structure:**
```aiken
RoyaltyDatumV1 {
  version: Int,
  nft_policy_id: PolicyId,
  recipients: List<RoyaltyRecipient>,
  admin: PubKeyHash,
  is_locked: Bool,
}
```

**Supported Actions:**
- `Distribute` - Split funds to recipients by share percentage
- `UpdateConfig` - Modify recipient list (admin only, if not locked)
- `LockConfig` - Permanently lock configuration
- `AdminWithdraw` - Emergency recovery (admin only)

### HTLCValidator

Enables cross-chain atomic swaps with Bitcoin via Cardinal Protocol.

**Flow:**
1. Alice locks BTC on Bitcoin with `hash(secret)`
2. Bob locks ADA on Cardano with same `hash(secret)`
3. Alice reveals secret to claim ADA
4. Bob uses revealed secret to claim BTC

**Supported Actions:**
- `Claim { secret }` - Claim funds by revealing the preimage
- `Refund` - Reclaim funds after deadline (timeout)

### EscrowValidator

Multi-signature escrow for revenue advances and milestone payments.

**Supported Actions:**
- `Release` - Send funds to beneficiary (M-of-N signatures)
- `RefundEscrow` - Return funds (deadline passed or M-of-N signatures)
- `PartialRelease { amount }` - Partial milestone release

## Development

### Prerequisites

- [Aiken](https://aiken-lang.org) v1.0.0+
- Node.js 18+
- pnpm or npm

### Building Validators

```bash
# Check and build Aiken contracts
aiken check
aiken build

# Run Aiken tests
aiken test
```

### Off-Chain SDK

```bash
cd offchain

# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Run tests
npm test
```

### Usage Example

```typescript
import { RoyaltyBuilder } from '@psyndica/utxo-offchain';
import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';

// Initialize provider and wallet
const provider = new BlockfrostProvider('your-project-id');
const wallet = new MeshWallet({
  networkId: 0, // Preview network
  fetcher: provider,
  submitter: provider,
  key: { type: 'mnemonic', words: [...] },
});

// Create royalty builder
const royaltyBuilder = new RoyaltyBuilder(
  {
    network: 'preview',
    validatorCbor: '...', // From aiken build output
  },
  provider,
  provider,
);

// Create new royalty configuration
const unsignedTx = await royaltyBuilder.buildCreateRoyalty(wallet, {
  nftPolicyId: 'abc123...',
  recipients: [
    { address: 'artist_pkh', shareBps: 7000 },    // 70%
    { address: 'producer_pkh', shareBps: 2000 },  // 20%
    { address: 'platform_pkh', shareBps: 1000 },  // 10%
  ],
  admin: 'admin_pkh',
  initialFunding: 100_000_000n, // 100 ADA
});

// Sign and submit
const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);
```

## Testing Philosophy

### Property-Based Testing

Validators are tested with property-based techniques:
- Enumerate all redeemer paths
- Test edge cases (0%, 100%, rounding)
- Verify failure modes crash correctly

### Integration Testing

Full transaction flow simulation:
1. Create UTXO with datum
2. Build spending transaction
3. Validate against compiled script
4. Verify output constraints

## Security Considerations

### Fail Fast

Validators crash immediately on:
- Invalid datum deserialization
- Redeemer type mismatch
- Insufficient collateral
- Unauthorized actions

### Recovery Patterns

- Network partition → Retry with exponential backoff
- Insufficient UTXOs → Queue and wait
- Validator upgrade → Versioned datum migration

## Roadmap

- [x] Core validator implementation
- [x] Off-chain SDK foundation
- [ ] Cardinal Protocol integration
- [ ] Midnight privacy layer
- [ ] DAO governance module
- [ ] Production deployment scripts

## License

Apache-2.0

## Contributing

Contributions welcome! Please read the architectural principles before submitting PRs.
