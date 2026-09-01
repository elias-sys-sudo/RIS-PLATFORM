process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/facilities/facilities.service';
import * as repo from '../../../src/services/facilities/facilities.repository';
import { pool, beginWithRls } from '../../../src/shared/database/pool';
import { FacilityStatus, DrawdownStatus } from '../../../src/services/facilities/facilities.types';
import type {
  BankFacility,
  FacilityDrawdown,
} from '../../../src/services/facilities/facilities.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/facilities/facilities.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn(),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FACILITY_ID = 'fac-uuid-1';
const FACILITY_ID_2 = 'fac-uuid-2';
const INVOICE_ID = 'inv-uuid-1';
const USER_ID = 'user-uuid-1';
const IP = '127.0.0.1';
const UA = 'test-agent';

function makeFacility(overrides: Partial<BankFacility> = {}): BankFacility {
  return {
    id: FACILITY_ID,
    bank_name: 'Stanbic Bank',
    total_limit: '2000000000',
    drawn_amount: '990000000',
    available_amount: '1010000000',
    annual_rate: '0.18',
    maturity_date: '2027-06-30',
    status: FacilityStatus.ACTIVE,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-03-21T00:00:00Z',
    ...overrides,
  };
}

function makeDrawdown(overrides: Partial<FacilityDrawdown> = {}): FacilityDrawdown {
  return {
    id: 'dd-uuid-1',
    facility_id: FACILITY_ID,
    invoice_id: INVOICE_ID,
    principal: '990000000',
    accrued_interest: '0',
    bank_fees: '0',
    status: DrawdownStatus.ACTIVE,
    last_accrued_date: '2026-03-20',
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T00:00:00Z',
    ...overrides,
  };
}

