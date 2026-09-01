import { describe, it, expect } from '@jest/globals';
import { BusinessRuleError } from '../../../src/shared/errors';
import { validateRateCap } from '../../../src/services/pricing/pricing.service';

describe('Rate Cap Validation', () => {
  describe('validateRateCap', () => {
    it('does not throw when rate is below the 15% cap', () => {
      expect(() => validateRateCap(0.1)).not.toThrow();
    });

    it('does not throw when rate is exactly at the 15% cap', () => {
      expect(() => validateRateCap(0.15)).not.toThrow();
    });

    it('throws BusinessRuleError when rate exceeds 15% cap', () => {
      expect(() => validateRateCap(0.16)).toThrow(BusinessRuleError);
    });

    it('throws with RATE_CAP_EXCEEDED code', () => {
      try {
        validateRateCap(0.2);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessRuleError);
        expect((err as BusinessRuleError).errorCode).toBe('RATE_CAP_EXCEEDED');
      }
    });

    it('includes rate values in error message', () => {
      try {
        validateRateCap(0.25);
        expect(true).toBe(false);
      } catch (err) {
        const msg = (err as BusinessRuleError).message;
        expect(msg).toContain('0.25');
        expect(msg).toContain('0.15');
      }
    });

    it('allows common rate combinations below cap', () => {
      // Bank 4% + Risk 3% + RIS 5% = 12% — below cap
      expect(() => validateRateCap(0.12)).not.toThrow();
    });

    it('rejects rate combinations exceeding cap', () => {
      // Bank 6% + Risk 5% + RIS 5% = 16% — above cap
      expect(() => validateRateCap(0.16)).toThrow(BusinessRuleError);
    });
  });
});
