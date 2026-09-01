jest.mock('../../../src/shared/database/pool', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  query: jest.fn(),
  beginWithRls: jest.fn(),
}));
jest.mock('../../../src/services/collections/collections.repository');
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getDrawdownByInvoiceId: jest.fn(),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn(),
  encrypt: jest.fn(),
}));

import { calculatePenalty } from '../../../src/services/collections/collections.service';

// ---------------------------------------------------------------------------
// calculatePenalty — BigInt penalty arithmetic edge cases
// ---------------------------------------------------------------------------

describe('calculatePenalty', () => {
  // -----------------------------------------------------------------------
  // Standard cases
  // -----------------------------------------------------------------------

  it('calculates standard daily penalty at 0.1% for 1 day', () => {
    // 50,000,000 * 0.001 * 1 = 50,000
    const result = calculatePenalty('50000000', 1, '0.001');
    expect(result).toBe('50000');
  });

  it('calculates standard daily penalty at 0.1% for 10 days', () => {
    // 50,000,000 * 0.001 * 10 = 500,000
    const result = calculatePenalty('50000000', 10, '0.001');
    expect(result).toBe('500000');
  });

  // -----------------------------------------------------------------------
  // Rate precision variants
  // -----------------------------------------------------------------------

  it('converts rate "0.0001" (0.01% per day) correctly', () => {
    // 50,000,000 * 0.0001 * 1 = 5,000
    const result = calculatePenalty('50000000', 1, '0.0001');
    expect(result).toBe('5000');
  });

  it('handles max 6-digit precision rate "0.123456"', () => {
    // rateInt = 0 * 1_000_000 + 123456 = 123456
    // penalty = (50_000_000 * 123456 * 1) / 1_000_000 = 6_172_800
    const result = calculatePenalty('50000000', 1, '0.123456');
    expect(result).toBe('6172800');
  });

  it('handles rate with integer part "1.000000" (100% per day)', () => {
    // rateInt = 1 * 1_000_000 + 0 = 1_000_000
    // penalty = (50_000_000 * 1_000_000 * 1) / 1_000_000 = 50_000_000
    const result = calculatePenalty('50000000', 1, '1.000000');
    expect(result).toBe('50000000');
  });

  it('handles rate with no decimal part "1"', () => {
    // rateParts[1] is undefined → fracPart = '' → padEnd(6,'0') → '000000'
    // rateInt = 1 * 1_000_000 + 0 = 1_000_000
    // penalty = (50_000_000 * 1_000_000 * 1) / 1_000_000 = 50_000_000
    const result = calculatePenalty('50000000', 1, '1');
    expect(result).toBe('50000000');
  });

  // -----------------------------------------------------------------------
  // Zero / boundary cases
  // -----------------------------------------------------------------------

  it('returns "0" when daysOverdue is zero', () => {
    const result = calculatePenalty('50000000', 0, '0.001');
    expect(result).toBe('0');
  });

  it('returns "0" when faceValue is zero', () => {
    const result = calculatePenalty('0', 10, '0.001');
    expect(result).toBe('0');
  });

  // -----------------------------------------------------------------------
  // Large value — BigInt overflow safety
  // -----------------------------------------------------------------------

  it('handles large face value (100 billion UGX) without overflow', () => {
    // 100_000_000_000 * 0.001 * 30 = 3_000_000_000
    const result = calculatePenalty('100000000000', 30, '0.001');
    expect(result).toBe('3000000000');
  });

  it('handles very large face value with high rate and many days', () => {
    // 100_000_000_000 * 1.0 * 365 = 36_500_000_000_000
    const result = calculatePenalty('100000000000', 365, '1.000000');
    expect(result).toBe('36500000000000');
  });

  // -----------------------------------------------------------------------
  // Rate parsing edge cases
  // -----------------------------------------------------------------------

  it('truncates rate fractional part beyond 6 digits', () => {
    // "0.1234569" → fracPart becomes "123456" (9 is dropped)
    // Same as "0.123456"
    const result = calculatePenalty('50000000', 1, '0.1234569');
    const expected = calculatePenalty('50000000', 1, '0.123456');
    expect(result).toBe(expected);
  });

  it('pads short fractional parts with zeros', () => {
    // "0.1" → fracPart = "100000"
    // rateInt = 0 * 1_000_000 + 100_000 = 100_000
    // penalty = (50_000_000 * 100_000 * 1) / 1_000_000 = 5_000_000
    const result = calculatePenalty('50000000', 1, '0.1');
    expect(result).toBe('5000000');
  });
});
