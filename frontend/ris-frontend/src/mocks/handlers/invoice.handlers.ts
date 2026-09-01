import { http, HttpResponse, delay, passthrough } from 'msw';
import type {
  Invoice,
  StatusTransition,
  ApprovalDecision,
  RiskBreakdown,
  InvoiceDocument,
  BuyerInfo,
  SupplierInfo,
} from '../../types/invoice.types';
import type { InvoiceStatus, RiskLevel } from '../../lib/constants';
import { COLLATERAL_STORE, type CollateralMockItem } from './collateral.handlers';
import { addToApprovalQueue } from './approvals.handlers';
import { addRuntimeCollection } from './collections.handlers';
import { USERS } from './auth.handlers';
import { PRICING_DATA } from './pricing.handlers';
import type { PricingBreakdown } from '../../features/pricing/api/pricing.api';
// UploadDocumentResponse will be defined when invoices.api is created in Phase 4
interface UploadDocumentResponse {
  id: string;
  name: string;
  doc_type: string;
  uploaded_at: string;
  size_bytes: number;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

/**
 * Mock-only extension of Invoice that carries the workflow comment fields the
 * MSW handlers record on transitions (reject/dual-auth/execute). These are not
 * part of the camelCase API contract — they exist solely to drive the mock
 * timeline. Already camelCase, so the deepCamelCase interceptor is a no-op.
 */
interface MockInvoice extends Invoice {
  rejectComment?:    string | null;
  dualAuthComment1?: string | null;
  dualAuthComment2?: string | null;
  executeComment?:   string | null;
}

export const MOCK_INVOICES: MockInvoice[] = [
  {
    id: 'inv_001',
    invoiceNumber: 'INV-2025-001',
    supplierId: 'usr_002',
    supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_101',
    buyerName: 'Stanbic Bank Uganda',
    faceValue:      45_000_000,
    advanceAmount:  40_500_000,
    discountAmount:  4_500_000,
    advancePercentage: 90,
    discountRate: 3.2,
    tenor: 45,
    status: 'funded' as InvoiceStatus,
    riskScore: 72,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-02-10T00:00:00Z',
    dueDate:     '2025-03-27T00:00:00Z',
    fundedAt:    '2025-02-12T09:15:00Z',
    collectedAt: null,
    createdAt: '2025-02-10T07:30:00Z',
    updatedAt: '2025-02-12T09:15:00Z',
  },
  {
    id: 'inv_002',
    invoiceNumber: 'INV-2025-002',
    supplierId: 'usr_002',
    supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_102',
    buyerName: 'MTN Uganda Ltd',
    faceValue:     120_000_000,
    advanceAmount: 108_000_000,
    discountAmount: 12_000_000,
    advancePercentage: 90,
    discountRate: 2.8,
    tenor: 60,
    status: 'collecting' as InvoiceStatus,
    riskScore: 65,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-01-20T00:00:00Z',
    dueDate:     '2025-03-21T00:00:00Z',
    fundedAt:    '2025-01-22T11:00:00Z',
    collectedAt: null,
    createdAt: '2025-01-20T08:00:00Z',
    updatedAt: '2025-01-22T11:00:00Z',
  },
  {
    id: 'inv_003',
    invoiceNumber: 'INV-2025-003',
    supplierId: 'sup_003',
    supplierName: 'Nile Agro Exports',
    buyerId: 'buyer_103',
    buyerName: 'Umeme Ltd',
    faceValue:      78_500_000,
    advanceAmount:  70_650_000,
    discountAmount:  7_850_000,
    advancePercentage: 90,
    discountRate: 3.5,
    tenor: 30,
    status: 'overdue' as InvoiceStatus,
    riskScore: 38,
    riskLevel: 'high' as RiskLevel,
    issueDate:   '2025-01-05T00:00:00Z',
    dueDate:     '2025-02-04T00:00:00Z',
    fundedAt:    '2025-01-07T14:20:00Z',
    collectedAt: null,
    createdAt: '2025-01-05T09:00:00Z',
    updatedAt: '2025-02-05T10:00:00Z',
  },
  {
    id: 'inv_004',
    invoiceNumber: 'INV-2025-004',
    supplierId: 'sup_004',
    supplierName: 'Pearl Foods Uganda',
    buyerId: 'buyer_104',
    buyerName: 'Centenary Bank',
    faceValue:     200_000_000,
    advanceAmount: 180_000_000,
    discountAmount: 20_000_000,
    advancePercentage: 90,
    discountRate: 2.5,
    tenor: 90,
    status: 'approved' as InvoiceStatus,
    riskScore: 81,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-03-01T00:00:00Z',
    dueDate:     '2025-05-29T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-01T10:30:00Z',
    updatedAt: '2025-03-03T14:00:00Z',
  },
  {
    id: 'inv_005',
    invoiceNumber: 'INV-2025-005',
    supplierId: 'sup_005',
    supplierName: 'Buganda Road Supplies',
    buyerId: 'buyer_105',
    buyerName: 'Uganda Telecom',
    faceValue:      32_750_000,
    advanceAmount:  29_475_000,
    discountAmount:  3_275_000,
    advancePercentage: 90,
    discountRate: 4.0,
    tenor: 21,
    status: 'submitted' as InvoiceStatus,
    riskScore: null,
    riskLevel: null,
    issueDate:   '2025-03-20T00:00:00Z',
    dueDate:     '2025-04-10T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-20T11:00:00Z',
    updatedAt: '2025-03-20T11:00:00Z',
  },
  {
    id: 'inv_006',
    invoiceNumber: 'INV-2025-006',
    supplierId: 'usr_002',
    supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_106',
    buyerName: 'DFCU Bank',
    faceValue:      55_000_000,
    advanceAmount:  49_500_000,
    discountAmount:  5_500_000,
    advancePercentage: 90,
    discountRate: 3.0,
    tenor: 45,
    status: 'draft' as InvoiceStatus,
    riskScore: null,
    riskLevel: null,
    issueDate:   '2025-03-24T00:00:00Z',
    dueDate:     '2025-05-08T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-24T08:45:00Z',
    updatedAt: '2025-03-24T08:45:00Z',
  },
  {
    id: 'inv_007',
    invoiceNumber: 'INV-2025-007',
    supplierId: 'sup_006',
    supplierName: 'Entebbe Cold Storage',
    buyerId: 'buyer_107',
    buyerName: 'Airtel Uganda',
    faceValue:      89_000_000,
    advanceAmount:  80_100_000,
    discountAmount:  8_900_000,
    advancePercentage: 90,
    discountRate: 3.1,
    tenor: 60,
    status: 'scored' as InvoiceStatus,
    riskScore: 58,
    riskLevel: 'medium' as RiskLevel,
    issueDate:   '2025-03-15T00:00:00Z',
    dueDate:     '2025-05-14T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-15T09:20:00Z',
    updatedAt: '2025-03-18T16:00:00Z',
  },
  {
    id: 'inv_008',
    invoiceNumber: 'INV-2025-008',
    supplierId: 'sup_007',
    supplierName: 'Masaka General Goods',
    buyerId: 'buyer_108',
    buyerName: 'Housing Finance Bank',
    faceValue:      15_000_000,
    advanceAmount:  13_500_000,
    discountAmount:  1_500_000,
    advancePercentage: 90,
    discountRate: 5.0,
    tenor: 14,
    status: 'rejected' as InvoiceStatus,
    riskScore: 28,
    riskLevel: 'critical' as RiskLevel,
    issueDate:   '2025-03-10T00:00:00Z',
    dueDate:     '2025-03-24T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-10T13:00:00Z',
    updatedAt: '2025-03-13T10:00:00Z',
  },
  {
    id: 'inv_009',
    invoiceNumber: 'INV-2025-009',
    supplierId: 'sup_008',
    supplierName: 'Fort Portal Farms',
    buyerId: 'buyer_109',
    buyerName: 'National Water & Sewerage',
    faceValue:     165_000_000,
    advanceAmount: 148_500_000,
    discountAmount: 16_500_000,
    advancePercentage: 90,
    discountRate: 2.7,
    tenor: 75,
    status: 'pending_first_auth' as InvoiceStatus,
    riskScore: 76,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-03-05T00:00:00Z',
    dueDate:     '2025-05-19T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-05T07:00:00Z',
    updatedAt: '2025-03-20T11:30:00Z',
  },
  {
    id: 'inv_010',
    invoiceNumber: 'INV-2025-010',
    supplierId: 'sup_009',
    supplierName: 'Jinja Industrial Supplies',
    buyerId: 'buyer_110',
    buyerName: 'Kakira Sugar Works',
    faceValue:      43_200_000,
    advanceAmount:  38_880_000,
    discountAmount:  4_320_000,
    advancePercentage: 90,
    discountRate: 3.6,
    tenor: 30,
    status: 'pending_second_auth' as InvoiceStatus,
    riskScore: 69,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-03-12T00:00:00Z',
    dueDate:     '2025-04-11T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-12T08:30:00Z',
    updatedAt: '2025-03-22T14:00:00Z',
  },
  {
    id: 'inv_011',
    invoiceNumber: 'INV-2025-011',
    supplierId: 'sup_010',
    supplierName: 'Gulu Trade Centre',
    buyerId: 'buyer_111',
    buyerName: 'Uganda Revenue Authority',
    faceValue:     310_000_000,
    advanceAmount: 279_000_000,
    discountAmount: 31_000_000,
    advancePercentage: 90,
    discountRate: 2.3,
    tenor: 90,
    status: 'executing' as InvoiceStatus,
    riskScore: 84,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-03-01T00:00:00Z',
    dueDate:     '2025-05-29T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-01T06:00:00Z',
    updatedAt: '2025-03-23T16:45:00Z',
  },
  {
    id: 'inv_012',
    invoiceNumber: 'INV-2024-098',
    supplierId: 'sup_011',
    supplierName: 'Mbarara Dairy Co.',
    buyerId: 'buyer_112',
    buyerName: 'Roofings Ltd',
    faceValue:      61_500_000,
    advanceAmount:  55_350_000,
    discountAmount:  6_150_000,
    advancePercentage: 90,
    discountRate: 3.3,
    tenor: 45,
    status: 'collected' as InvoiceStatus,
    riskScore: 77,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2024-12-01T00:00:00Z',
    dueDate:     '2025-01-15T00:00:00Z',
    fundedAt:    '2024-12-03T10:00:00Z',
    collectedAt: '2025-01-15T14:30:00Z',
    createdAt: '2024-12-01T09:00:00Z',
    updatedAt: '2025-01-15T14:30:00Z',
  },
  {
    id: 'inv_013',
    invoiceNumber: 'INV-2024-099',
    supplierId: 'sup_012',
    supplierName: 'Soroti Grains Ltd',
    buyerId: 'buyer_113',
    buyerName: 'Nile Breweries',
    faceValue:      28_800_000,
    advanceAmount:  25_920_000,
    discountAmount:  2_880_000,
    advancePercentage: 90,
    discountRate: 4.2,
    tenor: 21,
    status: 'defaulted' as InvoiceStatus,
    riskScore: 31,
    riskLevel: 'critical' as RiskLevel,
    issueDate:   '2024-11-15T00:00:00Z',
    dueDate:     '2024-12-06T00:00:00Z',
    fundedAt:    '2024-11-17T09:00:00Z',
    collectedAt: null,
    createdAt: '2024-11-15T10:00:00Z',
    updatedAt: '2025-01-10T09:00:00Z',
  },
  {
    id: 'inv_014',
    invoiceNumber: 'INV-2025-014',
    supplierId: 'sup_013',
    supplierName: 'Lira Logistics',
    buyerId: 'buyer_114',
    buyerName: 'Standard Chartered Uganda',
    faceValue:      97_000_000,
    advanceAmount:  87_300_000,
    discountAmount:  9_700_000,
    advancePercentage: 90,
    discountRate: 2.9,
    tenor: 60,
    status: 'buyer_confirmed' as InvoiceStatus,
    riskScore: null,
    riskLevel: null,
    issueDate:   '2025-03-18T00:00:00Z',
    dueDate:     '2025-05-17T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-18T08:00:00Z',
    updatedAt: '2025-03-20T11:00:00Z',
  },
  {
    id: 'inv_015',
    invoiceNumber: 'INV-2025-015',
    supplierId: 'sup_014',
    supplierName: 'Tororo Cement Dealers',
    buyerId: 'buyer_115',
    buyerName: 'Bank of Africa Uganda',
    faceValue:     145_500_000,
    advanceAmount: 130_950_000,
    discountAmount: 14_550_000,
    advancePercentage: 90,
    discountRate: 3.0,
    tenor: 75,
    status: 'funded' as InvoiceStatus,
    riskScore: 73,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2025-02-28T00:00:00Z',
    dueDate:     '2025-05-14T00:00:00Z',
    fundedAt:    '2025-03-01T10:00:00Z',
    collectedAt: null,
    createdAt: '2025-02-28T09:30:00Z',
    updatedAt: '2025-03-01T10:00:00Z',
  },
  {
    id: 'inv_016',
    invoiceNumber: 'INV-2025-016',
    supplierId: 'sup_015',
    supplierName: 'Mbale Fresh Produce',
    buyerId: 'buyer_102',
    buyerName: 'MTN Uganda Ltd',
    faceValue:      52_000_000,
    advanceAmount:  46_800_000,
    discountAmount:  5_200_000,
    advancePercentage: 90,
    discountRate: 3.4,
    tenor: 45,
    status: 'scored' as InvoiceStatus,
    riskScore: 51,
    riskLevel: 'medium' as RiskLevel,
    issueDate:   '2025-03-22T00:00:00Z',
    dueDate:     '2025-05-06T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2025-03-22T07:45:00Z',
    updatedAt: '2025-03-24T13:00:00Z',
  },
  {
    id: 'inv_pricing_001',
    invoiceNumber: 'INV-2026-P001',
    supplierId: 'sup_020',
    supplierName: 'Kampala Steel Works',
    buyerId: 'buyer_120',
    buyerName: 'Uganda Breweries Ltd',
    faceValue:     100_000_000,
    advanceAmount:  95_000_000,
    discountAmount:  3_591_000,
    advancePercentage: 95,
    discountRate: 3.78,
    tenor: 60,
    status: 'priced' as InvoiceStatus,
    riskScore: 74,
    riskLevel: 'low' as RiskLevel,
    issueDate:   '2026-03-10T00:00:00Z',
    dueDate:     '2026-05-09T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2026-03-10T08:00:00Z',
    updatedAt: '2026-03-14T11:30:00Z',
  },
  {
    id: 'inv_pricing_002',
    invoiceNumber: 'INV-2026-P002',
    supplierId: 'sup_021',
    supplierName: 'Entebbe Fish Exports',
    buyerId: 'buyer_121',
    buyerName: 'Stanbic Bank Uganda',
    faceValue:      75_000_000,
    advanceAmount:  69_000_000,
    discountAmount:  2_932_500,
    advancePercentage: 92,
    discountRate: 4.25,
    tenor: 45,
    status: 'priced' as InvoiceStatus,
    riskScore: 62,
    riskLevel: 'medium' as RiskLevel,
    issueDate:   '2026-03-15T00:00:00Z',
    dueDate:     '2026-04-29T00:00:00Z',
    fundedAt:    null,
    collectedAt: null,
    createdAt: '2026-03-15T09:30:00Z',
    updatedAt: '2026-03-18T14:00:00Z',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyFilters(invoices: Invoice[], params: URLSearchParams): Invoice[] {
  let result = [...invoices];

  // Axios serialises arrays as status[]=x — check both forms
  const statusParam = params.get('status');
  const statusBracket = params.getAll('status[]');
  const rawStatuses = statusBracket.length > 0
    ? statusBracket
    : statusParam ? statusParam.split(',') : [];
  if (rawStatuses.length > 0) {
    const statuses = rawStatuses as InvoiceStatus[];
    result = result.filter((inv) => statuses.includes(inv.status));
  }

  const supplier = params.get('supplier')?.toLowerCase();
  if (supplier) {
    result = result.filter((inv) =>
      inv.supplierName.toLowerCase().includes(supplier),
    );
  }

  const search = params.get('search')?.toLowerCase();
  if (search) {
    result = result.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(search) ||
        inv.buyerName.toLowerCase().includes(search),
    );
  }

  const dateFrom = params.get('date_from');
  if (dateFrom) {
    result = result.filter((inv) => inv.dueDate >= dateFrom);
  }

  const dateTo = params.get('date_to');
  if (dateTo) {
    result = result.filter((inv) => inv.dueDate <= dateTo + 'T23:59:59Z');
  }

  return result;
}

type SortableField = keyof Pick<
  Invoice,
  'invoiceNumber' | 'supplierName' | 'buyerName' | 'faceValue' | 'status' | 'riskScore' | 'dueDate' | 'createdAt'
>;

function applySort(
  invoices: Invoice[],
  sortBy: string,
  sortDir: string,
): Invoice[] {
  const field = sortBy as SortableField;
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...invoices].sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });
}

