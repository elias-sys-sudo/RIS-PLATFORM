process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/settlements/settlements.service';
import * as repo from '../../../src/services/settlements/settlements.repository';
import { pool } from '../../../src/shared/database/pool';
import {
  SettlementStatus,
  SettlementErrorCode,
} from '../../../src/services/settlements/settlements.types';
import type { SettlementRecord } from '../../../src/services/settlements/settlements.types';

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

const SETTLEMENT_ID = 'stl-uuid-1';
const USER_ID = 'usr-fm-1';
const IP = '10.0.0.1';
const UA = 'jest';

function makeSettlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: SETTLEMENT_ID,
    invoice_id: 'inv-1',
    collection_id: 'col-1',
    drawdown_id: 'drw-1',
    buyer_payment_amount: '50000000',
    facility_repayment_amount: '42500000',
    accrued_interest: '1250000',
    penalty_income: '0',
    net_profit: '0',
    status: SettlementStatus.FACILITY_REPAID,
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
// BigInt arithmetic — net profit
// formula: discount_earned - bank_cost_paid + penalty_income
// =========================================================================
describe('bookProfit BigInt math', () => {
  function expectComputedNetProfit(
    discount: string,
    bankCost: string,
    penalty: string,
    expectedNet: string,
  ): void {
    it(`net = ${discount} - ${bankCost} + ${penalty} = ${expectedNet}`, async () => {
      const repaid = makeSettlement({
        status: SettlementStatus.FACILITY_REPAID,
        penalty_income: penalty,
      });
      mockedRepo.getSettlementById.mockResolvedValue(repaid);
      mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(
        makeSettlement({ status: SettlementStatus.PROFIT_BOOKED, net_profit: expectedNet }),
      );

      await service.bookProfit(SETTLEMENT_ID, discount, bankCost, USER_ID, IP, UA);

      expect(mockedRepo.createProfitBookingWithClient).toHaveBeenCalledWith(
        mockClient,
        expect.any(String),
        SETTLEMENT_ID,
        discount,
        bankCost,
        penalty,
        expectedNet,
        USER_ID,
      );
      expect(mockedRepo.updateNetProfitWithClient).toHaveBeenCalledWith(
        mockClient,
        SETTLEMENT_ID,
        expectedNet,
      );
    });
  }

  // Happy path — positive profit
  expectComputedNetProfit('7500000', '1250000', '500000', '6750000');

  // Zero profit — break-even
  expectComputedNetProfit('1000000', '1000000', '0', '0');

  // Loss — negative net profit must be preserved as a string
  expectComputedNetProfit('1000000', '5000000', '0', '-4000000');

  // Penalty income tips a loss into break-even
  expectComputedNetProfit('1000000', '1500000', '500000', '0');

  // Very large values — beyond Number.MAX_SAFE_INTEGER (2^53-1 ≈ 9.007e15)
  // 100 trillion - 1 trillion + 500m = 99,000,500,000,000
  expectComputedNetProfit('100000000000000', '1000000000000', '500000000', '99000500000000');

  // Penalty-only profit (no discount, no bank cost)
  expectComputedNetProfit('0', '0', '750000', '750000');

  it('uses penalty_income from the settlement record, not from the caller', async () => {
    // Caller provides discount + bankCost, but penalty_income lives on the settlement.
    const repaid = makeSettlement({
      status: SettlementStatus.FACILITY_REPAID,
      penalty_income: '999999',
    });
    mockedRepo.getSettlementById.mockResolvedValue(repaid);
    mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(
      makeSettlement({ status: SettlementStatus.PROFIT_BOOKED }),
    );

    await service.bookProfit(SETTLEMENT_ID, '5000000', '2000000', USER_ID, IP, UA);

    // 5000000 - 2000000 + 999999 = 3999999
    expect(mockedRepo.createProfitBookingWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.any(String),
      SETTLEMENT_ID,
      '5000000',
      '2000000',
      '999999',
      '3999999',
      USER_ID,
    );
  });
});

