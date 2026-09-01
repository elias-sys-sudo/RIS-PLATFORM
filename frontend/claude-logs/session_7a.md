All done. Zero TypeScript errors. Here's a summary of everything built:

---

## What was built

### New types
- `src/types/settings.types.ts` — `UserProfile`, `UpdateProfileRequest`, `NotificationPreferences`, `NotificationEventType`, `NotificationChannel`
- `src/types/admin.types.ts` — `AdminUser`, `CreateUserRequest/Response`, `UpdateUserRequest`, `PaginatedAdminUsers`, `RiskConfigEntry`, `UpdateRiskConfigRequest`
- `src/types/auth.types.ts` — added `'admin'` role

### New API services
- `src/services/settings.api.ts` — `getProfile`, `updateProfile`, `getNotificationPreferences`, `saveNotificationPreferences`
- `src/services/admin.api.ts` — `listUsers`, `createUser`, `updateUser`, `listRiskConfig`, `updateRiskConfig`

### New pages
| Route | File | Access |
|---|---|---|
| `/settings/profile` | `ProfilePage.tsx` | All authenticated |
| `/settings/notifications` | `NotificationsPage.tsx` | All authenticated |
| `/admin/users` | `UsersPage.tsx` | `admin` only |
| `/admin/risk-config` | `RiskConfigPage.tsx` | `admin` + `management` |

**`/settings` now redirects to `/settings/profile`.**

### Key features
- **Profile**: React Query fetch + optimistic save with success confirmation
- **Notifications**: Full event × channel toggle matrix (`10 events × email/SMS`), save-all-at-once
- **Users**: DataTable with search, create-user modal showing temp password **once** in a separate modal (copy button included), edit modal to change role or deactivate/reactivate — **no delete option**
- **Risk Config**: Table showing all 12 entries (5 weights, thresholds, limits, rates); click Edit → modal with `ConfirmationDialog` before save; weight validation ensures the 5 factors sum to 100
- **`RoleRoute` guard** in `App.tsx` — redirects to `/` on unauthorized access

### MSW mocks
- `settings.handlers.ts` — profile GET/PUT, notifications GET/PUT
- `admin.handlers.ts` — users list/create/patch, risk-config list/PUT with full seed data

### Navigation
Admin nav items (Users, Risk Config) are appended conditionally — only visible when the role is `admin` or `management`. The dev role switcher now includes `admin`.
