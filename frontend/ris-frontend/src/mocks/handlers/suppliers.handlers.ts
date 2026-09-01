import { http, HttpResponse, delay } from 'msw';
import type {
  Supplier,
  SupplierDetail,
  SupplierDetailResponse,
  SupplierBuyer,
  SupplierPaymentItem,
  SupplierPaymentMethodBreakdown,
  SupplierInvoiceStatusBreakdown,
  SupplierActiveCollection,
  PaginatedSuppliers,
  PaginatedSupplierPayments,
  BuyerStatus,
} from '../../types/supplier.types';

// ── Seed data ─────────────────────────────────────────────────────────────────

const SUPPLIERS: SupplierDetail[] = [
  {
    id: 'sup_001',
    name: 'Sarah Namukasa',
    company: 'Nakawa Steel Ltd',
    contactEmail: 'sarah.n@nakawasteel.co.ug',
    contactPhone: '+256 772 100 001',
    registrationDate: '2022-03-15',
    status: 'active',
    riskBand: 'low',
    totalInvoices: 24,
    totalOutstandingUgx: 45_000_000,
    metrics: { totalInvoices: 24, collectionRate: 96, avgDaysToPayment: 38 },
  },
  {
    id: 'sup_002',
    name: 'Robert Ssali Jr',
    company: 'Kampala Medical Supplies',
    contactEmail: 'robert@kms.co.ug',
    contactPhone: '+256 701 200 002',
    registrationDate: '2021-07-22',
    status: 'active',
    riskBand: 'medium',
    totalInvoices: 18,
    totalOutstandingUgx: 120_500_000,
    metrics: { totalInvoices: 18, collectionRate: 82, avgDaysToPayment: 52 },
  },
  {
    id: 'sup_003',
    name: 'Agnes Nakimuli',
    company: 'Entebbe Printing House',
    contactEmail: 'agnes@entebbeprint.co.ug',
    contactPhone: '+256 782 300 003',
    registrationDate: '2020-11-05',
    status: 'active',
    riskBand: 'high',
    totalInvoices: 12,
    totalOutstandingUgx: 280_000_000,
    metrics: { totalInvoices: 12, collectionRate: 64, avgDaysToPayment: 71 },
  },
  {
    id: 'sup_004',
    name: 'Patrick Okello',
    company: 'Mbarara Agriculture Ltd',
    contactEmail: 'patrick@mbaragraag.co.ug',
    contactPhone: '+256 756 400 004',
    registrationDate: '2023-01-10',
    status: 'inactive',
    riskBand: 'low',
    totalInvoices: 8,
    totalOutstandingUgx: 0,
    metrics: { totalInvoices: 8, collectionRate: 100, avgDaysToPayment: 29 },
  },
  {
    id: 'sup_005',
    name: 'James Mugisha',
    company: 'Gulu Tech Solutions',
    contactEmail: 'james@gulutech.co.ug',
    contactPhone: '+256 714 500 005',
    registrationDate: '2021-04-18',
    status: 'suspended',
    riskBand: 'critical',
    totalInvoices: 5,
    totalOutstandingUgx: 350_000_000,
    metrics: { totalInvoices: 5, collectionRate: 20, avgDaysToPayment: 120 },
  },
];

// ── Buyers seed ───────────────────────────────────────────────────────────────

