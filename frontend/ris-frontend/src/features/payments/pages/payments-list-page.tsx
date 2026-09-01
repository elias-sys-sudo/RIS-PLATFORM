import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2 } from 'lucide-react';
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
        <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="mx-auto size-8 text-emerald-500/50 mb-2" />
          <p className="text-sm font-medium">No pending payment authorisations in this queue.</p>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {payments.map((p) => (
        <TableRow
          key={p.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onRowClick(p)}
        >
          <TableCell className="font-mono text-xs font-bold text-primary">
            {p.invoiceNumber ?? p.invoiceId.slice(0, 8)}
          </TableCell>
          <TableCell className="font-medium text-sm">{p.supplierName ?? '---'}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{p.buyerName ?? '---'}</TableCell>
          <TableCell className="text-right font-mono font-bold text-sm">{formatUGX(p.amount)}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-[10px] font-semibold uppercase">{p.provider}</Badge>
          </TableCell>
          <TableCell>
            <Badge
              variant={
                p.status === 'funded'
                  ? 'success'
                  : p.status === 'failed'
                  ? 'destructive'
                  : p.status === 'pending_first_auth'
                  ? 'warning'
                  : 'gold'
              }
              className="text-[10px] font-semibold uppercase tracking-wider"
            >
              {STATUS_LABELS[p.status] ?? p.status}
            </Badge>
          </TableCell>
          <TableCell className="text-xs">
            {p.dualAuthUser1 ? (
              <Badge variant="success" className="text-[10px]">Signed</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Awaiting</Badge>
            )}
          </TableCell>
          <TableCell>
            {isPendingAuth(p) ? (
              <SlaCountdown startedAt={p.createdAt} slaHours={72} />
            ) : (
              <span className="text-xs text-muted-foreground font-mono">---</span>
            )}
          </TableCell>
          <TableCell className="text-xs text-muted-foreground font-mono">
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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Payment Authorisation Cockpit</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <Lock className="size-3 mr-1" />
              Dual-Auth Secured
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Two-officer cryptographic sign-off required before executing banking &amp; Mobile Money disbursements
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card/80 border border-border/70 p-1 rounded-xl">
          <TabsTrigger value="needs_my_auth" className="text-xs rounded-lg font-semibold flex items-center gap-1.5">
            Needs My Signature
            {pendingCount > 0 && (
              <Badge variant="gold" className="text-[10px] px-1.5 py-0 h-4 font-bold">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs rounded-lg font-semibold">
            All Disbursement Records ({allPayments.length})
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
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
        </div>
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
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice #</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Supplier</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Buyer</TableHead>
            <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Net Payout</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Rail</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Status</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">1st Signature</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Banking SLA</TableHead>
            <TableHead className="text-xs font-bold uppercase tracking-wider">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-16 rounded" /></TableCell>
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

