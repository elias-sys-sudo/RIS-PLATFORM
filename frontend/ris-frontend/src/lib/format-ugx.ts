/**
 * Format a BIGINT string (or number) as UGX currency.
 * Uses string-based formatting to avoid Number overflow on values > 2^53.
 *
 * @example formatUGX("1500000")   → "UGX 1,500,000"
 * @example formatUGX("0")         → "UGX 0"
 * @example formatUGX(null)        → "—"
 */
export function formatUGX(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  const str = typeof value === 'number' ? String(value) : value;
  const cleaned = str.replace(/[^0-9-]/g, '');
  if (cleaned === '' || cleaned === '-') return '—';

  const isNegative = cleaned.startsWith('-');
  const digits = isNegative ? cleaned.slice(1) : cleaned;

  // Insert commas every 3 digits from the right
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `UGX ${isNegative ? '-' : ''}${formatted}`;
}

/**
 * Parse a formatted UGX display string back to a raw integer string.
 * @example parseUGX("UGX 1,500,000") → "1500000"
 * @example parseUGX("1,500,000")     → "1500000"
 */
export function parseUGX(display: string): string {
  return display.replace(/[^0-9-]/g, '');
}
