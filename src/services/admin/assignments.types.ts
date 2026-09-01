// =============================================================================
// Assignments — Types, Interfaces & Enums
// =============================================================================

/** Entity types that can be assigned to a credit officer. */
export type AssignmentEntityType = 'supplier_kyc' | 'invoice';

/** Error codes specific to the assignments module. */
export enum AssignmentErrorCode {
  NOT_FOUND = 'ASSIGNMENT_NOT_FOUND',
  ALREADY_ASSIGNED = 'ASSIGNMENT_ALREADY_ASSIGNED',
  ENTITY_NOT_FOUND = 'ASSIGNMENT_ENTITY_NOT_FOUND',
  ASSIGNEE_NOT_FOUND = 'ASSIGNMENT_ASSIGNEE_NOT_FOUND',
  INVALID_ENTITY_TYPE = 'ASSIGNMENT_INVALID_ENTITY_TYPE',
}

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/** Row from application_assignments table. */
export interface AssignmentRecord {
  id: string;
  entity_type: AssignmentEntityType;
  entity_id: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: string;
  notes: string | null;
  is_active: boolean;
}

// -------------------------------------------------------------------------
// Request/response types
// -------------------------------------------------------------------------

/** Body for POST /assignments. */
export interface CreateAssignmentInput {
  entity_type: AssignmentEntityType;
  entity_id: string;
  assigned_to: string;
  notes?: string;
}

/** Item returned in the officer's queue. */
export interface AssignmentQueueItem {
  id: string;
  entity_type: AssignmentEntityType;
  entity_id: string;
  assigned_at: string;
  notes: string | null;
}
