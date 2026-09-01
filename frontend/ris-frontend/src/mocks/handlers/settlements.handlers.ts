import { http, HttpResponse, delay, passthrough } from 'msw';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Settlement {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  buyerName: string;
  faceValue: string;
  collectedAmount: string;
  advanceAmount: string;
  discountEarned: string;
  penaltyIncome: string;
  facilityRepayment: string;
  netProfit: string;
  status: 'pending' | 'facility_repaid' | 'profit_booked' | 'closed';
  collectedAt: string;
  settledAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Seed data                                                          */
/* ------------------------------------------------------------------ */

const SEED_SETTLEMENTS: Settlement[] = [
  {
    id: 'stl_001',
    invoiceId: 'inv_101',
    invoiceNumber: 'INV-2024-098',
    supplierName: 'Mbarara Dairy Co.',
    buyerName: 'Roofings Ltd',
    faceValue: '61500000',
    collectedAmount: '61500000',
    advanceAmount: '58425000',
    discountEarned: '3075000',
    penaltyIncome: '0',
    facilityRepayment: '1200000',
    netProfit: '1875000',
    status: 'closed',
    collectedAt: '2026-01-15T14:00:00Z',
    settledAt: '2026-01-18T10:00:00Z',
    createdAt: '2026-01-15T14:30:00Z',
  },
  {
    id: 'stl_002',
    invoiceId: 'inv_102',
    invoiceNumber: 'INV-2024-085',
    supplierName: 'Entebbe Cold Storage',
    buyerName: 'Airtel Uganda',
    faceValue: '89000000',
    collectedAmount: '89000000',
    advanceAmount: '84550000',
    discountEarned: '4450000',
    penaltyIncome: '0',
    facilityRepayment: '1750000',
    netProfit: '2700000',
    status: 'closed',
    collectedAt: '2026-02-10T09:00:00Z',
    settledAt: '2026-02-13T11:00:00Z',
    createdAt: '2026-02-10T09:30:00Z',
  },
  {
    id: 'stl_003',
    invoiceId: 'inv_103',
    invoiceNumber: 'INV-2025-042',
    supplierName: 'Kampala Traders Ltd',
    buyerName: 'MTN Uganda Ltd',
    faceValue: '120000000',
    collectedAmount: '120000000',
    advanceAmount: '114000000',
    discountEarned: '6000000',
    penaltyIncome: '0',
    facilityRepayment: '2350000',
    netProfit: '3650000',
    status: 'profit_booked',
    collectedAt: '2026-03-05T16:00:00Z',
    settledAt: null,
    createdAt: '2026-03-05T16:30:00Z',
  },
  {
    id: 'stl_004',
    invoiceId: 'inv_104',
    invoiceNumber: 'INV-2025-055',
    supplierName: 'Nile Agro Exports',
    buyerName: 'Centenary Bank',
    faceValue: '200000000',
    collectedAmount: '200000000',
    advanceAmount: '190000000',
    discountEarned: '10000000',
    penaltyIncome: '0',
    facilityRepayment: '3900000',
    netProfit: '0',
    status: 'facility_repaid',
    collectedAt: '2026-03-18T13:00:00Z',
    settledAt: null,
    createdAt: '2026-03-18T13:30:00Z',
  },
  {
    id: 'stl_005',
    invoiceId: 'inv_105',
    invoiceNumber: 'INV-2025-061',
    supplierName: 'Buganda Road Supplies',
    buyerName: 'Uganda Telecom',
    faceValue: '32750000',
    collectedAmount: '32750000',
    advanceAmount: '31112500',
    discountEarned: '1637500',
    penaltyIncome: '0',
    facilityRepayment: '640000',
    netProfit: '0',
    status: 'pending',
    collectedAt: '2026-03-25T10:00:00Z',
    settledAt: null,
    createdAt: '2026-03-25T10:30:00Z',
  },
  {
    id: 'stl_006',
    invoiceId: 'inv_106',
    invoiceNumber: 'INV-2025-078',
    supplierName: 'Jinja Industrial Supplies',
    buyerName: 'Kakira Sugar Works',
    faceValue: '43200000',
    collectedAmount: '45360000',
    advanceAmount: '41040000',
    discountEarned: '2160000',
    penaltyIncome: '2160000',
    facilityRepayment: '845000',
    netProfit: '3475000',
    status: 'closed',
    collectedAt: '2026-02-28T15:00:00Z',
    settledAt: '2026-03-03T09:00:00Z',
    createdAt: '2026-02-28T15:30:00Z',
  },
];

/* ------------------------------------------------------------------ */
/*  Runtime state                                                      */
/* ------------------------------------------------------------------ */

const runtimeSettlements = SEED_SETTLEMENTS.map((s) => ({ ...s }));

/** Add a settlement from outside (e.g. when a collection is fully paid). */
export function addSettlement(s: Settlement): void {
  if (!runtimeSettlements.some((x) => x.id === s.id)) {
    runtimeSettlements.push(s);
  }
}

/** Read-only view of the runtime store — used by reporting to compute live P&L. */
export function getSettlements(): readonly Settlement[] {
  return runtimeSettlements;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildSummary(settlements: Settlement[]) {
  let totalNetProfit = 0;
  let totalFacilityRepaid = 0;
  let pendingCount = 0;

  for (const s of settlements) {
    if (s.status === 'profit_booked' || s.status === 'closed') {
      totalNetProfit += Number(s.netProfit);
    }
    if (s.status !== 'pending') {
      totalFacilityRepaid += Number(s.facilityRepayment);
    }
    if (s.status === 'pending') pendingCount++;
  }

  return {
    totalSettlements: settlements.length,
    totalNetProfit: String(totalNetProfit),
    totalFacilityRepaid: String(totalFacilityRepaid),
    pendingCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */

export const settlementsHandlers = [
  /** GET /api/settlements — serve mock data (passthrough causes 401 logout when JWT is mock-issued) */
  http.get('/api/settlements', async ({ request }) => {
    await delay(250);
    const url    = new URL(request.url);
    const status = url.searchParams.get('status') as Settlement['status'] | null;
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const page      = Math.max(1, parseInt(url.searchParams.get('page')      ?? '1',  10));
    const page_size = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    let filtered = [...runtimeSettlements];
    if (status) filtered = filtered.filter((s) => s.status === status);
    if (search) filtered = filtered.filter(
      (s) => s.invoiceNumber.toLowerCase().includes(search) ||
             s.supplierName.toLowerCase().includes(search) ||
             s.buyerName.toLowerCase().includes(search),
    );

    const total = filtered.length;
    const start = (page - 1) * page_size;
    return HttpResponse.json({
      data:       filtered.slice(start, start + page_size),
      total,
      page,
      pageSize:   page_size,
      totalPages: Math.ceil(total / page_size),
      summary:    buildSummary(runtimeSettlements),
    });
  }),

  /** GET /api/settlements/:id — real backend for real IDs, mock for seed IDs */
  http.get('/api/settlements/:id', async ({ params }) => {
    const settlement = runtimeSettlements.find((s) => s.id === params.id);
    if (!settlement) return passthrough();
    await delay(200);
    return HttpResponse.json({ data: settlement });
  }),

  /** POST /api/settlements/:id/repay-facility */
  http.post('/api/settlements/:id/repay-facility', async ({ request, params }) => {
    const s = runtimeSettlements.find((x) => x.id === params.id);
    if (!s) return passthrough();
    await delay(400);
    if (s.status !== 'pending') {
      return HttpResponse.json({ message: 'Settlement is not in pending status' }, { status: 409 });
    }
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.facility_repayment_amount !== undefined) {
        s.facilityRepayment = String(body.facility_repayment_amount);
      }
    } catch { /* body may be empty or unreadable — keep existing values */ }
    s.status = 'facility_repaid';
    return HttpResponse.json({ data: s });
  }),

  /** POST /api/settlements/:id/book-profit */
  http.post('/api/settlements/:id/book-profit', async ({ request, params }) => {
    const s = runtimeSettlements.find((x) => x.id === params.id);
    if (!s) return passthrough();
    await delay(400);
    if (s.status !== 'facility_repaid') {
      return HttpResponse.json({ message: 'Facility must be repaid first' }, { status: 409 });
    }
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.discount_earned !== undefined) {
        s.discountEarned = String(body.discount_earned);
      }
      if (body.bank_cost_paid !== undefined) {
        s.facilityRepayment = String(body.bank_cost_paid);
      }
    } catch { /* body may be empty or unreadable — keep existing values */ }
    s.status = 'profit_booked';
    s.netProfit = String(
      Number(s.discountEarned) - Number(s.facilityRepayment) + Number(s.penaltyIncome),
    );
    return HttpResponse.json({ data: s });
  }),

  /** POST /api/settlements/:id/close */
  http.post('/api/settlements/:id/close', async ({ params }) => {
    const s = runtimeSettlements.find((x) => x.id === params.id);
    if (!s) return passthrough();
    await delay(400);
    if (s.status !== 'profit_booked') {
      return HttpResponse.json({ message: 'Profit must be booked first' }, { status: 409 });
    }
    s.status = 'closed';
    s.settledAt = new Date().toISOString();
    return HttpResponse.json({ data: s });
  }),
];
