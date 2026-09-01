Zero errors. Here's a complete summary of everything built:

---

## Invoice Creation Wizard — Complete

### What was built

**17 files created/modified** across the frontend.

#### New files

| File | Purpose |
|---|---|
| `src/types/buyer.types.ts` | `Buyer` + `BuyerListResponse` types |
| `src/services/buyers.api.ts` | `fetchBuyers(search?)` — `GET /buyers` |
| `src/services/invoices.api.ts` | Added `uploadDocument(id, docType, file, onProgress)` |
| `src/hooks/useBuyers.ts` | React Query hook, 5-min staleTime |
| `src/components/forms/SearchableDropdown.tsx` | Keyboard-navigable, filterable combobox with clear button |
| `src/pages/invoices/invoiceCreate.types.ts` | Shared wizard types: `WizardFormData`, `StepProps`, `RequiredDocType`, `CollateralFormItem`, `UploadedDoc` |
| `src/pages/invoices/steps/Step1InvoiceDetails.tsx` | Buyer searchable dropdown, auto-generated ref, AmountInput, future-only date, optional description, per-field validation on blur + on submit |
| `src/pages/invoices/steps/Step2Documents.tsx` | 4 required doc types; drag-drop or click-to-browse per file; real progress bar; re-upload button; simulates upload when no draft yet |
| `src/pages/invoices/steps/Step3Collateral.tsx` | Add/remove collateral items inline; type dropdown, description, AmountInput per item; optional step |
| `src/pages/invoices/steps/Step4Review.tsx` | Full summary of Steps 1–3; calculated advance amount; "Edit" links that jump back to each step; missing-docs warning |
| `src/pages/invoices/steps/Step5Submit.tsx` | Final confirmation panel with financials; Submit button with loading state; error display |
| `src/pages/invoices/InvoiceCreatePage.tsx` | Wizard container: progress bar (clickable completed steps), auto-save every 30s (only fires when buyer/value/date filled), `useBlocker` for in-app navigation, `beforeunload` for browser close, supplier-role guard (`Navigate` to `/invoices` for other roles) |
| `src/pages/invoices/InvoiceCreatePage.css` | All wizard styles — progress bar, step layout, searchable dropdown, doc upload rows, progress fill, collateral rows, review sections, submit panel, responsive at 600px |
| `src/mocks/handlers/buyers.handlers.ts` | `GET /api/buyers` with 10 seed buyers + optional `?search=` filter |

#### Modified files

| File | Change |
|---|---|
| `src/types/invoice.types.ts` | Added optional `invoice_reference?` and `description?` to `CreateInvoicePayload` |
| `src/mocks/handlers/invoice.handlers.ts` | Added `POST /api/invoices/:id/documents` handler; fixed buyer_name resolution from BUYER_POOL in create |
| `src/mocks/browser.ts` | Registered `buyersHandlers` |
| `src/App.tsx` | Added `<Route path="/invoices/new" element={<InvoiceCreatePage />} />` (before `/:id` to avoid conflict) |

### Key behaviours

- **Auto-save**: Fires every 30s silently, only when buyer + face value + due date are filled. Shows "Draft saved" / "Save failed" chip. Creates on first save, patches on subsequent
- **Unsaved changes warning**: `useBlocker` (react-router) catches in-app navigations and shows `ConfirmationDialog`; native `beforeunload` catches browser close/reload
- **Supplier-only guard**: Non-supplier roles are immediately redirected to `/invoices`
- **Progress bar**: Completed steps are clickable (jump back); current step highlighted in brand blue; connector lines turn green as steps complete
- **File upload**: Each doc type has its own drop zone with live progress bar; if no draft yet (before Step 1 completes), upload is simulated locally; with a draft ID, real `POST /invoices/:id/documents` fires with Axios `onUploadProgress`
