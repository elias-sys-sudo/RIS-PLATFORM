import type { InvoiceStatus, RiskLevel } from '../lib/constants';
import type { ApprovalTier } from './approval.types';
export type { InvoiceStatus, RiskLevel };
export type { CollateralItem, CollateralDocument, CollateralType, CollateralStatus } from './collateral.types';

// ── Core invoice entity ───────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  invoiceNumber: string;

  supplierId:   string;
  supplierName: string;

  buyerId:   string;
  buyerName: string;

  /** Raw UGX integer — no floats */
  faceValue:      number;
  advanceAmount:  number;
  discountAmount: number;

  advancePercentage: number;
  discountRate:      number;

  /** Days from issue to due date (7–90) */
  tenor: number;

  status:     InvoiceStatus;
  riskScore: number | null;
  riskLevel: RiskLevel | null;

  issueDate:   string;
  dueDate:     string;
  fundedAt:    string | null;
  collectedAt: string | null;
  createdAt:   string;
  updatedAt:   string;

  /** Dual-auth payment fields (Stage 11 — workflow doc) */
  approvedAt?:          string | null;
  dualAuthUser1Id?:     string | null;
  dualAuthUser1Name?:   string | null;
  dualAuthUser1At?:     string | null;
  dualAuthUser2Id?:     string | null;
  dualAuthUser2Name?:   string | null;
  dualAuthUser2At?:     string | null;

  /** G6 — set when supplier captures bank details on the approved invoice. */
  bankDetailsCapturedAt?: string | null;
}

// ── List / filter types ───────────────────────────────────────────────────────

export type SortField =
  | 'invoice_number'
  | 'supplier_name'
  | 'buyer_name'
  | 'face_value'
  | 'status'
  | 'risk_score'
  | 'due_date'
  | 'created_at';

export type SortDirection = 'asc' | 'desc';

export interface InvoiceFilters {
  status?:     InvoiceStatus[];
  supplier?:   string;   // free-text search on supplier_name
  search?:     string;   // invoice_number or buyer_name
  date_from?:  string;   // ISO date string
  date_to?:    string;   // ISO date string
  sort_by?:    SortField;
  sort_dir?:   SortDirection;
  page?:       number;
  page_size?:  number;
}

export interface PaginatedInvoices {
  data:        Invoice[];
  total:       number;
  page:        number;
  pageSize:    number;
  totalPages:  number;
}

// ── Mutation payloads ─────────────────────────────────────────────────────────

export interface CreateInvoicePayload {
  /** Backend-required invoice number (e.g. REF-YYYY-NNNN) */
  invoice_number:      string;
  buyer_id:            string;
  face_value:          number;
  issue_date:          string;
  due_date:            string;
  advance_percentage:  number;
  /** Supplier's own reference number — stored as metadata */
  invoice_reference?:  string;
  /** Optional notes or description */
  description?:        string;
  /** URA EFRIS reference — required for e-invoice authenticity check (G1) */
  ura_efris_ref:       string;
  /** Optional: days supplier needs funding for — triggers reminder email (G9) */
  funding_timeline_days?: number;
}

export interface UpdateInvoicePayload {
  face_value?:         number;
  due_date?:           string;
  advance_percentage?: number;
}

// ── Invoice detail — nested objects returned by GET /invoices/:id ─────────────

export interface StatusTransition {
  status:          InvoiceStatus;
  transitionedAt:  string;
  actorName:       string;
  actorRole:       string;
  notes:           string | null;
}

export interface ApprovalDecision {
  tier:       ApprovalTier;
  decision:   'APPROVED' | 'REJECTED' | 'ESCALATED';
  actorName:  string;
  actorRole:  string;
  decidedAt:  string;
  reason:     string | null;
}

export interface RiskBreakdown {
  composite:            number;
  buyerCredit:          number;
  supplierTrackRecord:  number;
  concentrationRisk:    number;
  collateral:           number;
  tenor:                number;
}

export interface InvoiceDocument {
  id:          string;
  name:        string;
  type:        'invoice_pdf' | 'notice_of_assignment' | 'supporting_doc';
  uploadedAt:  string;
  sizeBytes:   number;
}

// CollateralItem is now defined in collateral.types.ts and re-exported above.

export interface BuyerInfo {
  id:               string;
  name:             string;
  industry:         string;
  creditLimit:      number;
  paymentTermsDays: number;
  contactEmail:     string;
  contactPhone:     string;
}

export interface SupplierInfo {
  id:                 string;
  name:               string;
  industry:           string;
  registrationNumber: string;
  contactEmail:       string;
  contactPhone:       string;
}

/** Full invoice returned by GET /invoices/:id — extends the list shape */
export interface InvoiceDetail extends Invoice {
  buyerInfo:       BuyerInfo;
  supplierInfo:    SupplierInfo;
  statusTimeline:  StatusTransition[];
  approvalHistory: ApprovalDecision[];
  riskBreakdown:   RiskBreakdown | null;
  documents:       InvoiceDocument[];
  collateral:      import('./collateral.types').CollateralItem[];

  /** Set when the supplier accepts the pricing offer */
  pricingAcceptedAt?: string | null;
  /** Net amount payable to supplier after all deductions */
  netPaymentToSupplier?: number;
}
