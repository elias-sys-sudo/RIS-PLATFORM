// =========================================================================
// Notification service types
// =========================================================================

/** Supported notification delivery channels. */
export type NotificationChannel = 'email' | 'sms';

/** Job priority levels. */
export type NotificationPriority = 'high' | 'normal' | 'low';

/** Email template identifiers. */
export type EmailTemplate =
  | 'password_reset'
  | 'invoice_created'
  | 'payment_received'
  | 'collection_escalation'
  | 'welcome'
  | 'document_comment_added'
  | 'new_document_uploaded'
  | 'financing_timeline_due'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'settlement_complete'
  | 'buyer_confirmation'
  | 'confirmation_reminder'
  | 'payment_funded'
  | 'pricing_ready'
  | 'payment_failed'
  | 'info_requested'
  | 'invoice_rejected'
  | 'sla_escalation'
  | 'assessment_sla_reminder'
  | 'assessment_sla_overdue'
  | 'invoice_dispute'
  | 'buyer_confirmation_overdue'
  | 'overdue_notification'
  | 'escalation_notification'
  | 'invoice_reminder'
  | 'buyer_payment_escalation'
  | 'invoice_defaulted'
  | 'supplier_payment_notification'
  | 'escalation_document_sent'
  | 'complaint_filed'
  | 'complaint_resolved'
  | 'complaint_escalated'
  | 'aml_cleared'
  | 'aml_review_required'
  | 'facility_utilisation_alert'
  | 'facility_maturity_alert'
  | 'collateral_expiry_warning'
  | 'document_expiry_warning'
  | 'supplier_feedback'
  | 'buyer_request_submitted'
  | 'buyer_request_reviewed'
  | 'inactive_account_warning'
  | 'email_verification'
  | 'new_device_login';

/** SMS template identifiers. */
export type SmsTemplate = 'payment_reminder' | 'payment_confirmation' | 'escalation_notice';

/** Combined template type. */
export type NotificationTemplate = EmailTemplate | SmsTemplate;

/** Rendered email content. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Rendered SMS content. */
export interface RenderedSms {
  message: string;
}

/** Notification job payload stored in the queue. */
export interface NotificationJobPayload {
  id: string;
  channel: NotificationChannel;
  template: NotificationTemplate;
  recipient: string;
  data: Record<string, unknown>;
  priority: NotificationPriority;
  attempts: number;
  max_attempts: number;
  created_at: string;
  scheduled_at?: string;
}

/** Result of a provider send attempt. */
export interface SendResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  durationMs: number;
}

/** Circuit breaker state for a provider. */
export interface CircuitBreakerState {
  consecutiveFailures: number;
  pausedUntil: number | null;
}

/** Health check result. */
export interface NotificationHealthStatus {
  healthy: boolean;
  email: {
    configured: boolean;
    circuitOpen: boolean;
  };
  sms: {
    configured: boolean;
    circuitOpen: boolean;
  };
}

/** Password reset email template data. */
export interface PasswordResetData {
  token_url: string;
  expiry_minutes: number;
  user_name: string;
}

/** Email verification template data — sent at supplier registration. */
export interface EmailVerificationData {
  verification_url: string;
  expiry_hours: number;
  user_name: string;
}

/** New device login template data — REQ-AUTH-007. */
export interface NewDeviceLoginData {
  user_name: string;
  ip_address: string;
  user_agent: string;
  login_timestamp: string;
  reset_url: string;
}

/** Invoice created email template data. */
export interface InvoiceCreatedData {
  invoice_number: string;
  amount: string;
  buyer_name: string;
  due_date: string;
}

/** Payment received email template data. */
export interface PaymentReceivedData {
  amount: string;
  reference: string;
  remaining_balance: string;
}

/** Collection escalation email template data. */
export interface CollectionEscalationData {
  escalation_level: string;
  amount_overdue: string;
  days_overdue: number;
  next_action: string;
}

/** Welcome email template data. */
export interface WelcomeData {
  user_name: string;
  login_url: string;
}

/** Document comment added email template data. */
export interface DocumentCommentAddedData {
  document_type: string;
  comment_snippet: string;
  login_url: string;
}

/** New document uploaded email template data (for staff). */
export interface NewDocumentUploadedData {
  document_type: string;
  login_url: string;
}

