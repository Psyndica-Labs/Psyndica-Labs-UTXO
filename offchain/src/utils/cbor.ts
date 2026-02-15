/**
 * CBOR Serialization Utilities
 * 
 * Converts off-chain types to Plutus Data format for on-chain consumption.
 * These utilities ensure type-safe serialization that matches the Aiken
 * validator expectations.
 */

import { 
  Data,
  conStr,
  conStr0,
  conStr1,
  integer,
  byteString,
  list,
} from '@meshsdk/core';
import type {
  RoyaltyDatum,
  RoyaltyRedeemer,
  RoyaltyRecipient,
  HTLCDatum,
  HTLCRedeemer,
  EscrowDatum,
  EscrowRedeemer,
  SignatureRequirement,
  OutputReference,
} from '../types/index.js';

// ============================================================================
// Generic Plutus Data Helpers
// ============================================================================

/**
 * Encode optional value as Plutus Data
 */
function encodeOption<T>(
  value: T | undefined | null,
  encoder: (v: T) => Data
): Data {
  if (value === undefined || value === null) {
    return conStr1([]); // None
  }
  return conStr0([encoder(value)]); // Some
}

/**
 * Encode bigint as Plutus integer
 */
function encodeBigInt(value: bigint): Data {
  return integer(value);
}

/**
 * Encode string as ByteString (hex)
 */
function encodeByteString(value: string): Data {
  return byteString(value);
}

/**
 * Encode boolean as Plutus constructor
 */
function encodeBool(value: boolean): Data {
  return value ? conStr1([]) : conStr0([]);
}

// ============================================================================
// Royalty Type Serialization
// ============================================================================

/**
 * Encode RoyaltyRecipient to Plutus Data
 */
function encodeRoyaltyRecipient(recipient: RoyaltyRecipient): Data {
  return conStr0([
    encodeByteString(recipient.address),
    integer(BigInt(recipient.shareBps)),
    encodeOption(recipient.minThreshold, encodeBigInt),
  ]);
}

/**
 * Encode RoyaltyDatum to Plutus Data
 */
function encodeRoyaltyDatum(datum: RoyaltyDatum): Data {
  // RoyaltyDatumV1 constructor (index 0)
  return conStr0([
    integer(BigInt(datum.version)),
    encodeByteString(datum.nftPolicyId),
    list(datum.recipients.map(encodeRoyaltyRecipient)),
    encodeByteString(datum.admin),
    encodeBool(datum.isLocked),
  ]);
}

/**
 * Encode RoyaltyRedeemer to Plutus Data
 */
function encodeRoyaltyRedeemer(redeemer: RoyaltyRedeemer): Data {
  switch (redeemer.type) {
    case 'Distribute':
      return conStr0([]); // Constructor 0
    case 'UpdateConfig':
      return conStr1([
        list(redeemer.newRecipients.map(encodeRoyaltyRecipient)),
      ]); // Constructor 1
    case 'LockConfig':
      return conStr(2, []); // Constructor 2
    case 'AdminWithdraw':
      return conStr(3, []); // Constructor 3
  }
}

// ============================================================================
// HTLC Type Serialization
// ============================================================================

/**
 * Encode HTLCDatum to Plutus Data
 */
function encodeHTLCDatum(datum: HTLCDatum): Data {
  // HTLCDatumV1 constructor (index 0)
  return conStr0([
    integer(BigInt(datum.version)),
    encodeByteString(datum.secretHash),
    encodeByteString(datum.recipient),
    encodeByteString(datum.refundAddress),
    integer(datum.deadline),
    integer(datum.lockedAmount),
  ]);
}

/**
 * Encode HTLCRedeemer to Plutus Data
 */
function encodeHTLCRedeemer(redeemer: HTLCRedeemer): Data {
  switch (redeemer.type) {
    case 'Claim':
      return conStr0([encodeByteString(redeemer.secret)]); // Constructor 0
    case 'Refund':
      return conStr1([]); // Constructor 1
  }
}

// ============================================================================
// Escrow Type Serialization
// ============================================================================

/**
 * Encode SignatureRequirement to Plutus Data
 */
