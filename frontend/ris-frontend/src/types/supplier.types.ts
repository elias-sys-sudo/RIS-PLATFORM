import type { EscalationLevel, InvoiceStatus } from '../lib/constants';

// ── Supplier status & risk ─────────────────────────────────────────────────────

export type SupplierStatus = 'active' | 'inactive' | 'suspended';
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

// ── Core supplier entity ──────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  /** Contact person's full name */
  name: string;
  company: string;
  contactEmail: string;
  contactPhone: string;
  /** ISO date string YYYY-MM-DD */
  registrationDate: string;
  status: SupplierStatus;
  riskBand: RiskBand;
  totalInvoices: number;
  /** Raw UGX — sum of outstanding amounts across all active invoices */
  totalOutstandingUgx: number;
}

// ── Performance metrics ───────────────────────────────────────────────────────

export interface SupplierMetrics {
  totalInvoices: number;
  /** Percentage of invoices collected on time (0–100) */
  collectionRate: number;
  /** Average calendar days from funding to full collection */
  avgDaysToPayment: number;
}

// ── Supplier detail (full record returned by GET /suppliers/:id) ──────────────

export interface SupplierDetail extends Supplier {
  metrics: SupplierMetrics;
}

// ── Supplier detail endpoint response ────────────────────────────────────────

export interface SupplierDetailResponse {
  supplier: SupplierDetail;
  invoiceStatusBreakdown: SupplierInvoiceStatusBreakdown[];
  activeCollections: SupplierActiveCollection[];
}

// ── Buyer sub-list ────────────────────────────────────────────────────────────

export type BuyerStatus = 'active' | 'inactive';

export interface SupplierBuyer {
  id: string;
  company: string;
  contactEmail: string;
  contactPhone: string;
  status: BuyerStatus;
  totalInvoices: number;
  /** Raw UGX — current outstanding balance with this buyer */
  outstandingUgx: number;
}

// ── Payment history ───────────────────────────────────────────────────────────

export type SupplierPaymentStatus = 'completed' | 'pending' | 'failed';

export interface SupplierPaymentItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  buyerName: string;
  /** Raw UGX integer */
  amount: number;
  /** e.g. 'mtn_momo' */
  method: string;
  methodLabel: string;
  paymentDate: string;
  status: SupplierPaymentStatus;
}

// ── Payment method breakdown (returned alongside payments list) ───────────────

export interface SupplierPaymentMethodBreakdown {
  method: string;
  label: string;
  count: number;
  /** Raw UGX total for this method */
  amount: number;
}

// ── Invoice status breakdown ──────────────────────────────────────────────────

export interface SupplierInvoiceStatusBreakdown {
  status: InvoiceStatus;
  count: number;
  /** Raw UGX total for this status bucket */
  amount: number;
}

// ── Active collections ────────────────────────────────────────────────────────

export interface SupplierActiveCollection {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  buyerName: string;
  /** Raw UGX outstanding */
  outstandingUgx: number;
  escalationLevel: EscalationLevel;
  daysOverdue: number;
  /** ISO date */
  dueDate: string;
}

// ── List response ─────────────────────────────────────────────────────────────

export interface PaginatedSuppliers {
  data: Supplier[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Buyers paginated response ─────────────────────────────────────────────────

export interface PaginatedSupplierBuyers {
  data: SupplierBuyer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Payments paginated response ───────────────────────────────────────────────

export interface PaginatedSupplierPayments {
  data: SupplierPaymentItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  methodBreakdown: SupplierPaymentMethodBreakdown[];
}

// ── Filters (outgoing — snake_case converted by request interceptor) ─────────

export interface SupplierFilters {
  search?: string;
  status?: SupplierStatus[];
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface SupplierBuyerFilters {
  search?: string;
  status?: BuyerStatus;
  page?: number;
  page_size?: number;
}

export interface SupplierPaymentFilters {
  method?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}
