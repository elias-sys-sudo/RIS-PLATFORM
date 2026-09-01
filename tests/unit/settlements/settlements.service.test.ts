process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/settlements/settlements.service';
import * as repo from '../../../src/services/settlements/settlements.repository';
import { pool } from '../../../src/shared/database/pool';
import {
  SettlementStatus,
  SettlementErrorCode,
} from '../../../src/services/settlements/settlements.types';
import type { SettlementRecord } from '../../../src/services/settlements/settlements.types';

// ---------------------------------------------------------------------------
// Mocks
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
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest.fn(),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'inv-uuid-1';
const COLLECTION_ID = 'col-uuid-1';
const SETTLEMENT_ID = 'stl-uuid-1';
const DRAWDOWN_ID = 'drw-uuid-1';
const USER_ID = 'usr-uuid-1';
const IP = '127.0.0.1';
const UA = 'test-agent';

const IDEMPOTENCY_KEY = '00000000-0000-0000-0000-00000000abcd';

function makeSettlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: SETTLEMENT_ID,
    invoice_id: INVOICE_ID,
    collection_id: COLLECTION_ID,
    drawdown_id: DRAWDOWN_ID,
    buyer_payment_amount: '50000000',
    facility_repayment_amount: '42500000',
    accrued_interest: '1250000',
    penalty_income: '500000',
    net_profit: '0',
    status: SettlementStatus.PENDING,
    settled_by: null,
    settled_at: null,
    idempotency_key: IDEMPOTENCY_KEY,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let mockClient: {
  query: jest.Mock;
  release: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
  // Default: pool.query returns no drawdown
  (mockedPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
});

