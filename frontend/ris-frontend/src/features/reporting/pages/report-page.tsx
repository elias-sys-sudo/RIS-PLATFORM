import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateRangePicker } from '@/components/forms/date-range-picker';
import { AmountDisplay } from '@/components/display/amount-display';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import {
  fetchPortfolioReport, fetchAgingReport, fetchBuyerExposure,
  fetchProfitReport, fetchFacilitiesReport, fetchAuditExport, fetchRegulatoryReport,
} from '../api/reporting.api';

const REPORT_TITLES: Record<string, string> = {
  portfolio: 'Portfolio Overview', aging: 'Aging Analysis',
  'buyer-exposure': 'Buyer Exposure', profit: 'Profit & Loss',
  facilities: 'Facilities Usage', 'audit-export': 'Audit Export',
  regulatory: 'Regulatory Compliance',
};

const REPORT_FETCHERS: Record<string, (f: Record<string, string | undefined>) => Promise<unknown>> = {
  portfolio: fetchPortfolioReport, aging: fetchAgingReport,
  'buyer-exposure': fetchBuyerExposure, profit: fetchProfitReport,
  facilities: fetchFacilitiesReport, 'audit-export': fetchAuditExport,
  regulatory: fetchRegulatoryReport,
};

export function ReportPage(): React.ReactElement {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [from, setFrom] = useState<Date>();
  const [to, setTo] = useState<Date>();

  const reportType = type ?? 'portfolio';
  const title = REPORT_TITLES[reportType] ?? 'Report';
  const fetcher = REPORT_FETCHERS[reportType];

  const { data, isLoading } = useQuery({
    queryKey: ['reports', reportType, from?.toISOString(), to?.toISOString()],
    queryFn: () => fetcher?.({
      startDate: from?.toISOString().slice(0, 10),
      endDate: to?.toISOString().slice(0, 10),
    }),
    enabled: !!fetcher,
    staleTime: 5 * 60 * 1000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reporting')}><ArrowLeft className="size-4" /></Button>
        <h1 className="text-2xl font-bold font-display">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <DateRangePicker from={from} to={to} onChange={({ from: f, to: t }) => { setFrom(f); setTo(t); }} />
        {reportType === 'audit-export' && (
          <Button variant="outline" size="sm" onClick={() => {
            void fetchAuditExport({ startDate: from?.toISOString().slice(0, 10), endDate: to?.toISOString().slice(0, 10), format: 'csv' });
          }}>
            <Download className="mr-2 size-4" /> Export CSV
          </Button>
        )}
      </div>

      {isLoading ? <Skeleton className="h-64 w-full" /> : !d ? (
        <p className="text-muted-foreground text-center py-8">No data available.</p>
      ) : (
        <>
          {/* Portfolio summary cards */}
          {reportType === 'portfolio' && (
            <div className="grid gap-4 md:grid-cols-5">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Funded</p><AmountDisplay value={d.totalFunded} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Collected</p><AmountDisplay value={d.totalCollected} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><AmountDisplay value={d.totalOutstanding} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overdue</p><AmountDisplay value={d.totalOverdue} className="text-lg font-bold text-red-600" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Annualised Yield</p><p className="text-lg font-bold">{d.annualisedYield ?? '—'}%</p></CardContent></Card>
            </div>
          )}

          {/* Aging buckets chart */}
          {reportType === 'aging' && d.buckets && (
            <Card>
              <CardHeader><CardTitle className="text-base">Aging Buckets</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.buckets}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" className="text-xs" />
                    <YAxis tickFormatter={(v: number) => formatUGX(v).replace('UGX ', '')} className="text-xs" />
                    <Tooltip formatter={(v) => formatUGX(Number(v))} />
                    <Bar dataKey="totalAmount" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Regulatory cards */}
          {reportType === 'regulatory' && (
            <div className="grid gap-4 md:grid-cols-5">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">AML Flags</p><p className="text-lg font-bold">{d.amlFlagsRaised ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">SARs Filed</p><p className="text-lg font-bold">{d.sarsFiled ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Above Threshold</p><p className="text-lg font-bold">{d.transactionsAboveThreshold ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">KYC Approved</p><p className="text-lg font-bold text-green-600">{d.kycApprovals ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">KYC Rejected</p><p className="text-lg font-bold text-red-600">{d.kycRejections ?? 0}</p></CardContent></Card>
            </div>
          )}

          {/* Profit summary */}
          {reportType === 'profit' && d.summary && (
            <div className="grid gap-4 md:grid-cols-5">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Face Value</p><AmountDisplay value={d.summary.totalFaceValue} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Discount</p><AmountDisplay value={d.summary.totalDiscount} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Bank Interest</p><AmountDisplay value={d.summary.totalBankInterest} className="text-lg font-bold" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Net Profit</p><AmountDisplay value={d.summary.totalNetProfit} className="text-lg font-bold text-green-600" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Avg Margin</p><p className="text-lg font-bold">{d.summary.avgProfitMarginPct?.toFixed(1) ?? '—'}%</p></CardContent></Card>
            </div>
          )}

          {/* Buyer exposure table */}
          {reportType === 'buyer-exposure' && Array.isArray(d) && d.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Buyer</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Limit</TableHead><TableHead>Util %</TableHead><TableHead>Avg Days</TableHead><TableHead>Overdue</TableHead></TableRow></TableHeader>
                <TableBody>{d.map((b: { buyerId: string; buyerName: string; usedLimit: number; approvedLimit: number; utilisationPct: number; avgDaysToPay: number; overdueIncidentCount: number }) => (
                  <TableRow key={b.buyerId}>
                    <TableCell>{b.buyerName}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={b.usedLimit} /></TableCell>
                    <TableCell className="text-right"><AmountDisplay value={b.approvedLimit} /></TableCell>
                    <TableCell>{b.utilisationPct?.toFixed(1)}%</TableCell>
                    <TableCell>{b.avgDaysToPay?.toFixed(0)}d</TableCell>
                    <TableCell>{b.overdueIncidentCount}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          )}

          {/* Facilities usage table */}
          {reportType === 'facilities' && d.data && Array.isArray(d.data) && (
            <div className="rounded-md border">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Bank</TableHead><TableHead className="text-right">Total Limit</TableHead>
                  <TableHead className="text-right">Drawn</TableHead><TableHead className="text-right">Available</TableHead>
                  <TableHead>Utilisation</TableHead><TableHead className="text-right">Interest Accrued</TableHead>
                  <TableHead>Maturity</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>{d.data.map((f: { id: string; bankName: string; totalLimit: number; drawnAmount: number; availableAmount: number; utilisationPct: number; interestAccrued: number; maturityDate: string; status: string }) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.bankName}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={f.totalLimit} /></TableCell>
                    <TableCell className="text-right"><AmountDisplay value={f.drawnAmount} /></TableCell>
                    <TableCell className="text-right"><AmountDisplay value={f.availableAmount} /></TableCell>
                    <TableCell><div className="flex items-center gap-2"><Progress value={f.utilisationPct} className="h-2 w-16" /><span className="text-xs">{f.utilisationPct.toFixed(0)}%</span></div></TableCell>
                    <TableCell className="text-right"><AmountDisplay value={f.interestAccrued} /></TableCell>
                    <TableCell className="text-xs">{formatDate(f.maturityDate)}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{f.status}</Badge></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          )}

          {/* Audit entries table */}
          {reportType === 'audit-export' && d.entries && (
            <div className="rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Table</TableHead><TableHead>Record</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>{d.entries.slice(0, 50).map((e: { id: string; userId: string; action: string; tableName: string; recordId: string; createdAt: string }) => (
                  <TableRow key={e.id}><TableCell className="text-xs font-mono">{e.userId?.slice(0, 8) ?? '—'}</TableCell><TableCell className="text-xs">{e.action}</TableCell><TableCell className="text-xs">{e.tableName}</TableCell><TableCell className="text-xs font-mono">{e.recordId?.slice(0, 8)}</TableCell><TableCell className="text-xs">{e.createdAt}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export default ReportPage;
