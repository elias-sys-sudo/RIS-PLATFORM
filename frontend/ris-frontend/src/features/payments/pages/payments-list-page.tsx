import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SlaCountdown } from '@/components/display/sla-countdown';
import { usePendingPayments } from '../hooks/use-payments';
import { formatUGX } from '@/lib/format-ugx';
import { formatRelative } from '@/lib/format-date';
import { useAuthStore } from '@/store/auth.store';
import type { PaymentRecord } from '../api/payments.api';

const STATUS_COLORS: Record<string, string> = {
  pending_first_auth: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_second_auth: 'bg-orange-50 text-orange-700 border-orange-200',
  executing: 'bg-blue-50 text-blue-700 border-blue-200',
  funded: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  reversed: 'bg-gray-50 text-gray-500 border-gray-200',
};

const STATUS_LABELS: Record<string, string> = {
  pending_first_auth: '1st Auth Pending',
  pending_second_auth: '2nd Auth Pending',
  executing: 'Executing',
  funded: 'Funded',
  failed: 'Failed',
  reversed: 'Reversed',
};

/** True when the payment is awaiting the current user's authorisation. */
function needsMyAuth(p: PaymentRecord, userId: string): boolean {
  if (p.status === 'pending_first_auth') return true;
  if (p.status === 'pending_second_auth' && p.dualAuthUser1 !== userId) {
    return true;
  }
  return false;
}

/** True when the payment is in any pending-auth state. */
function isPendingAuth(p: PaymentRecord): boolean {
  return p.status === 'pending_first_auth' || p.status === 'pending_second_auth';
}

function PaymentTableRows({
  payments,
  onRowClick,
}: {
  payments: PaymentRecord[];
  onRowClick: (p: PaymentRecord) => void;
}): React.ReactElement {
  if (payments.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
          No payments found.
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {payments.map((p) => (
        <TableRow
          key={p.id}
          className="cursor-pointer hover:bg-muted/50"
          onClick={() => onRowClick(p)}
        >
          <TableCell className="font-mono text-sm">
            {p.invoiceNumber ?? p.invoiceId.slice(0, 8)}
          </TableCell>
          <TableCell>{p.supplierName ?? '---'}</TableCell>
          <TableCell>{p.buyerName ?? '---'}</TableCell>
          <TableCell className="text-right font-mono">{formatUGX(p.amount)}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">{p.provider}</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="outline" className={STATUS_COLORS[p.status] ?? ''}>
              {STATUS_LABELS[p.status] ?? p.status}
            </Badge>
          </TableCell>
          <TableCell className="text-xs">
            {p.dualAuthUser1 ? 'Done' : 'Pending'}
          </TableCell>
          <TableCell>
            {isPendingAuth(p) ? (
              <SlaCountdown startedAt={p.createdAt} slaHours={72} />
            ) : (
              <span className="text-xs text-muted-foreground">---</span>
            )}
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {formatRelative(p.createdAt)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function PaymentsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading } = usePendingPayments();
  const currentUser = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<string>('needs_my_auth');

  const allPayments = data ?? [];
  const userId = currentUser?.id ?? '';

  const myAuthPayments = allPayments.filter((p) => needsMyAuth(p, userId));
  const pendingCount = myAuthPayments.length;

  function handleRowClick(p: PaymentRecord): void {
    navigate(`/payments/${p.id}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold font-display">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Dual-authorisation payment queue — {pendingCount} awaiting your authorisation
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="needs_my_auth">
            Needs My Auth{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </TabsTrigger>
          <TabsTrigger value="all">All Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="needs_my_auth">
          <PaymentsTable
            payments={myAuthPayments}
            isLoading={isLoading}
            onRowClick={handleRowClick}
          />
        </TabsContent>

        <TabsContent value="all">
          <PaymentsTable
            payments={allPayments}
            isLoading={isLoading}
            onRowClick={handleRowClick}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PaymentsTable({
  payments,
  isLoading,
  onRowClick,
}: {
  payments: PaymentRecord[];
  isLoading: boolean;
  onRowClick: (p: PaymentRecord) => void;
}): React.ReactElement {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>1st Auth</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                  ))}
                </TableRow>
              ))
            : <PaymentTableRows payments={payments} onRowClick={onRowClick} />
          }
        </TableBody>
      </Table>
    </div>
  );
}

export default PaymentsListPage;
