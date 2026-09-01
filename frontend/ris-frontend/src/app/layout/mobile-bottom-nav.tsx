import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, FileCheck, Settings2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuthStore } from '@/store/auth.store';
import type { LucideIcon } from 'lucide-react';

interface BottomTab {
  label: string;
  path: string;
  icon: LucideIcon;
}

const TABS: BottomTab[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Invoices', path: '/invoices', icon: FileText },
  { label: 'KYC', path: '/kyc', icon: FileCheck },
  { label: 'Settings', path: '/settings', icon: Settings2 },
];

function isTabActive(tabPath: string, pathname: string): boolean {
  if (tabPath === '/') return pathname === '/';
  return pathname.startsWith(tabPath);
}

/**
 * Bottom tab navigation bar for supplier role on mobile devices.
 * Only renders when viewport is below 768px AND user role is 'supplier'.
 */
export function MobileBottomNav(): React.ReactElement | null {
  const isMobile = useIsMobile();
  const role = useAuthStore((s) => s.role);

  if (!isMobile || role !== 'supplier') return null;

  return <BottomNavBar />;
}

function BottomNavBar(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-background border-t flex items-center justify-around h-14 pb-[env(safe-area-inset-bottom)]"
      aria-label="Mobile navigation"
    >
      {TABS.map((tab) => {
        const active = isTabActive(tab.path, location.pathname);
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => navigate(tab.path)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-h-[44px]',
              active
                ? 'text-primary border-t-2 border-primary'
                : 'text-muted-foreground',
            )}
            aria-current={active ? 'page' : undefined}
            aria-label={tab.label}
          >
            <tab.icon className="size-5" />
            <span className="text-[10px]">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
