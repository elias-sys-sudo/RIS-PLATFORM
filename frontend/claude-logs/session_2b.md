All done. Here's a summary of everything built:

---

## What was built

### New files (15 files)

**Types & API**
- `dashboard.types.ts` — added `ApprovalQueueItem`, `FundingPipelineItem`, `SupplierDashboardSummary`, `LegalDashboardSummary`, `SarItem`, `LegalEscalationItem`, `RiskDistributionItem`
- `dashboard.api.ts` — added `fetchApprovalQueue`, `fetchFundingPipeline`, `fetchSupplierSummary`, `fetchLegalSummary`, `fetchRiskDistribution`

**Mocks**
- `mocks/handlers/roleSpecific.handlers.ts` — 5 new MSW handlers with realistic Ugandan business mock data
- `mocks/browser.ts` — registered new handlers

**Shell**
- `AppShell.types.ts` — added `devControls?: React.ReactNode` prop
- `AppShell.tsx` — renders `devControls` in the header right section

**Dashboard**
- `DashboardPage.css` — shared layout: stat rows, 2-col/equal grids, section cards, data tables, quick links, CTA card, risk bars, dev switcher
- `pages/dashboard/DashboardPage.tsx` — role router mapping all 7 roles to 6 views
- `views/AdminDashboard.tsx` — 4 stat cards, trend chart, activity feed, 5 quick links (compliance_officer / auditor / fallback)
- `views/CreditOfficerDashboard.tsx` — pending count cards, top-5 approval queue table with Review links, escalation overview, activity feed
- `views/FinanceManagerDashboard.tsx` — 4 finance stat cards, cash flow trend chart, payment method breakdown, funding pipeline table
- `views/SupplierDashboard.tsx` — personal stats, invoice status donut, recent payments table, Submit New Invoice CTA
- `views/ManagementDashboard.tsx` — portfolio KPIs, trend chart, collection rate gauge, risk distribution bars, escalation overview
- `views/LegalDashboard.tsx` — SAR flagged count/amount stats, SAR detail table with status pills, tier-3 escalated collections table

**App.tsx**
- Replaced Dashboard placeholder with `<DashboardPage />`
- Added `DevRoleSwitcher` component — a dropdown in the header showing all 7 roles, only rendered when `import.meta.env.DEV` is true; changing the selection calls `setUser({ ...user, role })` to instantly re-render the matching dashboard view
