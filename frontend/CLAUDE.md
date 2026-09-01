# frontend/ — Patterns & Rules

## Stack

- React 19, TypeScript strict mode, Vite
- shadcn/ui + Tailwind CSS
- TanStack Query v5 for server state
- React Router v6 for navigation
- Zod for form validation (mirrors backend Joi schemas)

---

## API Client — Never Call fetch Directly in Components

All backend communication goes through typed functions in `src/api/`:

```typescript
// src/api/invoices.ts ✅ CORRECT
export async function submitInvoice(data: SubmitInvoiceRequest): Promise<Invoice> {
  const res = await apiClient.post('/invoices', data);
  return res.data;
}

// In component ✅ CORRECT — use TanStack Query
const { mutate, isPending } = useMutation({ mutationFn: submitInvoice });
```

❌ WRONG — raw fetch in component:
```typescript
// InvoiceForm.tsx
const res = await fetch('/api/invoices', { method: 'POST', body: JSON.stringify(data) });
// No type safety, no error normalisation, no retry, duplicated across components
```

---

## Amount Formatting — Always Use formatUGX

Financial amounts come from the backend as integer strings (BIGINT serialised as string).
Never display raw integers.

```typescript
// src/lib/format.ts
export function formatUGX(ugxInteger: string | number | bigint): string {
  return `UGX ${Number(ugxInteger).toLocaleString('en-UG')}`;
}

// ✅ In component
<span>{formatUGX(invoice.faceValue)}</span>       // "UGX 5,000,000"
<span>{formatUGX(invoice.advanceAmount)}</span>    // "UGX 4,750,000"

// ❌ WRONG — raw number display
<span>{invoice.faceValue}</span>       // "5000000" — unreadable, unprofessional
<span>{invoice.faceValue / 100}</span> // wrong — UGX has no decimal subdivision
```

---

## Token Storage — Memory Only

```typescript
// ✅ CORRECT — access token in memory (React state / zustand store)
// Refresh token in httpOnly cookie (set by server, invisible to JS)
const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
}));

// ❌ WRONG — storing tokens in localStorage
localStorage.setItem('accessToken', token);   // XSS-readable
sessionStorage.setItem('refreshToken', token); // XSS-readable, visible in devtools
```

---

## Role-Based UI — UX Only, Never Security

```typescript
// src/hooks/useRole.ts
export function useRole(): UserRole {
  const { user } = useAuthStore();
  return user?.role ?? 'supplier';
}

// In component — hiding UI is UX, not security (backend enforces access)
export function ApproveButton({ invoiceId }: { invoiceId: string }) {
  const role = useRole();
  if (role !== 'credit_officer' && role !== 'finance_manager') return null;
  return <Button onClick={() => approve(invoiceId)}>Approve</Button>;
}
```

❌ WRONG — relying on UI hiding as a security control:
```typescript
// Do NOT skip the authMiddleware/requireRole on the backend because
// "the button is hidden in the frontend". Frontend can be bypassed with curl.
```

---

## Error Display — Never Expose Raw Errors

```typescript
// src/lib/api-errors.ts
export function getErrorMessage(err: unknown): string {
  if (isApiError(err)) return err.response.data.message; // backend's safe message
  if (err instanceof Error && err.message === 'Network Error') return 'Connection problem. Please try again.';
  return 'Something went wrong. Please try again.'; // generic fallback
}

// ❌ WRONG — exposing raw error details
toast.error(err.message);            // may contain stack traces, internal paths
toast.error(JSON.stringify(err));    // exposes full error object
console.error(err);                  // fine for development, remove before prod
```

---

## Form Validation — Zod Mirrors Backend Joi

```typescript
// src/schemas/invoice.schema.ts
export const submitInvoiceSchema = z.object({
  faceValue:   z.number().int().positive(),
  tenorDays:   z.number().int().min(7).max(90),   // matches backend MIN/MAX_TENOR_DAYS
  buyerId:     z.string().uuid(),
  invoiceDate: z.string().datetime(),
});

// Keeps client and server validation in sync.
// When backend Joi schema changes, update the matching Zod schema here.
```

---

## Loading States — Required for Every Async Operation

```typescript
// ✅ CORRECT
const { data, isPending, isError } = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id) });
if (isPending) return <Skeleton />;
if (isError)  return <ErrorState />;
return <InvoiceDetail invoice={data} />;

// ❌ WRONG — no loading state (jarring UX, layout shift)
const { data } = useQuery(...);
return <InvoiceDetail invoice={data!} />; // data is undefined on first render
```

---

## Component Checklist — Before Submitting

- [ ] No raw `fetch` calls — all API calls through `src/api/`
- [ ] All amounts displayed with `formatUGX()`
- [ ] Loading and error states handled
- [ ] Role checks are UX only (not replacing backend auth)
- [ ] No tokens in localStorage/sessionStorage
- [ ] No raw error messages shown to user
- [ ] All form inputs have accessible `<label>` elements
- [ ] No `any` in props or hooks
- [ ] Zod schema matches backend Joi schema for same endpoint
