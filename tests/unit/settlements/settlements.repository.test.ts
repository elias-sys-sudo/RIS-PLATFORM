process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { PoolClient } from 'pg';
import * as repo from '../../../src/services/settlements/settlements.repository';
import { pool } from '../../../src/shared/database/pool';

// ---------------------------------------------------------------------------
// Mocks — pool.query for standalone reads, a fake PoolClient for WithClient
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const mockedPool = pool as jest.Mocked<typeof pool>;

interface FakeRow {
  id: string;
  status?: string;
  invoice_id?: string;
  net_profit?: string;
}

function makeClient(): { client: PoolClient; query: jest.Mock } {
  const query = jest.fn();
  const client = { query } as unknown as PoolClient;
  return { client, query };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =========================================================================
// createSettlementWithClient
// =========================================================================
describe('createSettlementWithClient', () => {
  const IDEMPOTENCY_KEY = '00000000-0000-0000-0000-00000000abcd';

  it('inserts settlement with all monetary fields and returns the row', async () => {
    const { client, query } = makeClient();
    const row: FakeRow = { id: 'stl-1', invoice_id: 'inv-1' };
    query.mockResolvedValue({ rows: [row], rowCount: 1 });

    const result = await repo.createSettlementWithClient(
      client,
      'stl-1',
      'inv-1',
      'col-1',
      'drw-1',
      '50000000',
      '42500000',
      '1250000',
      '500000',
      IDEMPOTENCY_KEY,
    );

    expect(result).toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO settlements');
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sql).toContain('RETURNING *');
    // Parameterised — values should NOT appear in the SQL string
    expect(sql).not.toContain('stl-1');
    expect(sql).not.toContain('50000000');
    expect(params).toEqual([
      'stl-1',
      'inv-1',
      'col-1',
      'drw-1',
      '50000000',
      '42500000',
      '1250000',
      '500000',
      IDEMPOTENCY_KEY,
    ]);
  });

  it('accepts null drawdownId for settlements with no facility', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [{ id: 'stl-2' }], rowCount: 1 });

    await repo.createSettlementWithClient(
      client,
      'stl-2',
      'inv-2',
      'col-2',
      null,
      '10000000',
      '0',
      '0',
      '0',
      IDEMPOTENCY_KEY,
    );

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBeNull();
  });

  it('returns the existing row when ON CONFLICT yields no inserted row', async () => {
    const { client, query } = makeClient();
    const existing: FakeRow = { id: 'stl-existing', invoice_id: 'inv-1' };
    // First call (INSERT ... ON CONFLICT) returns no rows; fallback SELECT returns the existing row.
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 });

    const result = await repo.createSettlementWithClient(
      client,
      'stl-new',
      'inv-1',
      'col-1',
      null,
      '10000000',
      '0',
      '0',
      '0',
      IDEMPOTENCY_KEY,
    );

    expect(result).toEqual(existing);
    expect(query).toHaveBeenCalledTimes(2);
    const [fallbackSql, fallbackParams] = query.mock.calls[1] as [string, unknown[]];
    expect(fallbackSql).toContain('SELECT * FROM settlements');
    expect(fallbackSql).toContain('idempotency_key');
    expect(fallbackParams).toEqual([IDEMPOTENCY_KEY]);
  });
});

// =========================================================================
// updateSettlementStatusWithClient
// =========================================================================
describe('updateSettlementStatusWithClient', () => {
  it('updates status and returns row', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [{ id: 'stl-1', status: 'closed' }], rowCount: 1 });

    const result = await repo.updateSettlementStatusWithClient(client, 'stl-1', 'closed', 'user-1');

    expect(result).toEqual({ id: 'stl-1', status: 'closed' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE settlements');
    // Sets settled_at = NOW() only when status is 'closed' — guarded in SQL
    expect(sql).toContain("$1 = 'closed'");
    expect(params).toEqual(['closed', 'user-1', 'stl-1']);
  });

  it('returns null when no row matched', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await repo.updateSettlementStatusWithClient(
      client,
      'missing',
      'closed',
      'user-1',
    );

    expect(result).toBeNull();
  });

  it('passes null settledBy through (COALESCE preserves existing)', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [{ id: 'stl-1' }], rowCount: 1 });

    await repo.updateSettlementStatusWithClient(client, 'stl-1', 'facility_repaid', null);

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBeNull();
  });
});

// =========================================================================
// updateNetProfitWithClient
// =========================================================================
describe('updateNetProfitWithClient', () => {
  it('updates net_profit with parameterised value', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateNetProfitWithClient(client, 'stl-1', '6750000');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SET net_profit = $1');
    expect(sql).not.toContain('6750000');
    expect(params).toEqual(['6750000', 'stl-1']);
  });

  it('passes negative net_profit (loss) through unchanged', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateNetProfitWithClient(client, 'stl-1', '-1500000');

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('-1500000');
  });
});

// =========================================================================
// updateFacilityRepaymentWithClient
// =========================================================================
describe('updateFacilityRepaymentWithClient', () => {
  it('updates facility repayment and accrued interest', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.updateFacilityRepaymentWithClient(client, 'stl-1', '42500000', '1250000');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('facility_repayment_amount = $1');
    expect(sql).toContain('accrued_interest = $2');
    expect(params).toEqual(['42500000', '1250000', 'stl-1']);
  });
});

