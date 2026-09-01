// ============================================================
// complaints.types.ts — Interfaces, enums, error codes
// ============================================================

export enum ComplaintStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum ComplaintPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplaintCategory {
  BILLING = 'BILLING',
  SERVICE = 'SERVICE',
  PAYMENT = 'PAYMENT',
  PRICING = 'PRICING',
  GENERAL = 'GENERAL',
}

export enum ComplaintErrorCode {
  NOT_FOUND = 'COMPLAINT_NOT_FOUND',
  ALREADY_RESOLVED = 'COMPLAINT_ALREADY_RESOLVED',
  INVALID_STATUS = 'COMPLAINT_INVALID_STATUS',
}

export interface ComplaintRecord {
  id: string;
  complainant_id: string;
  entity_type: string;
  entity_id: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  resolution: string | null;
  amount_involved: string;
  escalated: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateComplaintInput {
  entity_type: string;
  entity_id?: string;
  subject: string;
  description: string;
  category: string;
  amount_involved?: number;
}

export interface UpdateComplaintInput {
  status?: string;
  priority?: string;
  assigned_to?: string;
}

export interface ComplaintFilters {
  status?: string;
  category?: string;
  complainant_id?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
