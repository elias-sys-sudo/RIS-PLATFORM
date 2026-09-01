Zero type errors. Here's a summary of everything built:

---

## Collections — 10 files created/modified

### New files

| File | Purpose |
|---|---|
| `src/types/collection.types.ts` | `Collection`, `CollectionDetail`, `CollectionPayment`, `EscalationEvent`, `BuyerContact`, `CollectionFilters`, `PaginatedCollections`, `CollectionSummaryStats` |
| `src/services/collections.api.ts` | `fetchCollections(filters)`, `fetchCollection(id)` |
| `src/mocks/handlers/collections.handlers.ts` | `GET /api/collections` (paginated + filtered) and `GET /api/collections/:id` with 12 seed collections, full payment & escalation histories |
| `src/hooks/useCollections.ts` | `useCollections(filters)`, `useCollection(id)` — React Query with staleTime |
| `src/pages/collections/CollectionsPage.tsx` | List page |
| `src/pages/collections/CollectionsPage.css` | List page styles |
| `src/pages/collections/CollectionDetailPage.tsx` | Detail page |
| `src/pages/collections/CollectionDetailPage.css` | Detail page styles |

### Modified files

| File | Change |
|---|---|
| `src/mocks/browser.ts` | Registered `collectionsHandlers` |
| `src/App.tsx` | Added `/collections` and `/collections/:id` routes |

---

### What was built

**MSW mock data** — 12 seed collections spanning all states:
- 3 `collecting` (current / minor overdue), 6 `overdue` (6–145 days), 2 `collected`, 1 `defaulted`
- All 4 escalation levels represented: none / reminder / formal / legal
- 2 SAR-flagged collections (UGX 300M and 230M — above the UGX 100M AML threshold)
- Every collection has 0–3 payment history entries with running balance column
- Every collection has a 4-level escalation history with actor names, roles, dates and notes

**`/collections` list page:**
- **Stats row** — 4 cards: total outstanding UGX, overdue count, avg days overdue, collection rate %
- **Quick-filter pills** — Overdue / Escalated / SAR Flagged (toggle; active state visually distinct)
- **Filter bar** — text search, days-overdue min/max range, status chips, escalation-level chips; "N filters active" + clear-all
- **DataTable** — days-overdue column colour-coded green→amber→orange→red; escalation shown as 4-dot indicator (blue/amber/red/dark-red filling left-to-right by level + SAR); last payment date column; sortable on all key fields
- Filters are URL-synced so links are shareable

**`/collections/:id` detail page:**
- **Financial progress bar** — collected vs face value with percentage label and outstanding amount callout; overdue note badge
- **Payment history table** — amount, date, method, reference, running balance (shows "Settled" at zero), notes
- **4-level escalation timeline** — each level (Reminder / Formal Notice / Legal Action / SAR Filed with FIA) shown with icon, colour, actor, date, notes; current level highlighted with "Current" badge; future levels greyed as "Not yet reached"
- **Buyer contact card** — company, contact person, email/phone (clickable links), address, payment terms
- **Invoice link card** — key invoice fields + "View invoice" button linking to `/invoices/:id`
