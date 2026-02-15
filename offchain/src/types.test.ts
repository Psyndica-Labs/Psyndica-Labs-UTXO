/**
 * Unit tests for type utilities
 * 
 * Following supervision tree model: tests fail fast on assertion failures
 */

import { describe, it, expect } from 'vitest';
import {
  validateShares,
  calculateShare,
  meetsThreshold,
  MAX_BASIS_POINTS,
  RoyaltyRecipient,
} from './types.js';

describe('validateShares', () => {
  it('returns true when shares sum to 100%', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'addr1', shareBp: 5000, minThreshold: 1000000n },
      { address: 'addr2', shareBp: 3000, minThreshold: 1000000n },
      { address: 'addr3', shareBp: 2000, minThreshold: 1000000n },
    ];
    expect(validateShares(recipients)).toBe(true);
  });

  it('returns false when shares exceed 100%', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'addr1', shareBp: 6000, minThreshold: 1000000n },
      { address: 'addr2', shareBp: 5000, minThreshold: 1000000n },
    ];
    expect(validateShares(recipients)).toBe(false);
  });

  it('returns false when shares are below 100%', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'addr1', shareBp: 5000, minThreshold: 1000000n },
      { address: 'addr2', shareBp: 3000, minThreshold: 1000000n },
    ];
    expect(validateShares(recipients)).toBe(false);
  });

  it('handles empty recipient list', () => {
    expect(validateShares([])).toBe(false);
  });

  it('handles single recipient with 100%', () => {
    const recipients: RoyaltyRecipient[] = [
      { address: 'addr1', shareBp: 10000, minThreshold: 1000000n },
    ];
    expect(validateShares(recipients)).toBe(true);
  });
});

describe('calculateShare', () => {
  it('calculates correct share for 50%', () => {
    const total = 1000000n;
    const shareBp = 5000; // 50%
    expect(calculateShare(total, shareBp)).toBe(500000n);
  });

  it('calculates correct share for 25%', () => {
    const total = 1000000n;
    const shareBp = 2500; // 25%
    expect(calculateShare(total, shareBp)).toBe(250000n);
  });

  it('handles rounding down for fractional amounts', () => {
    const total = 100n;
    const shareBp = 3333; // 33.33%
    // 100 * 3333 / 10000 = 33.33 → rounds down to 33
    expect(calculateShare(total, shareBp)).toBe(33n);
  });

  it('handles zero total', () => {
    expect(calculateShare(0n, 5000)).toBe(0n);
  });

  it('handles zero share', () => {
    expect(calculateShare(1000000n, 0)).toBe(0n);
  });

  it('handles 100% share', () => {
    const total = 1000000n;
    expect(calculateShare(total, MAX_BASIS_POINTS)).toBe(total);
  });
});

describe('meetsThreshold', () => {
  const recipient: RoyaltyRecipient = {
    address: 'addr1',
    shareBp: 5000,
    minThreshold: 1000000n, // 1 ADA
  };

  it('returns true when amount equals threshold', () => {
    expect(meetsThreshold(1000000n, recipient)).toBe(true);
  });

  it('returns true when amount exceeds threshold', () => {
    expect(meetsThreshold(2000000n, recipient)).toBe(true);
  });

  it('returns false when amount is below threshold', () => {
    expect(meetsThreshold(500000n, recipient)).toBe(false);
  });

  it('returns false for zero amount', () => {
    expect(meetsThreshold(0n, recipient)).toBe(false);
  });

  it('handles zero threshold', () => {
    const zeroThresholdRecipient: RoyaltyRecipient = {
      address: 'addr1',
      shareBp: 5000,
      minThreshold: 0n,
    };
    expect(meetsThreshold(0n, zeroThresholdRecipient)).toBe(true);
  });
});
