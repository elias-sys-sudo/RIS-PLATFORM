import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Header } from './header';
import { SidebarNav } from './sidebar-nav';
import { useAuthStore } from '@/store/auth.store';
import { useIdleTimeout } from '@/hooks/use-idle-timeout';
import { queryClient } from '@/lib/query-client';
import { DevRoleSwitcher } from './dev-role-switcher';
import { OfflineBanner } from '@/components/display/offline-banner';
import { TwoFaEnforcementBanner } from '@/components/display/two-fa-enforcement-banner';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useEventStream } from '@/hooks/use-event-stream';
import type { SseEvent } from '@/hooks/use-event-stream';
import { showRealtimeToast } from '@/components/display/realtime-toast';
import {
  useNotificationCounts,
  isRelevantForRole,
} from '@/hooks/use-notification-counts';
import type { NotificationKey } from '@/hooks/use-notification-counts';
import { MobileBottomNav } from './mobile-bottom-nav';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/cn';
import { SessionTimeoutWarning } from '@/components/overlays/session-timeout-warning';

interface AppShellProps {
  children: React.ReactNode;
}

// ── SSE event type to notification key mapping ──────────────────────────────

const EVENT_TO_COUNT_KEY: Record<string, NotificationKey> = {
  'approval:new':        'approvals',
  'payment:authorized':  'payments',
  'invoice:status_changed': 'invoices',
};

const TWO_FA_GRACE_PERIOD_DAYS = 7;

function calculateGraceDays(createdAt: string | undefined): number {
  if (!createdAt) return TWO_FA_GRACE_PERIOD_DAYS;
  const created = new Date(createdAt).getTime();
  const deadline = created + TWO_FA_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
}

export function AppShell({ children }: AppShellProps): React.ReactElement {
  const { logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOnline = useOnlineStatus();
  const increment = useNotificationCounts((s) => s.increment);
  const showBottomNav = isMobile && role === 'supplier';

  // 2FA enforcement for staff roles
  const needs2fa = user?.twoFactorEnabled === false && role !== null && role !== 'supplier';
  const graceDaysRemaining = useMemo(
    () => (needs2fa ? calculateGraceDays(user?.createdAt) : 0),
    [needs2fa, user?.createdAt],
  );

  // Redirect to 2FA setup when grace period expired (except if already on 2FA page)
  useEffect(() => {
    if (needs2fa && graceDaysRemaining <= 0 && location.pathname !== '/settings/2fa') {
      navigate('/settings/2fa', { replace: true });
    }
  }, [needs2fa, graceDaysRemaining, location.pathname, navigate]);

  // ── SSE: toasts + notification badge counts ────────────────────────────────

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      showRealtimeToast(event.type, event, role);
      const countKey = EVENT_TO_COUNT_KEY[event.type];
      if (countKey && isRelevantForRole(countKey, role)) {
        increment(countKey);
      }
    },
    [role, increment],
  );

  useEventStream(isAuthenticated && isOnline, handleSseEvent);

  // Session timeout: 5 min idle (DESIGN.md), warn at 60s before logout
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const { secondsRemaining, isWarning, resetTimer } = useIdleTimeout({
    onIdle: async () => {
      setShowTimeoutWarning(false);
      await logout();
    },
    onWarn: () => setShowTimeoutWarning(true),
    enabled: true,
  });

  // Cross-tab logout sync
  useEffect(() => {
    function handleStorage(e: StorageEvent): void {
      if (e.key === 'ris-auth' && e.newValue !== null) {
        try {
          const parsed = JSON.parse(e.newValue) as {
            state?: { isAuthenticated?: boolean };
          };
          if (parsed?.state?.isAuthenticated === false) {
            queryClient.clear();
            useAuthStore.setState({ user: null, isAuthenticated: false, role: null });
            navigate('/login', { replace: true });
          }
        } catch { /* ignore malformed */ }
      }
      if (e.key === 'accessToken' && e.newValue === null) {
        queryClient.clear();
        useAuthStore.setState({ user: null, isAuthenticated: false, role: null });
        navigate('/login', { replace: true });
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [navigate]);

  return (
    <SidebarProvider>
      {/* WCAG 2.1 skip navigation link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:m-2"
      >
        Skip to main content
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b p-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              R
            </div>
            <span className="truncate font-semibold text-sm group-data-[collapsible=icon]:hidden">
              RIS Platform
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav />
        </SidebarContent>
        <SidebarFooter>
          {import.meta.env.DEV && <DevRoleSwitcher />}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <Header />
        <OfflineBanner />
        {needs2fa && role && (
          <TwoFaEnforcementBanner
            graceDaysRemaining={graceDaysRemaining}
            userRole={role}
          />
        )}
        <main id="main-content" className={cn('flex-1 overflow-auto p-6', showBottomNav && 'pb-20')}>
          {children}
        </main>
        <MobileBottomNav />
        {/* Feedback button — dev-only; hidden in production to avoid leaking repo URL */}
        {import.meta.env.DEV && (
          <a
            href="https://github.com/256MMcode/RIS-Platform/issues/new?template=bug_report.md"
            target="_blank"
            rel="noopener noreferrer"
            className="fixed bottom-4 right-4 z-50 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          >
            Feedback
          </a>
        )}
      </SidebarInset>
      <SessionTimeoutWarning
        open={showTimeoutWarning && isWarning}
        secondsRemaining={secondsRemaining}
        onExtend={() => {
          setShowTimeoutWarning(false);
          resetTimer();
        }}
        onLogout={async () => {
          setShowTimeoutWarning(false);
          await logout();
        }}
      />
    </SidebarProvider>
  );
}
