import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  CreditCard,
  Users,
  ShieldCheck,
  BarChart3,
  Settings2,
  Building2,
  UserCog,
  SlidersHorizontal,
  Landmark,
  Wallet,
  FileCheck,
  Banknote,
  UserPlus,
} from 'lucide-react';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/auth.store';
import {
  useNotificationCounts,
  isRelevantForRole,
} from '@/hooks/use-notification-counts';
import type { NotificationKey } from '@/hooks/use-notification-counts';
import type { Role } from '@/lib/constants';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  roles: Role[];
  /** Optional key into the notification counts store. */
  countKey?: NotificationKey;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',   path: '/',            icon: LayoutDashboard, roles: ['supplier','credit_officer','finance_manager','management','compliance_officer','auditor','legal'] },
  { label: 'Invoices',    path: '/invoices',     icon: FileText,        roles: ['supplier','credit_officer','finance_manager','management','compliance_officer','legal'] },
  { label: 'Approvals',   path: '/approvals',    icon: ShieldCheck,     roles: ['credit_officer','management','legal'], countKey: 'approvals' },
  { label: 'Payments',    path: '/payments',     icon: CreditCard,      roles: ['finance_manager','management','legal'], countKey: 'payments' },
  { label: 'Collections', path: '/collections',  icon: Landmark,        roles: ['credit_officer','finance_manager','management','legal'] },
  { label: 'Suppliers',   path: '/suppliers',    icon: Building2,       roles: ['credit_officer','finance_manager','management'] },
  { label: 'Buyers',      path: '/buyers',       icon: Users,           roles: ['credit_officer','finance_manager','management','supplier'] },
  { label: 'Buyer Requests', path: '/buyer-requests', icon: UserPlus,   roles: ['credit_officer','management'] },
  { label: 'Facilities',  path: '/facilities',   icon: Wallet,          roles: ['finance_manager','management'] },
  { label: 'Reporting',   path: '/reporting',    icon: BarChart3,       roles: ['credit_officer','finance_manager','management','compliance_officer','auditor'] },
  { label: 'Settlements', path: '/settlements',  icon: Banknote,        roles: ['finance_manager','management'] },
  { label: 'KYC Documents', path: '/kyc',       icon: FileCheck,       roles: ['supplier'] },
  { label: 'Settings',    path: '/settings',     icon: Settings2,       roles: ['supplier','credit_officer','finance_manager','management','compliance_officer','auditor','legal'] },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: 'Users',       path: '/admin/users',       icon: UserCog,          roles: ['management'] },
  { label: 'Risk Config', path: '/admin/risk-config',  icon: SlidersHorizontal, roles: ['management'] },
];

export function SidebarNav(): React.ReactElement {
  const { role } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { counts, clearCount } = useNotificationCounts();

  const items = [...NAV_ITEMS, ...ADMIN_ITEMS].filter(
    (item) => role && item.roles.includes(role),
  );

  function handleNavigate(item: NavItem): void {
    if (item.countKey) {
      clearCount(item.countKey);
    }
    navigate(item.path);
  }

  return (
    <nav role="navigation" aria-label="Main navigation">
    <SidebarMenu>
      {items.map((item) => {
        const isActive =
          item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

        const badgeCount = getBadgeCount(item, counts, role);

        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton
              isActive={isActive}
              tooltip={item.label}
              onClick={() => handleNavigate(item)}
              aria-current={isActive ? 'page' : undefined}
              className={isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-xs transition-all" : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"}
            >
              <item.icon className={isActive ? "size-4 text-emerald-400" : "size-4 text-muted-foreground"} />
              <span className="font-medium tracking-tight">{item.label}</span>
            </SidebarMenuButton>
            {badgeCount > 0 && (
              <SidebarMenuBadge>
                <Badge
                  variant="gold"
                  className="ml-auto size-5 flex items-center justify-center rounded-full p-0 text-[10px] font-bold shadow-xs"
                  aria-label={`${badgeCount} pending ${item.label.toLowerCase()}`}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </Badge>
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
    </nav>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBadgeCount(
  item: NavItem,
  counts: Record<NotificationKey, number>,
  role: Role | null,
): number {
  if (!item.countKey) return 0;
  if (!isRelevantForRole(item.countKey, role)) return 0;
  return counts[item.countKey];
}
