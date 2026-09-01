import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format-date';
import { Check } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface TimelineStep {
  id: string;
  label: string;
  timestamp?: string;
  actor?: string;
}

interface TimelineStepperProps {
  steps: TimelineStep[];
  currentStepId: string;
  className?: string;
}

type StepState = 'completed' | 'current' | 'pending';

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveStepStates(
  steps: TimelineStep[],
  currentStepId: string,
): StepState[] {
  const currentIdx = steps.findIndex((s) => s.id === currentStepId);
  return steps.map((_, i) => {
    if (i < currentIdx) return 'completed';
    if (i === currentIdx) return 'current';
    return 'pending';
  });
}

// ── Circle ─────────────────────────────────────────────────────────────────

function StepCircle({ state }: { state: StepState }): React.ReactElement {
  const base = 'flex size-6 shrink-0 items-center justify-center rounded-full';

  if (state === 'completed') {
    return (
      <span className={cn(base, 'bg-primary text-primary-foreground')}>
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (state === 'current') {
    return (
      <span
        className={cn(
          base,
          'bg-primary text-primary-foreground',
          'motion-safe:animate-[step-pulse_2s_ease-out_infinite]',
        )}
      />
    );
  }

  // pending
  return (
    <span
      className={cn(
        base,
        'border-2 border-muted-foreground/30 bg-background',
      )}
    />
  );
}

// ── Connector line ─────────────────────────────────────────────────────────

function ConnectorLine({
  completed,
}: {
  completed: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'ml-[11px] block w-0.5 grow',
        completed ? 'bg-primary' : 'bg-muted-foreground/20',
      )}
    />
  );
}

// ── Step row ───────────────────────────────────────────────────────────────

function StepRow({
  step,
  state,
  isLast,
}: {
  step: TimelineStep;
  state: StepState;
  isLast: boolean;
}): React.ReactElement {
  return (
    <li
      className="flex min-h-[48px]"
      aria-current={state === 'current' ? 'step' : undefined}
    >
      {/* left rail: circle + connector */}
      <div className="flex flex-col items-center">
        <StepCircle state={state} />
        {!isLast && <ConnectorLine completed={state === 'completed'} />}
      </div>

      {/* right: label + metadata */}
      <div className="ml-3 flex flex-col gap-0.5 pb-6">
        <span
          className={cn(
            'text-sm font-medium leading-6',
            state === 'pending'
              ? 'text-muted-foreground'
              : 'text-foreground',
          )}
        >
          {step.label}
        </span>

        {step.timestamp && (
          <span className="text-xs text-muted-foreground">
            {formatRelative(step.timestamp)}
          </span>
        )}

        {step.actor && (
          <span className="text-xs text-muted-foreground/70">
            {step.actor}
          </span>
        )}
      </div>
    </li>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Vertical step indicator for the invoice lifecycle.
 *
 * Accessibility:
 * - Container is `role="list"` with a descriptive label
 * - Current step carries `aria-current="step"`
 * - Pulse animation respects `prefers-reduced-motion`
 *
 * The pulse keyframe (`step-pulse`) must be added to
 * `tailwind.config.ts` or the global CSS:
 *
 * ```css
 * @keyframes step-pulse {
 *   0%, 100% { transform: scale(1); }
 *   50%      { transform: scale(1.1); }
 * }
 * ```
 */
export function TimelineStepper({
  steps,
  currentStepId,
  className,
}: TimelineStepperProps): React.ReactElement {
  const states = resolveStepStates(steps, currentStepId);

  return (
    <ol
      role="list"
      aria-label="Invoice lifecycle progress"
      className={cn('flex flex-col', className)}
    >
      {steps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          state={states[i]}
          isLast={i === steps.length - 1}
        />
      ))}
    </ol>
  );
}