// =========================================================================
// initiateSettlement
// =========================================================================
describe('initiateSettlement', () => {
  it('creates a settlement when no existing settlement for invoice', async () => {
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(null);
    const created = makeSettlement();
    mockedRepo.createSettlementWithClient.mockResolvedValue(created);

    const result = await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '50000000',
      '500000',
      USER_ID,
      IP,
      UA,
      IDEMPOTENCY_KEY,
    );

    expect(result.id).toBe(SETTLEMENT_ID);
    expect(mockedRepo.createSettlementWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.any(String),
      INVOICE_ID,
      COLLECTION_ID,
      null, // no drawdown found
      '50000000',
      '0', // no drawdown principal
      '0', // no drawdown interest
      '500000',
      IDEMPOTENCY_KEY,
    );
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('links drawdown when one exists for the invoice', async () => {
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(null);
    (mockedPool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: DRAWDOWN_ID, principal: '42500000', accrued_interest: '1250000' }],
      rowCount: 1,
    });
    mockedRepo.createSettlementWithClient.mockResolvedValue(makeSettlement());

    await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '50000000',
      '500000',
      USER_ID,
      IP,
      UA,
      IDEMPOTENCY_KEY,
    );

    expect(mockedRepo.createSettlementWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.any(String),
      INVOICE_ID,
      COLLECTION_ID,
      DRAWDOWN_ID,
      '50000000',
      '42500000',
      '1250000',
      '500000',
      IDEMPOTENCY_KEY,
    );
  });

  it('throws ALREADY_EXISTS when settlement for invoice exists', async () => {
    mockedRepo.getSettlementByIdempotencyKey.mockResolvedValue(null);
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(makeSettlement());

    await expect(
      service.initiateSettlement(
        INVOICE_ID,
        COLLECTION_ID,
        '50000000',
        '0',
        USER_ID,
        IP,
        UA,
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ errorCode: SettlementErrorCode.ALREADY_EXISTS });
  });

  it('rolls back on repository error', async () => {
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(null);
    mockedRepo.createSettlementWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.initiateSettlement(
        INVOICE_ID,
        COLLECTION_ID,
        '50000000',
        '0',
        USER_ID,
        IP,
        UA,
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =========================================================================
// repayFacility
// =========================================================================
describe('repayFacility', () => {
  it('transitions pending → facility_repaid', async () => {
    const pending = makeSettlement({ status: SettlementStatus.PENDING });
    mockedRepo.getSettlementById.mockResolvedValue(pending);
    const updated = makeSettlement({ status: SettlementStatus.FACILITY_REPAID });
    mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(updated);

    const result = await service.repayFacility(
      SETTLEMENT_ID,
      '42500000',
      '1250000',
      USER_ID,
      IP,
      UA,
    );

    expect(result.status).toBe(SettlementStatus.FACILITY_REPAID);
    expect(mockedRepo.updateFacilityRepaymentWithClient).toHaveBeenCalledWith(
      mockClient,
      SETTLEMENT_ID,
      '42500000',
      '1250000',
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws WRONG_STATUS when settlement is not pending', async () => {
    const closed = makeSettlement({ status: SettlementStatus.CLOSED });
    mockedRepo.getSettlementById.mockResolvedValue(closed);

    await expect(
      service.repayFacility(SETTLEMENT_ID, '42500000', '1250000', USER_ID, IP, UA),
    ).rejects.toMatchObject({ errorCode: SettlementErrorCode.WRONG_STATUS });
  });

  it('throws NotFoundError when settlement does not exist', async () => {
    mockedRepo.getSettlementById.mockResolvedValue(null);

    await expect(
      service.repayFacility(SETTLEMENT_ID, '42500000', '1250000', USER_ID, IP, UA),
    ).rejects.toThrow();
  });
});

// =========================================================================
// bookProfit
// =========================================================================
describe('bookProfit', () => {
  it('calculates net profit and creates profit booking', async () => {
    const repaid = makeSettlement({
      status: SettlementStatus.FACILITY_REPAID,
      penalty_income: '500000',
    });
    mockedRepo.getSettlementById.mockResolvedValue(repaid);
    const updated = makeSettlement({ status: SettlementStatus.PROFIT_BOOKED });
    mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(updated);

    const result = await service.bookProfit(SETTLEMENT_ID, '7500000', '1250000', USER_ID, IP, UA);

    // net = 7500000 - 1250000 + 500000 = 6750000
    expect(mockedRepo.createProfitBookingWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.any(String), // booking id
      SETTLEMENT_ID,
      '7500000', // discount earned
      '1250000', // bank cost
      '500000', // penalty income
      '6750000', // net profit
      USER_ID,
    );
    expect(mockedRepo.updateNetProfitWithClient).toHaveBeenCalledWith(
      mockClient,
      SETTLEMENT_ID,
      '6750000',
    );
    expect(result.status).toBe(SettlementStatus.PROFIT_BOOKED);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws WRONG_STATUS when settlement is not facility_repaid', async () => {
    const pending = makeSettlement({ status: SettlementStatus.PENDING });
    mockedRepo.getSettlementById.mockResolvedValue(pending);

    await expect(
      service.bookProfit(SETTLEMENT_ID, '7500000', '1250000', USER_ID, IP, UA),
    ).rejects.toMatchObject({ errorCode: SettlementErrorCode.WRONG_STATUS });
  });
});

// =========================================================================
// closeSettlement
// =========================================================================
describe('closeSettlement', () => {
  it('transitions profit_booked → closed', async () => {
    const profitBooked = makeSettlement({ status: SettlementStatus.PROFIT_BOOKED });
    mockedRepo.getSettlementById.mockResolvedValue(profitBooked);
    const closed = makeSettlement({ status: SettlementStatus.CLOSED });
    mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(closed);

    const result = await service.closeSettlement(SETTLEMENT_ID, USER_ID, IP, UA);

    expect(result.status).toBe(SettlementStatus.CLOSED);
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      USER_ID,
      'SETTLEMENT_CLOSED',
      'settlements',
      SETTLEMENT_ID,
      expect.any(Object),
      expect.any(Object),
      IP,
      UA,
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws WRONG_STATUS when settlement is not profit_booked', async () => {
    const pending = makeSettlement({ status: SettlementStatus.PENDING });
    mockedRepo.getSettlementById.mockResolvedValue(pending);

    await expect(service.closeSettlement(SETTLEMENT_ID, USER_ID, IP, UA)).rejects.toMatchObject({
      errorCode: SettlementErrorCode.WRONG_STATUS,
    });
  });

  it('rolls back on error and releases client', async () => {
    const profitBooked = makeSettlement({ status: SettlementStatus.PROFIT_BOOKED });
    mockedRepo.getSettlementById.mockResolvedValue(profitBooked);
    mockedRepo.updateSettlementStatusWithClient.mockRejectedValue(new Error('DB fail'));

    await expect(service.closeSettlement(SETTLEMENT_ID, USER_ID, IP, UA)).rejects.toThrow(
      'DB fail',
    );
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =========================================================================
// getSettlement
// =========================================================================
describe('getSettlement', () => {
  it('returns enriched settlement when found', async () => {
    const settlement = {
      ...makeSettlement(),
      invoice_number: 'INV-1',
      supplier_name: 'Supplier',
      buyer_name: 'Buyer',
      face_value: '100000000',
      advance_amount: '85000000',
      drawdown_principal: null,
    };
    mockedRepo.getEnrichedSettlementById.mockResolvedValue(settlement);

    const result = await service.getSettlement(SETTLEMENT_ID);
    expect(result.id).toBe(SETTLEMENT_ID);
  });

  it('throws NotFoundError when not found', async () => {
    mockedRepo.getEnrichedSettlementById.mockResolvedValue(null);

    await expect(service.getSettlement(SETTLEMENT_ID)).rejects.toThrow();
  });
});

// =========================================================================
// getSettlementList
// =========================================================================
describe('getSettlementList', () => {
  it('returns paginated settlements', async () => {
    mockedRepo.listSettlements.mockResolvedValue({
      data: [
        {
          id: SETTLEMENT_ID,
          invoice_id: INVOICE_ID,
          invoice_number: 'INV-1',
          supplier_name: 'Supplier',
          buyer_name: 'Buyer',
          buyer_payment_amount: '50000000',
          facility_repayment_amount: '42500000',
          net_profit: '6750000',
          status: SettlementStatus.CLOSED,
          settled_at: '2026-01-15T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      total: 1,
    });

    const result = await service.getSettlementList(1, 20);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