// ── Detail builder ────────────────────────────────────────────────────────────

const BUYER_POOL: Record<string, BuyerInfo> = {
  buyer_101: { id: 'buyer_101', name: 'Stanbic Bank Uganda',      industry: 'Banking & Finance', creditLimit: 500_000_000, paymentTermsDays: 45, contactEmail: 'ap@stanbic.co.ug',     contactPhone: '+256 414 345 000' },
  buyer_102: { id: 'buyer_102', name: 'MTN Uganda Ltd',           industry: 'Telecommunications', creditLimit: 800_000_000, paymentTermsDays: 60, contactEmail: 'finance@mtn.co.ug',    contactPhone: '+256 312 350 100' },
  buyer_103: { id: 'buyer_103', name: 'Umeme Ltd',                industry: 'Energy & Utilities', creditLimit: 300_000_000, paymentTermsDays: 30, contactEmail: 'payables@umeme.co.ug', contactPhone: '+256 312 360 000' },
  buyer_104: { id: 'buyer_104', name: 'Centenary Bank',           industry: 'Banking & Finance', creditLimit: 450_000_000, paymentTermsDays: 90, contactEmail: 'ops@centenarybank.co.ug', contactPhone: '+256 414 251 276' },
  buyer_105: { id: 'buyer_105', name: 'Uganda Telecom',           industry: 'Telecommunications', creditLimit: 200_000_000, paymentTermsDays: 21, contactEmail: 'finance@utl.co.ug',    contactPhone: '+256 312 222 000' },
  buyer_106: { id: 'buyer_106', name: 'DFCU Bank',                industry: 'Banking & Finance', creditLimit: 350_000_000, paymentTermsDays: 45, contactEmail: 'treasury@dfcubank.co.ug', contactPhone: '+256 414 340 000' },
  buyer_107: { id: 'buyer_107', name: 'Airtel Uganda',            industry: 'Telecommunications', creditLimit: 600_000_000, paymentTermsDays: 60, contactEmail: 'ap@airtel.co.ug',      contactPhone: '+256 312 500 100' },
  buyer_108: { id: 'buyer_108', name: 'Housing Finance Bank',     industry: 'Banking & Finance', creditLimit: 180_000_000, paymentTermsDays: 14, contactEmail: 'finance@hfb.co.ug',    contactPhone: '+256 414 259 651' },
  buyer_109: { id: 'buyer_109', name: 'National Water & Sewerage', industry: 'Utilities', creditLimit: 400_000_000, paymentTermsDays: 75, contactEmail: 'accounts@nwsc.co.ug',   contactPhone: '+256 417 117 000' },
  buyer_110: { id: 'buyer_110', name: 'Kakira Sugar Works',       industry: 'Agro-processing', creditLimit: 250_000_000, paymentTermsDays: 30, contactEmail: 'finance@kakira.co.ug',  contactPhone: '+256 434 224 000' },
  buyer_111: { id: 'buyer_111', name: 'Uganda Revenue Authority', industry: 'Government', creditLimit: 999_000_000, paymentTermsDays: 90, contactEmail: 'accounts@ura.go.ug',   contactPhone: '+256 417 444 000' },
  buyer_112: { id: 'buyer_112', name: 'Roofings Ltd',             industry: 'Manufacturing', creditLimit: 220_000_000, paymentTermsDays: 45, contactEmail: 'ap@roofings.co.ug',    contactPhone: '+256 414 287 000' },
  buyer_113: { id: 'buyer_113', name: 'Nile Breweries',           industry: 'FMCG', creditLimit: 320_000_000, paymentTermsDays: 21, contactEmail: 'payables@nile.co.ug',   contactPhone: '+256 434 120 000' },
  buyer_114: { id: 'buyer_114', name: 'Standard Chartered Uganda', industry: 'Banking & Finance', creditLimit: 550_000_000, paymentTermsDays: 60, contactEmail: 'ops@sc.com',           contactPhone: '+256 414 258 211' },
  buyer_115: { id: 'buyer_115', name: 'Bank of Africa Uganda',    industry: 'Banking & Finance', creditLimit: 280_000_000, paymentTermsDays: 75, contactEmail: 'finance@boafrica.co.ug', contactPhone: '+256 414 302 001' },
};

