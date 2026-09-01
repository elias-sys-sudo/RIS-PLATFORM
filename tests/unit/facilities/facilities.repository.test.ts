process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as repo from '../../../src/services/facilities/facilities.repository';
import { query } from '../../../src/shared/database/pool';
import { FacilityStatus, DrawdownStatus } from '../../../src/services/facilities/facilities.types';
import type {
  BankFacility,
  FacilityDrawdown,
} from '../../../src/services/facilities/facilities.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
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

const mockedQuery = query as jest.MockedFunction<typeof query>;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FACILITY_ID = 'fac-uuid-1';
const DRAWDOWN_ID = 'dd-uuid-1';
const INVOICE_ID = 'inv-uuid-1';

function makeFacilityRow(): BankFacility {
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
  };
}

function makeDrawdownRow(): FacilityDrawdown {
  return {
    id: DRAWDOWN_ID,
    facility_id: FACILITY_ID,
    invoice_id: INVOICE_ID,
    principal: '100000000',
    accrued_interest: '0',
    bank_fees: '500000',
    status: DrawdownStatus.ACTIVE,
    last_accrued_date: '2026-03-20',
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T00:00:00Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// getActiveFacilities
// ===========================================================================
describe('getActiveFacilities', () => {
  it('returns rows with active status', async () => {
    const row = makeFacilityRow();
    mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1, command: '', oid: 0, fields: [] });

    const result = await repo.getActiveFacilities();

    expect(result).toEqual([row]);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('status = $1'), [
      FacilityStatus.ACTIVE,
    ]);
  });
});

// ===========================================================================
// getFacilityById
// ===========================================================================
describe('getFacilityById', () => {
  it('returns facility by ID', async () => {
    const row = makeFacilityRow();
    mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1, command: '', oid: 0, fields: [] });

    const result = await repo.getFacilityById(FACILITY_ID);

    expect(result).toEqual(row);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [
      FACILITY_ID,
    ]);
  });

  it('returns null when not found', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    const result = await repo.getFacilityById('nonexistent');

    expect(result).toBeNull();
  });
});

// ===========================================================================
// getFacilityByIdWithClient (SELECT FOR UPDATE)
// ===========================================================================
describe('getFacilityByIdWithClient', () => {
  it('locks row with FOR UPDATE', async () => {
    const row = makeFacilityRow();
    mockClient.query.mockResolvedValue({ rows: [row], rowCount: 1 });

    const result = await repo.getFacilityByIdWithClient(mockClient as never, FACILITY_ID);

    expect(result).toEqual(row);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [
      FACILITY_ID,
    ]);
  });
});

// ===========================================================================
// createDrawdownWithClient
// ===========================================================================
describe('createDrawdownWithClient', () => {
  it('inserts a drawdown record', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createDrawdownWithClient(mockClient as never, {
      id: DRAWDOWN_ID,
      facilityId: FACILITY_ID,
      invoiceId: INVOICE_ID,
      principal: '100000000',
      bankFees: '500000',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO facility_drawdowns'),
      expect.arrayContaining([DRAWDOWN_ID, FACILITY_ID, INVOICE_ID]),
    );
  });
});

// ===========================================================================
// updateDrawnAmountWithClient
// ===========================================================================
describe('updateDrawnAmountWithClient', () => {
  it('updates drawn_amount and recalculates available_amount', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateDrawnAmountWithClient(mockClient as never, FACILITY_ID, '1100000000');

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('drawn_amount'),
      expect.arrayContaining([FACILITY_ID]),
    );
  });
});

// ===========================================================================
// accrueDailyInterestWithClient
// ===========================================================================
describe('accrueDailyInterestWithClient', () => {
  it('adds interest and updates last_accrued_date', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.accrueDailyInterestWithClient(
      mockClient as never,
      DRAWDOWN_ID,
      '488219',
      '2026-03-21',
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('accrued_interest'),
      expect.arrayContaining([DRAWDOWN_ID, '488219', '2026-03-21']),
    );
  });
});

