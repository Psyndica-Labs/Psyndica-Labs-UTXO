/**
 * Unit tests for HTLC utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sha256,
  generateSecret,
  calculateTimeout,
  generateAtomicSwapParams,
} from './htlc-builder.js';

describe('sha256', () => {
  it('generates consistent hashes', () => {
    const data = 'test_secret';
    const hash1 = sha256(data);
    const hash2 = sha256(data);
    expect(hash1).toBe(hash2);
  });

  it('generates different hashes for different inputs', () => {
    const hash1 = sha256('secret1');
    const hash2 = sha256('secret2');
    expect(hash1).not.toBe(hash2);
  });

  it('generates 64 character hex string', () => {
    const hash = sha256('test');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('handles empty string', () => {
    const hash = sha256('');
    expect(hash).toHaveLength(64);
  });
});

describe('generateSecret', () => {
  it('generates secret of specified length', () => {
    const secret = generateSecret(32);
    expect(secret).toHaveLength(32);
  });

  it('generates different secrets each time', () => {
    const secret1 = generateSecret(32);
    const secret2 = generateSecret(32);
    expect(secret1).not.toBe(secret2);
  });

  it('generates alphanumeric secrets', () => {
    const secret = generateSecret(100);
    expect(secret).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('defaults to 32 characters', () => {
    const secret = generateSecret();
    expect(secret).toHaveLength(32);
  });
});

describe('calculateTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates future timeout correctly', () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const durationMs = 3600000; // 1 hour
    const timeout = calculateTimeout(durationMs);

    expect(timeout).toBe(now + durationMs);
  });

  it('handles zero duration', () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const timeout = calculateTimeout(0);
    expect(timeout).toBe(now);
  });
});

describe('generateAtomicSwapParams', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates valid atomic swap parameters', () => {
    const params = {
      cardanoOffer: {
        tokenPolicy: 'abc123',
        tokenName: 'TOKEN',
        amount: 1000000n,
      },
      bitcoinExpect: {
        amount: 100000n,
        address: 'bc1qtest',
      },
      initiator: 'addr_initiator',
      counterparty: 'addr_counterparty',
      cardanoTimeoutMs: 7200000, // 2 hours
      bitcoinTimeoutMs: 3600000, // 1 hour
    };

    const result = generateAtomicSwapParams(params);

    expect(result.secret).toHaveLength(32);
    expect(result.secretHash).toHaveLength(64);
    expect(sha256(result.secret)).toBe(result.secretHash);
    
    // Verify Cardano HTLC
    expect(result.cardanoHTLC.recipient).toBe(params.counterparty);
    expect(result.cardanoHTLC.refundAddress).toBe(params.initiator);
    expect(result.cardanoHTLC.secretHash).toBe(result.secretHash);
    expect(result.cardanoHTLC.tokenPolicy).toBe(params.cardanoOffer.tokenPolicy);
    expect(result.cardanoHTLC.tokenName).toBe(params.cardanoOffer.tokenName);
    expect(result.cardanoHTLC.tokenAmount).toBe(params.cardanoOffer.amount);
    
    // Verify timeouts
    expect(result.cardanoHTLC.timeout).toBe(1700000000000 + 7200000);
    expect(result.bitcoinTimeout).toBe(1700000000000 + 3600000);
    
    // Bitcoin timeout should be shorter
    expect(result.bitcoinTimeout).toBeLessThan(result.cardanoHTLC.timeout);
  });

  it('generates unique secrets for each call', () => {
    const params = {
      cardanoOffer: { tokenPolicy: 'abc', tokenName: 'TOKEN', amount: 1000n },
      bitcoinExpect: { amount: 100n, address: 'bc1q' },
      initiator: 'addr1',
      counterparty: 'addr2',
      cardanoTimeoutMs: 7200000,
      bitcoinTimeoutMs: 3600000,
    };

    const result1 = generateAtomicSwapParams(params);
    const result2 = generateAtomicSwapParams(params);

    expect(result1.secret).not.toBe(result2.secret);
    expect(result1.secretHash).not.toBe(result2.secretHash);
  });
});
