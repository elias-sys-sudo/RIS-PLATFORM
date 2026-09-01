import { ChevronDown } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { AmountDisplay } from '@/components/display/amount-display';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatUGX } from '@/lib/format-ugx';

// ── Props ───────────────────────────────────────────────────────────────────

interface PricingTransparencyProps {
  faceValue: number;
  netPayment: number;
  discountAmount: number;
  tenor: number;
  paymentMethod: string;
}

// ── Visual bar ──────────────────────────────────────────────────────────────

interface ComparisonBarProps {
  faceValue: number;
  netPayment: number;
  discountAmount: number;
}

function ComparisonBar({ faceValue, netPayment, discountAmount }: ComparisonBarProps): React.ReactElement {
  const netPct = faceValue > 0 ? (netPayment / faceValue) * 100 : 0;
  const discountPct = faceValue > 0 ? (discountAmount / faceValue) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex h-6 w-full rounded-md overflow-hidden" role="img" aria-label={`Net payment is ${netPct.toFixed(0)}% of face value`}>
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${netPct}%` }}
          title={`Net: ${formatUGX(netPayment)}`}
        />
        <div
          className="bg-amber-400 transition-all"
          style={{ width: `${discountPct}%` }}
          title={`Discount: ${formatUGX(discountAmount)}`}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          You receive ({netPct.toFixed(1)}%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-amber-400" />
          Discount fee ({discountPct.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

// ── Fee detail line ─────────────────────────────────────────────────────────

interface FeeDetailLineProps {
  label: string;
  value: string | number;
}

function FeeDetailLine({ label, value }: FeeDetailLineProps): React.ReactElement {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{typeof value === 'number' ? formatUGX(value) : value}</span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

/**
 * Hero summary with visual comparison bar and expandable fee breakdown.
 * Shown to suppliers once an invoice has been priced, to make the
 * early-payment value proposition crystal clear.
 */
export function PricingTransparency({
  faceValue,
  netPayment,
  discountAmount,
  tenor,
  paymentMethod,
}: PricingTransparencyProps): React.ReactElement {
  const isMobile = useIsMobile();

  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardContent className="space-y-4 p-5">
        {/* Hero message */}
        <div>
          <p className="text-lg font-semibold text-emerald-700">
            You receive <AmountDisplay value={netPayment} className="text-lg font-bold text-emerald-700" /> within 72 hours
          </p>
          <p className="text-sm text-muted-foreground">
            Instead of waiting {tenor} days for{' '}
            <span className="font-mono">{formatUGX(faceValue)}</span>
          </p>
        </div>

        {/* Visual comparison bar */}
        <ComparisonBar
          faceValue={faceValue}
          netPayment={netPayment}
          discountAmount={discountAmount}
        />

        {/* Collapsible fee breakdown — expanded by default on desktop */}
        <Collapsible defaultOpen={!isMobile}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="size-4 transition-transform [[data-state=open]>&]:rotate-180" />
            Fee breakdown
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 rounded-md border bg-background p-3">
              <FeeDetailLine label="Face Value" value={faceValue} />
              <FeeDetailLine label="Discount Amount" value={discountAmount} />
              <FeeDetailLine label="Net Payment" value={netPayment} />
              <FeeDetailLine label="Tenor" value={`${tenor} days`} />
              <FeeDetailLine label="Payment Method" value={paymentMethod} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
