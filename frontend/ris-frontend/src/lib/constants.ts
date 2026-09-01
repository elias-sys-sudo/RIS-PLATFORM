import type { Role } from '@/types/auth.types';

/* ── Invoice Status ─────────────────────────────────────── */
export type InvoiceStatus =
  | 'draft'
  | 'submitted'
  | 'buyer_confirmed'
  | 'scored'
  | 'priced'
  | 'approved'
  | 'rejected'
  | 'pending_first_auth'
  | 'pending_second_auth'
  | 'executing'
  | 'funded'
  | 'collecting'
  | 'overdue'
  | 'collected'
  | 'defaulted'
  | 'cancelled'
  | 'withdrawn';

/* ── Escalation Level ──────────────────────────────────── */
export type EscalationLevel = 'none' | 'reminder' | 'formal' | 'legal';

/* ── Risk Level ────────────────────────────────────────── */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/* ── Badge Variants ────────────────────────────────────── */
export type BadgeVariant = 'invoice' | 'escalation' | 'risk';
export type BadgeStatus = InvoiceStatus | EscalationLevel | RiskLevel | 'pending' | 'failed';

/* ── Roles ─────────────────────────────────────────────── */
/** Single source of truth lives in types/auth.types.ts. Re-exported here so the
 *  many existing `@/lib/constants` imports keep working without duplication. */
export type { Role };

export const ALL_ROLES: Role[] = [
  'supplier', 'credit_officer', 'finance_manager',
  'management', 'compliance_officer', 'auditor', 'legal',
];

/** Roles that can be created by admin. Suppliers self-register via onboarding. */
export const STAFF_ROLES: Role[] = [
  'credit_officer', 'finance_manager',
  'management', 'compliance_officer', 'auditor', 'legal',
];

export const ROLE_LABELS: Record<Role, string> = {
  supplier:            'Supplier',
  credit_officer:      'Credit Officer',
  finance_manager:     'Finance Manager',
  management:          'Management',
  compliance_officer:  'Compliance Officer',
  auditor:             'Auditor',
  legal:               'Legal',
};

/* ── Invoice Status Labels ─────────────────────────────── */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft:               'Draft',
  submitted:           'Submitted',
  buyer_confirmed:     'Buyer Confirmed',
  scored:              'Scored',
  priced:              'Priced',
  approved:            'Approved',
  rejected:            'Rejected',
  pending_first_auth:  '1st Auth Pending',
  pending_second_auth: '2nd Auth Pending',
  executing:           'Executing',
  funded:              'Funded',
  collecting:          'Collecting',
  overdue:             'Overdue',
  collected:           'Collected',
  defaulted:           'Defaulted',
  cancelled:           'Cancelled',
  withdrawn:           'Withdrawn',
};

/* ── Invoice Status Colours (warm palette for charts) ── */
export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft:               'hsl(30 6% 58%)',
  submitted:           'hsl(160 40% 40%)',
  buyer_confirmed:     'hsl(172 50% 42%)',
  scored:              'hsl(263 55% 55%)',
  priced:              'hsl(255 50% 52%)',
  approved:            'hsl(142 71% 40%)',
  rejected:            'hsl(0 72% 55%)',
  pending_first_auth:  'hsl(38 92% 50%)',
  pending_second_auth: 'hsl(38 85% 48%)',
  executing:           'hsl(45 90% 50%)',
  funded:              'hsl(152 82% 32%)',
  collecting:          'hsl(220 65% 55%)',
  overdue:             'hsl(25 95% 53%)',
  collected:           'hsl(160 60% 38%)',
  defaulted:           'hsl(0 72% 48%)',
  cancelled:           'hsl(30 6% 48%)',
  withdrawn:           'hsl(215 14% 52%)',
};

/* ── Escalation Labels ───────────────────────────────── */
export const ESCALATION_LABELS: Record<EscalationLevel, string> = {
  none:     'None',
  reminder: 'Reminder',
  formal:   'Formal Notice',
  legal:    'Legal Action',
};