// =========================================================================
// createProfitBookingWithClient
// =========================================================================
describe('createProfitBookingWithClient', () => {
  it('inserts immutable profit booking row', async () => {
    const { client, query } = makeClient();
    const row = { id: 'pb-1', settlement_id: 'stl-1', net_profit: '6750000' };
    query.mockResolvedValue({ rows: [row], rowCount: 1 });

    const result = await repo.createProfitBookingWithClient(
      client,
      'pb-1',
      'stl-1',
      '7500000',
      '1250000',
      '500000',
      '6750000',
      'user-fm-1',
    );

    expect(result).toEqual(row);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO profit_bookings');
    expect(sql).toContain('RETURNING *');
    expect(params).toEqual([
      'pb-1',
      'stl-1',
      '7500000',
      '1250000',
      '500000',
      '6750000',
      'user-fm-1',
    ]);
  });
});

// =========================================================================
// getSettlementById
// =========================================================================
describe('getSettlementById', () => {
  it('returns settlement when found', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'stl-1' }],
      rowCount: 1,
    });

    const result = await repo.getSettlementById('stl-1');
    expect(result).toEqual({ id: 'stl-1' });
    const [sql, params] = (mockedPool.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT * FROM settlements WHERE id = $1');
    expect(params).toEqual(['stl-1']);
  });

  it('returns null when not found', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await repo.getSettlementById('missing');
    expect(result).toBeNull();
  });
});

// =========================================================================
// getSettlementByInvoiceId
// =========================================================================
describe('getSettlementByInvoiceId', () => {
  it('queries by invoice_id and returns null when none exists', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await repo.getSettlementByInvoiceId('inv-1');

    expect(result).toBeNull();
    const [sql, params] = (mockedPool.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE invoice_id = $1');
    expect(params).toEqual(['inv-1']);
  });

  it('returns the settlement when one exists', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'stl-1', invoice_id: 'inv-1' }],
      rowCount: 1,
    });

    const result = await repo.getSettlementByInvoiceId('inv-1');
    expect(result).toEqual({ id: 'stl-1', invoice_id: 'inv-1' });
  });
});

// =========================================================================
// listSettlements
// =========================================================================
describe('listSettlements', () => {
  it('returns paginated rows and total count with computed offset', async () => {
    (mockedPool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: '42' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: 'stl-1' }, { id: 'stl-2' }],
        rowCount: 2,
      });

    const result = await repo.listSettlements(2, 20);

    expect(result.total).toBe(42);
    expect(result.data).toHaveLength(2);

    const calls = (mockedPool.query as jest.Mock).mock.calls as Array<[string, unknown[]]>;
    expect(calls[0][0]).toContain('COUNT(*)');
    const [sql, params] = calls[1];
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    // page 2, limit 20 → offset 20
    expect(params).toEqual([20, 20]);
  });

  it('computes offset 0 for page 1', async () => {
    (mockedPool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await repo.listSettlements(1, 10);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    const [, params] = (mockedPool.query as jest.Mock).mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([10, 0]);
  });
});

// =========================================================================
// getProfitBookingBySettlementId
// =========================================================================
describe('getProfitBookingBySettlementId', () => {
  it('returns the profit booking when one exists', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'pb-1', settlement_id: 'stl-1' }],
      rowCount: 1,
    });

    const result = await repo.getProfitBookingBySettlementId('stl-1');
    expect(result).toEqual({ id: 'pb-1', settlement_id: 'stl-1' });
    const [sql, params] = (mockedPool.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM profit_bookings WHERE settlement_id = $1');
    expect(params).toEqual(['stl-1']);
  });

  it('returns null when none', async () => {
    (mockedPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await repo.getProfitBookingBySettlementId('missing');
    expect(result).toBeNull();
  });
});

// =========================================================================
// createAuditEntryWithClient — rule #4: written inside transaction client
// =========================================================================
describe('createAuditEntryWithClient', () => {
  it('inserts audit_logs row using the same client passed in (rule #4)', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createAuditEntryWithClient(
      client,
      'user-1',
      'SETTLEMENT_INITIATED',
      'settlements',
      'stl-1',
      null,
      { status: 'pending' },
      '127.0.0.1',
      'agent',
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe('SETTLEMENT_INITIATED');
    expect(params[2]).toBe('settlements');
    expect(params[3]).toBe('stl-1');
    expect(params[4]).toBeNull();
    // newValues serialised as JSON
    expect(params[5]).toBe(JSON.stringify({ status: 'pending' }));
    expect(params[6]).toBe('127.0.0.1');
    expect(params[7]).toBe('agent');
  });

  it('serialises both oldValues and newValues to JSON when present', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createAuditEntryWithClient(
      client,
      null,
      'SETTLEMENT_CLOSED',
      'settlements',
      'stl-1',
      { status: 'profit_booked' },
      { status: 'closed' },
      null,
      null,
    );

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBeNull();
    expect(params[4]).toBe(JSON.stringify({ status: 'profit_booked' }));
    expect(params[5]).toBe(JSON.stringify({ status: 'closed' }));
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
  });

  it('passes null for both old and new values when both omitted', async () => {
    const { client, query } = makeClient();
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    await repo.createAuditEntryWithClient(
      client,
      'user-1',
      'ACTION',
      'settlements',
      'stl-1',
      null,
      null,
      '127.0.0.1',
      'agent',
    );

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
  });
});
