/**
 * Tests for type utilities and validation functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateShares,
  calculatePayout,
  validateThreshold,
  RoyaltyRecipient,
  SignatureRequirement,
} from './index.js';

describe('validateShares', () => {
  it('should return true when shares sum to 10000', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'pkh1', shareBps: 7000 },
      { address: 'pkh2', shareBps: 3000 },
    ];
    expect(validateShares(recipients)).toBe(true);
  });

  it('should return false when shares sum to less than 10000', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'pkh1', shareBps: 5000 },
      { address: 'pkh2', shareBps: 3000 },
    ];
    expect(validateShares(recipients)).toBe(false);
  });

  it('should return false when shares sum to more than 10000', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'pkh1', shareBps: 7000 },
      { address: 'pkh2', shareBps: 5000 },
    ];
    expect(validateShares(recipients)).toBe(false);
  });

  it('should handle empty recipient list', () => {
    expect(validateShares([])).toBe(false);
  });

  it('should handle single recipient with 100%', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'pkh1', shareBps: 10000 },
    ];
    expect(validateShares(recipients)).toBe(true);
  });
});

describe('calculatePayout', () => {
  it('should calculate 70% correctly', () => {
    const result = calculatePayout(1_000_000n, 7000);
    expect(result).toBe(700_000n);
  });

  it('should calculate 100% correctly', () => {
    const result = calculatePayout(1_000_000n, 10000);
    expect(result).toBe(1_000_000n);
  });

  it('should calculate 0% correctly', () => {
    const result = calculatePayout(1_000_000n, 0);
    expect(result).toBe(0n);
  });

  it('should handle small percentages', () => {
    // 0.01% of 1 million = 100
    const result = calculatePayout(1_000_000n, 1);
    expect(result).toBe(100n);
  });

  it('should handle rounding down for indivisible amounts', () => {
    // 33.33% of 100 = 33 (truncated)
    const result = calculatePayout(100n, 3333);
    expect(result).toBe(33n);
  });
});

describe('validateThreshold', () => {
  it('should return true for valid 2-of-3 threshold', () => {
    const requirement: SignatureRequirement = {
      signers: ['pkh1', 'pkh2', 'pkh3'],
      threshold: 2,
    };
    expect(validateThreshold(requirement)).toBe(true);
  });

  it('should return true for 1-of-1 threshold', () => {
    const requirement: SignatureRequirement = {
      signers: ['pkh1'],
      threshold: 1,
    };
    expect(validateThreshold(requirement)).toBe(true);
  });

  it('should return false for 0 threshold', () => {
    const requirement: SignatureRequirement = {
      signers: ['pkh1', 'pkh2'],
      threshold: 0,
    };
    expect(validateThreshold(requirement)).toBe(false);
  });

  it('should return false when threshold exceeds signer count', () => {
    const requirement: SignatureRequirement = {
      signers: ['pkh1', 'pkh2'],
      threshold: 3,
    };
    expect(validateThreshold(requirement)).toBe(false);
  });

  it('should return true for N-of-N threshold', () => {
    const requirement: SignatureRequirement = {
      signers: ['pkh1', 'pkh2', 'pkh3'],
      threshold: 3,
    };
    expect(validateThreshold(requirement)).toBe(true);
  });
});
