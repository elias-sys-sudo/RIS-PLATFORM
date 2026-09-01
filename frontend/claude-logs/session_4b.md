All 10 files are in place. Here's a summary of everything built:

---

## What was built

### New files
- **`src/components/collections/RecordPaymentModal.tsx`** — Multi-step modal (Form → Confirm → Success)
- **`src/components/collections/RecordPaymentModal.css`**
- **`src/components/collections/CollectionActions.tsx`** — Escalate / Resolve / De-escalate buttons
- **`src/components/collections/CollectionActions.css`**

### Modified files
- **`src/types/collection.types.ts`** — Added `PaymentMethod`, `RecordPaymentPayload`, `EscalatePayload`, `DeescalatePayload`
- **`src/services/collections.api.ts`** — Added `recordPayment`, `escalateCollection`, `deescalateCollection`, `resolveCollection`
- **`src/hooks/useCollections.ts`** — Added `useRecordPayment`, `useEscalateCollection`, `useDeescalateCollection`, `useResolveCollection` (all invalidate list + detail queries on success)
- **`src/mocks/handlers/collections.handlers.ts`** — Converted to mutable runtime state; added POST handlers for `/payments`, `/escalate`, `/de-escalate`, `/resolve`
- **`src/pages/collections/CollectionDetailPage.tsx`** — Added `CollectionActions` bar (right-aligned in topbar) + modal
- **`src/pages/collections/CollectionsPage.tsx`** — Added `PlusCircle` Record Payment button per active row, opening a shared modal instance

### Behaviour highlights
| Feature | Detail |
|---|---|
| **Amount validation** | Blocks zero/null; warning (not blocking) if amount exceeds outstanding |
| **Quick-fill** | 25% / 50% / Full Balance buttons pre-fill the UGX amount |
| **Method icons** | 5 payment methods as styled radio cards; reference required only for electronic methods (MTN/Airtel/Bank Transfer) |
| **Date** | Defaults to today; `max={today}` blocks future dates |
| **Unsaved data warning** | `ConfirmationDialog` shown when closing with dirty form |
| **Success state** | Shows paid amount + new running balance; "Record another" resets form |
| **Escalation dialog** | Shows current → next level, reason textarea, notification preview; confirm disabled until reason is entered |
| **De-escalate** | Management role only; logged in escalation history |
| **Resolve** | Shown only when `outstanding_amount === 0` and collection is not yet closed |
| **Mock persistence** | Runtime state is mutable — recorded payments + escalations survive query invalidation within the browser session |