// ===========================================================================
// createRepaymentWithClient
// ===========================================================================
describe('createRepaymentWithClient', () => {
  it('inserts a repayment record', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createRepaymentWithClient(mockClient as never, {
      id: 'rep-uuid-1',
      drawdownId: DRAWDOWN_ID,
      facilityId: FACILITY_ID,
      principal: '100000000',
      interest: '500000',
      bankFees: '200000',
      totalAmount: '100700000',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO facility_repayments'),
      expect.arrayContaining(['rep-uuid-1', DRAWDOWN_ID]),
    );
  });
});

// ===========================================================================
// getFacilitiesNearMaturity
// ===========================================================================
describe('getFacilitiesNearMaturity', () => {
  it('queries with default 5 days', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    await repo.getFacilitiesNearMaturity(5);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('maturity_date'),
      expect.arrayContaining([5]),
    );
  });
});

// ===========================================================================
// getFacilitiesByUtilisation
// ===========================================================================
describe('getFacilitiesByUtilisation', () => {
  it('filters facilities above threshold', async () => {
    const row = makeFacilityRow();
    mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1, command: '', oid: 0, fields: [] });

    const result = await repo.getFacilitiesByUtilisation(80);

    expect(result).toEqual([row]);
  });
});

// ===========================================================================
// getActiveDrawdowns
// ===========================================================================
describe('getActiveDrawdowns', () => {
  it('returns active drawdown records', async () => {
    const row = makeDrawdownRow();
    mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1, command: '', oid: 0, fields: [] });

    const result = await repo.getActiveDrawdowns();

    expect(result).toEqual([row]);
  });
});

// ===========================================================================
// getDrawdownByInvoiceId
// ===========================================================================
describe('getDrawdownByInvoiceId', () => {
  it('returns the active drawdown for a given invoice ID', async () => {
    const row = makeDrawdownRow();
    mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1, command: '', oid: 0, fields: [] });

    const result = await repo.getDrawdownByInvoiceId(INVOICE_ID);

    expect(result).toEqual(row);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE invoice_id = $1'), [
      INVOICE_ID,
    ]);
  });

  it('returns null when no active drawdown exists for the invoice', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    const result = await repo.getDrawdownByInvoiceId('inv-no-drawdown');

    expect(result).toBeNull();
  });
});

// ===========================================================================
// getDrawdownByIdWithClient
// ===========================================================================
describe('getDrawdownByIdWithClient', () => {
  it('returns drawdown with FOR UPDATE lock', async () => {
    const row = makeDrawdownRow();
    mockClient.query.mockResolvedValue({ rows: [row], rowCount: 1 });

    const result = await repo.getDrawdownByIdWithClient(mockClient as never, DRAWDOWN_ID);

    expect(result).toEqual(row);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [
      DRAWDOWN_ID,
    ]);
  });

  it('returns null when drawdown not found', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await repo.getDrawdownByIdWithClient(mockClient as never, 'nonexistent');

    expect(result).toBeNull();
  });
});

// ===========================================================================
// getActiveDrawdownCount
// ===========================================================================
describe('getActiveDrawdownCount', () => {
  it('returns count of active drawdowns for a facility', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ count: '3' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const count = await repo.getActiveDrawdownCount(FACILITY_ID);

    expect(count).toBe(3);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('COUNT(*)'), [FACILITY_ID]);
  });

  it('returns 0 when no active drawdowns', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ count: '0' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const count = await repo.getActiveDrawdownCount(FACILITY_ID);

    expect(count).toBe(0);
  });

  it('returns 0 when rows are empty', async () => {
    mockedQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const count = await repo.getActiveDrawdownCount(FACILITY_ID);

    expect(count).toBe(0);
  });
});

// ===========================================================================
// updateFacilityStatusWithClient
// ===========================================================================
describe('updateFacilityStatusWithClient', () => {
  it('updates facility status using transaction client', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateFacilityStatusWithClient(
      mockClient as never,
      FACILITY_ID,
      FacilityStatus.SUSPENDED,
    );

    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      FACILITY_ID,
      FacilityStatus.SUSPENDED,
    ]);
  });
});

// ===========================================================================
// updateFacilityStatus (non-transactional)
// ===========================================================================
describe('updateFacilityStatus', () => {
  it('updates facility status without a transaction client', async () => {
    mockedQuery.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.updateFacilityStatus(FACILITY_ID, FacilityStatus.MATURED);

    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      FACILITY_ID,
      FacilityStatus.MATURED,
    ]);
  });
});

