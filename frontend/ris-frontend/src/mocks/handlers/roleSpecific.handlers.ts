import { http, HttpResponse, delay } from 'msw';
import type {
  ApprovalQueueItem,
  FundingPipelineItem,
  SupplierDashboardSummary,
  LegalDashboardSummary,
  RiskDistributionItem,
  Period,
} from '../../types/dashboard.types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const M = 1_000_000;
const B = 1_000_000_000;

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3_600_000).toISOString();
}

// ── Approval queue ─────────────────────────────────────────────────────────────

const APPROVAL_QUEUE: ApprovalQueueItem[] = [
  {
    id: 'app_01', invoiceRef: 'INV-2024-0852',
    supplierName: 'Nile Agro Suppliers',   buyerName: 'Roofings Group',
    faceValue: 2.1 * B, submittedAt: minutesAgo(120),
    status: 'pending_first_auth',  riskLevel: 'low',
  },
  {
    id: 'app_02', invoiceRef: 'INV-2024-0851',
    supplierName: 'Kampala Traders Ltd',   buyerName: 'MTN Uganda',
    faceValue: 620 * M, submittedAt: minutesAgo(240),
    status: 'pending_second_auth', riskLevel: 'medium',
  },
  {
    id: 'app_03', invoiceRef: 'INV-2024-0850',
    supplierName: 'Entebbe Logistics',     buyerName: 'Nile Breweries',
    faceValue: 1.45 * B, submittedAt: minutesAgo(360),
    status: 'pending_first_auth',  riskLevel: 'low',
  },
  {
    id: 'app_04', invoiceRef: 'INV-2024-0849',
    supplierName: 'Gulu Distributors',     buyerName: 'UMEME Ltd',
    faceValue: 880 * M, submittedAt: minutesAgo(480),
    status: 'pending_first_auth',  riskLevel: 'high',
  },
  {
    id: 'app_05', invoiceRef: 'INV-2024-0848',
    supplierName: 'Jinja Farm Supplies',   buyerName: 'Airtel Uganda',
    faceValue: 3.2 * B, submittedAt: minutesAgo(600),
    status: 'pending_second_auth', riskLevel: 'medium',
  },
];

// ── Funding pipeline ───────────────────────────────────────────────────────────

const FUNDING_PIPELINE: FundingPipelineItem[] = [
  {
    id: 'fp_01', invoiceRef: 'INV-2024-0851',
    supplierName: 'Kampala Traders Ltd', buyerName: 'MTN Uganda',
    faceValue: 620 * M, advanceAmount: Math.round(620 * M * 0.85),
    approvedAt: minutesAgo(45),  paymentMethod: 'mtn_momo',
  },
  {
    id: 'fp_02', invoiceRef: 'INV-2024-0853',
    supplierName: 'Mbarara Agri Ltd',    buyerName: 'Stanbic Bank Uganda',
    faceValue: 1.8 * B, advanceAmount: Math.round(1.8 * B * 0.80),
    approvedAt: minutesAgo(90),  paymentMethod: 'eft_rtgs',
  },
  {
    id: 'fp_03', invoiceRef: 'INV-2024-0854',
    supplierName: 'Masaka Grain Co.',    buyerName: 'Uganda Breweries',
    faceValue: 940 * M, advanceAmount: Math.round(940 * M * 0.82),
    approvedAt: minutesAgo(180), paymentMethod: 'airtel_money',
  },
  {
    id: 'fp_04', invoiceRef: 'INV-2024-0855',
    supplierName: 'Soroti Fresh Foods',  buyerName: 'UMEME Ltd',
    faceValue: 2.5 * B, advanceAmount: Math.round(2.5 * B * 0.78),
    approvedAt: minutesAgo(240), paymentMethod: 'eft_rtgs',
  },
  {
    id: 'fp_05', invoiceRef: 'INV-2024-0856',
    supplierName: 'Arua Textiles',       buyerName: 'Roofings Group',
    faceValue: 730 * M, advanceAmount: Math.round(730 * M * 0.83),
    approvedAt: minutesAgo(310), paymentMethod: 'mtn_momo',
  },
];

// ── Supplier summary ───────────────────────────────────────────────────────────

const SUPPLIER_SUMMARY: SupplierDashboardSummary = {
  stats: {
    totalSubmitted: 23,
    totalFunded: 18,
    outstandingAmount: 4.2 * B,
    overdueCount: 2,
    avgPaymentDays: 31,
  },
  invoiceStatusBreakdown: [
    { status: 'funded',             count: 8, amount: 6.8 * B },
    { status: 'collecting',         count: 6, amount: 4.2 * B },
    { status: 'submitted',          count: 3, amount: 2.1 * B },
    { status: 'pending_first_auth', count: 2, amount: 1.4 * B },
    { status: 'overdue',            count: 2, amount: 850 * M },
    { status: 'collected',          count: 2, amount: 1.8 * B },
  ],
  recentPayments: [
    {
      id: 'sp_01', invoiceId: 'inv_847', invoiceRef: 'INV-2024-0847',
      supplierName: 'Kampala Traders Ltd', buyerName: 'Nile Breweries',
      amount: 850 * M, method: 'mtn_momo',
      status: 'funded', direction: 'disbursement', paidAt: minutesAgo(8),
    },
    {
      id: 'sp_02', invoiceId: 'inv_845', invoiceRef: 'INV-2024-0845',
      supplierName: 'Kampala Traders Ltd', buyerName: 'Roofings Group',
      amount: 760 * M, method: 'mtn_momo',
      status: 'funded', direction: 'disbursement', paidAt: minutesAgo(150),
    },
    {
      id: 'sp_03', invoiceId: 'inv_790', invoiceRef: 'INV-2024-0790',
      supplierName: 'Kampala Traders Ltd', buyerName: 'Nile Breweries',
      amount: 730 * M, method: 'mtn_momo',
      status: 'funded', direction: 'collection',   paidAt: minutesAgo(2400),
    },
  ],
};

