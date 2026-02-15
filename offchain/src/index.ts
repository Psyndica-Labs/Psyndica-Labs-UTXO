/**
 * Psyndica Royalty Off-chain SDK
 * 
 * Transaction builders and utilities for interacting with
 * Psyndica's EUTXO-based royalty distribution system.
 */

// Type exports
export * from './types.js';

// Royalty distribution
export {
  RoyaltyTransactionBuilder,
  submitWithRetry,
  findRoyaltyUtxos,
  parseRoyaltyConfig,
  type RetryConfig,
} from './royalty-builder.js';

// HTLC / Cross-chain
export {
  HTLCTransactionBuilder,
  sha256,
  generateSecret,
  calculateTimeout,
  generateAtomicSwapParams,
  type AtomicSwapParams,
} from './htlc-builder.js';