const ALL_BUYERS: SupplierBuyer[] = [
  { id: 'buyer_201', company: 'Stanbic Bank Uganda',          contactEmail: 'payables@stanbic.co.ug',          contactPhone: '+256 312 224 600', status: 'active',   totalInvoices: 9,  outstandingUgx: 18_000_000 },
  { id: 'buyer_202', company: 'MTN Uganda Ltd',               contactEmail: 'finance@mtn.co.ug',               contactPhone: '+256 312 111 500', status: 'active',   totalInvoices: 7,  outstandingUgx: 27_500_000 },
  { id: 'buyer_203', company: 'Uganda Breweries Ltd',         contactEmail: 'accounts@ubl.co.ug',              contactPhone: '+256 414 321 001', status: 'active',   totalInvoices: 6,  outstandingUgx: 0          },
  { id: 'buyer_204', company: 'Airtel Uganda',                contactEmail: 'payables@airtel.co.ug',           contactPhone: '+256 312 200 100', status: 'active',   totalInvoices: 5,  outstandingUgx: 95_000_000 },
  { id: 'buyer_205', company: 'Dfcu Bank',                    contactEmail: 'operations@dfcu.co.ug',           contactPhone: '+256 414 234 700', status: 'inactive', totalInvoices: 3,  outstandingUgx: 25_500_000 },
  { id: 'buyer_206', company: 'Nile Breweries Ltd',           contactEmail: 'finance@nilebreweries.co.ug',     contactPhone: '+256 434 123 456', status: 'active',   totalInvoices: 4,  outstandingUgx: 0          },
  { id: 'buyer_207', company: 'Uganda Telecom Ltd',           contactEmail: 'payables@utl.co.ug',              contactPhone: '+256 417 700 100', status: 'active',   totalInvoices: 5,  outstandingUgx: 185_000_000 },
  { id: 'buyer_208', company: 'Roofings Uganda Ltd',          contactEmail: 'accounts@roofings.co.ug',         contactPhone: '+256 414 567 890', status: 'active',   totalInvoices: 3,  outstandingUgx: 0           },
  { id: 'buyer_209', company: 'Umeme Ltd',                    contactEmail: 'finance@umeme.co.ug',             contactPhone: '+256 312 333 888', status: 'inactive', totalInvoices: 2,  outstandingUgx: 0           },
  { id: 'buyer_210', company: 'National Water Corporation',   contactEmail: 'payables@nwsc.co.ug',             contactPhone: '+256 414 315 600', status: 'active',   totalInvoices: 2,  outstandingUgx: 165_000_000 },
];

// Buyer IDs associated with each supplier
const SUPPLIER_BUYER_IDS: Record<string, string[]> = {
  sup_001: ['buyer_201', 'buyer_202', 'buyer_203', 'buyer_208'],
  sup_002: ['buyer_204', 'buyer_205', 'buyer_206'],
  sup_003: ['buyer_207', 'buyer_210'],
  sup_004: ['buyer_203', 'buyer_209'],
  sup_005: ['buyer_204', 'buyer_207'],
};

// ── Payment seed ──────────────────────────────────────────────────────────────

function makePayments(supplierId: string): SupplierPaymentItem[] {
  const buyerNames: Record<string, string> = {
    sup_001: 'Stanbic Bank Uganda',
    sup_002: 'Airtel Uganda',
    sup_003: 'Uganda Telecom Ltd',
    sup_004: 'Uganda Breweries Ltd',
    sup_005: 'Airtel Uganda',
  };
  const buyer = buyerNames[supplierId] ?? 'Unknown Buyer';
  const methods = [
    { method: 'mtn_momo',     label: 'MTN Mobile Money' },
    { method: 'airtel_money', label: 'Airtel Money' },
    { method: 'bank_transfer', label: 'Bank Transfer' },
  ];

  return Array.from({ length: 12 }, (_, i) => {
    const m = methods[i % 3];
    const daysAgo = (i + 1) * 12;
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    return {
      id:            `pay_${supplierId}_${String(i + 1).padStart(3, '0')}`,
      invoiceId:     `inv_${supplierId}_${String(i + 1).padStart(3, '0')}`,
      invoiceNumber: `INV-${supplierId.toUpperCase()}-${String(1000 + i)}`,
      buyerName:     buyer,
      amount:        5_000_000 + i * 3_500_000,
      method:        m.method,
      methodLabel:   m.label,
      paymentDate:   d.toISOString().slice(0, 10),
      status:        i === 2 ? 'failed' : 'completed',
    } as SupplierPaymentItem;
  });
}

const PAYMENTS: Record<string, SupplierPaymentItem[]> = {
  sup_001: makePayments('sup_001'),
  sup_002: makePayments('sup_002'),
  sup_003: makePayments('sup_003'),
  sup_004: makePayments('sup_004'),
  sup_005: makePayments('sup_005'),
};

// ── Invoice status breakdown ──────────────────────────────────────────────────