const SUPPLIER_POOL: Record<string, SupplierInfo> = {
  usr_002:  { id: 'usr_002',  name: 'Kampala Traders Ltd',    industry: 'Wholesale Trade',  registrationNumber: 'UG-80012345', contactEmail: 'accounts@kampalatraders.co.ug', contactPhone: '+256 772 100 200' },
  sup_003:  { id: 'sup_003',  name: 'Nile Agro Exports',      industry: 'Agriculture',       registrationNumber: 'UG-80034567', contactEmail: 'finance@nileagro.co.ug',       contactPhone: '+256 772 200 300' },
  sup_004:  { id: 'sup_004',  name: 'Pearl Foods Uganda',     industry: 'Food Processing',   registrationNumber: 'UG-80056789', contactEmail: 'ap@pearlfoods.co.ug',          contactPhone: '+256 772 300 400' },
  sup_005:  { id: 'sup_005',  name: 'Buganda Road Supplies',  industry: 'Retail Trade',      registrationNumber: 'UG-80078901', contactEmail: 'finance@brs.co.ug',            contactPhone: '+256 772 400 500' },
  sup_006:  { id: 'sup_006',  name: 'Entebbe Cold Storage',   industry: 'Logistics',         registrationNumber: 'UG-80090123', contactEmail: 'accounts@ecs.co.ug',           contactPhone: '+256 772 500 600' },
  sup_007:  { id: 'sup_007',  name: 'Masaka General Goods',   industry: 'Wholesale Trade',   registrationNumber: 'UG-80012367', contactEmail: 'info@mgg.co.ug',               contactPhone: '+256 772 600 700' },
  sup_008:  { id: 'sup_008',  name: 'Fort Portal Farms',      industry: 'Agriculture',       registrationNumber: 'UG-80023478', contactEmail: 'finance@fportfarms.co.ug',     contactPhone: '+256 772 700 800' },
  sup_009:  { id: 'sup_009',  name: 'Jinja Industrial Supplies', industry: 'Manufacturing',  registrationNumber: 'UG-80034589', contactEmail: 'accounts@jinja-ind.co.ug',     contactPhone: '+256 772 800 900' },
  sup_010:  { id: 'sup_010',  name: 'Gulu Trade Centre',      industry: 'Retail Trade',      registrationNumber: 'UG-80045690', contactEmail: 'finance@gulutrade.co.ug',      contactPhone: '+256 772 900 100' },
  sup_011:  { id: 'sup_011',  name: 'Mbarara Dairy Co.',      industry: 'Dairy Processing',  registrationNumber: 'UG-80056701', contactEmail: 'ap@mbaradadairy.co.ug',        contactPhone: '+256 782 100 200' },
  sup_012:  { id: 'sup_012',  name: 'Soroti Grains Ltd',      industry: 'Agriculture',       registrationNumber: 'UG-80067812', contactEmail: 'finance@sorotigrains.co.ug',   contactPhone: '+256 782 200 300' },
  sup_013:  { id: 'sup_013',  name: 'Lira Logistics',         industry: 'Logistics',         registrationNumber: 'UG-80078923', contactEmail: 'accounts@liralogistics.co.ug', contactPhone: '+256 782 300 400' },
  sup_014:  { id: 'sup_014',  name: 'Tororo Cement Dealers',  industry: 'Construction',      registrationNumber: 'UG-80089034', contactEmail: 'finance@tororo-c.co.ug',       contactPhone: '+256 782 400 500' },
  sup_015:  { id: 'sup_015',  name: 'Mbale Fresh Produce',    industry: 'Agriculture',       registrationNumber: 'UG-80090145', contactEmail: 'ap@mbalefresh.co.ug',          contactPhone: '+256 782 500 600' },
};