function encodeSignatureRequirement(req: SignatureRequirement): Data {
  return conStr0([
    list(req.signers.map(encodeByteString)),
    integer(BigInt(req.threshold)),
  ]);
}

/**
 * Encode OutputReference to Plutus Data
 */
function encodeOutputReference(ref: OutputReference): Data {
  return conStr0([
    conStr0([encodeByteString(ref.transactionId)]), // TxId wrapper
    integer(BigInt(ref.outputIndex)),
  ]);
}

/**
 * Encode EscrowDatum to Plutus Data
 */
function encodeEscrowDatum(datum: EscrowDatum): Data {
  // EscrowDatumV1 constructor (index 0)
  return conStr0([
    integer(BigInt(datum.version)),
    encodeByteString(datum.beneficiary),
    encodeSignatureRequirement(datum.releaseSigners),
    encodeSignatureRequirement(datum.refundSigners),
    encodeOption(datum.refundDeadline, encodeBigInt),
    encodeOption(datum.originRef, encodeOutputReference),
  ]);
}

/**
 * Encode EscrowRedeemer to Plutus Data
 */
function encodeEscrowRedeemer(redeemer: EscrowRedeemer): Data {
  switch (redeemer.type) {
    case 'Release':
      return conStr0([]); // Constructor 0
    case 'RefundEscrow':
      return conStr1([]); // Constructor 1
    case 'PartialRelease':
      return conStr(2, [integer(redeemer.amount)]); // Constructor 2
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Convert any datum type to Plutus Data
 */
export function datumToPlutusData(
  datum: RoyaltyDatum | HTLCDatum | EscrowDatum
): Data {
  // Type discrimination based on structure
  if ('nftPolicyId' in datum && 'recipients' in datum) {
    return encodeRoyaltyDatum(datum as RoyaltyDatum);
  }
  if ('secretHash' in datum && 'deadline' in datum) {
    return encodeHTLCDatum(datum as HTLCDatum);
  }
  if ('beneficiary' in datum && 'releaseSigners' in datum) {
    return encodeEscrowDatum(datum as EscrowDatum);
  }
  throw new Error('Unknown datum type');
}

/**
 * Convert any redeemer type to Plutus Data
 */
export function redeemerToPlutusData(
  redeemer: RoyaltyRedeemer | HTLCRedeemer | EscrowRedeemer
): Data {
  // Type discrimination based on 'type' field
  if (redeemer.type === 'Distribute' || 
      redeemer.type === 'UpdateConfig' ||
      redeemer.type === 'LockConfig' ||
      redeemer.type === 'AdminWithdraw') {
    return encodeRoyaltyRedeemer(redeemer as RoyaltyRedeemer);
  }
  if (redeemer.type === 'Claim' || redeemer.type === 'Refund') {
    return encodeHTLCRedeemer(redeemer as HTLCRedeemer);
  }
  if (redeemer.type === 'Release' || 
      redeemer.type === 'RefundEscrow' ||
      redeemer.type === 'PartialRelease') {
    return encodeEscrowRedeemer(redeemer as EscrowRedeemer);
  }
  throw new Error('Unknown redeemer type');
}

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * Compute Blake2b-256 hash of input data
 * Used for HTLC secret hashing
 */
export function blake2b256(input: string): string {
  // In browser/Node, use available crypto
  // This is a placeholder - in production use @noble/hashes or similar
  const crypto = globalThis.crypto || require('crypto');
  
  if (typeof crypto.subtle !== 'undefined') {
    // Browser environment - would need async
    throw new Error('Use blake2b256Async in browser environment');
  }
  
  // Node.js environment
  const hash = require('crypto').createHash('blake2b512');
  hash.update(Buffer.from(input, 'utf8'));
  // Blake2b-256 is first 32 bytes of Blake2b-512
  return hash.digest('hex').slice(0, 64);
}

/**
 * Async version of blake2b256 for browser environments
 */
export async function blake2b256Async(input: string): Promise<string> {
  // Use @noble/hashes in production
  const { blake2b } = await import('@noble/hashes/blake2b');
  const hash = blake2b(new TextEncoder().encode(input), { dkLen: 32 });
  return Buffer.from(hash).toString('hex');
}
