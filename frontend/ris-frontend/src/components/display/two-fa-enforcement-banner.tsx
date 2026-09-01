import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Role } from '@/types/auth.types';

// ── Constants ────────────────────────────────────────────────────────────────

const STAFF_ROLES: ReadonlySet<Role> = new Set([
  'credit_officer',
  'finance_manager',
  'management',
  'compliance_officer',
  'auditor',
]);

// ── Props ────────────────────────────────────────────────────────────────────

interface TwoFaEnforcementBannerProps {
  graceDaysRemaining: number;
  userRole: Role;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TwoFaEnforcementBanner({
  graceDaysRemaining,
  userRole,
}: TwoFaEnforcementBannerProps): React.ReactElement | null {
  // Only show for staff roles, never for suppliers
  if (!STAFF_ROLES.has(userRole)) return null;

  const isExpired = graceDaysRemaining <= 0;
  const variant = isExpired ? 'destructive' : 'warning';

  return (
    <Alert variant={variant} className="mx-6 mt-2">
      <ShieldAlert className="size-4" />
      <AlertTitle>
        {isExpired
          ? 'Two-factor authentication required'
          : 'Set up two-factor authentication'}
      </AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          {isExpired
            ? 'Your account requires two-factor authentication to continue.'
            : `Two-factor authentication is required. Set up now to keep your account secure. ${graceDaysRemaining} day${graceDaysRemaining === 1 ? '' : 's'} remaining.`}
        </span>
        <Button asChild size="sm" variant={isExpired ? 'destructive' : 'default'}>
          <Link to="/settings/2fa">Set Up Now</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
