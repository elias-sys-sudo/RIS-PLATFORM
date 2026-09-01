import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert, FileWarning, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { ChartTooltip } from '@/components/charts/chart-tooltip';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { CHART_COLORS } from '@/components/charts/chart-theme';
import { fetchRegulatoryReport } from '../api/reporting.api';
import type { RegulatoryReport } from '@/types/reporting.types';

// ── Props ───────────────────────────────────────────────────────────────────

interface RegulatoryReportProps {
  filters: { period?: string; startDate?: string; endDate?: string };
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function RegulatorySkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

// ── KYC donut data builder ──────────────────────────────────────────────────

interface KycSlice {
  name: string;
  value: number;
  color: string;
}

function buildKycData(report: RegulatoryReport): KycSlice[] {
  return [
    { name: 'Approved', value: report.kycApprovals, color: CHART_COLORS.success },
    { name: 'Rejected', value: report.kycRejections, color: CHART_COLORS.danger },
  ];
}

// ── Component ───────────────────────────────────────────────────────────────

function RegulatoryReportView({ filters }: RegulatoryReportProps): React.ReactElement {
  const { data, isLoading } = useQuery<RegulatoryReport>({
    queryKey: ['reports', 'regulatory', filters],
    queryFn: () => fetchRegulatoryReport(filters) as Promise<RegulatoryReport>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <RegulatorySkeleton />;

  if (!data) {
    return (
      <ChartEmpty
        message="No regulatory data for this period"
        hint="Compliance data will appear once invoices are processed"
      />
    );
  }

  const kycData = buildKycData(data);
  const kycTotal = data.kycApprovals + data.kycRejections;
  const hasKycData = kycTotal > 0;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard
          title="AML Flags"
          value={String(data.amlFlagsRaised)}
          icon={ShieldAlert}
          subtitle="Flagged transactions"
        />
        <StatCard
          title="SARs Filed"
          value={String(data.sarsFiled)}
          icon={FileWarning}
          subtitle="Suspicious activity reports"
        />
        <StatCard
          title="Above Threshold"
          value={String(data.transactionsAboveThreshold)}
          icon={AlertTriangle}
          subtitle="Large value transactions"
        />
        <StatCard
          title="KYC Approved"
          value={String(data.kycApprovals)}
          icon={CheckCircle2}
          valueClassName="text-green-600"
          subtitle="Suppliers cleared"
        />
        <StatCard
          title="KYC Rejected"
          value={String(data.kycRejections)}
          icon={XCircle}
          valueClassName="text-red-600"
          subtitle="Suppliers declined"
        />
      </div>

      {/* KYC donut chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KYC Review Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {hasKycData ? (
            <div className="relative mx-auto h-72 w-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={kycData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    strokeWidth={0}
                  >
                    {kycData.map((slice) => (
                      <Cell key={slice.name} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(v) => String(v)}
                      />
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-mono font-bold text-foreground">
                  {kycTotal}
                </span>
                <span className="text-xs text-muted-foreground">reviews</span>
              </div>
            </div>
          ) : (
            <ChartEmpty
              message="No KYC reviews recorded"
              hint="Reviews will appear as suppliers are onboarded"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default RegulatoryReportView;