// ===========================================================================
// updateDrawdownStatusWithClient
// ===========================================================================
describe('updateDrawdownStatusWithClient', () => {
  it('updates drawdown status using transaction client', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateDrawdownStatusWithClient(
      mockClient as never,
      DRAWDOWN_ID,
      DrawdownStatus.REPAID,
    );

    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      DRAWDOWN_ID,
      DrawdownStatus.REPAID,
    ]);
  });
});

// ===========================================================================
// getFacilityByIdWithClient — null case
// ===========================================================================
describe('getFacilityByIdWithClient null case', () => {
  it('returns null when facility not found', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await repo.getFacilityByIdWithClient(mockClient as never, 'nonexistent');

    expect(result).toBeNull();
  });
});

// ===========================================================================
// Audit entry
// ===========================================================================
describe('createAuditEntry', () => {
  it('inserts audit log with client', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createAuditEntry(
      mockClient as never,
      'user-1',
      'DRAWDOWN_CREATED',
      'facility_drawdowns',
      DRAWDOWN_ID,
      null,
      { facilityId: FACILITY_ID },
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['user-1', 'DRAWDOWN_CREATED']),
    );
  });

  it('handles non-null oldValues', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createAuditEntry(
      mockClient as never,
      null,
      'REPAYMENT_RECORDED',
      'facility_repayments',
      'rep-uuid-1',
      { status: 'active' },
      { status: 'repaid' },
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining([null, 'REPAYMENT_RECORDED']),
    );
  });
});

// ===========================================================================
// getFacilityAggregates — sums backing the facility-detail endpoint
// ===========================================================================
describe('getFacilityAggregates', () => {
  it('returns interest_accrued + defaulted_exposure aggregated by facility', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ interest_accrued: '750000', defaulted_exposure: '0' }],
      rowCount: 1,
    } as never);

    const result = await repo.getFacilityAggregates(FACILITY_ID);

    expect(result).toEqual({ interest_accrued: '750000', defaulted_exposure: '0' });
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM facility_drawdowns');
    expect(sql).toContain("i.status = 'defaulted'");
    expect(params).toEqual([FACILITY_ID]);
    // Parameterised — must NOT inject the id into the SQL string
    expect(sql).not.toContain(FACILITY_ID);
  });

  it('returns zeros when no drawdown rows exist', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ interest_accrued: '0', defaulted_exposure: '0' }],
      rowCount: 1,
    } as never);

    const result = await repo.getFacilityAggregates(FACILITY_ID);

    expect(result.interest_accrued).toBe('0');
    expect(result.defaulted_exposure).toBe('0');
  });
});

// ===========================================================================
// getDrawdownsForFacility — joins to invoice_number for display
// ===========================================================================
describe('getDrawdownsForFacility', () => {
  it('returns drawdowns with invoice_number, ordered by created_at DESC', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        {
          id: 'dd-uuid-1',
          principal: '100000000',
          invoice_number: 'INV-001',
          created_at: '2026-03-20T00:00:00Z',
        },
      ],
      rowCount: 1,
    } as never);

    const rows = await repo.getDrawdownsForFacility(FACILITY_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0].invoice_number).toBe('INV-001');
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEFT JOIN invoices');
    expect(sql).toContain('ORDER BY fd.created_at DESC');
    expect(params).toEqual([FACILITY_ID]);
  });

  it('returns [] when facility has no drawdowns', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const rows = await repo.getDrawdownsForFacility(FACILITY_ID);
    expect(rows).toEqual([]);
  });
});

// ===========================================================================
// getRepaymentsForFacility
// ===========================================================================
describe('getRepaymentsForFacility', () => {
  it('returns repayments ordered by repaid_at DESC', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ id: 'rp-uuid-1', total_amount: '250000000', repaid_at: '2026-04-10T00:00:00Z' }],
      rowCount: 1,
    } as never);

    const rows = await repo.getRepaymentsForFacility(FACILITY_ID);

    expect(rows).toHaveLength(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM facility_repayments');
    expect(sql).toContain('ORDER BY repaid_at DESC');
    expect(params).toEqual([FACILITY_ID]);
  });
});
