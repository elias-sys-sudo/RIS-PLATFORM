All done — `tsc --noEmit` passes with zero errors. Here's what was built:

---

## What was created

### API layer
| File | Purpose |
|---|---|
| `src/types/dashboard.types.ts` | Full type definitions — `Period`, `DashboardSummary`, `PaymentHistoryFilters`, all breakdown types |
| `src/services/dashboard.api.ts` | `fetchDashboardSummary(period)` and `fetchPaymentHistory(filters)` using the shared `apiClient` |
| `src/hooks/useDashboardSummary.ts` | `useDashboardSummary(period)` — react-query, 2 min stale, keeps previous period data visible during fetch |
| `src/hooks/usePaymentHistory.ts` | `usePaymentHistory(filters)` — react-query with `keepPreviousData` for smooth pagination |

### MSW mocks (`src/mocks/handlers/dashboard.handlers.ts`)
- `GET /api/dashboard/summary?period=` — per-period stats (e.g. 30d: UGX 48.2B face value, UGX 38.6B funded, 84.7% collection rate), status breakdown, payment method split, trend data, escalation counts, 10 recent activity items, `cached_at` 90s in the past
- `GET /api/dashboard/payments` — 15 realistic payment records (MTN MoMo, Airtel, EFT/RTGS; disbursements + collections; UGX 350M–4.2B per transaction)

### Components (`src/components/dashboard/`)

| Component | Chart type | Key behaviour |
|---|---|---|
| `StatCard` | — | Label / value / trend chip (green↑ red↓) / icon / clickable / skeleton |
| `PeriodSelector` | — | Pill tabs sync with `?period=` URL param; `useActivePeriod()` hook co-exported; shows `cached_at` timestamp |
| `CollectionRateGauge` | SVG semicircle arc | Red <50%, Amber 50–75%, Green >75%; tooltip with collected/overdue counts; animated fill |
| `InvoiceStatusChart` | SVG donut | Each slice clickable → navigates to `/invoices?status=`; hover tooltip with count + UGX amount; toggleable legend |
| `PaymentMethodBreakdown` | CSS horizontal bars | Proportional width, tooltip with count/total/share %; MTN blue / Airtel red / EFT gray |
| `TrendChart` | SVG polyline | Period-aware x-axis (weekday/date/month); crosshair tooltip; click-to-toggle series in legend |
| `RecentActivityFeed` | List | Max 10 items; type-specific icons/colours; relative timestamps; invoice items navigate on click |
| `EscalationOverview` | 4-column grid | None/Reminder/Formal/Legal colours from tokens; each column navigates to `/collections?escalation=`; responsive 2-col on mobile |
