All done, zero TypeScript errors. Here's what was built:

---

### Files changed / created

| File | Change |
|---|---|
| `types/invoice.types.ts` | Added 8 new types: `StatusTransition`, `ApprovalDecision`, `RiskBreakdown`, `InvoiceDocument`, `CollateralItem`, `BuyerInfo`, `SupplierInfo`, `InvoiceDetail` |
| `mocks/handlers/invoice.handlers.ts` | `GET /api/invoices/:id` now returns full `InvoiceDetail`. Added 6 new action endpoints: `approve`, `reject`, `request-info`, `fund`, `authorise`, `override` |
| `services/invoices.api.ts` | `fetchInvoice` returns `InvoiceDetail`. Added 6 new API functions |
| `hooks/useInvoices.ts` | Added 6 new mutation hooks: `useApproveInvoice`, `useRejectInvoice`, `useRequestInfo`, `useFundInvoice`, `useAuthoriseInvoice`, `useOverrideInvoice` |
| `pages/invoices/InvoiceDetailPage.tsx` | New page — all sub-components inline |
| `pages/invoices/InvoiceDetailPage.css` | New stylesheet |
| `App.tsx` | `/invoices/:id` now renders `<InvoiceDetailPage />` |

---

### Page structure

**Left column (65%):** Invoice header (number, dates, status) → Financials card (face value headline + 6-cell grid) → Buyer info → Supplier info (hidden for `supplier` role) → Documents with download buttons → Collateral items

**Right column (35%):** Action panel (role+status gated) → Risk assessment (large coloured composite score + 5 progress bars) → Status timeline (vertical, badged) → Approval history (tier decisions)

**Action panel logic:**
- `supplier` + `draft` → Edit + Submit
- `credit_officer` + `under_review` → Approve / Reject (with textarea) / Request Info
- `finance_manager` + `approved` → Initiate Disbursement / Reject
- `finance_manager` + `pending_first_auth` / `pending_second_auth` → Authorise
- `management` → Override Status (collapsed until clicked, requires reason textarea)
- All other roles / statuses → panel hidden
