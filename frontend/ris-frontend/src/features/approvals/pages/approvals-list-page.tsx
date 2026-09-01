import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, CheckCircle2, XCircle, Clock, X } from 'lucide-react';
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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApprovals } from '../hooks/use-approvals';
import { formatUGX } from '@/lib/format-ugx';
import { formatRelative } from '@/lib/format-date';
import type { ApprovalFilters, ApprovalTab } from '@/types/approval.types';

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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">4-Tier Credit Approvals</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <ShieldCheck className="size-3 mr-1" />
              Tiered Delegation Matrix
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review, sign off, or escalate invoice discounting requests based on credit limit tiers
          </p>
        </div>
      </div>

      {/* 4 Stats Cards */}
      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <Clock className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Pending Queue</p>
                <p className="text-xl font-bold font-mono text-foreground">{data.stats.pendingCount}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Approved Today</p>
                <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{data.stats.approvedToday}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <XCircle className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Rejected Today</p>
                <p className="text-xl font-bold font-mono text-destructive">{data.stats.rejectedToday}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Average SLA</p>
                <p className="text-xl font-bold font-mono text-foreground">{data.stats.avgDaysInQueue.toFixed(1)} Days</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as ApprovalTab); setPage(1); }}>
          <TabsList className="bg-card/80 border border-border/70 p-1 rounded-xl">
            <TabsTrigger value="pending" className="text-xs rounded-lg font-semibold">Pending Action</TabsTrigger>
            <TabsTrigger value="approved" className="text-xs rounded-lg font-semibold">Approved</TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs rounded-lg font-semibold">Declined</TabsTrigger>
            <TabsTrigger value="all" className="text-xs rounded-lg font-semibold">All Records</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search approvals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-10 rounded-xl bg-card/60 border-border/80 text-xs focus-visible:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice #</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Supplier</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Buyer</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Face Value</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Risk Grade</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Required Tier</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Queue Age</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16 rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/approvals/${item.invoiceId}`)}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">{item.invoiceNumber}</TableCell>
                    <TableCell className="font-medium text-sm">{item.supplierName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.buyerName}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">{formatUGX(item.faceValue)}</TableCell>
                    <TableCell>
                      {item.riskLevel ? (
                        <Badge
                          variant={
                            item.riskLevel === 'low'
                              ? 'success'
                              : item.riskLevel === 'high' || item.riskLevel === 'critical'
                              ? 'destructive'
                              : 'warning'
                          }
                          className="text-[10px] font-semibold uppercase tracking-wider"
                        >
                          {item.riskLevel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-semibold">
                        Tier {item.currentTier}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.daysInQueue}d</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {formatRelative(item.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <ShieldCheck className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No approval requests found for this tab.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground font-mono">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="text-xs rounded-lg">
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="text-xs rounded-lg">
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalsListPage;