function buildTimeline(inv: MockInvoice): StatusTransition[] {
  const base: StatusTransition[] = [
    { status: 'draft',          transitionedAt: inv.createdAt,  actorName: inv.supplierName, actorRole: 'supplier',       notes: null },
    { status: 'submitted',      transitionedAt: inv.createdAt,  actorName: inv.supplierName, actorRole: 'supplier',       notes: 'Invoice submitted for buyer confirmation.' },
  ];
  const statusOrder: InvoiceStatus[] = [
    'draft','submitted','buyer_confirmed','scored','priced',
    'approved','rejected','pending_first_auth','pending_second_auth',
    'executing','funded','collecting','overdue','collected','defaulted',
  ];
  const currentIdx = statusOrder.indexOf(inv.status);
  const entries: StatusTransition[] = [base[0]];
  if (currentIdx >= 1) entries.push({ ...base[1], transitionedAt: new Date(new Date(inv.createdAt).getTime() + 3_600_000).toISOString() });
  if (currentIdx >= 2) entries.push({ status: 'buyer_confirmed',    transitionedAt: new Date(new Date(inv.createdAt).getTime() + 7_200_000).toISOString(),    actorName: 'James Opio',       actorRole: 'buyer',          notes: 'Buyer confirmed receipt of goods.' });
  if (currentIdx >= 3) entries.push({ status: 'scored',             transitionedAt: new Date(new Date(inv.createdAt).getTime() + 86_400_000).toISOString(),   actorName: 'Risk Engine',      actorRole: 'system',         notes: `Composite risk score: ${inv.riskScore ?? 0}/100.` });
  if (currentIdx >= 4) entries.push({ status: 'priced',             transitionedAt: new Date(new Date(inv.createdAt).getTime() + 172_800_000).toISOString(),  actorName: 'Pricing Engine',   actorRole: 'system',         notes: 'Discount rate and advance amount calculated.' });
  if (currentIdx === statusOrder.indexOf('rejected')) {
    const rejectNote = inv.rejectComment ?? null;
    entries.push({ status: 'rejected', transitionedAt: new Date(new Date(inv.createdAt).getTime() + 259_200_000).toISOString(), actorName: 'Sarah Nakato', actorRole: 'credit_officer', notes: rejectNote ?? 'Score below minimum threshold. Credit risk too high.' });
  }
  if (currentIdx >= 5 && inv.status !== 'rejected') entries.push({ status: 'approved', transitionedAt: new Date(new Date(inv.createdAt).getTime() + 259_200_000).toISOString(), actorName: 'Sarah Nakato', actorRole: 'credit_officer', notes: 'Risk profile acceptable. Approved for disbursement.' });
  if (currentIdx >= statusOrder.indexOf('pending_first_auth') && inv.status !== 'rejected' && inv.status !== 'approved') {
    const auth1Name = inv.dualAuthUser1Name ?? 'Finance Officer';
    const auth1At = inv.dualAuthUser1At ?? new Date(new Date(inv.createdAt).getTime() + 345_600_000).toISOString();
    const auth1Note = inv.dualAuthComment1 ?? null;
    entries.push({ status: 'pending_first_auth', transitionedAt: auth1At, actorName: auth1Name, actorRole: 'finance_manager', notes: auth1Note ? `1st authorisation granted. "${auth1Note}"` : '1st authorisation granted.' });
  }
  if (currentIdx >= statusOrder.indexOf('pending_second_auth') && inv.status !== 'rejected' && inv.status !== 'approved' && inv.status !== 'pending_first_auth') {
    const auth2Name = inv.dualAuthUser2Name ?? 'Finance Officer';
    const auth2At = inv.dualAuthUser2At ?? new Date(new Date(inv.createdAt).getTime() + 360_000_000).toISOString();
    const auth2Note = inv.dualAuthComment2 ?? null;
    entries.push({ status: 'pending_second_auth', transitionedAt: auth2At, actorName: auth2Name, actorRole: 'finance_manager', notes: auth2Note ? `2nd authorisation granted. "${auth2Note}"` : '2nd authorisation granted.' });
  }
  if (currentIdx >= statusOrder.indexOf('executing') && !['rejected','approved','pending_first_auth','pending_second_auth'].includes(inv.status)) {
    const execName = inv.dualAuthUser2Name ?? 'Finance Officer';
    const execAt = inv.dualAuthUser2At ?? new Date(new Date(inv.createdAt).getTime() + 375_000_000).toISOString();
    const execNote = inv.executeComment ?? null;
    entries.push({ status: 'executing', transitionedAt: execAt, actorName: execName, actorRole: 'finance_manager', notes: execNote ? `Payment initiated. "${execNote}"` : 'Both authorisations complete. Payment initiated.' });
  }
  if (inv.fundedAt) entries.push({ status: 'funded', transitionedAt: inv.fundedAt, actorName: 'Payment System', actorRole: 'system', notes: `MTN Mobile Money disbursement of UGX ${inv.advanceAmount.toLocaleString()} completed.` });
  if (['collecting','overdue','collected','defaulted'].includes(inv.status)) {
    entries.push({ status: 'collecting', transitionedAt: new Date(new Date(inv.fundedAt ?? inv.createdAt).getTime() + 86_400_000).toISOString(), actorName: 'Collections System', actorRole: 'system', notes: 'Invoice entered collections period.' });
  }
  if (inv.status === 'overdue')    entries.push({ status: 'overdue',    transitionedAt: inv.dueDate, actorName: 'Collections System', actorRole: 'system', notes: 'Payment not received by due date. Escalation triggered.' });
  if (inv.collectedAt)            entries.push({ status: 'collected',  transitionedAt: inv.collectedAt, actorName: 'Collections System', actorRole: 'system', notes: `Full face value of UGX ${inv.faceValue.toLocaleString()} received from buyer.` });
  if (inv.status === 'defaulted')  entries.push({ status: 'defaulted',  transitionedAt: new Date(new Date(inv.dueDate).getTime() + 30 * 86_400_000).toISOString(), actorName: 'Sarah Nakato', actorRole: 'credit_officer', notes: 'Buyer defaulted. Full recourse claim initiated against supplier.' });
  return entries;
}

