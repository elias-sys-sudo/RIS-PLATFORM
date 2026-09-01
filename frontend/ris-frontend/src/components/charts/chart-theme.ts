/** Resolved hex colors matching the OKLCH design tokens. Recharts needs hex, not CSS vars. */
export const CHART_COLORS = {
  primary: '#1B3352',
  secondary: '#F59E0B',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#2563EB',
  muted: '#78716C',
  /** 8-color palette for multi-series charts */
  palette: ['#1B3352', '#F59E0B', '#16A34A', '#2563EB', '#7C3AED', '#EC4899', '#06B6D4', '#84CC16'],
} as const;

export const RISK_COLORS: Record<string, string> = {
  low: '#16A34A',
  medium: '#F59E0B',
  high: '#F97316',
  critical: '#EF4444',
};

export const AGING_COLORS = ['#16A34A', '#D97706', '#EA580C', '#E11D48', '#DC2626'] as const;

/** Subtle dotted grid replacing dated "3 3" dashes */
export const GRID_CONFIG = {
  strokeDasharray: '2 4',
  strokeOpacity: 0.4,
  vertical: false,
  stroke: '#E7E5E4',
} as const;

/** Axis config for text labels (DM Sans) */
export const AXIS_LABEL_CONFIG = {
  tickLine: false,
  axisLine: false,
  fontSize: 12,
  fontFamily: "'DM Sans Variable', 'DM Sans', sans-serif",
  fill: '#78716C',
  tickMargin: 8,
} as const;

/** Axis config for monetary values (Geist Mono) */
export const AXIS_VALUE_CONFIG = {
  ...AXIS_LABEL_CONFIG,
  fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
} as const;

/** Compact UGX formatter for chart labels. Consolidates 3 duplicate implementations. */
export function formatCompactUGX(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num) || num === 0) return 'UGX 0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) return `${sign}UGX ${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${sign}UGX ${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}UGX ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}UGX ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}UGX ${abs}`;
}

/** Format axis values without the UGX prefix for cleaner charts */
export function formatCompactValue(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num) || num === 0) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs}`;
}
