import { cn } from '@/lib/cn';
import { formatAbsolute } from '@/lib/format-date';
import type { EscalationEvent } from '@/types/collection.types';
import type { EscalationLevel } from '@/lib/constants';

// ── Static escalation step definitions ──────────────────────────────────────

interface EscalationStep {
  levelNumber: 1 | 2 | 3;
  level: EscalationLevel;
  label: string;
  triggerLabel: string;
}

const ESCALATION_STEPS: EscalationStep[] = [
  { levelNumber: 1, level: 'reminder', label: 'Reminder',      triggerLabel: 'T+1 day overdue' },
  { levelNumber: 2, level: 'formal',   label: 'Formal Notice',  triggerLabel: 'T+3 days overdue' },
  { levelNumber: 3, level: 'legal',    label: 'Legal Action',   triggerLabel: 'T+7 days overdue' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

type StepState = 'completed' | 'active' | 'pending';

function getStepState(
  step: EscalationStep,
  currentLevel: EscalationLevel,
  eventMap: Map<number, EscalationEvent>,
): StepState {
  const hasEvent = eventMap.has(step.levelNumber);
  if (hasEvent && step.level !== currentLevel) return 'completed';
  if (hasEvent && step.level === currentLevel) return 'active';
  return 'pending';
}

function dotClass(state: StepState): string {
  switch (state) {
    case 'completed': return 'bg-green-500';
    case 'active':    return 'bg-primary';
    case 'pending':   return 'bg-gray-300';
  }
}

function lineClass(state: StepState): string {
  switch (state) {
    case 'completed': return 'border-green-500';
    case 'active':    return 'border-primary';
    case 'pending':   return 'border-gray-300';
  }
}

// ── Single step row ─────────────────────────────────────────────────────────

interface StepRowProps {
  step: EscalationStep;
  state: StepState;
  event: EscalationEvent | undefined;
  isLast: boolean;
}

function StepRow({ step, state, event, isLast }: StepRowProps): React.ReactElement {
  return (
    <div className="flex gap-3">
      {/* Dot + connector line */}
      <div className="flex flex-col items-center">
        <div className={cn('size-3 rounded-full shrink-0 mt-1', dotClass(state))} />
        {!isLast && (
          <div className={cn('w-0 flex-1 border-l-2 my-1', lineClass(state))} />
        )}
      </div>

      {/* Content */}
      <div className="pb-5 flex-1">
        <p className="text-sm font-medium">{step.label}</p>
        <p className="text-xs text-muted-foreground">{step.triggerLabel}</p>
        {event ? (
          <p className="text-xs text-muted-foreground mt-1">
            {formatAbsolute(event.occurredAt)}
            {event.actorName ? ` — ${event.actorName}` : ''}
            {event.notes ? ` — ${event.notes}` : ''}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/60 mt-1 italic">Pending</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface EscalationTimelineProps {
  events: EscalationEvent[];
  currentLevel: EscalationLevel;
}

/**
 * Vertical timeline showing the 3 collection escalation levels.
 * Steps are coloured green (completed), primary (active), or gray (pending).
 */
export function EscalationTimeline({
  events,
  currentLevel,
}: EscalationTimelineProps): React.ReactElement {
  // Index events by levelNumber for O(1) lookup
  const eventMap = new Map<number, EscalationEvent>();
  for (const ev of events) {
    eventMap.set(ev.levelNumber, ev);
  }

  return (
    <div className="pl-1">
      {ESCALATION_STEPS.map((step, idx) => {
        const state = getStepState(step, currentLevel, eventMap);
        return (
          <StepRow
            key={step.levelNumber}
            step={step}
            state={state}
            event={eventMap.get(step.levelNumber)}
            isLast={idx === ESCALATION_STEPS.length - 1}
          />
        );
      })}
    </div>
  );
}