// =========================================================================
// Rollback paths — every transactional method
// =========================================================================
describe('transaction rollback', () => {
  it('repayFacility rolls back when updateFacilityRepayment throws', async () => {
    mockedRepo.getSettlementById.mockResolvedValue(
      makeSettlement({ status: SettlementStatus.PENDING }),
    );
    mockedRepo.updateFacilityRepaymentWithClient.mockRejectedValue(new Error('boom'));

    await expect(service.repayFacility(SETTLEMENT_ID, '1', '1', USER_ID, IP, UA)).rejects.toThrow(
      'boom',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('repayFacility rolls back when audit insert throws (rule #4 — audit inside txn)', async () => {
    mockedRepo.getSettlementById.mockResolvedValue(
      makeSettlement({ status: SettlementStatus.PENDING }),
    );
    mockedRepo.updateFacilityRepaymentWithClient.mockResolvedValue(undefined);
    mockedRepo.updateSettlementStatusWithClient.mockResolvedValue(
      makeSettlement({ status: SettlementStatus.FACILITY_REPAID }),
    );
    mockedRepo.createAuditEntryWithClient.mockRejectedValue(new Error('audit fail'));

    await expect(service.repayFacility(SETTLEMENT_ID, '1', '1', USER_ID, IP, UA)).rejects.toThrow(
      'audit fail',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('bookProfit rolls back when createProfitBookingWithClient throws', async () => {
    mockedRepo.getSettlementById.mockResolvedValue(
      makeSettlement({ status: SettlementStatus.FACILITY_REPAID }),
    );
    mockedRepo.createProfitBookingWithClient.mockRejectedValue(new Error('insert fail'));

    await expect(
      service.bookProfit(SETTLEMENT_ID, '1000000', '500000', USER_ID, IP, UA),
    ).rejects.toThrow('insert fail');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
    // updateNetProfit must NOT have been attempted
    expect(mockedRepo.updateNetProfitWithClient).not.toHaveBeenCalled();
  });

  it('initiateSettlement releases client even when ROLLBACK is reached via audit failure', async () => {
    mockedRepo.getSettlementByInvoiceId.mockResolvedValue(null);
    mockedRepo.createSettlementWithClient.mockResolvedValue(makeSettlement());
    mockedRepo.createAuditEntryWithClient.mockRejectedValue(new Error('audit fail'));

    await expect(
      service.initiateSettlement(
        'inv-1',
        'col-1',
        '10000',
        '0',
        USER_ID,
        IP,
        UA,
        '00000000-0000-0000-0000-00000000abcd',
      ),
    ).rejects.toThrow('audit fail');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =========================================================================
// State guard — every disallowed transition
// =========================================================================
describe('status transition guard', () => {
  const guardCases: Array<{
    method: 'repayFacility' | 'bookProfit' | 'closeSettlement';
    from: SettlementStatus;
  }> = [
    { method: 'repayFacility', from: SettlementStatus.FACILITY_REPAID },
    { method: 'repayFacility', from: SettlementStatus.PROFIT_BOOKED },
    { method: 'repayFacility', from: SettlementStatus.CLOSED },
    { method: 'bookProfit', from: SettlementStatus.PENDING },
    { method: 'bookProfit', from: SettlementStatus.PROFIT_BOOKED },
    { method: 'bookProfit', from: SettlementStatus.CLOSED },
    { method: 'closeSettlement', from: SettlementStatus.PENDING },
    { method: 'closeSettlement', from: SettlementStatus.FACILITY_REPAID },
    { method: 'closeSettlement', from: SettlementStatus.CLOSED },
  ];

  for (const { method, from } of guardCases) {
    it(`${method} rejects WRONG_STATUS when current=${from}`, async () => {
      mockedRepo.getSettlementById.mockResolvedValue(makeSettlement({ status: from }));

      const call = (): Promise<unknown> => {
        if (method === 'repayFacility') {
          return service.repayFacility(SETTLEMENT_ID, '1', '1', USER_ID, IP, UA);
        }
        if (method === 'bookProfit') {
          return service.bookProfit(SETTLEMENT_ID, '1', '1', USER_ID, IP, UA);
        }
        return service.closeSettlement(SETTLEMENT_ID, USER_ID, IP, UA);
      };

      await expect(call()).rejects.toMatchObject({
        errorCode: SettlementErrorCode.WRONG_STATUS,
      });
      // No transaction should have started
      expect(mockedPool.connect).not.toHaveBeenCalled();
    });
  }
});