function setupMockClient(): {
  query: jest.Mock;
  release: jest.Mock;
} {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  mockedPool.connect.mockResolvedValue(client as never);
  return client;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// determineTier / calculateDailyInterest (pure functions)
// ===========================================================================
describe('calculateDailyInterest', () => {
  it('computes daily interest with integer arithmetic', () => {
    // principal=990,000,000, rate=18% → 488,219 UGX/day
    const result = service.calculateDailyInterest('990000000', '0.18');
    expect(result).toBe('488219');
  });

  it('returns zero for zero principal', () => {
    const result = service.calculateDailyInterest('0', '0.18');
    expect(result).toBe('0');
  });

  it('handles large principals without overflow', () => {
    const result = service.calculateDailyInterest('5000000000', '0.22');
    // 5,000,000,000 × 0.22 / 365 = 3,013,698 (truncated)
    expect(result).toBe('3013698');
  });
});

describe('calculateUtilisation', () => {
  it('returns correct percentage for acceptance test', () => {
    // drawn=990,000,000 / limit=2,000,000,000 = 49.5%
    const result = service.calculateUtilisation('990000000', '2000000000');
    expect(result).toBeCloseTo(49.5, 1);
  });

  it('returns 0 when nothing drawn', () => {
    const result = service.calculateUtilisation('0', '2000000000');
    expect(result).toBe(0);
  });

  it('returns 100 when fully drawn', () => {
    const result = service.calculateUtilisation('2000000000', '2000000000');
    expect(result).toBe(100);
  });
});

// ===========================================================================
// createDrawdown
// ===========================================================================
describe('createDrawdown', () => {
  it('rejects when facility maturity < invoice due date', async () => {
    const client = setupMockClient();
    const facility = makeFacility({ maturity_date: '2026-06-01' });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000',
        '0',
        '2026-09-01', // invoice due date AFTER facility maturity
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Facility maturity is before invoice due date');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('throws NotFoundError when facility not found', async () => {
    const client = setupMockClient();
    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(null);

    await expect(
      service.createDrawdown(
        'nonexistent-fac',
        INVOICE_ID,
        '100000000',
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Facility');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects when facility is suspended', async () => {
    const client = setupMockClient();
    const facility = makeFacility({ status: FacilityStatus.SUSPENDED });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000',
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Facility is suspended');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects when facility is matured', async () => {
    setupMockClient();
    const facility = makeFacility({ status: FacilityStatus.MATURED });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000',
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Facility has matured');
  });

  it('rejects when facility is closed', async () => {
    setupMockClient();
    const facility = makeFacility({ status: FacilityStatus.CLOSED });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000',
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Facility is closed');
  });

  it('rejects when principal exceeds available amount', async () => {
    setupMockClient();
    const facility = makeFacility({ available_amount: '50000000' });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000', // > 50M available
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('Principal exceeds available facility amount');
  });

  it('creates drawdown, updates drawn_amount, and commits', async () => {
    const client = setupMockClient();
    const facility = makeFacility({
      available_amount: '1010000000',
      drawn_amount: '990000000',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.createDrawdownWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const result = await service.createDrawdown(
      FACILITY_ID,
      INVOICE_ID,
      '100000000',
      '500000',
      '2026-06-01',
      USER_ID,
      IP,
      UA,
    );

    expect(result.facilityId).toBe(FACILITY_ID);
    expect(result.invoiceId).toBe(INVOICE_ID);
    expect(result.principal).toBe('100000000');

    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();

    // drawn_amount should increase by principal
    expect(mockedRepo.updateDrawnAmountWithClient).toHaveBeenCalledWith(
      client,
      FACILITY_ID,
      '1090000000', // 990M + 100M
    );

    // audit log must be written
    expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
  });

  it('sends utilisation alert at 80%', async () => {
    setupMockClient();
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '750000000',
      available_amount: '250000000',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.createDrawdownWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationQueue(mockQueue as never);

    // Drawing 60M → drawn becomes 810M/1000M = 81%
    await service.createDrawdown(
      FACILITY_ID,
      INVOICE_ID,
      '60000000',
      '0',
      '2026-06-01',
      USER_ID,
      IP,
      UA,
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      'facility-utilisation-alert',
      expect.objectContaining({
        facilityId: FACILITY_ID,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        utilisationPercent: expect.any(Number),
        alertLevel: 'warning',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    service.setNotificationQueue(null as never);
  });

  it('sends MD notification AND suspends facility at 90%', async () => {
    const client = setupMockClient();
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '850000000',
      available_amount: '150000000',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.createDrawdownWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockResolvedValue(undefined);
    mockedRepo.updateFacilityStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationQueue(mockQueue as never);

    // Drawing 60M → drawn becomes 910M/1000M = 91%
    await service.createDrawdown(
      FACILITY_ID,
      INVOICE_ID,
      '60000000',
      '0',
      '2026-06-01',
      USER_ID,
      IP,
      UA,
    );

    // Should suspend the facility
    expect(mockedRepo.updateFacilityStatusWithClient).toHaveBeenCalledWith(
      client,
      FACILITY_ID,
      FacilityStatus.SUSPENDED,
    );

    // Should notify MD
    expect(mockQueue.add).toHaveBeenCalledWith(
      'facility-utilisation-alert',
      expect.objectContaining({
        alertLevel: 'critical',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    service.setNotificationQueue(null as never);
  });

  it('rolls back on error', async () => {
    const client = setupMockClient();
    const facility = makeFacility();

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.createDrawdownWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.createDrawdown(
        FACILITY_ID,
        INVOICE_ID,
        '100000000',
        '0',
        '2026-06-01',
        USER_ID,
        IP,
        UA,
      ),
    ).rejects.toThrow('DB error');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// processRepayment
// ===========================================================================
describe('processRepayment', () => {
  it('atomically updates drawn_amount and creates repayment', async () => {
    const client = setupMockClient();
    const facility = makeFacility({ drawn_amount: '990000000' });
    const drawdown = makeDrawdown({
      principal: '100000000',
      accrued_interest: '500000',
      bank_fees: '200000',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.getDrawdownByIdWithClient.mockResolvedValue(drawdown);
    mockedRepo.createRepaymentWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawdownStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const result = await service.processRepayment(FACILITY_ID, drawdown.id, USER_ID, IP, UA);

    expect(result.principal).toBe('100000000');
    expect(result.accruedInterest).toBe('500000');
    expect(result.bankFees).toBe('200000');
    // total = 100000000 + 500000 + 200000 = 100700000
    expect(result.totalRepayment).toBe('100700000');

    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenCalledWith('COMMIT');

    // drawn_amount should decrease by principal
    expect(mockedRepo.updateDrawnAmountWithClient).toHaveBeenCalledWith(
      client,
      FACILITY_ID,
      '890000000', // 990M - 100M
    );

    expect(mockedRepo.updateDrawdownStatusWithClient).toHaveBeenCalledWith(
      client,
      drawdown.id,
      DrawdownStatus.REPAID,
    );

    expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
  });

  it('rejects repayment for already-repaid drawdown', async () => {
    setupMockClient();
    const facility = makeFacility();
    const drawdown = makeDrawdown({ status: DrawdownStatus.REPAID });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.getDrawdownByIdWithClient.mockResolvedValue(drawdown);

    await expect(
      service.processRepayment(FACILITY_ID, drawdown.id, USER_ID, IP, UA),
    ).rejects.toThrow('Drawdown has already been repaid');
  });

  it('rolls back if drawn_amount update fails mid-repayment', async () => {
    const client = setupMockClient();
    const facility = makeFacility();
    const drawdown = makeDrawdown({
      principal: '100000000',
      accrued_interest: '0',
      bank_fees: '0',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.getDrawdownByIdWithClient.mockResolvedValue(drawdown);
    mockedRepo.createRepaymentWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawdownStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockRejectedValue(new Error('Update failed'));

    await expect(
      service.processRepayment(FACILITY_ID, drawdown.id, USER_ID, IP, UA),
    ).rejects.toThrow('Update failed');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// accrueInterest
// ===========================================================================
describe('accrueInterest', () => {
  it('accrues daily interest for active drawdowns', async () => {
    setupMockClient();
    const drawdown = makeDrawdown({
      principal: '990000000',
      accrued_interest: '0',
      last_accrued_date: '2026-03-20',
    });
    const facility = makeFacility({ annual_rate: '0.18' });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);
    mockedRepo.getFacilityById.mockResolvedValue(facility);
    mockedRepo.accrueDailyInterestWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    // Accrue for 2026-03-21
    await service.accrueInterest('2026-03-21');

    // daily_interest = 990,000,000 × (0.18 / 365) = 488,219
    expect(mockedRepo.accrueDailyInterestWithClient).toHaveBeenCalledWith(
      expect.anything(),
      drawdown.id,
      '488219',
      '2026-03-21',
    );
  });

  it('recovers missed accruals from last_accrued_date', async () => {
    setupMockClient();
    const drawdown = makeDrawdown({
      principal: '990000000',
      accrued_interest: '0',
      last_accrued_date: '2026-03-18', // 3 days behind
    });
    const facility = makeFacility({ annual_rate: '0.18' });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);
    mockedRepo.getFacilityById.mockResolvedValue(facility);
    mockedRepo.accrueDailyInterestWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.accrueInterest('2026-03-21');

    // Should accrue for 3 days: 19th, 20th, 21st
    expect(mockedRepo.accrueDailyInterestWithClient).toHaveBeenCalledTimes(3);
  });

  it('skips drawdowns already accrued for today', async () => {
    const drawdown = makeDrawdown({
      last_accrued_date: '2026-03-21',
    });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);

    await service.accrueInterest('2026-03-21');

    expect(mockedRepo.accrueDailyInterestWithClient).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// checkUtilisationAlerts
// ===========================================================================
describe('checkUtilisationAlerts', () => {
  it('80% triggers finance_manager notification only', async () => {
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '800000000',
    });

    mockedRepo.getActiveFacilities.mockResolvedValue([facility]);

    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationQueue(mockQueue as never);

    await service.checkUtilisationAlerts();

    expect(mockQueue.add).toHaveBeenCalledWith(
      'facility-utilisation-alert',
      expect.objectContaining({
        alertLevel: 'warning',
        notifyRoles: ['finance_manager'],
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    service.setNotificationQueue(null as never);
  });

  it('90% triggers MD notification AND suspends facility', async () => {
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '900000000',
    });

    mockedRepo.getActiveFacilities.mockResolvedValue([facility]);
    mockedRepo.updateFacilityStatus.mockResolvedValue(undefined);

    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationQueue(mockQueue as never);

    await service.checkUtilisationAlerts();

    expect(mockQueue.add).toHaveBeenCalledWith(
      'facility-utilisation-alert',
      expect.objectContaining({
        alertLevel: 'critical',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        notifyRoles: expect.arrayContaining(['management']),
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    expect(mockedRepo.updateFacilityStatus).toHaveBeenCalledWith(
      facility.id,
      FacilityStatus.SUSPENDED,
    );

    service.setNotificationQueue(null as never);
  });
});

// ===========================================================================
// checkMaturityAlerts
// ===========================================================================
describe('checkMaturityAlerts', () => {
  it('notifies finance_manager for facilities maturing within 5 days', async () => {
    const facility = makeFacility({
      maturity_date: '2026-03-25',
    });

    mockedRepo.getFacilitiesNearMaturity.mockResolvedValue([facility]);

    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationQueue(mockQueue as never);

    await service.checkMaturityAlerts();

    expect(mockedRepo.getFacilitiesNearMaturity).toHaveBeenCalledWith(5);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'facility-maturity-alert',
      expect.objectContaining({
        facilityId: FACILITY_ID,
        notifyRoles: ['finance_manager'],
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    service.setNotificationQueue(null as never);
  });
});

// ===========================================================================
// getDashboard
// ===========================================================================
describe('getDashboard', () => {
  it('returns correct dashboard with utilisation percentages', async () => {
    const facilities = [
      makeFacility({
        id: FACILITY_ID,
        total_limit: '2000000000',
        drawn_amount: '990000000',
        available_amount: '1010000000',
      }),
      makeFacility({
        id: FACILITY_ID_2,
        bank_name: 'ABSA Bank',
        total_limit: '1000000000',
        drawn_amount: '500000000',
        available_amount: '500000000',
      }),
    ];

    mockedRepo.getActiveFacilities.mockResolvedValue(facilities);
    mockedRepo.getActiveDrawdownCount.mockResolvedValueOnce(3);
    mockedRepo.getActiveDrawdownCount.mockResolvedValueOnce(2);

    const dashboard = await service.getDashboard();

    expect(dashboard.totalFacilities).toBe(2);
    expect(dashboard.totalLimit).toBe('3000000000');
    expect(dashboard.totalDrawn).toBe('1490000000');
    expect(dashboard.totalAvailable).toBe('1510000000');
    // 1490000000/3000000000 ≈ 49.67%
    expect(dashboard.overallUtilisation).toBeCloseTo(49.67, 1);
    expect(dashboard.facilities).toHaveLength(2);
    expect(dashboard.facilities[0].utilisationPercent).toBeCloseTo(49.5, 1);
  });
});

// ===========================================================================
// getDashboard — zero total limit
// ===========================================================================
describe('getDashboard — zero total limit', () => {
  it('returns 0 for overallUtilisation when no facilities', async () => {
    mockedRepo.getActiveFacilities.mockResolvedValue([]);

    const dashboard = await service.getDashboard();

    expect(dashboard.totalFacilities).toBe(0);
    expect(dashboard.overallUtilisation).toBe(0);
    expect(dashboard.totalLimit).toBe('0');
  });
});

// ===========================================================================
// calculateDailyInterest — rate without decimal part
// ===========================================================================
describe('calculateDailyInterest — integer rate string', () => {
  it('handles rate with no decimal part', () => {
    // parseRateToScaled uses parts[1] ?? '' branch for rates like "1"
    const result = service.calculateDailyInterest('365000000000', '1');
    // 365B × (1 / 365) = 1,000,000,000
    expect(result).toBe('1000000000');
  });

  it('handles rate string with no integer part (decimal-only like ".18") — covers parts[0] ?? "0" fallback', () => {
    // '.18'.split('.') = ['', '18'] — parts[0] is '' which is falsy but not null/undefined.
    // V8 coverage tracks the ?? operator branches; this test exercises the path
    // where the integer portion of the rate is an empty string.
    const result = service.calculateDailyInterest('365000000000', '.18');
    // Effectively 0 integer part + 0.18 fraction → same as '0.18'
    expect(result).toBe(service.calculateDailyInterest('365000000000', '0.18'));
  });
});

// ===========================================================================
// createDrawdown — warning utilisation with null notification queue
// ===========================================================================
describe('createDrawdown — warning utilisation with null notification queue', () => {
  it('logs warning and succeeds when utilisation hits 80% but queue is null (line 343 branch 1)', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { warn: jest.Mock };
    };

    setupMockClient();
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '750000000',
      available_amount: '250000000',
    });

    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.createDrawdownWithClient.mockResolvedValue(undefined);
    mockedRepo.updateDrawnAmountWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
    // Ensure notification queue is null
    service.setNotificationQueue(null as never);

    // Drawing 60M → drawn becomes 810M/1000M = 81% (>= 80% warning threshold)
    const result = await service.createDrawdown(
      FACILITY_ID,
      INVOICE_ID,
      '60000000',
      '0',
      '2026-06-01',
      USER_ID,
      IP,
      UA,
    );

    expect(result.facilityId).toBe(FACILITY_ID);
    expect(logger.warn).toHaveBeenCalledWith(
      'Notification queue not configured',
      expect.objectContaining({ component: 'facilities' }),
    );
  });
});

// ===========================================================================
// accrueInterest — non-Error thrown
// ===========================================================================
describe('accrueInterest — non-Error thrown in accrueForDrawdown', () => {
  it('handles non-Error exceptions with "Unknown" message', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { error: jest.Mock };
    };
    const client = setupMockClient();
    const drawdown = makeDrawdown({
      principal: '990000000',
      last_accrued_date: '2026-03-20',
    });
    const facility = makeFacility({ annual_rate: '0.18' });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);
    mockedRepo.getFacilityById.mockResolvedValue(facility);
    // Throw a non-Error (string)
    mockedRepo.accrueDailyInterestWithClient.mockRejectedValue('string error');

    await service.accrueInterest('2026-03-21');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(logger.error).toHaveBeenCalledWith(
      'Interest accrual failed',
      expect.objectContaining({
        errorMessage: 'Unknown',
      }),
    );
  });
});

// ===========================================================================
// Acceptance test
// ===========================================================================
describe('Acceptance test — exact numbers', () => {
  it('facility_limit=2B, drawn=990M, rate=18%', () => {
    // utilisation = 990,000,000 / 2,000,000,000 = 49.5%
    const utilisation = service.calculateUtilisation('990000000', '2000000000');
    expect(utilisation).toBeCloseTo(49.5, 1);

    // daily_interest = 990,000,000 × (0.18 / 365) = 488,219 UGX
    const dailyInterest = service.calculateDailyInterest('990000000', '0.18');
    expect(dailyInterest).toBe('488219');
  });
});

// ===========================================================================
// getActiveFacilities
// ===========================================================================
describe('getActiveFacilities', () => {
  it('delegates to repository', async () => {
    const facilities = [makeFacility()];
    mockedRepo.getActiveFacilities.mockResolvedValue(facilities);

    const result = await service.getActiveFacilities();

    expect(result).toEqual(facilities);
    expect(mockedRepo.getActiveFacilities).toHaveBeenCalled();
  });
});

// ===========================================================================
// processRepayment — facility not found
// ===========================================================================
describe('processRepayment — facility not found', () => {
  it('throws NotFoundError when facility does not exist', async () => {
    const client = setupMockClient();
    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(null);

    await expect(
      service.processRepayment('nonexistent-fac', 'dd-uuid-1', USER_ID, IP, UA),
    ).rejects.toThrow('Facility');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ===========================================================================
// processRepayment — drawdown not found
// ===========================================================================
describe('processRepayment — drawdown not found', () => {
  it('throws NotFoundError when drawdown does not exist', async () => {
    const client = setupMockClient();
    const facility = makeFacility();
    mockedRepo.getFacilityByIdWithClient.mockResolvedValue(facility);
    mockedRepo.getDrawdownByIdWithClient.mockResolvedValue(null);

    await expect(
      service.processRepayment(FACILITY_ID, 'nonexistent-dd', USER_ID, IP, UA),
    ).rejects.toThrow('Drawdown');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ===========================================================================
// calculateUtilisation — zero limit
// ===========================================================================
describe('calculateUtilisation — zero limit', () => {
  it('returns 0 when total_limit is zero', () => {
    const result = service.calculateUtilisation('0', '0');
    expect(result).toBe(0);
  });
});

// ===========================================================================
// queueUtilisationAlert — no queue configured
// ===========================================================================
describe('checkUtilisationAlerts — queue not configured', () => {
  it('logs a warning when notification queue is not configured', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { warn: jest.Mock };
    };
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '800000000',
    });

    mockedRepo.getActiveFacilities.mockResolvedValue([facility]);
    // Ensure queue is null
    service.setNotificationQueue(null as never);

    await service.checkUtilisationAlerts();

    expect(logger.warn).toHaveBeenCalledWith(
      'Notification queue not configured',
      expect.objectContaining({ component: 'facilities' }),
    );
  });

  it('logs a warning for critical utilisation when queue is not configured', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { warn: jest.Mock };
    };
    const facility = makeFacility({
      total_limit: '1000000000',
      drawn_amount: '900000000',
    });

    mockedRepo.getActiveFacilities.mockResolvedValue([facility]);
    mockedRepo.updateFacilityStatus.mockResolvedValue(undefined);
    // Ensure queue is null
    service.setNotificationQueue(null as never);

    await service.checkUtilisationAlerts();

    expect(logger.warn).toHaveBeenCalledWith(
      'Notification queue not configured',
      expect.objectContaining({ component: 'facilities' }),
    );
  });
});

// ===========================================================================
// queueMaturityAlert — no queue configured
// ===========================================================================
describe('checkMaturityAlerts — queue not configured', () => {
  it('logs a warning when notification queue is not configured', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { warn: jest.Mock };
    };
    const facility = makeFacility({ maturity_date: '2026-03-25' });

    mockedRepo.getFacilitiesNearMaturity.mockResolvedValue([facility]);
    service.setNotificationQueue(null as never);

    await service.checkMaturityAlerts();

    expect(logger.warn).toHaveBeenCalledWith(
      'Notification queue not configured',
      expect.objectContaining({ component: 'facilities', facilityId: FACILITY_ID }),
    );
  });
});

// ===========================================================================
// accrueForDrawdown — error handling
// ===========================================================================
describe('accrueInterest — error handling in accrueForDrawdown', () => {
  it('logs error and continues when accrueDailyInterest fails', async () => {
    const { logger } = jest.requireMock('../../../src/shared/logger') as {
      logger: { error: jest.Mock };
    };
    const client = setupMockClient();
    const drawdown = makeDrawdown({
      principal: '990000000',
      last_accrued_date: '2026-03-20',
    });
    const facility = makeFacility({ annual_rate: '0.18' });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);
    mockedRepo.getFacilityById.mockResolvedValue(facility);
    mockedRepo.accrueDailyInterestWithClient.mockRejectedValue(new Error('DB write failed'));

    await service.accrueInterest('2026-03-21');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(logger.error).toHaveBeenCalledWith(
      'Interest accrual failed',
      expect.objectContaining({
        component: 'facilities',
        drawdownId: drawdown.id,
        errorMessage: 'DB write failed',
      }),
    );
  });

  it('skips drawdown when facility not found during accrual', async () => {
    setupMockClient();
    const drawdown = makeDrawdown({
      facility_id: 'missing-fac',
      last_accrued_date: '2026-03-20',
    });

    mockedRepo.getActiveDrawdowns.mockResolvedValue([drawdown]);
    mockedRepo.getFacilityById.mockResolvedValue(null);

    await service.accrueInterest('2026-03-21');

    expect(mockedRepo.accrueDailyInterestWithClient).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getFacilityDetail — GET /facilities/:id
// ===========================================================================
describe('getFacilityDetail', () => {
  it('throws NotFoundError when facility does not exist', async () => {
    mockedRepo.getFacilityById.mockResolvedValue(null);

    await expect(service.getFacilityDetail(FACILITY_ID)).rejects.toThrow('Facility');
    expect(mockedRepo.getFacilityAggregates).not.toHaveBeenCalled();
  });

  it('returns the full detail shape with drawdowns + repayments', async () => {
    mockedRepo.getFacilityById.mockResolvedValue(makeFacility());
    mockedRepo.getFacilityAggregates.mockResolvedValue({
      interest_accrued: '1500000',
      defaulted_exposure: '0',
    });
    mockedRepo.getDrawdownsForFacility.mockResolvedValue([
      {
        id: 'dd-uuid-1',
        principal: '500000000',
        invoice_number: 'INV-001',
        created_at: '2026-03-20T00:00:00Z',
      },
    ]);
    mockedRepo.getRepaymentsForFacility.mockResolvedValue([
      {
        id: 'rp-uuid-2',
        total_amount: '250000000',
        repaid_at: '2026-04-10T00:00:00Z',
      },
    ]);

    const detail = await service.getFacilityDetail(FACILITY_ID);

    expect(detail.id).toBe(FACILITY_ID);
    expect(detail.bankName).toBe('Stanbic Bank');
    expect(detail.totalLimit).toBe('2000000000');
    expect(detail.drawnAmount).toBe('990000000');
    expect(detail.availableAmount).toBe('1010000000');
    expect(detail.interestRate).toBe('0.18');
    expect(detail.interestAccrued).toBe('1500000');
    expect(detail.defaultedExposure).toBe('0');
    expect(detail.utilisationPct).toBeCloseTo(49.5, 1);
    expect(detail.drawdowns).toHaveLength(1);
    expect(detail.drawdowns[0]).toMatchObject({
      id: 'dd-uuid-1',
      amount: '500000000',
      invoiceRef: 'INV-001',
      drawnAt: '2026-03-20T00:00:00Z',
    });
    expect(detail.repayments).toHaveLength(1);
    expect(detail.repayments[0]).toMatchObject({
      id: 'rp-uuid-2',
      amount: '250000000',
      paidAt: '2026-04-10T00:00:00Z',
      reference: 'RP-RP-UUID-',
    });
  });

  it('falls back to short-id ref when invoice_number is null', async () => {
    mockedRepo.getFacilityById.mockResolvedValue(makeFacility());
    mockedRepo.getFacilityAggregates.mockResolvedValue({
      interest_accrued: '0',
      defaulted_exposure: '0',
    });
    mockedRepo.getDrawdownsForFacility.mockResolvedValue([
      {
        id: 'abcdef12-3456-7890-abcd-ef1234567890',
        principal: '100000000',
        invoice_number: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockedRepo.getRepaymentsForFacility.mockResolvedValue([]);

    const detail = await service.getFacilityDetail(FACILITY_ID);

    expect(detail.drawdowns[0].invoiceRef).toBe('ABCDEF12');
    expect(detail.repayments).toEqual([]);
  });

  it('returns empty arrays when facility has no activity', async () => {
    mockedRepo.getFacilityById.mockResolvedValue(makeFacility({ id: FACILITY_ID_2 }));
    mockedRepo.getFacilityAggregates.mockResolvedValue({
      interest_accrued: '0',
      defaulted_exposure: '0',
    });
    mockedRepo.getDrawdownsForFacility.mockResolvedValue([]);
    mockedRepo.getRepaymentsForFacility.mockResolvedValue([]);

    const detail = await service.getFacilityDetail(FACILITY_ID_2);

    expect(detail.drawdowns).toEqual([]);
    expect(detail.repayments).toEqual([]);
    expect(detail.interestAccrued).toBe('0');
    expect(detail.defaultedExposure).toBe('0');
  });
});