function buildApprovalHistory(inv: Invoice): ApprovalDecision[] {
  const hasCreditDecision = ['scored','approved','rejected','pending_first_auth','pending_second_auth','executing','funded','collecting','overdue','collected','defaulted'].includes(inv.status);
  const hasFinanceDecision = ['pending_second_auth','executing','funded','collecting','overdue','collected','defaulted'].includes(inv.status);
  const history: ApprovalDecision[] = [];
  if (hasCreditDecision) {
    history.push({
      tier:       'TIER_2',
      decision:   inv.status === 'rejected' ? 'REJECTED' : 'APPROVED',
      actorName: 'Sarah Nakato',
      actorRole: 'Credit Officer',
      decidedAt: new Date(new Date(inv.createdAt).getTime() + 259_200_000).toISOString(),
      reason:     inv.status === 'rejected' ? 'Composite risk score of 28 is below the minimum acceptable threshold of 40. Buyer credit history shows 2 late payments in the past 12 months.' : 'Risk profile is within acceptable parameters. Buyer credit history is strong with no defaults.',
    });
  }
  if (hasFinanceDecision) {
    const auth1 = inv.dualAuthUser1Name ?? 'Finance Officer 1';
    const auth2 = inv.dualAuthUser2Name ?? 'Finance Officer 2';
    history.push({
      tier:       'TIER_3',
      decision:   'APPROVED',
      actorName: `${auth1} & ${auth2}`,
      actorRole: 'Finance Manager (Dual Auth)',
      decidedAt: inv.dualAuthUser2At ?? new Date(new Date(inv.createdAt).getTime() + 360_000_000).toISOString(),
      reason:     `Dual authorisation completed. 1st auth: ${auth1}. 2nd auth: ${auth2}. Proceeding with disbursement.`,
    });
  }
  return history;
}

