import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  CheckCircle2,
  UserCheck,
  Landmark,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import type { ApprovalTier } from '@/types/approval.types';

// ── Props ──────────────────────────────────────────────────

interface ApprovalTierBadgeProps {
  tier: ApprovalTier;
  approvalsReceived?: number;
  approvalsRequired?: number;
  className?: string;
}

// ── Tier configuration ─────────────────────────────────────

interface TierConfig {
  label: string;
  icon: LucideIcon;
  variant: string;
  progressBg: string;
  progressFill: string;
}

const TIER_CONFIG: Record<ApprovalTier, TierConfig> = {
  AUTO: {
    label: 'Auto Approved',
    icon: CheckCircle2,
    variant: 'bg-green-50 text-green-700 border-green-200',
    progressBg: 'bg-green-100',
    progressFill: 'bg-green-500',
  },
  TIER_2: {
    label: 'Credit Officer',
    icon: UserCheck,
    variant: 'bg-blue-50 text-blue-700 border-blue-200',
    progressBg: 'bg-blue-100',
    progressFill: 'bg-blue-500',
  },
  TIER_3: {
    label: 'Finance Manager',
    icon: Landmark,
    variant: 'bg-amber-50 text-amber-700 border-amber-200',
    progressBg: 'bg-amber-100',
    progressFill: 'bg-amber-500',
  },
  TIER_4: {
    label: 'Management',
    icon: Shield,
    variant: 'bg-red-50 text-red-700 border-red-200',
    progressBg: 'bg-red-100',
    progressFill: 'bg-red-500',
  },
};

// ── Component ──────────────────────────────────────────────

/**
 * Approval tier indicator with quorum progress bar.
 * Shows tier name with color coding and optional "X of Y approvals" progress.
 *
 * Color coding: AUTO=green, TIER_2=blue, TIER_3=amber, TIER_4=red.
 * When approvalsRequired > 0, renders a thin progress bar below the label.
 */
export function ApprovalTierBadge({
  tier,
  approvalsReceived,
  approvalsRequired,
  className,
}: ApprovalTierBadgeProps): React.ReactElement {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;

  const hasQuorum =
    approvalsRequired != null &&
    approvalsRequired > 0 &&
    approvalsReceived != null;

  const progressPercent = hasQuorum
    ? Math.min(100, (approvalsReceived / approvalsRequired) * 100)
    : 0;

  const quorumMet = hasQuorum && approvalsReceived >= approvalsRequired;

  const ariaLabel = hasQuorum
    ? `${config.label}: ${approvalsReceived} of ${approvalsRequired} approvals${quorumMet ? ' (complete)' : ''}`
    : config.label;

  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex flex-col gap-1 px-2.5 py-1 text-[11px] font-medium',
        hasQuorum ? 'rounded-lg' : 'rounded-full',
        config.variant,
        className,
      )}
      aria-label={ariaLabel}
    >
      {/* Tier label row */}
      <span className="flex items-center gap-1">
        <Icon className="size-3" aria-hidden="true" />
        {config.label}
      </span>

      {/* Quorum progress */}
      {hasQuorum && (
        <span className="flex w-full flex-col gap-0.5">
          <span className="text-[10px] leading-none">
            {approvalsReceived} of {approvalsRequired}
            {' '}approval{approvalsRequired > 1 ? 's' : ''}
          </span>
          <span
            className={cn('h-1 w-full overflow-hidden rounded-full', config.progressBg)}
            role="progressbar"
            aria-valuenow={approvalsReceived}
            aria-valuemin={0}
            aria-valuemax={approvalsRequired}
          >
            <span
              className={cn(
                'block h-full rounded-full transition-all duration-200',
                config.progressFill,
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </span>
        </span>
      )}
    </Badge>
  );
}
