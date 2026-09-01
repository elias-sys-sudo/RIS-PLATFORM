import { CheckCircle2, Clock, CalendarDays, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format-date';

interface PostConfirmationTimelineProps {
  supplierName: string;
  dueDate: string;
}

const STEPS = [
  {
    icon: CheckCircle2,
    iconClass: 'text-green-600',
    getLabel: (_s: string, _d: string) => 'Confirmation received',
    getDetail: (s: string) => `We will notify ${s} that you have confirmed.`,
  },
  {
    icon: Clock,
    iconClass: 'text-blue-600',
    getLabel: (_s: string, _d: string) => 'Supplier receives payment',
    getDetail: (s: string) => `${s} will receive early payment within 72 hours.`,
  },
  {
    icon: CalendarDays,
    iconClass: 'text-primary',
    getLabel: (_s: string, d: string) => `You pay RIS on ${formatDate(d)}`,
    getDetail: () => 'On the due date, pay RIS (as assignee) instead of the supplier.',
  },
] as const;

/**
 * "What happens next" timeline shown after a buyer confirms an invoice.
 * Builds trust by making the process transparent and predictable.
 */
export function PostConfirmationTimeline({
  supplierName,
  dueDate,
}: PostConfirmationTimelineProps): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardContent className="py-8 space-y-6">
        <div className="text-center space-y-1">
          <CheckCircle2 className="mx-auto size-12 text-green-600" />
          <p className="text-lg font-semibold">Invoice Confirmed</p>
          <p className="text-sm text-muted-foreground">
            Thank you. Here is what happens next:
          </p>
        </div>

        {/* Timeline */}
        <div className="relative ml-4 space-y-0">
          {STEPS.map((step, i) => (
            <div key={i} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Vertical connector line */}
              {i < STEPS.length - 1 && (
                <div className="absolute left-[11px] top-6 h-full w-0.5 bg-border" />
              )}
              {/* Dot / icon */}
              <div className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-background">
                <step.icon className={`size-5 ${step.iconClass}`} />
              </div>
              {/* Text */}
              <div className="pt-0.5">
                <p className="text-sm font-medium">
                  {step.getLabel(supplierName, dueDate)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step.getDetail(supplierName)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Contact info */}
        <div className="border-t pt-4 text-center">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="size-3" />
            Questions? Contact support@ris.co.ug
          </p>
          <p className="text-[10px] text-muted-foreground mt-2">
            Your data is protected under the Uganda Personal Data Protection Act 2019
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
