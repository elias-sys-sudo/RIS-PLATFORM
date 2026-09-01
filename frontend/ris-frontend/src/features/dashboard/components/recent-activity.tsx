import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRelative } from '@/lib/format-date';
import { formatUGX } from '@/lib/format-ugx';
import type { RecentActivityItem } from '@/types/dashboard.types';

const ACTIVITY_LABELS: Record<string, string> = {
  invoice_submitted: 'Invoice submitted',
  invoice_funded: 'Invoice funded',
  payment_made: 'Payment made',
  collection_received: 'Collection received',
  escalation_raised: 'Escalation raised',
  approval_completed: 'Approval completed',
  invoice_overdue: 'Invoice overdue',
  facility_drawdown: 'Facility drawdown',
};

interface RecentActivityProps {
  items: RecentActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps): React.ReactElement {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start justify-between gap-2 cursor-pointer rounded-md p-2 -mx-2 hover:bg-muted/50 transition-colors"
            onClick={() => item.invoiceId && navigate(`/invoices/${item.invoiceId}`)}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {ACTIVITY_LABELS[item.type] ?? item.type}
              </p>
              <p className="text-xs text-muted-foreground truncate">{item.description}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {item.amount !== undefined && (
                <Badge variant="secondary" className="text-xs font-mono">
                  {formatUGX(item.amount)}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatRelative(item.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
