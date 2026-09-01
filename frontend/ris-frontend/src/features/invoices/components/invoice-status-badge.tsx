import { Badge } from '@/components/ui/badge';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants';
import { cn } from '@/lib/cn';

const STATUS_VARIANT: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  buyer_confirmed: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  scored: 'bg-violet-50 text-violet-700 border-violet-200',
  priced: 'bg-violet-50 text-violet-700 border-violet-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  pending_first_auth: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_second_auth: 'bg-amber-50 text-amber-700 border-amber-200',
  executing: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  funded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  collecting: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  overdue: 'bg-orange-50 text-orange-700 border-orange-200',
  collected: 'bg-teal-50 text-teal-700 border-teal-200',
  defaulted: 'bg-red-100 text-red-800 border-red-300',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  withdrawn: 'bg-slate-50 text-slate-600 border-slate-200',
};

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  className?: string;
}

export function InvoiceStatusBadge({ status, className }: InvoiceStatusBadgeProps): React.ReactElement {
  return (
    <Badge
      variant="outline"
      className={cn('text-[11px] font-medium', STATUS_VARIANT[status], className)}
    >
      {INVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
