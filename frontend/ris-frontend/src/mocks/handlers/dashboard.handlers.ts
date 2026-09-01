import { http, HttpResponse, delay } from 'msw';
import type {
  DashboardSummary,
  Period,
  TrendDataPoint,
  InvoiceStatusBreakdownItem,
  PaymentHistoryResponse,
  PaymentHistoryItem,
} from '../../types/dashboard.types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const M  = 1_000_000;        // 1 million UGX
const B  = 1_000_000_000;    // 1 billion UGX

/** Build ISO dates going back N days from today */
function datesBack(days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** Simple seeded pseudo-random (avoids different values each refresh) */
function seeded(seed: number, min: number, max: number): number {
  const x = Math.sin(seed) * 10000;
  return Math.round(min + (x - Math.floor(x)) * (max - min));
}

// ── Trend data builders ───────────────────────────────────────────────────────

function buildTrendData(period: Period): TrendDataPoint[] {
  const configs: Record<Period, { days: number; fundedBase: number; collBase: number; overdueBase: number }> = {
    '7d':  { days: 7,   fundedBase: 800 * M,  collBase: 750 * M,  overdueBase: 120 * M  },
    '30d': { days: 30,  fundedBase: 600 * M,  collBase: 560 * M,  overdueBase: 80 * M   },
    '90d': { days: 90,  fundedBase: 450 * M,  collBase: 420 * M,  overdueBase: 60 * M   },
    '12m': { days: 365, fundedBase: 3.2 * B,  collBase: 2.9 * B,  overdueBase: 400 * M  },
    'all': { days: 365, fundedBase: 4.5 * B,  collBase: 4.1 * B,  overdueBase: 600 * M  },
  };

  const { days, fundedBase, collBase, overdueBase } = configs[period];

  // For 12m / all: aggregate by month (12 points); otherwise daily
  if (period === '12m' || period === 'all') {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (11 - i));
      const date = d.toISOString().slice(0, 7); // YYYY-MM
      return {
        date,
        funded:    seeded(i * 3 + 1, fundedBase * 0.7, fundedBase * 1.3),
        collected: seeded(i * 3 + 2, collBase   * 0.7, collBase   * 1.3),
        overdue:   seeded(i * 3 + 3, overdueBase * 0.5, overdueBase * 1.5),
      };
    });
  }

  return datesBack(days).map((date, i) => ({
    date,
    funded:    seeded(i * 3 + 1, fundedBase * 0.6, fundedBase * 1.4),
    collected: seeded(i * 3 + 2, collBase   * 0.6, collBase   * 1.4),
    overdue:   seeded(i * 3 + 3, overdueBase * 0.4, overdueBase * 1.6),
  }));
}

// ── Invoice status breakdown ──────────────────────────────────────────────────

function buildStatusBreakdown(period: Period): InvoiceStatusBreakdownItem[] {
  const multipliers: Record<Period, number> = {
    '7d': 0.3, '30d': 1, '90d': 2.8, '12m': 11, 'all': 14,
  };
  const m = multipliers[period];

  return [
    { status: 'funded',               count: Math.round(42  * m), amount: Math.round(8.4  * B * m) },
    { status: 'collecting',           count: Math.round(28  * m), amount: Math.round(5.6  * B * m) },
    { status: 'approved',             count: Math.round(15  * m), amount: Math.round(2.1  * B * m) },
    { status: 'submitted',            count: Math.round(12  * m), amount: Math.round(1.8  * B * m) },
    { status: 'pending_second_auth',  count: Math.round(8   * m), amount: Math.round(1.2  * B * m) },
    { status: 'pending_first_auth',   count: Math.round(6   * m), amount: Math.round(900  * M * m) },
    { status: 'overdue',              count: Math.round(9   * m), amount: Math.round(1.35 * B * m) },
    { status: 'collected',            count: Math.round(120 * m), amount: Math.round(18   * B * m) },
    { status: 'rejected',             count: Math.round(5   * m), amount: Math.round(750  * M * m) },
    { status: 'defaulted',            count: Math.round(2   * m), amount: Math.round(300  * M * m) },
  ];
}

