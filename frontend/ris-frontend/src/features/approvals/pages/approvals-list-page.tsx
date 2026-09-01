import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useApprovals } from '../hooks/use-approvals';
import { formatUGX } from '@/lib/format-ugx';
import { formatRelative } from '@/lib/format-date';
import type { ApprovalFilters, ApprovalTab } from '@/types/approval.types';

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export function ApprovalsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filters: ApprovalFilters = {
    tab,
    search: search || undefined,
    page,
    page_size: 20,
  };

  const { data, isLoading } = useApprovals(filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold font-display">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review and approve invoice submissions
        </p>
      </div>

      {/* Stats */}
      {data?.stats && (
        <div className="flex gap-4 text-sm">
          <Badge variant="outline">{data.stats.pendingCount} pending</Badge>
          <Badge variant="outline" className="text-green-600">{data.stats.approvedToday} approved today</Badge>
          <Badge variant="outline" className="text-red-600">{data.stats.rejectedToday} rejected today</Badge>
          <Badge variant="outline">Avg {data.stats.avgDaysInQueue.toFixed(1)}d in queue</Badge>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as ApprovalTab); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Face Value</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Days in Queue</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/approvals/${item.invoiceId}`)}
                  >
                    <TableCell className="font-mono text-sm">{item.invoiceNumber}</TableCell>
                    <TableCell>{item.supplierName}</TableCell>
                    <TableCell>{item.buyerName}</TableCell>
                    <TableCell className="text-right font-mono">{formatUGX(item.faceValue)}</TableCell>
                    <TableCell>
                      {item.riskLevel ? (
                        <Badge variant="outline" className={RISK_COLORS[item.riskLevel]}>
                          {item.riskLevel}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell>Tier {item.currentTier}</TableCell>
                    <TableCell>{item.daysInQueue}d</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(item.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No approvals found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalsListPage;
