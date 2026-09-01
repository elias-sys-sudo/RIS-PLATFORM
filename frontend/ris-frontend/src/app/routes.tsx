import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';

/** Legacy alias from earlier internal docs — redirects /kyc/:id/review → /admin/suppliers/:id/kyc. */
function KycReviewRedirect(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/admin/suppliers/${id ?? ''}/kyc`} replace />;
}
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from './layout/app-shell';
import { ProtectedRoute, PublicRoute, RoleRoute } from './route-guards';

// ── Lazy route imports ──────────────────────────────────────────────────────

// Auth
const LoginPage          = React.lazy(() => import('@/features/auth/pages/login-page'));
const TwoFactorPage      = React.lazy(() => import('@/features/auth/pages/two-factor-page'));
const ForgotPasswordPage = React.lazy(() => import('@/features/auth/pages/forgot-password-page'));
const ResetPasswordPage  = React.lazy(() => import('@/features/auth/pages/reset-password-page'));
const VerifyEmailPage    = React.lazy(() => import('@/features/auth/pages/verify-email-page'));
const ResendVerificationPage = React.lazy(() => import('@/features/auth/pages/resend-verification-page'));

// Onboarding (public)
const EligibilityPage    = React.lazy(() => import('@/features/onboarding/pages/eligibility-page'));
const RegistrationPage   = React.lazy(() => import('@/features/onboarding/pages/registration-page'));

// Errors
const NotFoundPage       = React.lazy(() => import('@/features/errors/not-found-page'));
const AccessDeniedPage   = React.lazy(() => import('@/features/errors/access-denied-page'));

// Dashboard
const DashboardPage      = React.lazy(() => import('@/features/dashboard/pages/dashboard-page'));

// Invoices
const InvoicesListPage   = React.lazy(() => import('@/features/invoices/pages/invoices-list-page'));
const InvoiceDetailPage  = React.lazy(() => import('@/features/invoices/pages/invoice-detail-page'));
const InvoiceCreatePage  = React.lazy(() => import('@/features/invoices/pages/invoice-create-page'));

// Approvals
const ApprovalsListPage  = React.lazy(() => import('@/features/approvals/pages/approvals-list-page'));
const ApprovalReviewPage = React.lazy(() => import('@/features/approvals/pages/approval-review-page'));
const ApprovalHistoryPage = React.lazy(() => import('@/features/approvals/pages/approval-history-page'));

// Payments
const PaymentsListPage   = React.lazy(() => import('@/features/payments/pages/payments-list-page'));
const PaymentDetailPage  = React.lazy(() => import('@/features/payments/pages/payment-detail-page'));

// Collections
const CollectionsListPage = React.lazy(() => import('@/features/collections/pages/collections-list-page'));
const CollectionDetailPage = React.lazy(() => import('@/features/collections/pages/collection-detail-page'));

// Facilities
const FacilitiesListPage = React.lazy(() => import('@/features/facilities/pages/facilities-list-page'));
const FacilityDetailPage = React.lazy(() => import('@/features/facilities/pages/facility-detail-page'));

// Suppliers & Buyers
const SuppliersListPage  = React.lazy(() => import('@/features/suppliers/pages/suppliers-list-page'));
const SupplierDetailPage = React.lazy(() => import('@/features/suppliers/pages/supplier-detail-page'));
const BuyersListPage       = React.lazy(() => import('@/features/buyers/pages/buyers-list-page'));
const BuyerDetailPage      = React.lazy(() => import('@/features/buyers/pages/buyer-detail-page'));
const BuyerCreatePage      = React.lazy(() => import('@/features/buyers/pages/buyer-create-page'));
const BuyerRequestsPage    = React.lazy(() => import('@/features/buyers/pages/buyer-requests-page'));

// Reporting
const ReportingPage      = React.lazy(() => import('@/features/reporting/pages/reporting-page'));

// Settings
const ProfilePage        = React.lazy(() => import('@/features/settings/pages/profile-page'));
const ChangePasswordPage = React.lazy(() => import('@/features/settings/pages/change-password-page'));
const NotificationsPage  = React.lazy(() => import('@/features/settings/pages/notifications-page'));
const TwoFactorSetupPage = React.lazy(() => import('@/features/settings/pages/two-factor-setup-page'));

// Admin
const UsersPage          = React.lazy(() => import('@/features/admin/pages/users-page'));
const RiskConfigPage     = React.lazy(() => import('@/features/admin/pages/risk-config-page'));

// Verification (public)
const BuyerVerificationPage = React.lazy(() => import('@/features/verification/pages/buyer-verification-page'));

// KYC
const KycDocumentsPage = React.lazy(() => import('@/features/kyc/pages/kyc-documents-page'));
const KycReviewPage    = React.lazy(() => import('@/features/kyc/pages/kyc-review-page'));

// Settlements
const SettlementsListPage  = React.lazy(() => import('@/features/settlements/pages/settlements-list-page'));
const SettlementDetailPage = React.lazy(() => import('@/features/settlements/pages/settlement-detail-page'));

// Dev
const ComponentsGalleryPage = React.lazy(() => import('@/features/dev/pages/components-gallery-page'));
const DesignSystemPage = React.lazy(() => import('@/features/dev/pages/design-system-page'));

// ── Page fallback ───────────────────────────────────────────────────────────

function PageFallback(): React.ReactElement {
  return (
    <div className="animate-in fade-in duration-200 space-y-6 p-6">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 opacity-60" />
      </div>
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      {/* Table / content block */}
      <div className="rounded-xl border p-4 space-y-3">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

// ── App routes ──────────────────────────────────────────────────────────────

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      {/* ── Public auth routes ── */}
      <Route path="/login" element={<PublicRoute><Suspense fallback={<PageFallback />}><LoginPage /></Suspense></PublicRoute>} />
      <Route path="/2fa" element={<Suspense fallback={<PageFallback />}><TwoFactorPage /></Suspense>} />
      <Route path="/forgot-password" element={<PublicRoute><Suspense fallback={<PageFallback />}><ForgotPasswordPage /></Suspense></PublicRoute>} />
      <Route path="/reset-password" element={<PublicRoute><Suspense fallback={<PageFallback />}><ResetPasswordPage /></Suspense></PublicRoute>} />
      <Route path="/verify-email" element={<PublicRoute><Suspense fallback={<PageFallback />}><VerifyEmailPage /></Suspense></PublicRoute>} />
      <Route path="/resend-verification" element={<PublicRoute><Suspense fallback={<PageFallback />}><ResendVerificationPage /></Suspense></PublicRoute>} />

      {/* ── Public onboarding routes ── */}
      <Route path="/eligibility" element={<Suspense fallback={<PageFallback />}><EligibilityPage /></Suspense>} />
      <Route path="/register" element={<Suspense fallback={<PageFallback />}><RegistrationPage /></Suspense>} />

      {/* ── Public verification route (no auth required) ── */}
      <Route path="/verify/:token" element={<Suspense fallback={<PageFallback />}><BuyerVerificationPage /></Suspense>} />

      {/* ── Protected app routes ── */}
      <Route path="/*" element={
        <ProtectedRoute>
          <AppShell>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />

                {/* Invoices */}
                <Route path="/invoices" element={<InvoicesListPage />} />
                <Route path="/invoices/new" element={<InvoiceCreatePage />} />
                <Route path="/invoices/:id" element={<InvoiceDetailPage />} />

                {/* Approvals */}
                <Route path="/approvals" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer']}><ApprovalsListPage /></RoleRoute>} />
                <Route path="/approvals/history" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer']}><ApprovalHistoryPage /></RoleRoute>} />
                <Route path="/approvals/:id" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer']}><ApprovalReviewPage /></RoleRoute>} />

                {/* Payments */}
                <Route path="/payments" element={<RoleRoute allowed={['finance_manager', 'management']}><PaymentsListPage /></RoleRoute>} />
                <Route path="/payments/:id" element={<RoleRoute allowed={['finance_manager', 'management']}><PaymentDetailPage /></RoleRoute>} />

                {/* Collections */}
                <Route path="/collections" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management']}><CollectionsListPage /></RoleRoute>} />
                <Route path="/collections/:id" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management']}><CollectionDetailPage /></RoleRoute>} />

                {/* Facilities */}
                <Route path="/facilities" element={<RoleRoute allowed={['finance_manager', 'management']}><FacilitiesListPage /></RoleRoute>} />
                <Route path="/facilities/:id" element={<RoleRoute allowed={['finance_manager', 'management']}><FacilityDetailPage /></RoleRoute>} />

                {/* Suppliers & Buyers */}
                <Route path="/suppliers" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer']}><SuppliersListPage /></RoleRoute>} />
                <Route path="/suppliers/:id" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer']}><SupplierDetailPage /></RoleRoute>} />
                <Route path="/buyers" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'supplier']}><BuyersListPage /></RoleRoute>} />
                <Route path="/buyers/new" element={<RoleRoute allowed={['credit_officer', 'management']}><BuyerCreatePage /></RoleRoute>} />
                <Route path="/buyers/:id" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'supplier']}><BuyerDetailPage /></RoleRoute>} />
                <Route path="/buyer-requests" element={<RoleRoute allowed={['credit_officer', 'management']}><BuyerRequestsPage /></RoleRoute>} />

                {/* KYC */}
                <Route path="/kyc" element={<RoleRoute allowed={['supplier']}><KycDocumentsPage /></RoleRoute>} />
                {/* Open to every staff role for viewing; write actions (approve/reject, feedback)
                    are separately gated at the backend AND inside the page UI. */}
                <Route path="/admin/suppliers/:id/kyc" element={<RoleRoute allowed={['credit_officer', 'compliance_officer', 'management', 'finance_manager', 'auditor', 'legal']}><KycReviewPage /></RoleRoute>} />
                {/* Convenience alias — /kyc/:id/review → /admin/suppliers/:id/kyc */}
                <Route path="/kyc/:id/review" element={<KycReviewRedirect />} />

                {/* Settlements */}
                <Route path="/settlements" element={<RoleRoute allowed={['finance_manager', 'management']}><SettlementsListPage /></RoleRoute>} />
                <Route path="/settlements/:id" element={<RoleRoute allowed={['finance_manager', 'management']}><SettlementDetailPage /></RoleRoute>} />

                {/* Reporting */}
                <Route path="/reporting" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer', 'auditor']}><ReportingPage /></RoleRoute>} />
                <Route path="/reporting/:type" element={<RoleRoute allowed={['credit_officer', 'finance_manager', 'management', 'compliance_officer', 'auditor']}><ReportingPage /></RoleRoute>} />

                {/* Settings */}
                <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
                <Route path="/settings/profile" element={<ProfilePage />} />
                <Route path="/settings/change-password" element={<ChangePasswordPage />} />
                <Route path="/settings/notifications" element={<NotificationsPage />} />
                <Route path="/settings/2fa" element={<TwoFactorSetupPage />} />

                {/* Admin */}
                <Route path="/admin/users" element={<RoleRoute allowed={['management']}><UsersPage /></RoleRoute>} />
                <Route path="/admin/risk-config" element={<RoleRoute allowed={['management']}><RiskConfigPage /></RoleRoute>} />

                {/* Dev (only in development) */}
                <Route path="/dev/components" element={<ComponentsGalleryPage />} />
                <Route path="/dev/design-system" element={<DesignSystemPage />} />

                {/* Errors */}
                <Route path="/access-denied" element={<Suspense fallback={<PageFallback />}><AccessDeniedPage /></Suspense>} />
                <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFoundPage /></Suspense>} />
              </Routes>
            </Suspense>
          </AppShell>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
