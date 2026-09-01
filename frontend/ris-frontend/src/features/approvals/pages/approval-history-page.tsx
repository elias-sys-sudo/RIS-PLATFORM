import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RiskBadge } from '@/components/display/status-badge';
import { AmountDisplay } from '@/components/display/amount-display';
import { formatRelative } from '@/lib/format-date';
import { apiClient } from '@/lib/axios';
import type { PaginatedApprovalHistory, ApprovalHistoryFilters } from '@/types/approval.types';

function useApprovalHistory(filters: ApprovalHistoryFilters) {
  return useQuery({
    queryKey: ['approvals', 'history', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedApprovalHistory>('/approvals/history', { params: filters });
      return data;
    },
    staleTime: 60 * 1000,
  });
}

const DECISION_COLORS: Record<string, string> = {
  APPROVED: 'bg-green-50 text-green-700 border-green-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  ESCALATED: 'bg-amber-50 text-amber-700 border-amber-200',
};

const DECISION_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ESCALATED: 'Escalated',
};

export function ApprovalHistoryPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useApprovalHistory({ search: search || undefined, page, page_size: 20 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold font-display">Approval History</h1>
        <p className="text-sm text-muted-foreground">Past approval decisions</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Face Value</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Decided By</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>)}</TableRow>
                ))
              : data?.data.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/approvals/${item.invoiceId}`)}>
                    <TableCell className="font-mono text-sm">{item.invoiceNumber}</TableCell>
                    <TableCell>{item.supplierName}</TableCell>
                    <TableCell>{item.buyerName}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={item.faceValue} /></TableCell>
                    <TableCell>{item.riskLevel ? <RiskBadge level={item.riskLevel} /> : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={DECISION_COLORS[item.finalDecision] ?? ''}>
                        {DECISION_LABELS[item.finalDecision] ?? item.finalDecision}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.decidedBy}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRelative(item.decidedAt)}</TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No history found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalHistoryPage;
