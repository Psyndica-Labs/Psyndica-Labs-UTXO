/**
 * Royalty Distribution Transaction Builder
 * 
 * Implements off-chain transaction assembly for royalty distribution.
 * Acts as a "supervisor" in the supervision tree model:
 * - Validates inputs before submission
 * - Handles retry logic on transient failures
 * - Provides recovery strategies for common error cases
 */

import {
  MeshTxBuilder,
  IFetcher,
  ISubmitter,
  UTxO,
  serializePlutusScript,
  PlutusScript,
  mConStr0,
  mConStr1,
  mConStr2,
  mConStr3,
  stringToHex,
} from '@meshsdk/core';
import {
  RoyaltyConfig,
  RoyaltyRecipient,
  RoyaltyRedeemer,
  Result,
  TransactionBuildError,
  TransactionErrorCode,
  validateShares,
  calculateShare,
  meetsThreshold,
  MIN_UTXO_LOVELACE,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

/** Retry configuration for transient failures */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

// ============================================================================
// Transaction Builder
// ============================================================================

/**
 * Builder for royalty distribution transactions
 */
export class RoyaltyTransactionBuilder {
  private readonly meshTxBuilder: MeshTxBuilder;
  private readonly fetcher: IFetcher;
  private readonly submitter: ISubmitter;
  private readonly scriptCbor: string;
  private readonly scriptAddress: string;

  constructor(config: {
    fetcher: IFetcher;
    submitter: ISubmitter;
    script: PlutusScript;
    networkId: 0 | 1; // 0 = testnet, 1 = mainnet
  }) {
    this.fetcher = config.fetcher;
    this.submitter = config.submitter;
    this.scriptCbor = config.script.code;
    
    const serialized = serializePlutusScript(config.script, undefined, config.networkId);
    this.scriptAddress = serialized.address;
    
    this.meshTxBuilder = new MeshTxBuilder({
      fetcher: config.fetcher,
      submitter: config.submitter,
    });
  }

  /**
   * Build a distribution transaction
   * 
   * Distributes accumulated royalties to all configured recipients
   * according to their share percentages.
   */
  async buildDistribution(params: {
    royaltyUtxo: UTxO;
    config: RoyaltyConfig;
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      // Validate shares before building
      if (!validateShares(params.config.recipients)) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Recipient shares do not sum to 100%',
            TransactionErrorCode.INVALID_SHARES
          ),
        };
      }

      // Calculate available amount for distribution
      const inputLovelace = BigInt(params.royaltyUtxo.output.amount[0].quantity);
      const availableAmount = inputLovelace - MIN_UTXO_LOVELACE;

      if (availableAmount <= 0n) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Insufficient funds for distribution',
            TransactionErrorCode.INSUFFICIENT_FUNDS
          ),
        };
      }

      // Build transaction
      this.meshTxBuilder.reset();
      
      // Spend the royalty UTXO
      this.meshTxBuilder
        .spendingPlutusScriptV3()
        .txIn(
          params.royaltyUtxo.input.txHash,
          params.royaltyUtxo.input.outputIndex
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr0([])) // Distribute redeemer
        .spendingTxInReference(
          params.royaltyUtxo.input.txHash,
          params.royaltyUtxo.input.outputIndex,
        )
        .txInScript(this.scriptCbor);

      // Add outputs for each recipient
      for (const recipient of params.config.recipients) {
        const shareAmount = calculateShare(availableAmount, recipient.shareBp);
        
        if (meetsThreshold(shareAmount, recipient)) {
          this.meshTxBuilder.txOut(recipient.address, [
            { unit: 'lovelace', quantity: shareAmount.toString() },
          ]);
        }
      }

      // Continue the contract UTXO with remaining funds
      const continuingDatum = this.serializeRoyaltyConfig(params.config);
      this.meshTxBuilder
        .txOut(this.scriptAddress, [
          { unit: 'lovelace', quantity: MIN_UTXO_LOVELACE.toString() },
        ])
        .txOutInlineDatumValue(continuingDatum);

      // Set change address and complete
      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build distribution transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  /**
   * Build a claim transaction for a single recipient
   * 
   * Allows a recipient to pull their share from the contract
   * (pull-based distribution model).
   */
  async buildClaim(params: {
    royaltyUtxo: UTxO;
    config: RoyaltyConfig;
    recipientIndex: number;
    recipientAddress: string;
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      if (params.recipientIndex < 0 || params.recipientIndex >= params.config.recipients.length) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Invalid recipient index',
            TransactionErrorCode.INVALID_REDEEMER
          ),
        };
      }

      const recipient = params.config.recipients[params.recipientIndex];
      
      // Calculate claim amount
      const inputLovelace = BigInt(params.royaltyUtxo.output.amount[0].quantity);
      const availableAmount = inputLovelace - MIN_UTXO_LOVELACE;
      const claimAmount = calculateShare(availableAmount, recipient.shareBp);

      if (!meetsThreshold(claimAmount, recipient)) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Claim amount below minimum threshold',
            TransactionErrorCode.INSUFFICIENT_FUNDS
          ),
        };
      }

      this.meshTxBuilder.reset();
      
      // Spend the royalty UTXO with ClaimShare redeemer
      this.meshTxBuilder
        .spendingPlutusScriptV3()
        .txIn(
          params.royaltyUtxo.input.txHash,
          params.royaltyUtxo.input.outputIndex
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr3([params.recipientIndex])) // ClaimShare redeemer
        .txInScript(this.scriptCbor);

      // Pay to recipient
      this.meshTxBuilder.txOut(params.recipientAddress, [
        { unit: 'lovelace', quantity: claimAmount.toString() },
      ]);

      // Continue the contract with remaining funds
      const remainingAmount = inputLovelace - claimAmount;
      const continuingDatum = this.serializeRoyaltyConfig(params.config);
      this.meshTxBuilder
        .txOut(this.scriptAddress, [
          { unit: 'lovelace', quantity: remainingAmount.toString() },
        ])
        .txOutInlineDatumValue(continuingDatum);

      // Require recipient signature
      this.meshTxBuilder.requiredSignerHash(recipient.address);
      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build claim transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  /**
   * Build a configuration update transaction
   * 
   * Updates the royalty configuration (admin only).
   */
  async buildConfigUpdate(params: {
    royaltyUtxo: UTxO;
    oldConfig: RoyaltyConfig;
    newConfig: RoyaltyConfig;
    adminAddress: string;
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      // Validate new configuration
      if (!validateShares(params.newConfig.recipients)) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'New config shares do not sum to 100%',
            TransactionErrorCode.INVALID_SHARES
          ),
        };
      }

      // Version must increment
      if (params.newConfig.version !== params.oldConfig.version + 1) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'New config version must increment by 1',
            TransactionErrorCode.INVALID_DATUM
          ),
        };
      }

      // NFT policy must remain unchanged
      if (params.newConfig.nftPolicyId !== params.oldConfig.nftPolicyId ||
          params.newConfig.nftAssetName !== params.oldConfig.nftAssetName) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Cannot change NFT policy in config update',
            TransactionErrorCode.INVALID_DATUM
          ),
        };
      }

      this.meshTxBuilder.reset();
      
      // Build UpdateConfig redeemer with new config
      const newConfigDatum = this.serializeRoyaltyConfig(params.newConfig);
      
      this.meshTxBuilder
        .spendingPlutusScriptV3()
        .txIn(
          params.royaltyUtxo.input.txHash,
          params.royaltyUtxo.input.outputIndex
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr1([newConfigDatum])) // UpdateConfig redeemer
        .txInScript(this.scriptCbor);

      // Continue with new config
      const inputAmount = params.royaltyUtxo.output.amount[0].quantity;
      this.meshTxBuilder
        .txOut(this.scriptAddress, [
          { unit: 'lovelace', quantity: inputAmount },
        ])
        .txOutInlineDatumValue(newConfigDatum);

      // Require admin signature
      this.meshTxBuilder.requiredSignerHash(params.oldConfig.adminKey);
      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build config update transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  /**
   * Initialize a new royalty distribution contract
   * 
   * Creates the initial UTXO at the script address with configuration.
   */
  async buildInitialize(params: {
    config: RoyaltyConfig;
    initialFunding: bigint;
    fundingUtxos: UTxO[];
    changeAddress: string;
  }): Promise<Result<string>> {
    try {
      if (!validateShares(params.config.recipients)) {
        return {
          ok: false,
          error: new TransactionBuildError(
            'Recipient shares do not sum to 100%',
            TransactionErrorCode.INVALID_SHARES
          ),
        };
      }

      if (params.initialFunding < MIN_UTXO_LOVELACE) {
        return {
          ok: false,
          error: new TransactionBuildError(
            `Initial funding must be at least ${MIN_UTXO_LOVELACE} lovelace`,
            TransactionErrorCode.INSUFFICIENT_FUNDS
          ),
        };
      }

      this.meshTxBuilder.reset();

      // Add funding inputs
      for (const utxo of params.fundingUtxos) {
        this.meshTxBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex
        );
      }

      // Create contract output with initial configuration
      const configDatum = this.serializeRoyaltyConfig(params.config);
      this.meshTxBuilder
        .txOut(this.scriptAddress, [
          { unit: 'lovelace', quantity: params.initialFunding.toString() },
        ])
        .txOutInlineDatumValue(configDatum);

      this.meshTxBuilder.changeAddress(params.changeAddress);
      
      const unsignedTx = await this.meshTxBuilder.complete();
      
      return { ok: true, value: unsignedTx };
    } catch (error) {
      return {
        ok: false,
        error: new TransactionBuildError(
          'Failed to build initialize transaction',
          TransactionErrorCode.SCRIPT_ERROR,
          error
        ),
      };
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Serialize RoyaltyConfig to Plutus data format
   */
  private serializeRoyaltyConfig(config: RoyaltyConfig): object {
    const recipients = config.recipients.map(r => ({
      constructor: 0,
      fields: [
        stringToHex(r.address),
        r.shareBp,
        r.minThreshold,
      ],
    }));

    const lockUntil = config.lockUntil !== null
      ? { constructor: 0, fields: [config.lockUntil] }  // Some
      : { constructor: 1, fields: [] };                  // None

    return {
      constructor: 0,
      fields: [
        stringToHex(config.nftPolicyId),
        stringToHex(config.nftAssetName),
        recipients,
        config.version,
        stringToHex(config.adminKey),
        lockUntil,
      ],
    };
  }
}

