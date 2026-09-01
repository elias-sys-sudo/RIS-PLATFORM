process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/settlements/settlements.service';
import * as repo from '../../../src/services/settlements/settlements.repository';
import { BusinessRuleError } from '../../../src/shared/errors';
import type { DashboardRow } from '../../../src/services/settlements/settlements.types';

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

const mockedRepo = jest.mocked(repo);

const ZERO_ROW: DashboardRow = {
  total_settlements: '0',
  total_profit_booked: '0',
  total_facility_repayment: '0',
  pending_count: '0',
  avg_profit_per_invoice: '0',
};

describe('settlements.service getDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to the last 30 days when no bounds supplied', async () => {
    mockedRepo.getDashboardMetrics.mockResolvedValueOnce(ZERO_ROW);
    const before = Date.now();

    const result = await service.getDashboard();

    expect(mockedRepo.getDashboardMetrics).toHaveBeenCalledTimes(1);
    const [start, end] = mockedRepo.getDashboardMetrics.mock.calls[0];
    const spanMs = end.getTime() - start.getTime();
    // 30 days ± 1 second
    expect(spanMs).toBeGreaterThanOrEqual(30 * 86400_000 - 1000);
    expect(spanMs).toBeLessThanOrEqual(30 * 86400_000 + 1000);
    expect(end.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.total_settlements).toBe(0);
    expect(result.pending_count).toBe(0);
  });

  it('respects custom period bounds', async () => {
    mockedRepo.getDashboardMetrics.mockResolvedValueOnce({
      total_settlements: '12',
      total_profit_booked: '5000000',
      total_facility_repayment: '90000000',
      pending_count: '3',
      avg_profit_per_invoice: '416666',
    });

    const periodStart = new Date('2026-01-01T00:00:00Z');
    const periodEnd = new Date('2026-02-01T00:00:00Z');
    const result = await service.getDashboard(periodStart, periodEnd);

    expect(mockedRepo.getDashboardMetrics).toHaveBeenCalledWith(periodStart, periodEnd);
    expect(result.period_start).toBe(periodStart.toISOString());
    expect(result.period_end).toBe(periodEnd.toISOString());
    expect(result.total_settlements).toBe(12);
    expect(result.pending_count).toBe(3);
    expect(result.total_profit_booked).toBe('5000000');
    expect(result.total_facility_repayment).toBe('90000000');
    expect(result.avg_profit_per_invoice).toBe('416666');
  });

  it('returns zeroes for periods with no settlements', async () => {
    mockedRepo.getDashboardMetrics.mockResolvedValueOnce(ZERO_ROW);
    const result = await service.getDashboard(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-02-01T00:00:00Z'),
    );
    expect(result.total_settlements).toBe(0);
    expect(result.total_profit_booked).toBe('0');
    expect(result.pending_count).toBe(0);
  });

  it('throws BusinessRuleError when period_start >= period_end', async () => {
    const periodStart = new Date('2026-02-01T00:00:00Z');
    const periodEnd = new Date('2026-01-01T00:00:00Z');

    await expect(service.getDashboard(periodStart, periodEnd)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mockedRepo.getDashboardMetrics).not.toHaveBeenCalled();
  });

  it('throws BusinessRuleError when period_start equals period_end', async () => {
    const sameMoment = new Date('2026-02-01T00:00:00Z');

    await expect(service.getDashboard(sameMoment, sameMoment)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mockedRepo.getDashboardMetrics).not.toHaveBeenCalled();
  });
});