function buildRiskBreakdown(inv: Invoice): RiskBreakdown | null {
  if (inv.riskScore === null) return null;
  const c = inv.riskScore;
  return {
    composite:             c,
    buyerCredit:          Math.min(100, Math.round(c * 1.05 + 3)),
    supplierTrackRecord: Math.min(100, Math.round(c * 0.95 + 5)),
    concentrationRisk:    Math.min(100, Math.round(c * 0.90 + 8)),
    collateral:            Math.min(100, Math.round(c * 1.10 - 2)),
    tenor:                 Math.min(100, Math.round(c * 1.02 + 1)),
  };
}

function buildDocuments(inv: Invoice): InvoiceDocument[] {
  const docs: InvoiceDocument[] = [
    { id: `doc_${inv.id}_1`, name: `${inv.invoiceNumber}.pdf`,           type: 'invoice_pdf',          uploadedAt: inv.createdAt,  sizeBytes: 245_120 },
    { id: `doc_${inv.id}_2`, name: 'Delivery Note — Signed.pdf',          type: 'supporting_doc',       uploadedAt: inv.createdAt,  sizeBytes: 118_784 },
  ];
  if (['funded','collecting','overdue','collected','defaulted'].includes(inv.status)) {
    docs.push({ id: `doc_${inv.id}_3`, name: 'Notice of Assignment.pdf', type: 'notice_of_assignment', uploadedAt: inv.fundedAt ?? inv.createdAt, sizeBytes: 89_600 });
  }
  return docs;
}

/**
 * Generate static mock collateral for invoices with high face values.
 * Returns snake_case objects (deepCamelCase interceptor converts for the UI).
 */
function buildCollateral(inv: Invoice): CollateralMockItem[] {
  if (inv.faceValue < 50_000_000) return [];
  return [
    { id: `col_${inv.id}_1`, invoice_id: inv.id, type: 'inventory', description: 'Stock of finished goods held in Kampala warehouse', estimated_value: Math.round(inv.faceValue * 0.4), expiry_date: null, status: inv.status === 'scored' || inv.riskScore !== null ? 'verified' : 'pending', documents: [], created_at: inv.createdAt, updated_at: inv.createdAt },
    { id: `col_${inv.id}_2`, invoice_id: inv.id, type: 'receivables', description: 'Outstanding trade receivables from secondary buyers', estimated_value: Math.round(inv.faceValue * 0.25), expiry_date: null, status: 'pending', documents: [], created_at: inv.createdAt, updated_at: inv.createdAt },
  ];
}

/**
 * Merge static mock collateral with any user-added items from
 * the shared COLLATERAL_STORE (written to by collateral.handlers POST).
 */
function mergeCollateral(inv: Invoice): CollateralMockItem[] {
  const generated = buildCollateral(inv);
  const userAdded = COLLATERAL_STORE[inv.id] ?? [];
  // De-duplicate by id (user-added items from COLLATERAL_STORE take precedence)
  const userIds = new Set(userAdded.map((c) => c.id));
  const deduped = generated.filter((c) => !userIds.has(c.id));
  return [...deduped, ...userAdded];
}