// ── Legal summary ──────────────────────────────────────────────────────────────

const LEGAL_SUMMARY: LegalDashboardSummary = {
  sarFlaggedCount: 3,
  sarTotalAmount: 4.85 * B,
  sarItems: [
    {
      id: 'sar_01', invoiceRef: 'INV-2024-0798',
      supplierName: 'Fort Portal Supplies', buyerName: 'Uganda Telecom',
      amount: 2.1 * B,  flaggedAt: daysAgo(5),
      reason: 'Transaction exceeds AML threshold (UGX 100M)',
      status: 'pending_review',
    },
    {
      id: 'sar_02', invoiceRef: 'INV-2024-0761',
      supplierName: 'Kisumu Traders Ltd',   buyerName: 'Nile Breweries',
      amount: 1.4 * B,  flaggedAt: daysAgo(12),
      reason: 'Multiple large transactions same buyer in 48 hours',
      status: 'filed',
    },
    {
      id: 'sar_03', invoiceRef: 'INV-2024-0734',
      supplierName: 'Lira Auto Parts',      buyerName: 'Airtel Uganda',
      amount: 1.35 * B, flaggedAt: daysAgo(21),
      reason: 'Structuring pattern — 3 invoices below threshold within 72h',
      status: 'cleared',
    },
  ],
  tier3Escalations: [
    {
      id: 'esc_01', invoiceRef: 'INV-2024-0798',
      supplierName: 'Fort Portal Supplies', buyerName: 'Uganda Telecom',
      amount: 2.1 * B, daysOverdue: 32, escalatedAt: daysAgo(5),
    },
    {
      id: 'esc_02', invoiceRef: 'INV-2024-0779',
      supplierName: 'Mbale Cement Ltd',     buyerName: 'UMEME Ltd',
      amount: 1.8 * B, daysOverdue: 47, escalatedAt: daysAgo(14),
    },
  ],
};

// ── Risk distribution ──────────────────────────────────────────────────────────

const PERIOD_MULTIPLIERS: Record<Period, number> = {
  '7d': 0.3, '30d': 1, '90d': 2.8, '12m': 11, 'all': 14,
};

function buildRiskDistribution(period: Period): RiskDistributionItem[] {
  const m = PERIOD_MULTIPLIERS[period];
  return [
    { riskLevel: 'low',      count: Math.round(89 * m), amount: Math.round(15.2 * B * m) },
    { riskLevel: 'medium',   count: Math.round(47 * m), amount: Math.round(8.4  * B * m) },
    { riskLevel: 'high',     count: Math.round(28 * m), amount: Math.round(4.1  * B * m) },
    { riskLevel: 'critical', count: Math.round(7  * m), amount: Math.round(1.2  * B * m) },
  ];
}

// ── Handlers ───────────────────────────────────────────────────────────────────

export const roleSpecificHandlers = [

  http.get('/api/dashboard/approval-queue', async () => {
    await delay(300);
    return HttpResponse.json<{ data: ApprovalQueueItem[] }>({ data: APPROVAL_QUEUE });
  }),

  http.get('/api/dashboard/funding-pipeline', async () => {
    await delay(300);
    return HttpResponse.json<{ data: FundingPipelineItem[] }>({ data: FUNDING_PIPELINE });
  }),

  http.get('/api/dashboard/supplier/summary', async ({ request }) => {
    await delay(350);
    const auth = request.headers.get('Authorization') ?? '';
    // New supplier (usr_008) has no history yet
    if (auth.includes('usr_008')) {
      const empty: SupplierDashboardSummary = {
        stats: {
          totalSubmitted: 0,
          totalFunded: 0,
          outstandingAmount: 0,
          overdueCount: 0,
          avgPaymentDays: 0,
        },
        invoiceStatusBreakdown: [],
        recentPayments: [],
      };
      return HttpResponse.json<{ data: SupplierDashboardSummary }>({ data: empty });
    }
    return HttpResponse.json<{ data: SupplierDashboardSummary }>({ data: SUPPLIER_SUMMARY });
  }),

  http.get('/api/dashboard/legal/summary', async () => {
    await delay(300);
    return HttpResponse.json<{ data: LegalDashboardSummary }>({ data: LEGAL_SUMMARY });
  }),

  http.get('/api/dashboard/risk-distribution', async ({ request }) => {
    await delay(300);
    const url    = new URL(request.url);
    const period = (url.searchParams.get('period') ?? '30d') as Period;
    return HttpResponse.json<{ data: RiskDistributionItem[] }>({ data: buildRiskDistribution(period) });
  }),

];