const STATUS_BREAKDOWN: Record<string, SupplierInvoiceStatusBreakdown[]> = {
  sup_001: [
    { status: 'funded',     count: 8,  amount: 180_000_000 },
    { status: 'collecting', count: 6,  amount: 120_000_000 },
    { status: 'collected',  count: 7,  amount: 145_000_000 },
    { status: 'approved',   count: 3,  amount: 65_000_000  },
  ],
  sup_002: [
    { status: 'funded',     count: 4,  amount: 95_000_000  },
    { status: 'collecting', count: 5,  amount: 110_000_000 },
    { status: 'overdue',    count: 3,  amount: 72_000_000  },
    { status: 'collected',  count: 6,  amount: 130_000_000 },
  ],
  sup_003: [
    { status: 'funded',     count: 2,  amount: 55_000_000  },
    { status: 'overdue',    count: 4,  amount: 180_000_000 },
    { status: 'collected',  count: 3,  amount: 68_000_000  },
    { status: 'defaulted',  count: 3,  amount: 100_000_000 },
  ],
  sup_004: [
    { status: 'collected',  count: 7,  amount: 85_000_000  },
    { status: 'collecting', count: 1,  amount: 12_000_000  },
  ],
  sup_005: [
    { status: 'overdue',    count: 3,  amount: 280_000_000 },
    { status: 'defaulted',  count: 2,  amount: 70_000_000  },
  ],
};

// ── Active collections ────────────────────────────────────────────────────────