// ── Per-period summary stats ──────────────────────────────────────────────────

const PERIOD_STATS: Record<Period, DashboardSummary['stats']> = {
  '7d': {
    totalInvoices:    47,
    totalFaceValue:   12.6 * B,
    totalFunded:      10.1 * B,
    collectionRate:   81.4,
    overdueCount:     3,
    overdueAmount:    450 * M,
    avgTenorDays:     32,
    activeFacilities: 4,
  },
  '30d': {
    totalInvoices:    183,
    totalFaceValue:   48.2 * B,
    totalFunded:      38.6 * B,
    collectionRate:   84.7,
    overdueCount:     9,
    overdueAmount:    1.35 * B,
    avgTenorDays:     29,
    activeFacilities: 4,
  },
  '90d': {
    totalInvoices:    512,
    totalFaceValue:   134 * B,
    totalFunded:      107 * B,
    collectionRate:   87.2,
    overdueCount:     21,
    overdueAmount:    3.15 * B,
    avgTenorDays:     28,
    activeFacilities: 5,
  },
  '12m': {
    totalInvoices:    1_847,
    totalFaceValue:   492 * B,
    totalFunded:      394 * B,
    collectionRate:   91.3,
    overdueCount:     47,
    overdueAmount:    7.05 * B,
    avgTenorDays:     27,
    activeFacilities: 6,
  },
  'all': {
    totalInvoices:    2_430,
    totalFaceValue:   648 * B,
    totalFunded:      518 * B,
    collectionRate:   90.8,
    overdueCount:     52,
    overdueAmount:    7.8 * B,
    avgTenorDays:     27,
    activeFacilities: 6,
  },
};

const PERIOD_TRENDS: Record<Period, DashboardSummary['trends']> = {
  '7d':  { totalFaceValueChange: 14.2,  totalFundedChange: 12.8,  collectionRateChange:  2.1, overdueAmountChange: -8.4  },
  '30d': { totalFaceValueChange: 22.7,  totalFundedChange: 19.3,  collectionRateChange:  3.5, overdueAmountChange: -12.1 },
  '90d': { totalFaceValueChange: 31.4,  totalFundedChange: 27.6,  collectionRateChange:  4.8, overdueAmountChange: -5.3  },
  '12m': { totalFaceValueChange: 68.9,  totalFundedChange: 71.2,  collectionRateChange:  6.2, overdueAmountChange:  9.7  },
  'all': { totalFaceValueChange: 120.5, totalFundedChange: 118.3, collectionRateChange: 11.4, overdueAmountChange: 18.2  },
};

// ── Recent activity ───────────────────────────────────────────────────────────

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

const RECENT_ACTIVITY: DashboardSummary['recentActivity'] = [
  { id: 'act_01', type: 'invoice_funded',      description: 'INV-2024-0847 funded to Kampala Traders Ltd',       amount: 850 * M,  timestamp: minutesAgo(8),   invoiceId: 'inv_847'  },
  { id: 'act_02', type: 'collection_received', description: 'Collection received for INV-2024-0821',              amount: 1.2 * B,  timestamp: minutesAgo(22),  invoiceId: 'inv_821'  },
  { id: 'act_03', type: 'approval_completed',  description: 'INV-2024-0851 approved — second auth granted',       amount: 620 * M,  timestamp: minutesAgo(45),  invoiceId: 'inv_851'  },
  { id: 'act_04', type: 'escalation_raised',   description: 'INV-2024-0798 escalated to Formal notice',           amount: 340 * M,  timestamp: minutesAgo(90),  invoiceId: 'inv_798'  },
  { id: 'act_05', type: 'invoice_submitted',   description: 'New invoice submitted by Nile Agro Suppliers',       amount: 2.1 * B,  timestamp: minutesAgo(120), invoiceId: 'inv_852'  },
  { id: 'act_06', type: 'payment_made',        description: 'Disbursement processed via MTN MoMo for INV-2024-0845', amount: 760 * M, timestamp: minutesAgo(150), invoiceId: 'inv_845' },
  { id: 'act_07', type: 'invoice_overdue',     description: 'INV-2024-0801 is now 3 days overdue',                amount: 510 * M,  timestamp: minutesAgo(200), invoiceId: 'inv_801'  },
  { id: 'act_08', type: 'invoice_funded',      description: 'INV-2024-0843 funded to Entebbe Logistics',          amount: 1.45 * B, timestamp: minutesAgo(260), invoiceId: 'inv_843'  },
  { id: 'act_09', type: 'facility_drawdown',   description: 'UGX 5B drawdown from Equity Bank credit line',       amount: 5 * B,    timestamp: minutesAgo(320)                         },
  { id: 'act_10', type: 'collection_received', description: 'Collection received for INV-2024-0809',              amount: 880 * M,  timestamp: minutesAgo(400), invoiceId: 'inv_809'  },
];

