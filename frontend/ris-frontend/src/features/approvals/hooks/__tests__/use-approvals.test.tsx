import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useApproveInvoice } from '../use-approvals';
import type { ApprovalResult } from '@/types/approval.types';

const toastMock = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};
vi.mock('sonner', () => ({ toast: toastMock }));

const approveInvoiceMock = vi.fn<(invoiceId: string, payload?: unknown) => Promise<ApprovalResult>>();
vi.mock('../../api/approvals.api', () => ({
  approveInvoice: (...args: [string, unknown?]) => approveInvoiceMock(...args),
  fetchApprovals: vi.fn(),
  fetchApprovalDetail: vi.fn(),
  rejectInvoice: vi.fn(),
  requestInfo: vi.fn(),
}));

function makeWrapper(): { Wrapper: (p: { children: ReactNode }) => JSX.Element; qc: QueryClient } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function buildResult(overrides: Partial<ApprovalResult> = {}): ApprovalResult {
  return {
    approvalId: 'app-1',
    invoiceId: 'inv-1',
    tier: 'AUTO',
    decision: 'APPROVED',
    comments: '',
    quorumReached: true,
    ...overrides,
  };
}

describe('useApproveInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows info toast and invalidates BOTH queries on Tier-3 partial quorum', async () => {
    approveInvoiceMock.mockResolvedValue(
      buildResult({ tier: 'TIER_3', quorumReached: false }),
    );
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });
    result.current.mutate({ invoiceId: 'inv-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toastMock.info).toHaveBeenCalledWith(
      expect.stringContaining('1 of 2 approvals received'),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['approvals'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments', 'pending'] });
  });

  it('shows queued-for-authorisation toast on full quorum (AUTO/TIER_2)', async () => {
    approveInvoiceMock.mockResolvedValue(
      buildResult({ tier: 'AUTO', quorumReached: true }),
    );
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });
    result.current.mutate({ invoiceId: 'inv-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringContaining('payment queued for authorisation'),
    );
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['approvals'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments', 'pending'] });
  });

  it('surfaces error toast on rejection', async () => {
    approveInvoiceMock.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });
    result.current.mutate({ invoiceId: 'inv-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });
});
