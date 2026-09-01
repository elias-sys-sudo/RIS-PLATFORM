import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/store/auth.store';
import type { AuthUser } from '@/types/auth.types';

/**
 * All mock users — matches auth.handlers.ts seed data.
 * Two finance managers enable dual-auth testing (Stage 11).
 */
const DEV_USERS: AuthUser[] = [
  { id: 'usr_001', email: 'admin@ris.ug',       name: 'Admin User',         role: 'finance_manager' },
  { id: 'usr_004', email: 'finance2@ris.ug',     name: 'Grace Nakamya',      role: 'finance_manager' },
  { id: 'usr_002', email: 'supplier@ris.ug',     name: 'Kampala Traders Ltd', role: 'supplier', kycStatus: 'approved' },
  { id: 'usr_008', email: 'newsupplier@ris.ug',  name: 'Jinja Fresh Produce', role: 'supplier', kycStatus: 'pending' },
  { id: 'usr_003', email: 'officer@ris.ug',      name: 'Credit Officer',     role: 'credit_officer' },
  { id: 'usr_005', email: 'management@ris.ug',   name: 'David Mukasa',       role: 'management' },
  { id: 'usr_006', email: 'compliance@ris.ug',    name: 'Agnes Nambi',        role: 'compliance_officer' },
  { id: 'usr_007', email: 'auditor@ris.ug',       name: 'Robert Kizza',       role: 'auditor' },
  { id: 'usr_009', email: 'legal@ris.ug',          name: 'Patricia Acen',      role: 'legal' },
];

const USER_LABELS: Record<string, string> = {
  usr_001: 'FM 1 — Admin User',
  usr_004: 'FM 2 — Grace Nakamya',
  usr_002: 'Supplier — Kampala Traders',
  usr_008: 'New Supplier — KYC Pending',
  usr_003: 'Credit Officer',
  usr_005: 'Management — David Mukasa',
  usr_006: 'Compliance — Agnes Nambi',
  usr_007: 'Auditor — Robert Kizza',
};

export function DevRoleSwitcher(): React.ReactElement {
  const { user, setUser } = useAuthStore();

  function handleChange(userId: string): void {
    const selected = DEV_USERS.find((u) => u.id === userId);
    if (!selected) return;
    setUser(selected);
    // Set mock token so MSW handlers can identify the user
    useAuthStore.getState().setTokens(`mock-access-${userId}-${Date.now()}`);
  }

  return (
    <div className="p-2 group-data-[collapsible=icon]:hidden">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Dev User
      </p>
      <Select value={user?.id ?? ''} onValueChange={handleChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DEV_USERS.map((u) => (
            <SelectItem key={u.id} value={u.id} className="text-xs">
              {USER_LABELS[u.id]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
