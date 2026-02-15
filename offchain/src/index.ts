/**
 * Psyndica EUTXO Off-Chain SDK
 * 
 * Transaction builders and utilities for interacting with the
 * Psyndica smart contract system on Cardano.
 * 
 * @example
 * ```typescript
 * import { RoyaltyBuilder, HTLCBuilder } from '@psyndica/utxo-offchain';
 * import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';
 * 
 * const provider = new BlockfrostProvider('your-project-id');
 * 
 * const royaltyBuilder = new RoyaltyBuilder(
 *   { network: 'preview', validatorCbor: '...' },
 *   provider,
 *   provider
 * );
 * ```
 */

// Types
export * from './types/index.js';

// Transaction Builders
export { RoyaltyBuilder } from './builders/royalty.js';
export type { 
  RoyaltyBuilderConfig, 
  CreateRoyaltyParams, 
  DistributeParams 
} from './builders/royalty.js';

export { HTLCBuilder } from './builders/htlc.js';
export type {
  HTLCBuilderConfig,
  CreateHTLCParams,
  ClaimHTLCParams,
  RefundHTLCParams,
} from './builders/htlc.js';

// Utilities
export { 
  datumToPlutusData, 
  redeemerToPlutusData,
  blake2b256,
  blake2b256Async,
} from './utils/cbor.js';
