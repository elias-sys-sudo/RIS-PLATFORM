import { describe, it, expect } from 'vitest';
import { formatUGX, parseUGX } from '../format-ugx';

describe('formatUGX', () => {
  it('formats a number', () => {
    expect(formatUGX(1500000)).toBe('UGX 1,500,000');
  });

  it('formats a string', () => {
    expect(formatUGX('1500000')).toBe('UGX 1,500,000');
  });

  it('formats zero', () => {
    expect(formatUGX(0)).toBe('UGX 0');
    expect(formatUGX('0')).toBe('UGX 0');
  });

  it('returns dash for null', () => {
    expect(formatUGX(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatUGX(undefined)).toBe('—');
  });

  it('returns dash for empty string', () => {
    expect(formatUGX('')).toBe('—');
  });

  it('handles large BIGINT values without overflow', () => {
    expect(formatUGX('100000000000')).toBe('UGX 100,000,000,000');
    expect(formatUGX('999999999999999')).toBe('UGX 999,999,999,999,999');
  });

  it('handles negative values', () => {
    expect(formatUGX(-500000)).toBe('UGX -500,000');
  });

  it('never shows decimals', () => {
    expect(formatUGX(1500000)).not.toContain('.');
  });
});

describe('parseUGX', () => {
  it('parses formatted string back to raw', () => {
    expect(parseUGX('UGX 1,500,000')).toBe('1500000');
  });

  it('parses plain formatted number', () => {
    expect(parseUGX('1,500,000')).toBe('1500000');
  });
});