function enrichInvoice(inv: Invoice) {
  const buyerInfo    = BUYER_POOL[inv.buyerId]    ?? { id: inv.buyerId,    name: inv.buyerName,    industry: 'Trade', creditLimit: 200_000_000, paymentTermsDays: 30, contactEmail: 'ap@buyer.co.ug',    contactPhone: '+256 700 000 001' };
  const supplierInfo = SUPPLIER_POOL[inv.supplierId] ?? { id: inv.supplierId, name: inv.supplierName, industry: 'Trade', registrationNumber: 'UG-80000000', contactEmail: 'accounts@supplier.co.ug', contactPhone: '+256 700 000 002' };
  // Mock data uses snake_case to simulate backend responses — the axios
  // deepCamelCase interceptor converts to camelCase before components see it.
  const pricingEntry = PRICING_DATA.get(inv.id);
  return {
    ...inv,
    buyerInfo:       buyerInfo,
    supplierInfo:    supplierInfo,
    statusTimeline:  buildTimeline(inv),
    approvalHistory: buildApprovalHistory(inv),
    riskBreakdown:   buildRiskBreakdown(inv),
    documents:        buildDocuments(inv),
    collateral:       mergeCollateral(inv),
    ...(pricingEntry ? { netPaymentToSupplier: pricingEntry.netPaymentToSupplier } : {}),
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const invoiceHandlers = [

  // GET /api/invoices
  http.get('/api/invoices', async ({ request }) => {
    await delay(350);
    const url    = new URL(request.url);
    const params = url.searchParams;

    let items = applyFilters(MOCK_INVOICES, params);

    const sortBy  = params.get('sort_by')  ?? 'created_at';
    const sortDir = params.get('sort_dir') ?? 'desc';
    items = applySort(items, sortBy, sortDir);

    const pageSize = Math.max(1, parseInt(params.get('page_size') ?? '10', 10));
    const page     = Math.max(1, parseInt(params.get('page')      ?? '1',  10));
    const total    = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const slice    = items.slice((page - 1) * pageSize, page * pageSize);

    // Mirror the live backend wire shape: snake_case envelope keys.
    // The deepCamelCase axios interceptor will convert to PaginatedInvoices.
    return HttpResponse.json({
      data:        slice,
      total,
      page,
      page_size:   pageSize,
      total_pages: totalPages,
    });
  }),

  // GET /api/invoices/:id — returns full InvoiceDetail with nested objects
  // Falls through to real backend for non-demo invoice IDs.
  http.get('/api/invoices/:id', async ({ params }) => {
    const invoice = MOCK_INVOICES.find((inv) => inv.id === params.id);
    if (!invoice) return passthrough();
    await delay(300);
    return HttpResponse.json(enrichInvoice(invoice));
  }),

  // POST /api/invoices/submit — create + submit a new invoice
  http.post('/api/invoices/submit', async ({ request }) => {
    await delay(400);
    const body = await request.json() as {
      buyer_id?: string;
      face_value?: number;
      issue_date?: string;
      due_date?: string;
      advance_percentage?: number;
    };
    const buyerInfo  = body.buyer_id ? BUYER_POOL[body.buyer_id] : undefined;
    // Resolve logged-in supplier from auth token
    const authHeader = request.headers.get('Authorization') ?? '';
    const tokenMatch = /^Bearer mock-access-(.+)-\d+$/.exec(authHeader.slice(0));
    const tokenUserId = tokenMatch ? tokenMatch[1] : null;
    let suppId = 'usr_002';
    let suppName = 'Kampala Traders Ltd';
    if (tokenUserId) {
      for (const rec of Object.values(USERS)) {
        if ((rec.user as { id: string }).id === tokenUserId) {
          suppId = tokenUserId;
          suppName = (rec.user as { name: string }).name;
          break;
        }
      }
    }
    const newInvoice: Invoice = {
      id:             `inv_${Date.now()}`,
      invoiceNumber: `INV-${new Date().getFullYear()}-${String(MOCK_INVOICES.length + 1).padStart(3, '0')}`,
      supplierId:    suppId,
      supplierName:  suppName,
      buyerId:       body.buyer_id ?? 'buyer_101',
      buyerName:     buyerInfo?.name ?? 'Unknown Buyer',
      faceValue:         body.face_value ?? 0,
      advanceAmount:     Math.round((body.face_value ?? 0) * ((body.advance_percentage ?? 90) / 100)),
      discountAmount:    Math.round((body.face_value ?? 0) * (1 - (body.advance_percentage ?? 90) / 100)),
      advancePercentage: body.advance_percentage ?? 90,
      discountRate:      3.0,
      tenor:              14,
      status:         'submitted',
      riskScore:     null,
      riskLevel:     null,
      issueDate:     body.issue_date ?? new Date().toISOString(),
      dueDate:       body.due_date   ?? new Date().toISOString(),
      fundedAt:      null,
      collectedAt:   null,
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString(),
    };
    MOCK_INVOICES.push(newInvoice);
    return HttpResponse.json({ invoiceId: newInvoice.id }, { status: 201 });
  }),

  // PATCH /api/invoices/:id
  http.patch('/api/invoices/:id', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(300);
    const body = await request.json() as Partial<Invoice>;
    const updated = { ...MOCK_INVOICES[idx], ...body, updatedAt: new Date().toISOString() };
    MOCK_INVOICES[idx] = updated;
    return HttpResponse.json<Invoice>(updated);
  }),

  // DELETE /api/invoices/:id
  http.delete('/api/invoices/:id', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(250);
    MOCK_INVOICES.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /api/invoices/:id/confirm-buyer — credit_officer confirms buyer
  http.post('/api/invoices/:id/confirm-buyer', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    if (MOCK_INVOICES[idx].status !== 'submitted') {
      return HttpResponse.json({ message: 'Invoice must be in submitted status to confirm buyer.' }, { status: 422 });
    }
    MOCK_INVOICES[idx] = { ...MOCK_INVOICES[idx], status: 'buyer_confirmed' as InvoiceStatus, updatedAt: new Date().toISOString() };
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/score — run risk scoring
  http.post('/api/invoices/:id/score', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(600);
    if (MOCK_INVOICES[idx].status !== 'buyer_confirmed') {
      return HttpResponse.json({ message: 'Invoice must be in buyer_confirmed status to run scoring.' }, { status: 422 });
    }
    const riskScore = Math.floor(Math.random() * 40) + 50; // 50-89
    const riskLevel: RiskLevel = riskScore >= 70 ? 'low' : riskScore >= 50 ? 'medium' : 'high';
    MOCK_INVOICES[idx] = {
      ...MOCK_INVOICES[idx],
      status: 'scored' as InvoiceStatus,
      riskScore,
      riskLevel,
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/price — generate pricing
  http.post('/api/invoices/:id/price', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(500);
    if (MOCK_INVOICES[idx].status !== 'scored') {
      return HttpResponse.json({ message: 'Invoice must be in scored status to generate pricing.' }, { status: 422 });
    }
    const inv = MOCK_INVOICES[idx];
    MOCK_INVOICES[idx] = { ...inv, status: 'priced' as InvoiceStatus, updatedAt: new Date().toISOString() };

    // Auto-generate pricing breakdown so PricingBreakdownCard can fetch it
    if (!PRICING_DATA.has(inv.id)) {
      const faceValue = inv.faceValue ?? 0;
      const advPct = inv.advancePercentage ?? 90;
      const advanceAmount = Math.round(faceValue * advPct / 100);
      const discountRate = inv.discountRate ?? 3.0;
      const discountAmount = Math.round(advanceAmount * discountRate / 100);
      const bankCost = Math.round(discountAmount * 0.40);
      const riskPremium = Math.round(discountAmount * 0.25);
      const risMargin = discountAmount - bankCost - riskPremium;
      const netPayment = advanceAmount - discountAmount;
      const pricing: PricingBreakdown = {
        invoiceId: inv.id,
        faceValue,
        advancePercentage: advPct,
        advanceAmount,
        discountRate,
        discountAmount,
        bankCost,
        riskPremium,
        risMargin,
        tenor: inv.tenor ?? 30,
        netPaymentToSupplier: netPayment,
        status: 'pending',
        acceptedAt: null,
        rejectedAt: null,
        disputedAt: null,
        dispute: null,
      };
      PRICING_DATA.set(inv.id, pricing);
    }

    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/mark-funded — mark as funded
  http.post('/api/invoices/:id/mark-funded', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    if (MOCK_INVOICES[idx].status !== 'executing') {
      return HttpResponse.json({ message: 'Invoice must be in executing status to mark as funded.' }, { status: 422 });
    }
    const prev = MOCK_INVOICES[idx];
    const fundedAt = new Date().toISOString();
    const dueDate = new Date(Date.now() + (prev.tenor ?? 30) * 86_400_000).toISOString();
    // Sync handoff: funded → collecting + create collection row (mirrors backend)
    MOCK_INVOICES[idx] = {
      ...prev,
      status: 'collecting' as InvoiceStatus,
      fundedAt,
      updatedAt: fundedAt,
    };
    addRuntimeCollection({
      id: `col_${prev.id}`,
      invoiceId: prev.id,
      invoiceNumber: prev.invoiceNumber ?? prev.id,
      supplierId: prev.supplierId ?? 'usr_002',
      supplierName: prev.supplierName ?? 'Supplier',
      buyerId: prev.buyerId ?? '',
      buyerName: prev.buyerName ?? 'Buyer',
      faceValue: prev.faceValue ?? 0,
      collectedAmount: 0,
      outstandingAmount: prev.faceValue ?? 0,
      status: 'pending' as 'pending',
      dueDate,
      daysOverdue: 0,
      escalationLevel: 'none' as 'none',
      sarFlagged: false,
      lastPaymentDate: null,
      createdAt: fundedAt,
      updatedAt: fundedAt,
    });
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/approve  (accept pricing or credit officer approval)
  http.post('/api/invoices/:id/approve', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    const now = new Date().toISOString();
    MOCK_INVOICES[idx] = { ...MOCK_INVOICES[idx], status: 'approved', approvedAt: now, updatedAt: now };
    // When pricing is accepted (priced → approved), add to the approvals queue
    // so finance managers can see it
    addToApprovalQueue(MOCK_INVOICES[idx]);
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/bank-details — G6: post-approval bank capture (supplier)
  http.post('/api/invoices/:id/bank-details', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    const inv = MOCK_INVOICES[idx];
    if (inv.status !== 'approved') {
      return HttpResponse.json(
        { code: 'INVOICE_WRONG_STATUS', message: 'Invoice must be approved before bank details can be captured' },
        { status: 422 },
      );
    }
    const body = (await request.json()) as {
      bank_account_number?: string;
      bank_account_name?: string;
      bank_name?: string;
    };
    if (!body.bank_account_number || !body.bank_account_name || !body.bank_name) {
      return HttpResponse.json(
        { code: 'VALIDATION_ERROR', message: 'All three bank fields are required' },
        { status: 400 },
      );
    }
    await delay(300);
    MOCK_INVOICES[idx] = {
      ...inv,
      bankDetailsCapturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Invoice;
    return HttpResponse.json({ message: 'Bank details captured' });
  }),

  // POST /api/invoices/:id/reject
  http.post('/api/invoices/:id/reject', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    const body = await request.json() as { comment?: string };
    MOCK_INVOICES[idx] = { ...MOCK_INVOICES[idx], status: 'rejected', rejectComment: body.comment ?? null, updatedAt: new Date().toISOString() };
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/request-info
  http.post('/api/invoices/:id/request-info', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(300);
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/fund  (finance_manager)
  http.post('/api/invoices/:id/fund', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(500);
    MOCK_INVOICES[idx] = { ...MOCK_INVOICES[idx], status: 'pending_first_auth', updatedAt: new Date().toISOString() };
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/authorise  (Stage 11 — dual-auth by two DIFFERENT finance officers)
  http.post('/api/invoices/:id/authorise', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    const inv = MOCK_INVOICES[idx];
    const body = await request.json() as { user_id?: string; user_name?: string; comment?: string };
    const userId = body.user_id ?? 'usr_001';
    const userName = body.user_name ?? 'Admin User';
    const authComment = body.comment ?? null;
    const now = new Date().toISOString();

    // 1st auth: approved → pending_first_auth (record Auth 1 signer)
    if (inv.status === 'approved') {
      MOCK_INVOICES[idx] = {
        ...inv,
        status: 'pending_first_auth' as InvoiceStatus,
        dualAuthUser1Id: userId,
        dualAuthUser1Name: userName,
        dualAuthUser1At: now,
        dualAuthComment1: authComment,
        updatedAt: now,
      };
      return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
    }

    // 2nd auth: pending_first_auth → pending_second_auth (enforce DIFFERENT user)
    if (inv.status === 'pending_first_auth') {
      if (inv.dualAuthUser1Id === userId) {
        return HttpResponse.json(
          { message: 'Dual authorisation requires two different finance officers. The same user cannot perform both authorisations.', code: 'SAME_USER_DUAL_AUTH' },
          { status: 403 },
        );
      }
      MOCK_INVOICES[idx] = {
        ...inv,
        status: 'pending_second_auth' as InvoiceStatus,
        dualAuthUser2Id: userId,
        dualAuthUser2Name: userName,
        dualAuthUser2At: now,
        dualAuthComment2: authComment,
        updatedAt: now,
      };
      return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
    }

    // Execute: pending_second_auth → executing (payment initiation)
    if (inv.status === 'pending_second_auth') {
      MOCK_INVOICES[idx] = { ...inv, status: 'executing' as InvoiceStatus, executeComment: authComment, updatedAt: now };
      return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
    }

    return HttpResponse.json({ message: `Cannot authorise invoice in ${inv.status} status.` }, { status: 422 });
  }),

  // POST /api/invoices/:id/override  (management)
  http.post('/api/invoices/:id/override', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(400);
    const body = await request.json() as { status?: InvoiceStatus };
    if (body.status) MOCK_INVOICES[idx] = { ...MOCK_INVOICES[idx], status: body.status, updatedAt: new Date().toISOString() };
    return HttpResponse.json(enrichInvoice(MOCK_INVOICES[idx]));
  }),

  // POST /api/invoices/:id/documents — simulated file upload
  http.post('/api/invoices/:id/documents', async ({ params, request }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(600);
    const form     = await request.formData();
    const docType  = form.get('doc_type') as string ?? 'supporting_doc';
    const file     = form.get('file') as File | null;
    const response: UploadDocumentResponse = {
      id:          `doc_${params.id}_${Date.now()}`,
      name:        file?.name ?? 'document.pdf',
      doc_type:    docType,
      uploaded_at: new Date().toISOString(),
      size_bytes:  file?.size ?? 0,
    };
    return HttpResponse.json(response, { status: 201 });
  }),

  // POST /api/invoices/:id/submit
  http.post('/api/invoices/:id/submit', async ({ params }) => {
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === params.id);
    if (idx === -1) return passthrough();
    await delay(350);
    if (MOCK_INVOICES[idx].status !== 'draft') {
      return HttpResponse.json(
        { message: 'Only draft invoices can be submitted.' },
        { status: 422 },
      );
    }
    MOCK_INVOICES[idx] = {
      ...MOCK_INVOICES[idx],
      status:     'submitted',
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json<Invoice>(MOCK_INVOICES[idx]);
  }),
];