// ============================================================================
// Supervisor Functions (Recovery & Retry Logic)
// ============================================================================

/**
 * Submit transaction with retry logic
 * 
 * Implements exponential backoff for transient failures.
 */
export async function submitWithRetry(
  submitter: ISubmitter,
  signedTx: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<Result<string>> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const txHash = await submitter.submitTx(signedTx);
      return { ok: true, value: txHash };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is retryable
      if (!isRetryableError(lastError)) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt - 1),
        config.maxDelayMs
      );
      
      await sleep(delay);
    }
  }

  return {
    ok: false,
    error: new TransactionBuildError(
      `Transaction submission failed after ${config.maxAttempts} attempts`,
      TransactionErrorCode.NETWORK_ERROR,
      lastError
    ),
  };
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    'network',
    'timeout',
    'connection',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'temporarily unavailable',
  ];
  
  const message = error.message.toLowerCase();
  return retryablePatterns.some(pattern => message.includes(pattern.toLowerCase()));
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// UTXO Query Helpers
// ============================================================================

/**
 * Find royalty UTXOs at the script address
 */
export async function findRoyaltyUtxos(
  fetcher: IFetcher,
  scriptAddress: string
): Promise<UTxO[]> {
  return fetcher.fetchAddressUTxOs(scriptAddress);
}

/**
 * Parse RoyaltyConfig from UTXO datum
 */
export function parseRoyaltyConfig(utxo: UTxO): RoyaltyConfig | null {
  try {
    const datum = utxo.output.plutusData;
    if (!datum) return null;
    
    // Parse the datum structure (implementation depends on datum format)
    // This is a placeholder - actual implementation would decode CBOR
    return null;
  } catch {
    return null;
  }
}