/** Financing timeline due email template data. */
export interface FinancingTimelineDueData {
  invoice_number: string;
  due_date: string;
  amount: string;
  login_url: string;
}

/** KYC approved email template data. */
export interface KycApprovedData {
  user_name: string;
  login_url: string;
}

/** KYC rejected email template data. */
export interface KycRejectedData {
  user_name: string;
  rejection_reason: string;
  login_url: string;
}

/** Settlement complete email template data. */
export interface SettlementCompleteData {
  invoice_number: string;
  net_profit: string;
  settlement_id: string;
  login_url: string;
}

/** Payment reminder SMS template data. */
export interface PaymentReminderSmsData {
  name: string;
  amount: string;
  invoice_no: string;
  days: number;
  paybill: string;
  ref: string;
}

/** Payment confirmation SMS template data. */
export interface PaymentConfirmationSmsData {
  amount: string;
  ref: string;
  balance: string;
}

/** Escalation notice SMS template data. */
export interface EscalationNoticeSmsData {
  invoice_no: string;
  days: number;
  amount: string;
  contact: string;
}

// =========================================================================
// Extended email template data — workflow, collections, compliance, etc.
// =========================================================================

/** Buyer confirmation magic-link email (single most important email). */
export interface BuyerConfirmationData {
  buyer_name: string;
  supplier_name: string;
  invoice_number: string;
  amount: string;
  due_date: string;
  confirmation_url: string;
  expiry_hours: number;
}

/** Reminder for buyer to click their confirmation link before deadline. */
export interface ConfirmationReminderData {
  buyer_name: string;
  supplier_name: string;
  invoice_number: string;
  amount: string;
  confirmation_url: string;
  deadline: string;
}

/** Payment funded notification to supplier. */
export interface PaymentFundedData {
  supplier_name: string;
  invoice_number: string;
  amount_disbursed: string;
  reference: string;
  expected_arrival: string;
  login_url: string;
}

/** Pricing ready notification — supplier must accept or dispute. */
export interface PricingReadyData {
  supplier_name: string;
  invoice_number: string;
  face_value: string;
  advance_amount: string;
  discount_amount: string;
  expiry: string;
  login_url: string;
}

/** Payment provider failure notification to finance_manager. */
export interface PaymentFailedData {
  invoice_number: string;
  amount: string;
  provider: string;
  error_message: string;
  attempts: number;
  login_url: string;
}

/** Credit officer is requesting more information about an invoice. */
export interface InfoRequestedData {
  supplier_name: string;
  invoice_number: string;
  requested_info: string;
  officer_name: string;
  deadline: string;
  login_url: string;
}

/** Invoice rejected by credit officer or risk engine. */
export interface InvoiceRejectedData {
  supplier_name: string;
  invoice_number: string;
  rejection_reason: string;
  rejected_by: string;
  login_url: string;
}

/** SLA escalation for assessment beyond target window. */
export interface SlaEscalationData {
  invoice_number: string;
  supplier_name: string;
  hours_overdue: number;
  sla_deadline: string;
  assigned_officer: string;
  login_url: string;
}

/** Day 3 assessment SLA reminder. */
export interface AssessmentSlaReminderData {
  invoice_number: string;
  supplier_name: string;
  days_in_queue: number;
  sla_deadline: string;
  login_url: string;
}

/** Day 7 assessment SLA breached. */
export interface AssessmentSlaOverdueData {
  invoice_number: string;
  supplier_name: string;
  days_in_queue: number;
  assigned_officer: string;
  login_url: string;
}

/** Buyer filed a dispute against an invoice. */
export interface InvoiceDisputeData {
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  dispute_reason: string;
  filed_at: string;
  login_url: string;
}

/** Buyer hasn't confirmed an invoice within the window. */
export interface BuyerConfirmationOverdueData {
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  hours_overdue: number;
  login_url: string;
}

/** Gentle first overdue reminder to buyer. */
export interface OverdueNotificationData {
  buyer_name: string;
  invoice_number: string;
  amount_due: string;
  days_overdue: number;
  payment_instructions: string;
  contact_email: string;
}

