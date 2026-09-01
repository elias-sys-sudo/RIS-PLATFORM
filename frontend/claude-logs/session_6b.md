All 9 files are in place and TypeScript is clean. Here's a summary of everything built:

---

## What was built

### New files (9)

| File | Purpose |
|---|---|
| `src/types/supplier.types.ts` | Full type definitions — `Supplier`, `SupplierDetail`, `SupplierBuyer`, `SupplierPaymentItem`, breakdowns, filters, paginated responses |
| `src/services/suppliers.api.ts` | Axios API client for `/suppliers`, `/suppliers/:id`, `/suppliers/:id/buyers`, `/suppliers/:id/payments` |
| `src/hooks/useSuppliers.ts` | `useSuppliers` / `useSupplier` / `useSupplierBuyers` / `useSupplierPayments` — all with stale-time, placeholderData, and typed query keys |
| `src/mocks/handlers/suppliers.handlers.ts` | MSW handlers — 5 suppliers, 10 buyers, 12 payments/supplier with search/status/method filtering and pagination |
| `src/pages/suppliers/SuppliersPage.tsx` | `/suppliers` — DataTable with company+contact cell, email, invoice count, outstanding UGX, risk band badge (reuses `StatusBadge variant="risk"`), status badge, search input, status filter chips |
| `src/pages/suppliers/SuppliersPage.css` | Scoped CSS |
| `src/pages/suppliers/SupplierDetailPage.tsx` | `/suppliers/:id` — profile, metrics, invoice donut, active collections, buyers sub-table, payment history table + bar chart, all sections fire queries in parallel with individual skeletons |
| `src/pages/suppliers/SupplierDetailPage.css` | Scoped CSS |

### Updated files (2)
- **`src/mocks/browser.ts`** — registered `suppliersHandlers`
- **`src/App.tsx`** — added `Building2` icon, `Suppliers` nav item, `/suppliers` and `/suppliers/:id` routes

### Architecture notes
- **Parallel loading**: `ProfileCard`, `MetricsCard`, `InvoiceStatusSection`, `ActiveCollectionsSection` each call `useSupplier(id)` independently — React Query deduplicates the network request but each section renders its own skeleton while waiting
- **`BuyersSection`** and **`PaymentHistorySection`** fire separate queries (`useSupplierBuyers` / `useSupplierPayments`) entirely independently, with their own pagination state
- Reuses existing `PaymentMethodBreakdown` and `InvoiceStatusChart` dashboard components unchanged