const ACTIVE_COLLECTIONS: Record<string, SupplierActiveCollection[]> = {
  sup_001: [
    { id: 'col_s1_1', invoiceId: 'inv_s1_1', invoiceNumber: 'INV-SUP001-1001', buyerName: 'Stanbic Bank Uganda',    outstandingUgx: 18_000_000, escalationLevel: 'none',     daysOverdue: 0,  dueDate: '2026-04-15' },
    { id: 'col_s1_2', invoiceId: 'inv_s1_2', invoiceNumber: 'INV-SUP001-1002', buyerName: 'MTN Uganda Ltd',          outstandingUgx: 27_500_000, escalationLevel: 'none',     daysOverdue: 0,  dueDate: '2026-04-22' },
  ],
  sup_002: [
    { id: 'col_s2_1', invoiceId: 'inv_s2_1', invoiceNumber: 'INV-SUP002-2001', buyerName: 'Airtel Uganda',           outstandingUgx: 45_000_000, escalationLevel: 'reminder', daysOverdue: 14, dueDate: '2026-03-10' },
    { id: 'col_s2_2', invoiceId: 'inv_s2_2', invoiceNumber: 'INV-SUP002-2002', buyerName: 'Dfcu Bank',               outstandingUgx: 25_500_000, escalationLevel: 'reminder', daysOverdue: 8,  dueDate: '2026-03-17' },
    { id: 'col_s2_3', invoiceId: 'inv_s2_3', invoiceNumber: 'INV-SUP002-2003', buyerName: 'Nile Breweries Ltd',      outstandingUgx: 50_000_000, escalationLevel: 'none',     daysOverdue: 0,  dueDate: '2026-04-05' },
  ],
  sup_003: [
    { id: 'col_s3_1', invoiceId: 'inv_s3_1', invoiceNumber: 'INV-SUP003-3001', buyerName: 'Uganda Telecom Ltd',      outstandingUgx: 95_000_000, escalationLevel: 'formal',   daysOverdue: 38, dueDate: '2026-02-15' },
    { id: 'col_s3_2', invoiceId: 'inv_s3_2', invoiceNumber: 'INV-SUP003-3002', buyerName: 'National Water Corp',     outstandingUgx: 85_000_000, escalationLevel: 'legal',    daysOverdue: 62, dueDate: '2026-01-22' },
    { id: 'col_s3_3', invoiceId: 'inv_s3_3', invoiceNumber: 'INV-SUP003-3003', buyerName: 'Uganda Telecom Ltd',      outstandingUgx: 100_000_000, escalationLevel: 'reminder', daysOverdue: 18, dueDate: '2026-03-05' },
  ],
  sup_004: [],
  sup_005: [
    { id: 'col_s5_1', invoiceId: 'inv_s5_1', invoiceNumber: 'INV-SUP005-5001', buyerName: 'Airtel Uganda',           outstandingUgx: 185_000_000, escalationLevel: 'legal',   daysOverdue: 91, dueDate: '2025-12-25' },
    { id: 'col_s5_2', invoiceId: 'inv_s5_2', invoiceNumber: 'INV-SUP005-5002', buyerName: 'Uganda Telecom Ltd',      outstandingUgx: 165_000_000, escalationLevel: 'legal',   daysOverdue: 55, dueDate: '2026-01-29' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeMethodBreakdown(payments: SupplierPaymentItem[]): SupplierPaymentMethodBreakdown[] {
  const map = new Map<string, { label: string; count: number; amount: number }>();

  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const existing = map.get(p.method);
    if (existing) {
      existing.count  += 1;
      existing.amount += p.amount;
    } else {
      map.set(p.method, { label: p.methodLabel, count: 1, amount: p.amount });
    }
  }

  return Array.from(map.entries()).map(([method, v]) => ({ method, ...v }));
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    data:       items.slice(start, start + pageSize),
    total:      items.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const suppliersHandlers = [

  // GET /suppliers — paginated list with search + status filter
  http.get('/api/suppliers', async ({ request }) => {
    await delay(200);
    const url      = new URL(request.url);
    const search   = url.searchParams.get('search')?.toLowerCase() ?? '';
    const statuses = url.searchParams.get('status')?.split(',') ?? [];
    const page     = Math.max(1, parseInt(url.searchParams.get('page')     ?? '1',  10));
    const pageSize = Math.min(50, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    let filtered: Supplier[] = SUPPLIERS;

    if (search) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(search)    ||
          s.company.toLowerCase().includes(search) ||
          s.contactEmail.toLowerCase().includes(search),
      );
    }

    if (statuses.length) {
      filtered = filtered.filter((s) => statuses.includes(s.status));
    }

    const result: PaginatedSuppliers = paginate(filtered, page, pageSize);
    return HttpResponse.json(result);
  }),

  // GET /suppliers/:id — full detail
  http.get('/api/suppliers/:id', async ({ params }) => {
    await delay(250);
    const supplier = SUPPLIERS.find((s) => s.id === params.id);
    if (!supplier) return new HttpResponse(null, { status: 404 });

    const response: SupplierDetailResponse = {
      supplier,
      invoiceStatusBreakdown: STATUS_BREAKDOWN[supplier.id] ?? [],
      activeCollections:      ACTIVE_COLLECTIONS[supplier.id] ?? [],
    };

    return HttpResponse.json(response);
  }),

  // GET /suppliers/:id/buyers — paginated buyers sub-list
  http.get('/api/suppliers/:id/buyers', async ({ params, request }) => {
    await delay(180);
    const url      = new URL(request.url);
    const search   = url.searchParams.get('search')?.toLowerCase() ?? '';
    const status   = url.searchParams.get('status') as BuyerStatus | null;
    const page     = Math.max(1, parseInt(url.searchParams.get('page')      ?? '1',  10));
    const pageSize = Math.min(50, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    const ids     = SUPPLIER_BUYER_IDS[params.id as string] ?? [];
    let buyers = ALL_BUYERS.filter((b) => ids.includes(b.id));

    if (search) {
      buyers = buyers.filter(
        (b) =>
          b.company.toLowerCase().includes(search) ||
          b.contactEmail.toLowerCase().includes(search),
      );
    }

    if (status) {
      buyers = buyers.filter((b) => b.status === status);
    }

    return HttpResponse.json(paginate(buyers, page, pageSize));
  }),

  // GET /suppliers/:id/payments — paginated payment history + method breakdown
  http.get('/api/suppliers/:id/payments', async ({ params, request }) => {
    await delay(220);
    const url      = new URL(request.url);
    const method   = url.searchParams.get('method') ?? '';
    const from     = url.searchParams.get('from')   ?? '';
    const to       = url.searchParams.get('to')     ?? '';
    const page     = Math.max(1, parseInt(url.searchParams.get('page')      ?? '1',  10));
    const pageSize = Math.min(50, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    let payments = PAYMENTS[params.id as string] ?? [];

    if (method) payments = payments.filter((p) => p.method === method);
    if (from)   payments = payments.filter((p) => p.paymentDate >= from);
    if (to)     payments = payments.filter((p) => p.paymentDate <= to);

    const paged  = paginate(payments, page, pageSize);
    const result: PaginatedSupplierPayments = {
      ...paged,
      // Breakdown computed over ALL matching payments (ignoring pagination)
      methodBreakdown: computeMethodBreakdown(payments),
    };

    return HttpResponse.json(result);
  }),
];