// ── Payment history data ──────────────────────────────────────────────────────

const PAYMENT_HISTORY: PaymentHistoryItem[] = [
  { id: 'pay_01', invoiceId: 'inv_847', invoiceRef: 'INV-2024-0847', supplierName: 'Kampala Traders Ltd',    buyerName: 'Nile Breweries',       amount: 850  * M, method: 'mtn_momo',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(8)   },
  { id: 'pay_02', invoiceId: 'inv_821', invoiceRef: 'INV-2024-0821', supplierName: 'Entebbe Logistics',      buyerName: 'MTN Uganda',           amount: 1.2  * B, method: 'eft_rtgs',    status: 'funded',             direction: 'collection',   paidAt: minutesAgo(22)  },
  { id: 'pay_03', invoiceId: 'inv_845', invoiceRef: 'INV-2024-0845', supplierName: 'Jinja Farm Supplies',   buyerName: 'Roofings Group',       amount: 760  * M, method: 'mtn_momo',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(150) },
  { id: 'pay_04', invoiceId: 'inv_809', invoiceRef: 'INV-2024-0809', supplierName: 'Mbarara Agri Ltd',      buyerName: 'Airtel Uganda',        amount: 880  * M, method: 'airtel_money', status: 'funded',             direction: 'collection',   paidAt: minutesAgo(400) },
  { id: 'pay_05', invoiceId: 'inv_843', invoiceRef: 'INV-2024-0843', supplierName: 'Entebbe Logistics',     buyerName: 'Stanbic Bank Uganda',  amount: 1.45 * B, method: 'eft_rtgs',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(260) },
  { id: 'pay_06', invoiceId: 'inv_835', invoiceRef: 'INV-2024-0835', supplierName: 'Gulu Distributors',     buyerName: 'Uganda Telecom',       amount: 520  * M, method: 'airtel_money', status: 'funded',             direction: 'collection',   paidAt: minutesAgo(520) },
  { id: 'pay_07', invoiceId: 'inv_830', invoiceRef: 'INV-2024-0830', supplierName: 'Kisumu Traders Ltd',    buyerName: 'Nile Breweries',       amount: 2.1  * B, method: 'eft_rtgs',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(600) },
  { id: 'pay_08', invoiceId: 'inv_822', invoiceRef: 'INV-2024-0822', supplierName: 'Fort Portal Supplies',  buyerName: 'Roofings Group',       amount: 670  * M, method: 'mtn_momo',    status: 'failed',             direction: 'disbursement', paidAt: minutesAgo(720) },
  { id: 'pay_09', invoiceId: 'inv_818', invoiceRef: 'INV-2024-0818', supplierName: 'Masaka Grain Co.',      buyerName: 'UMEME Ltd',            amount: 3.4  * B, method: 'eft_rtgs',    status: 'funded',             direction: 'collection',   paidAt: minutesAgo(900) },
  { id: 'pay_10', invoiceId: 'inv_815', invoiceRef: 'INV-2024-0815', supplierName: 'Soroti Fresh Foods',    buyerName: 'MTN Uganda',           amount: 490  * M, method: 'mtn_momo',    status: 'pending_first_auth', direction: 'disbursement', paidAt: minutesAgo(1000) },
  { id: 'pay_11', invoiceId: 'inv_810', invoiceRef: 'INV-2024-0810', supplierName: 'Lira Auto Parts',       buyerName: 'Stanbic Bank Uganda',  amount: 1.8  * B, method: 'eft_rtgs',    status: 'funded',             direction: 'collection',   paidAt: minutesAgo(1200) },
  { id: 'pay_12', invoiceId: 'inv_805', invoiceRef: 'INV-2024-0805', supplierName: 'Mbale Cement Ltd',      buyerName: 'Uganda Breweries',     amount: 2.95 * B, method: 'eft_rtgs',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(1440) },
  { id: 'pay_13', invoiceId: 'inv_800', invoiceRef: 'INV-2024-0800', supplierName: 'Arua Textiles',         buyerName: 'Airtel Uganda',        amount: 350  * M, method: 'airtel_money', status: 'funded',             direction: 'collection',   paidAt: minutesAgo(1600) },
  { id: 'pay_14', invoiceId: 'inv_795', invoiceRef: 'INV-2024-0795', supplierName: 'Kabale Farm Exports',   buyerName: 'UMEME Ltd',            amount: 4.2  * B, method: 'eft_rtgs',    status: 'funded',             direction: 'disbursement', paidAt: minutesAgo(2000) },
  { id: 'pay_15', invoiceId: 'inv_790', invoiceRef: 'INV-2024-0790', supplierName: 'Kampala Traders Ltd',  buyerName: 'Nile Breweries',       amount: 730  * M, method: 'mtn_momo',    status: 'funded',             direction: 'collection',   paidAt: minutesAgo(2400) },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const dashboardHandlers = [

  // GET /api/dashboard/summary?period=
  http.get('/api/dashboard/summary', async ({ request }) => {
    await delay(350);

    const url    = new URL(request.url);
    const period = (url.searchParams.get('period') ?? '30d') as Period;

    if (!['7d', '30d', '90d', '12m', 'all'].includes(period)) {
      return HttpResponse.json({ message: 'Invalid period parameter.' }, { status: 400 });
    }

    const body: DashboardSummary = {
      period,
      cachedAt: new Date(Date.now() - 90_000).toISOString(), // cached 90 s ago
      stats:    PERIOD_STATS[period],
      trends:   PERIOD_TRENDS[period],
      invoiceStatusBreakdown: buildStatusBreakdown(period),
      paymentMethodBreakdown: [
        { method: 'mtn_momo',    label: 'MTN MoMo',     count: Math.round(58 * PERIOD_STATS[period].totalInvoices / 183), amount: Math.round(PERIOD_STATS[period].totalFunded * 0.51) },
        { method: 'airtel_money',label: 'Airtel Money',  count: Math.round(31 * PERIOD_STATS[period].totalInvoices / 183), amount: Math.round(PERIOD_STATS[period].totalFunded * 0.27) },
        { method: 'eft_rtgs',    label: 'EFT / RTGS',   count: Math.round(94 * PERIOD_STATS[period].totalInvoices / 183), amount: Math.round(PERIOD_STATS[period].totalFunded * 0.22) },
      ],
      trendData:           buildTrendData(period),
      escalationOverview:  { none: 127, reminder: 14, formal: 6, legal: 2 },
      recentActivity:      RECENT_ACTIVITY,
    };

    return HttpResponse.json({ data: body });
  }),

  // GET /api/dashboard/payments
  http.get('/api/dashboard/payments', async ({ request }) => {
    await delay(280);

    const url       = new URL(request.url);
    const status    = url.searchParams.get('status');
    const method    = url.searchParams.get('method');
    const direction = url.searchParams.get('direction');
    const page      = parseInt(url.searchParams.get('page')  ?? '1', 10);
    const limit     = parseInt(url.searchParams.get('limit') ?? '20', 10);

    let items = [...PAYMENT_HISTORY];

    if (status)    items = items.filter((p) => p.status    === status);
    if (method)    items = items.filter((p) => p.method    === method);
    if (direction) items = items.filter((p) => p.direction === direction);

    const total  = items.length;
    const offset = (page - 1) * limit;
    const paged  = items.slice(offset, offset + limit);

    return HttpResponse.json({
      data: {
        items: paged,
        total,
        page,
        limit,
      } satisfies PaymentHistoryResponse,
    });
  }),
];
