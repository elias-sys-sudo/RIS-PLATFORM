import { ShieldAlert } from 'lucide-react';

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { SlaCountdown } from '@/components/display/sla-countdown';

// ── Props ───────────────────────────────────────────────────────────────────

interface AuthUrgencyBannerProps {
  paymentStatus: string;
  dualAuthUser1: string | null;
  currentUserId: string;
  /** ISO timestamp when the SLA period started */
  slaStartedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when the current user is the one who should act next. */
function needsCurrentUserAuth(
  status: string,
  dualAuthUser1: string | null,
  currentUserId: string,
): boolean {
  if (status === 'pending_first_auth') return true;
  if (status === 'pending_second_auth' && dualAuthUser1 !== currentUserId) {
    return true;
  }
  return false;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Prominent warning banner shown when a payment awaits the current user's
 * dual-authorisation. Includes a live SLA countdown. The page's header
 * "Authorize Payment" button is the single CTA — this banner intentionally
 * has no button of its own to avoid a duplicate.
 */
export function AuthUrgencyBanner({
  paymentStatus,
  dualAuthUser1,
  currentUserId,
  slaStartedAt,
}: AuthUrgencyBannerProps): React.ReactElement | null {
  if (!needsCurrentUserAuth(paymentStatus, dualAuthUser1, currentUserId)) {
    return null;
  }

  return (
    <Alert variant="warning" className="border-l-4 border-l-amber-500">
      <ShieldAlert className="size-4" />
      <AlertTitle className="flex items-center gap-2">
        This payment is awaiting YOUR authorisation
        <SlaCountdown startedAt={slaStartedAt} slaHours={72} />
      </AlertTitle>
      <AlertDescription className="mt-1 text-sm">
        The 72-hour payment SLA is active. Please review and authorise promptly using the
        button in the header above.
      </AlertDescription>
    </Alert>
  );
}
