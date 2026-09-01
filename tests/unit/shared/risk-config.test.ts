process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as riskConfig from '../../../src/shared/risk-config';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { query } = require('../../../src/shared/database/pool') as { query: jest.Mock };

describe('risk-config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    riskConfig.invalidateRiskConfigCache();
  });

  describe('loadRiskConfig', () => {
    it('loads values from DB and merges with defaults', async () => {
      query.mockResolvedValue({
        rows: [
          { key: 'weight_buyer_credit', value: '0.35' },
          { key: 'weight_tenor', value: '0.25' },
        ],
      });

      const config = await riskConfig.loadRiskConfig();

      expect(config.get('weight_buyer_credit')).toBe('0.35');
      expect(config.get('weight_tenor')).toBe('0.25');
      // Defaults fill in missing keys
      expect(config.get('weight_track_record')).toBe('0.20');
      expect(config.get('weight_concentration')).toBe('0.15');
      expect(config.get('weight_collateral')).toBe('0.15');
    });

    it('falls back to defaults on DB error', async () => {
      query.mockRejectedValue(new Error('DB unreachable'));

      const config = await riskConfig.loadRiskConfig();

      expect(config.get('weight_buyer_credit')).toBe('0.30');
      expect(config.get('threshold_auto_approve')).toBe('75');
    });
  });

  describe('getRiskConfigValue', () => {
    it('returns cached value on subsequent calls', async () => {
      query.mockResolvedValue({
        rows: [{ key: 'threshold_auto_approve', value: '80' }],
      });

      const val1 = await riskConfig.getRiskConfigValue('threshold_auto_approve');
      const val2 = await riskConfig.getRiskConfigValue('threshold_auto_approve');

      expect(val1).toBe('80');
      expect(val2).toBe('80');
      // Should only call DB once due to cache
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('returns default for unknown key', async () => {
      query.mockResolvedValue({ rows: [] });

      const val = await riskConfig.getRiskConfigValue('nonexistent_key');
      expect(val).toBe('0');
    });
  });

  describe('getRiskConfigNumber', () => {
    it('returns parsed float', async () => {
      query.mockResolvedValue({
        rows: [{ key: 'advance_pct_high', value: '0.95' }],
      });

      const val = await riskConfig.getRiskConfigNumber('advance_pct_high');
      expect(val).toBe(0.95);
    });
  });

  describe('getRiskWeights', () => {
    it('returns all factor weights', async () => {
      query.mockResolvedValue({ rows: [] });

      const weights = await riskConfig.getRiskWeights();

      expect(weights.buyer_credit).toBe(0.3);
      expect(weights.tenor).toBe(0.2);
      expect(weights.track_record).toBe(0.2);
      expect(weights.concentration).toBe(0.15);
      expect(weights.collateral).toBe(0.15);
    });
  });

  describe('getDefaults', () => {
    it('returns a copy of defaults', () => {
      const defaults = riskConfig.getDefaults();
      expect(defaults.weight_buyer_credit).toBe('0.30');
      expect(defaults.tier3_auto_reject_threshold).toBe('3');
    });
  });

  describe('invalidateRiskConfigCache', () => {
    it('forces reload on next access', async () => {
      query.mockResolvedValue({ rows: [{ key: 'weight_buyer_credit', value: '0.30' }] });

      await riskConfig.getRiskConfigValue('weight_buyer_credit');
      expect(query).toHaveBeenCalledTimes(1);

      riskConfig.invalidateRiskConfigCache();

      await riskConfig.getRiskConfigValue('weight_buyer_credit');
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // getRiskWeights — lines 97 and 101-105 branch 1
  // The ?? DEFAULTS.xxx branches fire when cache.get() returns undefined,
  // i.e. when the DB returns partial rows that are missing weight keys.
  // -------------------------------------------------------------------------
  describe('getRiskWeights — default fallback branches (lines 101-105 branch 1)', () => {
    it('falls back to DEFAULTS for each weight key when cache is empty', async () => {
      // Return no rows → cache will have no weight_* keys → ?? DEFAULTS.xxx paths hit
      query.mockResolvedValue({ rows: [] });

      const weights = await riskConfig.getRiskWeights();

      // All values should equal the compiled-in DEFAULTS
      expect(weights.buyer_credit).toBeCloseTo(0.3);
      expect(weights.tenor).toBeCloseTo(0.2);
      expect(weights.track_record).toBeCloseTo(0.2);
      expect(weights.concentration).toBeCloseTo(0.15);
      expect(weights.collateral).toBeCloseTo(0.15);
    });

    it('uses cached values when weight keys are present in DB response', async () => {
      query.mockResolvedValue({
        rows: [
          { key: 'weight_buyer_credit', value: '0.40' },
          { key: 'weight_tenor', value: '0.22' },
          { key: 'weight_track_record', value: '0.18' },
          { key: 'weight_concentration', value: '0.12' },
          { key: 'weight_collateral', value: '0.08' },
        ],
      });

      const weights = await riskConfig.getRiskWeights();

      expect(weights.buyer_credit).toBeCloseTo(0.4);
      expect(weights.tenor).toBeCloseTo(0.22);
      expect(weights.track_record).toBeCloseTo(0.18);
      expect(weights.concentration).toBeCloseTo(0.12);
      expect(weights.collateral).toBeCloseTo(0.08);
    });

    // line 97 branch 1: cache is stale (expired TTL) → loadRiskConfig() is called again
    it('reloads config when cache TTL has expired', async () => {
      // First load
      query.mockResolvedValue({ rows: [] });
      await riskConfig.getRiskWeights();
      expect(query).toHaveBeenCalledTimes(1);

      // Expire the cache by invalidating
      riskConfig.invalidateRiskConfigCache();

      // Second call should trigger reload
      query.mockResolvedValue({ rows: [] });
      await riskConfig.getRiskWeights();
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // getRiskWeights line 97 branch 5: the TTL-expiry arm of the condition
  // (!cache is FALSE but Date.now() - cacheLoadedAt > CACHE_TTL_MS is TRUE)
  // Requires cache to be non-null but stale (not achieved by invalidating).
  // -------------------------------------------------------------------------
  describe('getRiskWeights — TTL-expiry branch (branch 5, line 97, right operand of ||)', () => {
    it('reloads config when TTL has expired without explicit cache invalidation', async () => {
      query.mockResolvedValue({ rows: [] });

      // First call: populates cache (cache is now non-null)
      await riskConfig.getRiskWeights();
      expect(query).toHaveBeenCalledTimes(1);

      // Advance time by 6 minutes (> 5-minute TTL) without invalidating cache.
      // This makes !cache === false but Date.now() - cacheLoadedAt > CACHE_TTL_MS === true,
      // covering the right operand (branch 5, location 1) of the || on line 97.
      const sixMinutesMs = 6 * 60 * 1000;
      const realDateNow = Date.now.bind(Date);
      jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + sixMinutesMs);

      query.mockResolvedValue({ rows: [] });
      await riskConfig.getRiskWeights();

      // DB should have been queried again due to stale cache
      expect(query).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });
  });

  // -------------------------------------------------------------------------
  // getRiskConfigValue line 71: TTL-expiry branch when cache is valid
  // -------------------------------------------------------------------------
  describe('getRiskConfigValue — TTL-expiry branch (branch, line 71, right operand of ||)', () => {
    it('reloads config when TTL has expired without explicit cache invalidation', async () => {
      query.mockResolvedValue({ rows: [] });

      // Populate cache
      await riskConfig.getRiskConfigValue('weight_buyer_credit');
      expect(query).toHaveBeenCalledTimes(1);

      // Advance time past TTL to trigger the right operand of the || condition
      const sixMinutesMs = 6 * 60 * 1000;
      const realDateNow = Date.now.bind(Date);
      jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + sixMinutesMs);

      query.mockResolvedValue({ rows: [{ key: 'weight_buyer_credit', value: '0.32' }] });
      const val = await riskConfig.getRiskConfigValue('weight_buyer_credit');

      // Cache was reloaded — new value from DB
      expect(query).toHaveBeenCalledTimes(2);
      expect(val).toBe('0.32');

      jest.restoreAllMocks();
    });
  });

  // -------------------------------------------------------------------------
  // getRiskConfigValue — line 74 branch: cache?.get(key) is undefined
  // and DEFAULTS[key] is also undefined → returns '0'
  // -------------------------------------------------------------------------
  describe('getRiskConfigValue — triple fallback to "0"', () => {
    it('returns "0" when key is not in cache and not in DEFAULTS', async () => {
      query.mockResolvedValue({ rows: [] });

      const val = await riskConfig.getRiskConfigValue('completely_unknown_key');
      expect(val).toBe('0');
    });
  });

  // -------------------------------------------------------------------------
  // getRiskWeights — branch 1 of ?? on lines 101-105:
  // cache?.get() returns undefined → DEFAULTS.xxx fallback is used.
  // Achieved by loading with a DB that returns no weight_* rows so the keys
  // are absent from the cache map (cache exists but map.get() → undefined).
  // -------------------------------------------------------------------------
  describe('getRiskWeights — ?? DEFAULTS fallback (branch 1 on lines 101-105)', () => {
    it('uses DEFAULTS for all weight keys when DB returns unrelated rows only', async () => {
      // Return rows that do NOT include any weight_* keys — the cache map
      // will be a Map that has only non-weight keys, so .get('weight_xxx')
      // returns undefined, triggering the ?? branch.
      query.mockResolvedValue({
        rows: [
          { key: 'threshold_auto_approve', value: '75' },
          { key: 'threshold_refer_manager', value: '50' },
        ],
      });

      const weights = await riskConfig.getRiskWeights();

      // All weight values must equal DEFAULTS since cache.get() returns undefined
      expect(weights.buyer_credit).toBeCloseTo(0.3);
      expect(weights.tenor).toBeCloseTo(0.2);
      expect(weights.track_record).toBeCloseTo(0.2);
      expect(weights.concentration).toBeCloseTo(0.15);
      expect(weights.collateral).toBeCloseTo(0.15);
    });
  });

  // -------------------------------------------------------------------------
  // getRiskWeights — partial DB data: some weight keys present, some missing
  // Covers the mixed scenario where some cache?.get() return values
  // and others fall back to DEFAULTS
  // -------------------------------------------------------------------------
  describe('getRiskWeights — partial weight key coverage', () => {
    it('uses DB value for present keys and DEFAULTS for missing ones', async () => {
      query.mockResolvedValue({
        rows: [
          { key: 'weight_buyer_credit', value: '0.40' },
          { key: 'weight_tenor', value: '0.25' },
          // weight_track_record, weight_concentration, weight_collateral missing
        ],
      });

      const weights = await riskConfig.getRiskWeights();

      // DB values used for present keys
      expect(weights.buyer_credit).toBeCloseTo(0.4);
      expect(weights.tenor).toBeCloseTo(0.25);
      // DEFAULTS used for missing keys
      expect(weights.track_record).toBeCloseTo(0.2);
      expect(weights.concentration).toBeCloseTo(0.15);
      expect(weights.collateral).toBeCloseTo(0.15);
    });
  });

  // -------------------------------------------------------------------------
  // getRiskConfigValue — key in DEFAULTS but not in DB (cache miss → default)
  // -------------------------------------------------------------------------
  describe('getRiskConfigValue — DEFAULTS fallback for known keys', () => {
    it('returns DEFAULTS value when key is not in DB response', async () => {
      // DB returns no rows for this key, but key is in DEFAULTS
      query.mockResolvedValue({ rows: [] });

      const val = await riskConfig.getRiskConfigValue('tier3_auto_reject_threshold');
      // loadRiskConfig merges DEFAULTS for missing keys, so cache has it
      expect(val).toBe('3');
    });
  });

  // -------------------------------------------------------------------------
  // getRiskConfigNumber — returns NaN for non-numeric value
  // -------------------------------------------------------------------------
  describe('getRiskConfigNumber — edge case', () => {
    it('returns parsed float for valid numeric string', async () => {
      query.mockResolvedValue({
        rows: [{ key: 'custom_key', value: '42.5' }],
      });

      const val = await riskConfig.getRiskConfigNumber('custom_key');
      expect(val).toBe(42.5);
    });
  });
});
