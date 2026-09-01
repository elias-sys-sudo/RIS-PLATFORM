process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { BusinessRuleError } from '../../../src/shared/errors';
import { EligibilityErrorCode } from '../../../src/services/onboarding/onboarding.types';
import type {
  EligibilityCheckInput,
  EligibilityThrottleSignals,
} from '../../../src/services/onboarding/onboarding.types';

jest.mock('../../../src/services/onboarding/onboarding.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedRepo = jest.mocked(repo);

const VALID_INPUT: EligibilityCheckInput = {
  registered_company: true,
  authorized_person: true,
  years_in_business: 5,
  email: 'applicant@example.com',
};
const FAILING_INPUT: EligibilityCheckInput = {
  registered_company: false,
  authorized_person: true,
  years_in_business: 5,
  email: 'applicant@example.com',
};
const IP = '102.0.0.1';

function noSignals(
  overrides: Partial<EligibilityThrottleSignals> = {},
): EligibilityThrottleSignals {
  return {
    failCount5min: 0,
    failCount1hour: 0,
    failCount24hour: 0,
    failCount30day: 0,
    mostRecentPassAt: null,
    mostRecentFailAt: null,
    ...overrides,
  };
}

describe('eligibility throttle (REQ-ELIG-006 — progressive backoff)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepo.createEligibilityCheck.mockResolvedValue(undefined);
  });

  describe('not blocked', () => {
    it('first-time attempt — empty signals', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(noSignals());

      const result = await service.checkEligibility(VALID_INPUT, IP);

      expect(result.passed).toBe(true);
      expect(result.session_token).toBeDefined();
      expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledTimes(1);
    });

    it('1 fail in last 5 min is BELOW the 5min threshold (need 2)', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 1,
          failCount1hour: 1,
          failCount24hour: 1,
          failCount30day: 1,
          mostRecentFailAt: new Date(Date.now() - 60_000),
        }),
      );

      const result = await service.checkEligibility(VALID_INPUT, IP);
      expect(result.passed).toBe(true);
    });

    it('forgiveness — a passed attempt newer than the most recent fail clears all prior fails', async () => {
      const passAt = new Date(Date.now() - 60_000);
      const failAt = new Date(Date.now() - 120_000);
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 5,
          failCount1hour: 5,
          failCount24hour: 5,
          failCount30day: 5,
          mostRecentPassAt: passAt,
          mostRecentFailAt: failAt,
        }),
      );

      const result = await service.checkEligibility(VALID_INPUT, IP);
      expect(result.passed).toBe(true);
    });

    it('an older passed row does NOT forgive when a newer fail exists', async () => {
      const passAt = new Date(Date.now() - 120_000);
      const failAt = new Date(Date.now() - 60_000);
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 2,
          failCount1hour: 2,
          failCount24hour: 2,
          failCount30day: 2,
          mostRecentPassAt: passAt,
          mostRecentFailAt: failAt,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });
  });

  describe('blocked', () => {
    it('5min tier — 2 fails in last 5 min', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 2,
          failCount1hour: 2,
          failCount24hour: 2,
          failCount30day: 2,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toMatchObject({
        errorCode: EligibilityErrorCode.THROTTLED,
        data: { tier: '5min', retryAfterSeconds: 300 },
      });
      expect(mockedRepo.createEligibilityCheck).not.toHaveBeenCalled();
    });

    it('1hour tier wins when 3 fails in last hour (and 5min count below 2)', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 1,
          failCount1hour: 3,
          failCount24hour: 3,
          failCount30day: 3,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toMatchObject({
        errorCode: EligibilityErrorCode.THROTTLED,
        data: { tier: '1hour', retryAfterSeconds: 3600 },
      });
    });

    it('24hour tier — 5 fails in last 24h', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 0,
          failCount1hour: 0,
          failCount24hour: 5,
          failCount30day: 5,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toMatchObject({
        data: { tier: '24hour', retryAfterSeconds: 86_400 },
      });
    });

    it('30day tier — 7 fails in last 30 days (spec ceiling)', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 0,
          failCount1hour: 0,
          failCount24hour: 0,
          failCount30day: 7,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toMatchObject({
        data: { tier: '30day', retryAfterSeconds: 86_400 * 30 },
      });
    });

    it('reports the LONGEST applicable tier when a spike escalated across windows', async () => {
      // 8 fails in 5 min means 5min, 1h, 24h, 30d are all over threshold.
      // We report the 30day tier so the user knows the worst block.
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(
        noSignals({
          failCount5min: 8,
          failCount1hour: 8,
          failCount24hour: 8,
          failCount30day: 8,
        }),
      );

      await expect(service.checkEligibility(VALID_INPUT, IP)).rejects.toMatchObject({
        data: { tier: '30day' },
      });
    });
  });

  describe('signal collection', () => {
    it('queries the repo with normalised lowercase email + IP', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(noSignals());

      await service.checkEligibility({ ...VALID_INPUT, email: 'Applicant@Example.COM' }, IP);

      expect(mockedRepo.getEligibilityThrottleSignals).toHaveBeenCalledWith(
        'applicant@example.com',
        IP,
      );
    });

    it('passes null email to the throttle when applicant did not supply one', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(noSignals());
      const noEmail: EligibilityCheckInput = {
        registered_company: true,
        authorized_person: true,
        years_in_business: 5,
      };

      await service.checkEligibility(noEmail, IP);

      expect(mockedRepo.getEligibilityThrottleSignals).toHaveBeenCalledWith(null, IP);
    });

    it('records failed attempt with the normalised email', async () => {
      mockedRepo.getEligibilityThrottleSignals.mockResolvedValueOnce(noSignals());

      await service.checkEligibility({ ...FAILING_INPUT, email: 'Applicant@Example.COM' }, IP);

      expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          passed: false,
          email: 'applicant@example.com',
          ipAddress: IP,
        }),
      );
    });
  });
});
