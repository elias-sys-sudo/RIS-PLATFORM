// ── Collateral type taxonomy ───────────────────────────────────────────────────

export type CollateralType =
  | 'property'
  | 'vehicle'
  | 'equipment'
  | 'inventory'
  | 'receivables'
  | 'other';

export type CollateralStatus = 'pending' | 'verified' | 'rejected';

// ── Document attached to a collateral item ────────────────────────────────────

export interface CollateralDocument {
  id:             string;
  name:           string;
  mimeType:       string;
  sizeBytes:      number;
  uploadedAt:     string;
  uploadedByName: string;
}

// ── Core collateral entity ────────────────────────────────────────────────────

export interface CollateralItem {
  id:             string;
  type:           CollateralType;
  description:    string;
  estimatedValue: number;
  status:         CollateralStatus;
  /** Present when fetched from the dedicated collateral endpoint. */
  invoiceId?:     string;
  expiryDate?:    string | null;
  documents?:     CollateralDocument[];
  createdAt?:     string;
  updatedAt?:     string;
}

// ── Mutation payloads (outgoing — snake_case converted by request interceptor) ─

export interface CreateCollateralPayload {
  type:             CollateralType;
  description:      string;
  estimated_value:  number;
  expiry_date?:     string;
}

export interface UpdateCollateralPayload {
  type?:            CollateralType;
  description?:     string;
  estimated_value?: number;
  expiry_date?:     string | null;
  /** Reason stored in the audit log when value changes. */
  reason?:          string;
}

// ── Value change audit log ────────────────────────────────────────────────────

export interface CollateralAuditEntry {
  id:            string;
  changedAt:     string;
  changedByName: string;
  oldValue:      number;
  newValue:      number;
  reason:        string | null;
}
