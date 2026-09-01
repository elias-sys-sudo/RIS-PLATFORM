// ── Profile ───────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface UpdateProfileRequest {
  name: string;
  email: string;
  phone: string;
}

// ── Notification preferences ──────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'sms';

export type NotificationEventType =
  | 'invoice_submitted'
  | 'invoice_approved'
  | 'invoice_rejected'
  | 'payment_disbursed'
  | 'payment_received'
  | 'collection_due'
  | 'collection_overdue'
  | 'approval_required'
  | 'dual_auth_required'
  | 'document_uploaded';

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  invoice_submitted:   'Invoice submitted',
  invoice_approved:    'Invoice approved',
  invoice_rejected:    'Invoice rejected',
  payment_disbursed:   'Payment disbursed',
  payment_received:    'Payment received',
  collection_due:      'Collection due',
  collection_overdue:  'Collection overdue',
  approval_required:   'Approval required',
  dual_auth_required:  'Dual authorisation required',
  document_uploaded:   'Document uploaded',
};

export type NotificationPreferences = Record<
  NotificationEventType,
  Record<NotificationChannel, boolean>
>;
