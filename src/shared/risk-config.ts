import { query } from './database/pool';
import { logger } from './logger';

// =============================================================================
// Risk Config — Configurable risk weights and thresholds
// Loaded from risk_config table with in-memory cache.
// Business logic: Weights control how much each factor contributes to the
// final risk score. Thresholds determine auto-approve/refer/reject cutoffs.
// =============================================================================

/** Default values used when DB is unavailable or for testing. */
const DEFAULTS: Record<string, string> = {
  weight_buyer_credit: '0.30',
  weight_tenor: '0.20',
  weight_track_record: '0.20',
  weight_concentration: '0.15',
  weight_collateral: '0.15',
  threshold_auto_approve: '75',
  threshold_refer_manager: '50',
  advance_pct_high: '0.95',
  advance_pct_mid: '0.90',
  advance_pct_low: '0.85',
  premium_score_80_plus: '0',
  premium_score_70_79: '0.005',
  premium_score_60_69: '0.01',
  premium_score_50_59: '0.015',
  tier3_auto_reject_threshold: '3',
};

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Load all risk config from DB into memory cache.
 * Falls back to defaults on error.
 */
export async function loadRiskConfig(): Promise<Map<string, string>> {
  try {
    const result = await query<{ key: string; value: string }>(
      'SELECT key, value FROM risk_config',
      [],
    );
    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.key, row.value);
    }
    // Merge defaults for any missing keys
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!map.has(k)) {
        map.set(k, v);
      }
    }
    cache = map;
    cacheLoadedAt = Date.now();
    return map;
  } catch {
    logger.warn('Failed to load risk_config from DB — using defaults', {
      component: 'risk-config',
    });
    cache = new Map(Object.entries(DEFAULTS));
    cacheLoadedAt = Date.now();
    return cache;
  }
}

/**
 * Get a risk config value by key. Uses cache with 5-minute TTL.
 */
export async function getRiskConfigValue(key: string): Promise<string> {
  if (!cache || Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await loadRiskConfig();
  }
  const loaded = cache as Map<string, string>;
  return loaded.get(key) ?? DEFAULTS[key] ?? '0';
}

/**
 * Get a numeric risk config value.
 */
export async function getRiskConfigNumber(key: string): Promise<number> {
  const val = await getRiskConfigValue(key);
  return parseFloat(val);
}

/**
 * Invalidate the cache (e.g. after admin updates config).
 */
export function invalidateRiskConfigCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

/**
 * Get all risk factor weights as a record. Used by scorers.
 */
export async function getRiskWeights(): Promise<Record<string, number>> {
  if (!cache || Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await loadRiskConfig();
  }
  // loadRiskConfig() always merges DEFAULTS for missing keys,
  // so all weight keys are guaranteed to be present in the cache.
  const loaded = cache as Map<string, string>;
  const getWeight = (key: string): number => parseFloat(loaded.get(key) as string);

  return {
    buyer_credit: getWeight('weight_buyer_credit'),
    tenor: getWeight('weight_tenor'),
    track_record: getWeight('weight_track_record'),
    concentration: getWeight('weight_concentration'),
    collateral: getWeight('weight_collateral'),
  };
}

/**
 * Get defaults for unit testing without DB.
 */
export function getDefaults(): Record<string, string> {
  return { ...DEFAULTS };
}
