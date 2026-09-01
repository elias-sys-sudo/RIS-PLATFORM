Zero TypeScript errors. All changes compile cleanly. Here's a full summary of everything delivered:

---

## Summary of changes

### New files created

| File | Purpose |
|------|---------|
| `src/lib/parseApiError.ts` | Centralized error parser — extracts server message → network fallback → status fallback |
| `src/hooks/useOnlineStatus.ts` | Lightweight hook returning browser `online`/`offline` state |
| `src/hooks/useFormPersist.ts` | `useFormPersist`, `readPersistedForm`, `clearPersistedForm`, `hasPersistedForm` — sessionStorage persistence |
| `src/components/display/TruncatedText.tsx` | Ellipsis truncation + native tooltip that only appears when text is actually clipped (ResizeObserver) |
| `src/pages/errors/NotFoundPage.tsx` | Styled 404 page with `variant="route"` / `variant="resource"` modes |
| `src/pages/errors/AccessDeniedPage.tsx` | Styled 403 page with "Go to Dashboard" link |
| `src/pages/errors/errors.css` | Shared styles for error pages |
| `src/components/overlays/NetworkErrorBanner.tsx` | `NetworkErrorProvider` + floating "Connection lost" banner with Retry button; auto-listens for the axios `mms:network-error` DOM event |

### Modified files

| File | What changed |
|------|-------------|
| `src/lib/axios.ts` | Fires `mms:network-error` DOM event on every network-level failure (no HTTP response) |
| `src/components/overlays/OfflineIndicator.tsx` | Now uses `useOnlineStatus` hook; adds Retry button to the offline banner; re-exports `useOnlineStatus` |
| `src/components/forms/LoadingButton.tsx` | New `mutating` prop — auto-disables + shows tooltip "You are offline…" when offline |
| `src/components/display/DataTable.tsx` | New `isFetching` prop — renders an animated blue sweep bar at the top when refetching stale data (content stays visible) |
| `src/components/display/DataTable.css` | `@keyframes data-table-refresh-sweep` animation |
| `src/App.tsx` | 404 → `NotFoundPage`; `RoleRoute` → `AccessDeniedPage` instead of silent redirect; `ErrorBoundary` wraps all pages; `NetworkErrorProvider` wraps the app; cross-tab logout listener via `window.addEventListener('storage', …)` |
| `src/pages/invoices/InvoicesPage.tsx` | `isFetching` passed to DataTable; supplier sees "Submit your first invoice" empty state with CTA; row action mutations now show error toasts via `parseApiError` |
| `src/pages/invoices/InvoiceCreatePage.tsx` | Form state persisted to sessionStorage on every change; restored on mount; cleared on successful submit |
| `src/pages/invoices/InvoiceDetailPage.tsx` | Fixed `DetailSkeleton` (removed non-existent `lines` prop); 404 resource error now renders `NotFoundPage` with back button |
| `src/pages/auth/LoginPage.tsx` | Detects saved form state (`hasPersistedForm`) → shows "Your session expired, continue where you left off" info banner → redirects to `/invoices/new` after re-login |
| `src/pages/auth/auth.css` | Added `.auth-alert--info` and `.auth-alert--warning` styles |
| `src/pages/invoices/steps/Step1InvoiceDetails.tsx` | Validation summary banner at top of form (shown on submit attempt) listing all errors as anchor links to the fields |
| `src/pages/invoices/InvoiceCreatePage.css` | `.wizard-validation-summary` styles |
