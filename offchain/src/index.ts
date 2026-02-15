/**
 * Psyndica EUTXO Off-chain SDK
 * 
 * Entry point for the off-chain SDK providing:
 * - Type definitions matching on-chain validators
 * - Transaction builders for royalty, escrow, and governance
 * - Erlang-style supervision tree for process management
 */

// Types
export * from './types.js';

// Supervision Tree
export { Supervisor, BaseProcess } from './supervision/supervisor.js';
export type { SupervisedProcess, ProcessEvents } from './supervision/supervisor.js';

// Transaction Builders - Royalty
export {
  buildDistributeTransaction,
  buildUpdateConfigTransaction,
  buildAdminWithdrawTransaction,
  serializeRoyaltyDatum,
  serializeRoyaltyRedeemer,
  validateRoyaltyDatum,
} from './transactions/royalty.js';

// Transaction Builders - Escrow
export {
  buildCreateEscrowTransaction,
  buildClaimEscrowTransaction,
  buildRefundEscrowTransaction,
  buildCancelEscrowTransaction,
  serializeEscrowDatum,
  serializeEscrowRedeemer,
  validateEscrowDatum,
  hashSecret,
  generateSecret,
  calculateDeadline,
} from './transactions/escrow.js';
