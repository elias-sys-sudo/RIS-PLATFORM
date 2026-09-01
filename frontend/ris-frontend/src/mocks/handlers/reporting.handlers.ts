import { http, HttpResponse, delay } from 'msw';
import { getSettlements } from './settlements.handlers';
import { MOCK_INVOICES } from './invoice.handlers';

/* ------------------------------------------------------------------ */
/*  Reporting mock handlers — aligned with workflow document           */
/*  All monetary values in UGX (integer, no decimals)                  */
/* ------------------------------------------------------------------ */

export const reportingHandlers = [

  /** Portfolio Overview — live from MOCK_INVOICES so status transitions are reflected. */
  http.get('/api/reports/portfolio', async () => {
    await delay(350);

    const FUNDED_STATUSES = ['funded','collecting','collected','overdue','defaulted'];
    const OUTSTANDING_STATUSES = ['funded','collecting','overdue'];

    let totalFunded = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;
    const statusCounts = new Map<string, number>();
    const buyerExposure = new Map<string, { buyerId: string; buyerName: string; totalExposure: number }>();

    for (const inv of MOCK_INVOICES) {
      const status = inv.status as string;
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
      if (FUNDED_STATUSES.includes(status))      totalFunded      += Number(inv.advanceAmount);
      if (status === 'collected')                totalCollected   += Number(inv.faceValue);
      if (OUTSTANDING_STATUSES.includes(status)) totalOutstanding += Number(inv.faceValue);
      if (status === 'overdue')                  totalOverdue     += Number(inv.faceValue);
      if (OUTSTANDING_STATUSES.includes(status)) {
        const key = inv.buyerId;
        const cur = buyerExposure.get(key) ?? { buyerId: key, buyerName: inv.buyerName, totalExposure: 0 };
        cur.totalExposure += Number(inv.faceValue);
        buyerExposure.set(key, cur);
      }
    }

    // Annualised yield: sum of discount from collected invoices / collected face value, annualised
    // across the avg tenor of collected invoices. Simple approximation for the dashboard.
    const collected = MOCK_INVOICES.filter((i) => (i.status as string) === 'collected');
    const sumDiscount    = collected.reduce((n, i) => n + Number(i.discountAmount), 0);
    const sumFace        = collected.reduce((n, i) => n + Number(i.faceValue), 0);
    const avgTenor       = collected.length > 0
      ? collected.reduce((n, i) => n + Number(i.tenor), 0) / collected.length
      : 0;
    const annualisedYield = sumFace > 0 && avgTenor > 0
      ? Number(((sumDiscount / sumFace) * (365 / avgTenor) * 100).toFixed(1))
      : 0;

    return HttpResponse.json({
      totalFunded,
      totalCollected,
      totalOutstanding,
      totalOverdue,
      annualisedYield,
      invoiceCountsByStatus: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
      topBuyers: Array.from(buyerExposure.values()).sort((a, b) => b.totalExposure - a.totalExposure).slice(0, 5),
    });
  }),

  /** Aging Analysis — overdue/defaulted invoices bucketed by days past due. */
  http.get('/api/reports/aging', async () => {
    await delay(300);
    // Aging seed — representative spread across all four buckets so the
    // chart demonstrates colour coding and proportion. In production the
    // backend runs a SQL query over `invoices` joining their due dates.
    // Real MOCK_INVOICES in this dev environment all have 2025 due dates
    // so they'd collapse into the 90+ bucket, which undersells the chart.
    const overdueNow = MOCK_INVOICES
      .filter((inv) => (inv.status as string) === 'overdue' || (inv.status as string) === 'defaulted')
      .reduce(
        (acc, inv) => ({
          count: acc.count + 1,
          total: acc.total + Number(inv.faceValue),
        }),
        { count: 0, total: 0 },
      );
    return HttpResponse.json({
      buckets: [
        { bucket: '0-30 days',  count: 7, totalAmount: 215_000_000 },
        { bucket: '31-60 days', count: 4, totalAmount: 128_500_000 },
        { bucket: '61-90 days', count: 2, totalAmount:  62_000_000 },
        { bucket: '90+ days',   count: overdueNow.count, totalAmount: overdueNow.total },
      ],
    });
  }),

  /** Buyer Exposure — live aggregation per buyer from outstanding invoices. */
  http.get('/api/reports/buyer-exposure', async () => {
    await delay(300);
    const OUTSTANDING = ['funded','collecting','overdue'];
    const byBuyer = new Map<string, {
      buyerId: string; buyerName: string;
      usedLimit: number; approvedLimit: number;
      utilisationPct: number;
      avgDaysToPay: number; overdueIncidentCount: number;
    }>();

    for (const inv of MOCK_INVOICES) {
      const status = inv.status as string;
      const entry = byBuyer.get(inv.buyerId) ?? {
        buyerId: inv.buyerId, buyerName: inv.buyerName,
        usedLimit: 0, approvedLimit: 0, utilisationPct: 0,
        avgDaysToPay: Number(inv.tenor), overdueIncidentCount: 0,
      };
      if (OUTSTANDING.includes(status)) entry.usedLimit += Number(inv.faceValue);
      if (status === 'overdue' || status === 'defaulted') entry.overdueIncidentCount += 1;
      byBuyer.set(inv.buyerId, entry);
    }

    // Mock approved limits: 2x the current used (or a reasonable floor of 100M).
    // Real backend queries buyer_credit_limits table.
    for (const b of byBuyer.values()) {
      b.approvedLimit = Math.max(b.usedLimit * 2, 100_000_000);
      b.utilisationPct = b.approvedLimit > 0
        ? Number(((b.usedLimit / b.approvedLimit) * 100).toFixed(1))
        : 0;
    }

    return HttpResponse.json(Array.from(byBuyer.values()).sort((a, b) => b.usedLimit - a.usedLimit));
  }),

  /** Profit & Loss — live P&L computed from settlements + defaulted invoices.
   *  Revenue = discountEarned + penaltyIncome (both are income to RIS).
   *  Net profit locks only when settlement reaches profit_booked / closed
   *  (matches backend rule: profit finalizes at profit_booked transition).
   *  Write-offs = advance amount of defaulted invoices — shows the loss from
   *  buyers who defaulted (matches the backend status filter dropping
   *  defaulted invoices from revenue: the advance RIS paid out is gone). */
  http.get('/api/reports/profit', async () => {
    await delay(350);

    const invoices = getSettlements().map((s) => {
      const faceValue        = Number(s.faceValue);
      const discountAmount   = Number(s.discountEarned);
      const penaltyIncome    = Number(s.penaltyIncome);
      const bankInterestCost = Number(s.facilityRepayment);
      const finalized        = s.status === 'profit_booked' || s.status === 'closed';
      const netMmsProfit     = finalized ? Number(s.netProfit) : 0;
      const profitMarginPct  = faceValue > 0
        ? Number(((netMmsProfit / faceValue) * 100).toFixed(2))
        : 0;
      return { invoiceId: s.invoiceId, faceValue, discountAmount, penaltyIncome, bankInterestCost, netMmsProfit, profitMarginPct };
    });

    const totalFaceValue     = invoices.reduce((n, i) => n + i.faceValue, 0);
    const totalDiscount      = invoices.reduce((n, i) => n + i.discountAmount, 0);
    const totalPenaltyIncome = invoices.reduce((n, i) => n + i.penaltyIncome, 0);
    const totalRevenue       = totalDiscount + totalPenaltyIncome;
    const totalBankInterest  = invoices.reduce((n, i) => n + i.bankInterestCost, 0);
    const totalNetProfit     = invoices.reduce((n, i) => n + i.netMmsProfit, 0);
    const totalWriteOffs     = MOCK_INVOICES
      .filter((inv) => inv.status === 'defaulted')
      .reduce((n, inv) => n + Number(inv.advanceAmount), 0);
    const avgProfitMarginPct = totalFaceValue > 0
      ? Number(((totalNetProfit / totalFaceValue) * 100).toFixed(2))
      : 0;

    return HttpResponse.json({
      invoices,
      summary: {
        totalFaceValue,
        totalDiscount,
        totalPenaltyIncome,
        totalRevenue,
        totalBankInterest,
        totalNetProfit,
        totalWriteOffs,
        avgProfitMarginPct,
      },
    });
  }),

  /** Facilities Usage — bank credit line utilisation + at-risk exposure.
   *  defaultedExposure = sum of advanceAmount for defaulted invoices drawn
   *  against this facility. Full mock assumption: all defaulted exposure
   *  sits on the primary facility (fac_001 Stanbic). Real backend computes
   *  this via the facility_drawdowns → invoices join. */
  http.get('/api/reports/facilities', async () => {
    await delay(300);
    const totalDefaultedExposure = MOCK_INVOICES
      .filter((inv) => inv.status === 'defaulted')
      .reduce((n, inv) => n + Number(inv.advanceAmount), 0);
    return HttpResponse.json({
      data: [
        { id: 'fac_001', bankName: 'Stanbic Bank Uganda', totalLimit: 2000000000, drawnAmount: 693000000, availableAmount: 1307000000, utilisationPct: 34.65, interestRate: 18, interestAccrued: 4880000, defaultedExposure: totalDefaultedExposure, maturityDate: '2026-06-30T00:00:00Z', status: 'active', createdAt: '2025-01-01T08:00:00Z' },
        { id: 'fac_002', bankName: 'Centenary Bank',      totalLimit: 500000000,  drawnAmount: 120000000, availableAmount: 380000000,  utilisationPct: 24.0,  interestRate: 20, interestAccrued: 1250000, defaultedExposure: 0,                      maturityDate: '2025-12-31T00:00:00Z', status: 'active', createdAt: '2024-06-15T08:00:00Z' },
        { id: 'fac_003', bankName: 'dfcu Bank',            totalLimit: 300000000,  drawnAmount: 0,         availableAmount: 300000000,  utilisationPct: 0,     interestRate: 19, interestAccrued: 0,       defaultedExposure: 0,                      maturityDate: '2025-03-31T00:00:00Z', status: 'matured', createdAt: '2024-01-10T08:00:00Z' },
      ],
      total: 3,
    });
  }),

  /** Audit Export — immutable audit trail */
  http.get('/api/reports/audit-export', async () => {
    await delay(400);
    return HttpResponse.json({
      entries: [
        { id: 'aud_001', userId: 'usr_002', action: 'INVOICE_SUBMITTED',   tableName: 'invoices',      recordId: 'inv_001', oldValues: null, newValues: '{"status":"submitted"}',                  ipAddress: '10.0.1.42', userAgent: 'Mozilla/5.0', createdAt: '2026-03-28T09:15:00Z' },
        { id: 'aud_002', userId: 'usr_003', action: 'APPROVAL_GRANTED',    tableName: 'approvals',     recordId: 'apr_001', oldValues: '{"status":"pending"}', newValues: '{"status":"approved"}', ipAddress: '10.0.1.55', userAgent: 'Mozilla/5.0', createdAt: '2026-03-28T10:30:00Z' },
        { id: 'aud_003', userId: 'usr_001', action: 'PAYMENT_AUTHORISED',  tableName: 'payments',      recordId: 'pay_001', oldValues: null, newValues: '{"dual_auth_user_1":"usr_001"}',          ipAddress: '10.0.1.10', userAgent: 'Mozilla/5.0', createdAt: '2026-03-28T11:00:00Z' },
        { id: 'aud_004', userId: 'usr_004', action: 'PAYMENT_AUTHORISED',  tableName: 'payments',      recordId: 'pay_001', oldValues: null, newValues: '{"dual_auth_user_2":"usr_004"}',          ipAddress: '10.0.1.12', userAgent: 'Mozilla/5.0', createdAt: '2026-03-28T11:05:00Z' },
        { id: 'aud_005', userId: 'SYSTEM',  action: 'PAYMENT_EXECUTED',    tableName: 'payments',      recordId: 'pay_001', oldValues: '{"status":"executing"}', newValues: '{"status":"funded"}',ipAddress: '127.0.0.1',  userAgent: 'BullMQ-Worker', createdAt: '2026-03-28T11:06:00Z' },
        { id: 'aud_006', userId: 'SYSTEM',  action: 'DRAWDOWN_CREATED',    tableName: 'drawdowns',     recordId: 'dd_005',  oldValues: null, newValues: '{"principal":"85500000"}',                ipAddress: '127.0.0.1',  userAgent: 'BullMQ-Worker', createdAt: '2026-03-28T11:06:05Z' },
        { id: 'aud_007', userId: 'usr_002', action: 'INVOICE_SUBMITTED',   tableName: 'invoices',      recordId: 'inv_008', oldValues: null, newValues: '{"status":"submitted"}',                  ipAddress: '10.0.1.42', userAgent: 'Mozilla/5.0', createdAt: '2026-03-27T08:30:00Z' },
        { id: 'aud_008', userId: 'SYSTEM',  action: 'RISK_SCORED',         tableName: 'invoices',      recordId: 'inv_008', oldValues: '{"status":"buyer_confirmed"}', newValues: '{"status":"scored","risk_score":81}', ipAddress: '127.0.0.1', userAgent: 'BullMQ-Worker', createdAt: '2026-03-27T09:00:00Z' },
        { id: 'aud_009', userId: 'usr_003', action: 'APPROVAL_REJECTED',   tableName: 'approvals',     recordId: 'apr_005', oldValues: '{"status":"pending"}', newValues: '{"status":"rejected","reason":"Insufficient collateral"}', ipAddress: '10.0.1.55', userAgent: 'Mozilla/5.0', createdAt: '2026-03-26T14:00:00Z' },
        { id: 'aud_010', userId: 'SYSTEM',  action: 'INTEREST_ACCRUED',    tableName: 'drawdowns',     recordId: 'dd_001',  oldValues: '{"accrued_interest":"4391781"}', newValues: '{"accrued_interest":"4880000"}', ipAddress: '127.0.0.1', userAgent: 'Cron-Worker', createdAt: '2026-03-30T00:00:05Z' },
        { id: 'aud_011', userId: 'SYSTEM',  action: 'OVERDUE_DETECTED',    tableName: 'collections',   recordId: 'col_003', oldValues: '{"status":"collecting"}', newValues: '{"status":"overdue"}',              ipAddress: '127.0.0.1', userAgent: 'Cron-Worker', createdAt: '2026-03-29T05:30:00Z' },
        { id: 'aud_012', userId: 'usr_006', action: 'AML_FLAG_REVIEWED',   tableName: 'invoices',      recordId: 'inv_006', oldValues: '{"aml_flagged":true}', newValues: '{"aml_flagged":false,"aml_cleared_by":"usr_006"}', ipAddress: '10.0.1.70', userAgent: 'Mozilla/5.0', createdAt: '2026-03-25T16:20:00Z' },
      ],
      totalCount: 12,
    });
  }),

  /** Regulatory Compliance — AML, KYC, SAR statistics (Bank of Uganda FIA 2004) */
  http.get('/api/reports/regulatory', async () => {
    await delay(300);
    return HttpResponse.json({
      amlFlagsRaised: 7,
      sarsFiled: 2,
      transactionsAboveThreshold: 14,
      kycApprovals: 23,
      kycRejections: 3,
    });
  }),

  // ── Checkers §6: 5 application / funds reports ────────────────────────────
  // These compute from MOCK_INVOICES + runtime settlements where meaningful
  // so values track what the user has done in the session.

  /** 6a — Applications Received: grouped by status + daily arrivals */
  http.get('/api/reports/applications-received', async () => {
    await delay(300);
    const byStatusMap = new Map<string, number>();
    const byDayMap    = new Map<string, number>();
    for (const inv of MOCK_INVOICES) {
      byStatusMap.set(inv.status, (byStatusMap.get(inv.status) ?? 0) + 1);
      const day = inv.createdAt.slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    }
    return HttpResponse.json({
      total: MOCK_INVOICES.length,
      byStatus: Array.from(byStatusMap, ([status, count]) => ({ status, count })),
      byDay: Array.from(byDayMap, ([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-30),
    });
  }),

  /** 6b — Applications Pipeline: invoices in review-type statuses, avg days in status */
  http.get('/api/reports/applications-pipeline', async () => {
    await delay(300);
    const REVIEW_STATUSES = [
      'submitted', 'buyer_confirmed', 'scored', 'priced',
      'pending_first_auth', 'pending_second_auth', 'executing',
    ];
    const now = Date.now();
    const stageMap = new Map<string, { count: number; totalDays: number }>();
    for (const inv of MOCK_INVOICES) {
      if (!REVIEW_STATUSES.includes(inv.status as string)) continue;
      const days = Math.max(0, Math.floor((now - new Date(inv.updatedAt).getTime()) / 86_400_000));
      const cur = stageMap.get(inv.status as string) ?? { count: 0, totalDays: 0 };
      cur.count += 1;
      cur.totalDays += days;
      stageMap.set(inv.status as string, cur);
    }
    return HttpResponse.json({
      stages: Array.from(stageMap, ([kycStatus, v]) => ({
        kycStatus,
        count: v.count,
        avgDaysInStatus: v.count > 0 ? Number((v.totalDays / v.count).toFixed(1)) : 0,
      })),
    });
  }),

  /** 6c — Incomplete Applications: drafts + invoices missing supporting documents */
  http.get('/api/reports/applications-incomplete', async () => {
    await delay(300);
    const now = Date.now();
    const rows = MOCK_INVOICES
      .filter((inv) => inv.status === 'draft' || inv.status === 'rejected')
      .map((inv) => ({
        supplierId: inv.supplierId,
        kycStatus: inv.status,
        daysInStatus: Math.max(0, Math.floor((now - new Date(inv.updatedAt).getTime()) / 86_400_000)),
        missingDocTypes: inv.status === 'draft'
          ? ['certificate_of_incorporation', 'tax_registration']
          : ['director_id'],
      }));
    return HttpResponse.json(rows);
  }),

  /** 6d — Company P&L: cumulative from collected invoices + settlements */
  http.get('/api/reports/company-pl', async () => {
    await delay(300);
    const collected = MOCK_INVOICES.filter(
      (inv) => ['funded','collecting','collected','overdue'].includes(inv.status as string),
    );
    const totalFaceValue = collected.reduce((n, i) => n + Number(i.faceValue), 0);
    const totalDiscount  = collected.reduce((n, i) => n + Number(i.discountAmount), 0);
    const totalBankInterest = getSettlements()
      .reduce((n, s) => n + Number(s.facilityRepayment), 0);
    const grossProfit = totalDiscount - totalBankInterest;
    return HttpResponse.json({
      totalFaceValueDiscounted: String(totalFaceValue),
      totalDiscountEarned:      String(totalDiscount),
      totalBankInterestCost:    String(totalBankInterest),
      grossProfit:              String(grossProfit),
    });
  }),

  /** 6e — Disbursed Funds: all funded/collecting/collected/overdue invoices */
  http.get('/api/reports/disbursed-funds', async () => {
    await delay(300);
    const funded = MOCK_INVOICES.filter(
      (inv) => ['funded','collecting','collected','overdue'].includes(inv.status as string),
    );
    const payments = funded.map((inv) => ({
      invoiceId:       inv.id,
      supplierId:      inv.supplierId,
      buyerId:         inv.buyerId,
      disbursedAmount: String(inv.advanceAmount),
      disbursedAt:     inv.fundedAt ?? inv.updatedAt,
      status:          inv.status as string,
    }));
    const totalDisbursed = payments.reduce((n, p) => n + Number(p.disbursedAmount), 0);
    return HttpResponse.json({
      payments,
      totalDisbursed: String(totalDisbursed),
      count: payments.length,
    });
  }),
];
