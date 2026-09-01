import { Printer, Share2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ReceiptParty {
  name: string;
  id?: string;
}

interface ReceiptCardProps {
  receiptNumber: string;
  date: string;
  supplier: { name: string; id: string };
  buyer: { name: string };
  faceValue: string;
  advanceAmount: string;
  discountAmount: string;
  netPayment: string;
  paymentMethod: string;
  transactionRef?: string;
  className?: string;
}

// ── Amount row helper ──────────────────────────────────────

function AmountRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5',
        bold && 'border-t border-border pt-2 font-semibold',
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-sm tabular-nums', bold && 'text-foreground')}>
        {formatUGX(value)}
      </span>
    </div>
  );
}

// ── Party section helper ───────────────────────────────────

function PartySection({
  role,
  party,
}: {
  role: string;
  party: ReceiptParty;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {role}
      </span>
      <span className="text-sm font-medium text-foreground">
        {party.name}
      </span>
      {party.id && (
        <span className="font-mono text-xs text-muted-foreground">
          ID: {party.id}
        </span>
      )}
    </div>
  );
}

// ── WhatsApp share link builder ────────────────────────────

function buildWhatsAppUrl(props: ReceiptCardProps): string {
  const text = [
    `RIS Payment Receipt`,
    `Receipt: ${props.receiptNumber}`,
    `Date: ${formatDate(props.date)}`,
    `Supplier: ${props.supplier.name}`,
    `Buyer: ${props.buyer.name}`,
    `Face Value: ${formatUGX(props.faceValue)}`,
    `Net Payment: ${formatUGX(props.netPayment)}`,
    `Method: ${props.paymentMethod}`,
    props.transactionRef ? `Ref: ${props.transactionRef}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ── Receipt Card ───────────────────────────────────────────

/**
 * Printable receipt card for funded invoices.
 * Uses @media print styles for clean printout.
 * Includes WhatsApp share (screen only) and print button.
 */
export function ReceiptCard(props: ReceiptCardProps): React.ReactElement {
  const {
    receiptNumber,
    date,
    supplier,
    buyer,
    faceValue,
    advanceAmount,
    discountAmount,
    netPayment,
    paymentMethod,
    transactionRef,
    className,
  } = props;

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          [data-receipt-card], [data-receipt-card] * { visibility: visible; }
          [data-receipt-card] {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none;
            box-shadow: none;
          }
          [data-print-hide] { display: none !important; }
        }
      `}</style>

      <Card data-receipt-card className={cn('max-w-lg', className)}>
        {/* Header — receipt number and date */}
        <CardHeader className="border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-lg">Payment Receipt</CardTitle>
              <span className="font-mono text-xs text-muted-foreground">
                {receiptNumber}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm text-muted-foreground">
                {formatDate(date)}
              </span>
              {/* QR code placeholder */}
              <div
                className="flex size-14 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                aria-label="QR code placeholder"
              >
                QR
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Parties */}
          <div className="grid grid-cols-2 gap-4">
            <PartySection role="Supplier" party={supplier} />
            <PartySection role="Buyer" party={buyer} />
          </div>

          {/* Amount breakdown */}
          <div className="rounded-md bg-secondary/50 p-3">
            <AmountRow label="Face Value" value={faceValue} />
            <AmountRow label="Advance Amount" value={advanceAmount} />
            <AmountRow label="Discount" value={discountAmount} />
            <AmountRow label="Net Payment" value={netPayment} bold />
          </div>

          {/* Payment details */}
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment Method</span>
              <span className="font-medium">{paymentMethod}</span>
            </div>
            {transactionRef && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transaction Ref</span>
                <span className="font-mono text-xs">{transactionRef}</span>
              </div>
            )}
          </div>
        </CardContent>

        {/* Actions — hidden on print */}
        <CardFooter data-print-hide className="gap-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 size-4" aria-hidden="true" />
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href={buildWhatsAppUrl(props)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Share2 className="mr-1.5 size-4" aria-hidden="true" />
              Share via WhatsApp
            </a>
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
