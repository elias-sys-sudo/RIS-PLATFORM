import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { AmountDisplay } from '@/components/display/amount-display';
import { formatDate } from '@/lib/format-date';
import type { Invoice } from '@/types/invoice.types';

interface InvoiceCardProps {
  invoice: Invoice;
}

/**
 * Mobile-friendly card view for invoice list items.
 * Used on screens < 768px where the table is too narrow.
 */
export function InvoiceCard({ invoice }: InvoiceCardProps): React.ReactElement {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer hover:bg-muted/50 active:bg-muted transition-colors min-h-[72px]"
      onClick={() => navigate(`/invoices/${invoice.id}`)}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-medium">{invoice.invoiceNumber}</span>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{invoice.supplierName}</span>
          <AmountDisplay value={invoice.faceValue} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{invoice.buyerName}</span>
          <span>Due {formatDate(invoice.dueDate)}</span>
        </div>
        {invoice.riskLevel && (
          <div className="text-xs">
            <span className="text-muted-foreground">Risk: </span>
            <span className="capitalize">{invoice.riskLevel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
