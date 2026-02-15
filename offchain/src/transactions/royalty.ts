/**
 * Royalty Distribution Transaction Builders
 * 
 * Off-chain transaction construction for the royalty distributor validator.
 * Follows supervision tree principles:
 * - Each builder is an isolated, restartable process
 * - Failures are explicit and recoverable
 * - State is explicitly managed
 */

import type {
  RoyaltyDatum,
  RoyaltyRecipient,
  RoyaltyRedeemer,
  TransactionResult,
  Result,
  Lovelace,
  VerificationKeyHash,
} from '../types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum script balance in lovelace (matches on-chain constant) */
const MIN_SCRIPT_BALANCE = 2_000_000n;

/** Minimum distribution amount (matches on-chain constant) */
const MIN_DISTRIBUTION = 5_000_000n;

// ============================================================================
// DATUM SERIALIZATION
// ============================================================================

/**
 * Serialize RoyaltyDatum to Plutus Data (CBOR)
 */
export function serializeRoyaltyDatum(datum: RoyaltyDatum): string {
  // Constr index 0 for RoyaltyDatum
  // Fields: nftPolicyId, nftTokenName, recipients, admin, protocolVersion
  const recipients = datum.recipients.map(r => serializeRoyaltyRecipient(r));
  
  return JSON.stringify({
    constructor: 0,
    fields: [
      { bytes: datum.nftPolicyId },
      { bytes: datum.nftTokenName },
      { list: recipients },
      { bytes: datum.admin },
      { int: datum.protocolVersion },
    ],
  });
}

/**
 * Serialize RoyaltyRecipient to Plutus Data
 */
function serializeRoyaltyRecipient(recipient: RoyaltyRecipient): object {
  return {
    constructor: 0,
    fields: [
      { bytes: recipient.address },
      { int: recipient.shareBps },
      { int: Number(recipient.minPayout) },
    ],
  };
}

/**
 * Serialize RoyaltyRedeemer to Plutus Data
 */
export function serializeRoyaltyRedeemer(redeemer: RoyaltyRedeemer): string {
  switch (redeemer.type) {
    case 'Distribute':
      return JSON.stringify({ constructor: 0, fields: [] });
    
    case 'UpdateConfig':
      return JSON.stringify({
        constructor: 1,
        fields: [{
          list: redeemer.newRecipients.map(r => serializeRoyaltyRecipient(r)),
        }],
      });
    
    case 'AdminWithdraw':
      return JSON.stringify({ constructor: 2, fields: [] });
  }
}

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

/**
 * Build a distribution transaction
 * 
 * @param scriptUtxo - The UTXO at the royalty script address
 * @param datum - Current royalty datum
 * @param scriptAddress - The validator script address
 * @param changeAddress - Address for change output
 */
export async function buildDistributeTransaction(
  scriptUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  datum: RoyaltyDatum,
  scriptAddress: string,
  changeAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate sufficient funds
    const distributable = scriptUtxo.value - MIN_SCRIPT_BALANCE;
    
    if (distributable < MIN_DISTRIBUTION) {
      return {
        success: false,
        error: new Error(
          `Insufficient funds to distribute. Have ${distributable}, need ${MIN_DISTRIBUTION}`
        ),
      };
    }
    
    // Calculate payouts for each recipient
    const payouts = calculatePayouts(datum.recipients, distributable);
    
    // Build outputs
    const outputs: { address: string; value: Lovelace }[] = [];
    
    // Recipient outputs
    for (const payout of payouts) {
      if (payout.amount >= payout.minPayout) {
        outputs.push({
          address: payout.address,
          value: payout.amount,
        });
      }
    }
    
    // Script continuing output with minimum balance
    outputs.push({
      address: scriptAddress,
      value: MIN_SCRIPT_BALANCE,
    });
    
    // Build transaction (placeholder - actual implementation uses Mesh SDK)
    const result: TransactionResult = {
      unsignedTx: '', // Would be actual CBOR
      fee: 200_000n,
      inputs: [`${scriptUtxo.txHash}#${scriptUtxo.outputIndex}`],
      outputs: outputs.map((o, i) => `output#${i}`),
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Build a configuration update transaction
 * 
 * @param scriptUtxo - The UTXO at the royalty script address
 * @param currentDatum - Current royalty datum
 * @param newRecipients - New recipient configuration
 * @param adminAddress - Admin wallet address for signing
 */
export async function buildUpdateConfigTransaction(
  scriptUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  currentDatum: RoyaltyDatum,
  newRecipients: RoyaltyRecipient[],
  adminAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    // Validate new configuration
    const validation = validateRecipientConfig(newRecipients);
    if (!validation.success) {
      return validation;
    }
    
    // Create new datum with updated recipients
    const newDatum: RoyaltyDatum = {
      ...currentDatum,
      recipients: newRecipients,
    };
    
    // Build transaction
    const result: TransactionResult = {
      unsignedTx: '', // Would be actual CBOR
      fee: 200_000n,
      inputs: [`${scriptUtxo.txHash}#${scriptUtxo.outputIndex}`],
      outputs: ['scriptOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Build an admin withdrawal transaction (emergency recovery)
 * 
 * @param scriptUtxo - The UTXO at the royalty script address
 * @param datum - Current royalty datum
 * @param adminAddress - Admin wallet address
 */
export async function buildAdminWithdrawTransaction(
  scriptUtxo: { txHash: string; outputIndex: number; value: Lovelace },
  datum: RoyaltyDatum,
  adminAddress: string,
): Promise<Result<TransactionResult>> {
  try {
    const result: TransactionResult = {
      unsignedTx: '', // Would be actual CBOR
      fee: 200_000n,
      inputs: [`${scriptUtxo.txHash}#${scriptUtxo.outputIndex}`],
      outputs: ['adminOutput#0'],
    };
    
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface Payout {
  address: VerificationKeyHash;
  amount: Lovelace;
  minPayout: Lovelace;
}

/**
 * Calculate payout amounts for each recipient
 */
function calculatePayouts(
  recipients: RoyaltyRecipient[],
  total: Lovelace,
): Payout[] {
  return recipients.map(recipient => ({
    address: recipient.address,
    amount: (total * BigInt(recipient.shareBps)) / 10000n,
    minPayout: recipient.minPayout,
  }));
}

/**
 * Validate recipient configuration
 */
function validateRecipientConfig(
  recipients: RoyaltyRecipient[],
): Result<void> {
  // Must have at least one recipient
  if (recipients.length === 0) {
    return {
      success: false,
      error: new Error('Must have at least one recipient'),
    };
  }
  
  // Shares must sum to 10000 (100%)
  const totalShares = recipients.reduce((sum, r) => sum + r.shareBps, 0);
  if (totalShares !== 10000) {
    return {
      success: false,
      error: new Error(
        `Shares must sum to 10000 (100%), got ${totalShares}`
      ),
    };
  }
  
  // Each share must be valid
  for (const recipient of recipients) {
    if (recipient.shareBps < 0 || recipient.shareBps > 10000) {
      return {
        success: false,
        error: new Error(
          `Invalid share ${recipient.shareBps} for ${recipient.address}`
        ),
      };
    }
  }
  
  return { success: true, value: undefined };
}

/**
 * Validate royalty datum
 */
export function validateRoyaltyDatum(datum: RoyaltyDatum): Result<void> {
  return validateRecipientConfig(datum.recipients);
}
