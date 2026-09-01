Everything is clean. Here's a summary of what was built:

---

## What was built

### Types & API layer
- **`src/types/invoice.types.ts`** — `Invoice`, `InvoiceFilters`, `PaginatedInvoices`, `CreateInvoicePayload`, `UpdateInvoicePayload`, `SortField`, `SortDirection`
- **`src/services/invoices.api.ts`** — `fetchInvoices`, `fetchInvoice`, `createInvoice`, `updateInvoice`, `deleteInvoice`, `submitInvoice`

### React Query hooks (`src/hooks/useInvoices.ts`)
- `useInvoices(filters)` — paginated, keeps previous page data while fetching
- `useInvoice(id)` — single invoice detail placeholder
- `useCreateInvoice`, `useUpdateInvoice`, `useDeleteInvoice`, `useSubmitInvoice` — mutations that invalidate/update cache on success

### MSW mock (`src/mocks/handlers/invoice.handlers.ts`)
- **16 invoices** covering every status: `draft`, `submitted`, `buyer_confirmed`, `under_review`, `scored`, `approved`, `rejected`, `pending_first_auth`, `pending_second_auth`, `executing`, `funded`, `collecting`, `overdue`, `collected`, `defaulted` — with realistic UGX amounts (15M–310M)
- Full CRUD + submit endpoint with server-side filtering, sorting, and pagination

### `DataTable<T>` component (`src/components/display/DataTable.tsx`)
- Generic column config with optional `render` function
- Sortable columns with asc/desc toggle and icon indicators
- Pagination controls: prev/next/numbered pages with ellipsis, plus rows-per-page selector (10/25/50)
- **8 animated skeleton rows** during loading (shimmer effect)
- `EmptyState` shown when no data
- Horizontal scroll on narrow screens via `overflow-x: auto`
- Row click handler, full `aria-sort` accessibility

### `InvoicesPage` (`src/pages/invoices/InvoicesPage.tsx`)
- Filter bar: text search, supplier search (hidden for `supplier` role), due date range, status multi-select chips (all 15 statuses)
- **All filters sync bidirectionally with URL query params** — shareable/bookmarkable URLs
- Active filter count + "Clear all" button
- **Create Invoice button** rendered only for `supplier` role → navigates to `/invoices/new`
- DataTable columns: Invoice #, Supplier, Buyer, Amount (UGX), Status badge, Risk score pill (colored by level), Due Date, Actions
- Row click → `/invoices/:id`
- Row actions: View (all), Submit + Delete (draft only)
- `/invoices/:id` route registered (placeholder until detail page is built)
