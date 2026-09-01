All 19 files created/modified. Here's a summary of everything built:

---

## What was built

### New files (19 total)

**Types & Services**
- `src/types/collateral.types.ts` — `CollateralType`, `CollateralItem`, `CollateralDocument`, `CollateralAuditEntry`, create/update payloads
- `src/services/collateral.api.ts` — full CRUD + document upload/delete/download URL + audit log fetch
- `src/hooks/useCollateral.ts` — `useCollateral`, `useCollateralAudit`, `useCreateCollateral`, `useUpdateCollateral`, `useDeleteCollateral`, `useUploadCollateralDocument`, `useDeleteCollateralDocument`

**Document components** (`src/components/documents/`)
- `DocumentList` — table with MIME-type icon, size, date, uploader, preview/download/delete buttons, inline delete confirm
- `DocumentUpload` — drag-and-drop zone, MIME + 10 MB validation, per-file progress bars, retry on failure, multi-file up to 10
- `DocumentPreview` — modal with native `<iframe>` for PDFs, `<img>` for images, metadata+download for other types; streaming download via `fetch` `ReadableStream` with `%` progress on the button

**Collateral components** (`src/components/collateral/`)
- `CollateralSection` — type icons (property/vehicle/equipment/inventory/receivables/other), description, UGX value, doc count, expiry; Add button hidden when `executing`/`funded`/`collecting`/`overdue`/`collected`/`defaulted`; total value summary bar; delete confirmation dialog
- `CollateralCreateEditModal` — 6-tile type selector with colour-coded icons, description/value/expiry fields, audit reason field (only shown when value changes in edit mode), value-exceeds-face-value warning banner, integrated `DocumentUpload`+`DocumentList`
- `CollateralDetailView` — full detail modal with doc list, live value-change audit log with ↑/↓ indicators

**MSW mock** (`src/mocks/handlers/collateral.handlers.ts`)
- 3 seed items on `inv_001` (property + vehicle + receivables) each with documents and audit entries
- Full in-memory CRUD — creates, updates (recording audit on value change), deletes, document upload/delete, PDF placeholder download

### Modified files
- `src/types/invoice.types.ts` — re-exports `CollateralItem` from `collateral.types.ts`
- `src/mocks/browser.ts` — registers `collateralHandlers`
- `src/pages/invoices/InvoiceDetailPage.tsx` — replaces inline `CollateralSection` with the full component + mounts create/edit and detail modals