/** Internal escalation tier triggered. */
export interface EscalationNotificationData {
  buyer_name: string;
  invoice_number: string;
  amount_due: string;
  escalation_level: string;
  days_overdue: number;
  next_action: string;
  contact_email: string;
}

/** Scheduled payment reminder to buyer. */
export interface InvoiceReminderData {
  buyer_name: string;
  invoice_number: string;
  amount_due: string;
  due_date: string;
  payment_instructions: string;
}

/** Firmer-toned payment escalation to buyer. */
export interface BuyerPaymentEscalationData {
  buyer_name: string;
  invoice_number: string;
  amount_due: string;
  days_overdue: number;
  consequence: string;
  contact_email: string;
}

/** Invoice has moved to defaulted status. */
export interface InvoiceDefaultedData {
  buyer_name: string;
  invoice_number: string;
  amount_outstanding: string;
  days_overdue: number;
  next_legal_action: string;
  contact_email: string;
}

/** Buyer paid invoice; collection complete notification to supplier. */
export interface SupplierPaymentNotificationData {
  supplier_name: string;
  invoice_number: string;
  amount_collected: string;
  paid_on: string;
  login_url: string;
}

/** Demand letter / legal escalation document sent to buyer. */
export interface EscalationDocumentSentData {
  buyer_name: string;
  invoice_number: string;
  document_type: string;
  amount_outstanding: string;
  response_deadline: string;
  contact_email: string;
}

/** New complaint logged in the system. */
export interface ComplaintFiledData {
  complaint_id: string;
  complainant_name: string;
  category: string;
  summary: string;
  filed_at: string;
  login_url: string;
}

/** Complaint marked resolved with resolution notes. */
export interface ComplaintResolvedData {
  complaint_id: string;
  complainant_name: string;
  resolution_summary: string;
  resolved_by: string;
  resolved_at: string;
  login_url: string;
}

/** Complaint escalated to higher tier. */
export interface ComplaintEscalatedData {
  complaint_id: string;
  complainant_name: string;
  escalation_reason: string;
  escalated_to: string;
  login_url: string;
}

/** AML hold cleared on an invoice. */
export interface AmlClearedData {
  invoice_number: string;
  supplier_name: string;
  cleared_by: string;
  cleared_at: string;
  notes: string;
  login_url: string;
}

/** New invoice exceeds AML threshold; compliance review required. */
export interface AmlReviewRequiredData {
  invoice_number: string;
  supplier_name: string;
  face_value: string;
  threshold: string;
  login_url: string;
}

/** Bank facility utilisation crossed threshold. */
export interface FacilityUtilisationAlertData {
  facility_name: string;
  utilisation_pct: string;
  threshold_pct: string;
  utilised_amount: string;
  total_limit: string;
  login_url: string;
}

/** Bank facility approaching maturity date. */
export interface FacilityMaturityAlertData {
  facility_name: string;
  maturity_date: string;
  days_to_maturity: number;
  outstanding_balance: string;
  login_url: string;
}

/** Pledged collateral approaching expiry. */
export interface CollateralExpiryWarningData {
  supplier_name: string;
  collateral_type: string;
  collateral_reference: string;
  expiry_date: string;
  days_to_expiry: number;
  login_url: string;
}

/** KYC document approaching expiry. */
export interface DocumentExpiryWarningData {
  supplier_name: string;
  document_type: string;
  expiry_date: string;
  days_to_expiry: number;
  login_url: string;
}

/** New supplier feedback submitted. */
export interface SupplierFeedbackData {
  supplier_name: string;
  feedback_category: string;
  rating: string;
  comments: string;
  submitted_at: string;
  login_url: string;
}

/** Supplier submitted a buyer onboarding request. */
export interface BuyerRequestSubmittedData {
  supplier_name: string;
  buyer_name: string;
  buyer_contact: string;
  submitted_at: string;
  login_url: string;
}

/** Buyer onboarding request was approved or rejected. */
export interface BuyerRequestReviewedData {
  supplier_name: string;
  buyer_name: string;
  decision: string;
  reviewer_notes: string;
  login_url: string;
}

/** Account inactive 90+ days; will be locked. */
export interface InactiveAccountWarningData {
  user_name: string;
  days_inactive: number;
  lock_date: string;
  login_url: string;
}
