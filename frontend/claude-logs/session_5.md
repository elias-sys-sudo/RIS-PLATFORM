Everything checks out. Here's a summary of everything that was built:

---

## Approvals workflow — complete

**9 files created, 2 updated:**

### New files

| File | Purpose |
|---|---|
| `types/approval.types.ts` | `ApprovalQueueItem`, `ApprovalDetail`, `TierDecision`, `ApprovalStats`, filters, paginated shapes |
| `services/approvals.api.ts` | 6 API functions: queue, detail, approve, reject, request-info, history |
| `hooks/useApprovals.ts` | `useApprovalQueue`, `useApproval`, `useApprovalHistory`, `useApprove`, `useReject`, `useRequestInfo` with full cache invalidation |
| `mocks/handlers/approvals.handlers.ts` | 8 pending approvals across Tiers 1–3 with varying risk scores (27–82), resolved history items, 7 MSW handlers |
| `pages/approvals/ApprovalsPage.tsx` + `.css` | Tabs (Pending/Approved/Rejected/All), stats bar (pending count / approved today / rejected today / avg days), sortable table with colored risk score badges, tier badges, days-in-queue color coding |
| `pages/approvals/ApprovalReviewPage.tsx` + `.css` | 60/40 split layout — left: invoice details / buyer credit history / supplier performance / collateral / documents / timeline; right: large colored risk score card with 5-scorer breakdown bars, approval chain timeline (Tier 1→2→3), sticky decision panel |
| `pages/approvals/ApprovalHistoryPage.tsx` + `.css` | History table with decision filter, search, sortable columns, decision badges |

### Updated files

- **`mocks/browser.ts`** — adds `approvalsHandlers` to the MSW worker
- **`App.tsx`** — replaces `/approvals` placeholder with `ApprovalsPage`, adds `/approvals/history` and `/approvals/:invoice_id` routes

### Key features
- **Keyboard shortcuts**: `A` approve, `R` reject, `N` request info, `←`/`→` navigate between queue items
- **Reject dialog**: textarea with hard block when reason < 20 chars — button label shows remaining character count
- **Approve/reject/info**: each uses `ConfirmationDialog` with appropriate variant (default/destructive/warning)
- **Queue navigation**: prev/next arrows with position counter (`3 / 8`), auto-advances to next item after decision
