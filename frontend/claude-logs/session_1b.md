Everything builds cleanly. Here's a summary of what was built:

---

## Frontend: Design System & Shared Components

**Location:** `frontend/mms-frontend/` — run with `npm run dev` (port 3000)

### Structure created

```
src/
  styles/
    tokens.css        ← all design tokens as CSS variables (zero hex values outside here)
    global.css        ← reset + base styles
  components/
    display/
      AmountDisplay.tsx     ← UGX integer formatting, headline/table/compact variants
      StatusBadge.tsx       ← coloured pill driven by CSS vars (invoice/escalation/risk)
      DateDisplay.tsx       ← EAT UTC+3, date/datetime/relative/time formats via Intl API
      LoadingSkeleton.tsx   ← text/avatar/badge/card/table-row + SkeletonCard/SkeletonTable
      EmptyState.tsx        ← icon + title + description + primary/secondary CTA
      ErrorBoundary.tsx     ← class component, catches render errors, retry button
    forms/
      FormField.tsx         ← label + hint + error with aria-describedby wiring
      PasswordInput.tsx     ← forwardRef, Eye/EyeOff toggle, accessible label
      AmountInput.tsx       ← thousand separators in display, raw integer in state, UGX prefix
      LoadingButton.tsx     ← spinner, 4 variants (primary/secondary/ghost/danger), 3 sizes
    shell/
      AppShell.tsx          ← collapsible sidebar + sticky header + scrollable main
    overlays/
      Toast.tsx             ← context+hook system, 4 types, auto-dismiss, persistent option
      ConfirmationDialog.tsx ← default/warning/destructive variants, focus trap, Escape key
      OfflineIndicator.tsx  ← live browser online/offline detection, 3s "back online" banner
    index.ts               ← single barrel export
  pages/
    dev/ComponentsPage.tsx  ← full showcase at /dev/components
```

### Design tokens cover
- **Invoice statuses** (16): draft→gray, submitted→blue, under_review→amber, approved/completed→green, funded/collecting→teal, overdue/rejected→red, defaulted→dark-red, + auth/executing/scored states
- **Escalation levels** (4): none→gray, reminder→amber, formal→orange, legal→red
- **Risk levels** (4): low→green, medium→amber, high→red, critical→dark-red

### Navigate to `http://localhost:3000/dev/components` to see all components rendered.
