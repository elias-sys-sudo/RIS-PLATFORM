process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/settlements/settlements.service';
import * as repo from '../../../src/services/settlements/settlements.repository';
import { pool } from '../../../src/shared/database/pool';
import { SettlementStatus } from '../../../src/services/settlements/settlements.types';
import type { SettlementRecord } from '../../../src/services/settlements/settlements.types';

// ---------------------------------------------------------------------------
// Mocks — same shape as the other settlements unit tests
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/settlements/settlements.repository');
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
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

const INVOICE_ID = 'inv-uuid-1';
const COLLECTION_ID = 'col-uuid-1';
const USER_ID = 'usr-uuid-1';
const IP = '127.0.0.1';
const UA = 'jest';

function makeSettlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: 'stl-existing',
    invoice_id: INVOICE_ID,
    collection_id: COLLECTION_ID,
    drawdown_id: null,
    buyer_payment_amount: '50000000',
    facility_repayment_amount: '0',
    accrued_interest: '0',
    penalty_income: '0',
    net_profit: '0',
    status: SettlementStatus.PENDING,
    settled_by: null,
    settled_at: null,
    idempotency_key: '00000000-0000-0000-0000-00000000abcd',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let mockClient: { query: jest.Mock; release: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
  (mockedPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
});

// =========================================================================
// deriveSettlementIdempotencyKey — deterministic and stable
// =========================================================================
describe('deriveSettlementIdempotencyKey', () => {
  it('returns the same key for the same (invoiceId, collectionId) pair', () => {
    const key1 = service.deriveSettlementIdempotencyKey('inv-a', 'col-a');
    const key2 = service.deriveSettlementIdempotencyKey('inv-a', 'col-a');
    expect(key1).toBe(key2);
  });

  it('returns different keys for different invoice IDs', () => {
    const k1 = service.deriveSettlementIdempotencyKey('inv-a', 'col-a');
    const k2 = service.deriveSettlementIdempotencyKey('inv-b', 'col-a');
    expect(k1).not.toBe(k2);
  });

  it('returns different keys for different collection IDs', () => {
    const k1 = service.deriveSettlementIdempotencyKey('inv-a', 'col-a');
    const k2 = service.deriveSettlementIdempotencyKey('inv-a', 'col-b');
    expect(k1).not.toBe(k2);
  });

  it('returns a valid UUID', () => {
    const key = service.deriveSettlementIdempotencyKey('inv-a', 'col-a');
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// =========================================================================
// initiateSettlement — idempotency replay
// =========================================================================
describe('initiateSettlement idempotency replay', () => {
  it('returns the existing settlement when the idempotency_key is already present', async () => {
    const existing = makeSettlement({ id: 'stl-prior-run' });
    mockedRepo.getSettlementByIdempotencyKey.mockResolvedValue(existing);

    const result = await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '50000000',
      '0',
      USER_ID,
      IP,
      UA,
      existing.idempotency_key,
    );

    expect(result.id).toBe('stl-prior-run');
    // Replay path must NOT open a transaction or insert anything.
    expect(mockedPool.connect).not.toHaveBeenCalled();
    expect(mockedRepo.createSettlementWithClient).not.toHaveBeenCalled();
    expect(mockedRepo.createAuditEntryWithClient).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('proceeds with a fresh INSERT when no prior idempotency_key matches', async () => {
    mockedRepo.getSettlementByIdempotencyKey.mockResolvedValue(null);
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(null);
    mockedRepo.createSettlementWithClient.mockResolvedValue(makeSettlement());

    await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '50000000',
      '0',
      USER_ID,
      IP,
      UA,
      '11111111-1111-1111-1111-111111111111',
    );

    expect(mockedRepo.createSettlementWithClient).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});
