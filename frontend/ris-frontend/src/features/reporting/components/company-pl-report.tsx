/**
 * Checkers §6d — Company P&L (company-wide, not per-invoice).
 * Rolls up face-value discounted + discount revenue + cost of funds + gross profit.
 */
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Landmark, TrendingUp, Coins } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { fetchCompanyPl } from '../api/reporting.api';
import { formatUGX } from '@/lib/format-ugx';
import type {
  CompanyPlReport as Report,
  ReportFilters,
} from '@/types/reporting.types';

interface Props { filters: ReportFilters }

function CompanyPlReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'company-pl', filters],
    queryFn: () => fetchCompanyPl(filters) as Promise<Report>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pt-6">
        <Skeleton className="h-36" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (!data) return <ChartEmpty message="No P&L data available" />;

  const margin = Number(data.totalDiscountEarned) > 0
    ? (Number(data.grossProfit) / Number(data.totalDiscountEarned)) * 100
    : 0;

  return (
    <div className="space-y-6 pt-6">
      {/* Hero */}
      <Card>
        <CardContent className="p-8">
          <p className="text-sm font-medium text-muted-foreground mb-1">Gross Profit (Company)</p>
          <span className="text-3xl font-mono font-bold text-green-600">
            {formatUGX(data.grossProfit)}
          </span>
          <p className="text-xs text-muted-foreground mt-3">
            Rolls up every invoice RIS has discounted: total face value bought,
            discount revenue earned, bank interest paid. Gross profit = discount − bank interest.
            Margin: {margin.toFixed(1)}% of discount revenue.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Face Value Discounted"
          value={formatUGX(data.totalFaceValueDiscounted)}
          icon={Coins}
          subtitle="Total invoice face value handled"
        />
        <StatCard
          title="Discount Revenue"
          value={formatUGX(data.totalDiscountEarned)}
          icon={DollarSign}
          subtitle="RIS gross income"
        />
        <StatCard
          title="Bank Interest Cost"
          value={formatUGX(data.totalBankInterestCost)}
          icon={Landmark}
          subtitle="Cost of funds"
        />
        <StatCard
          title="Margin"
          value={`${margin.toFixed(1)}%`}
          icon={TrendingUp}
          subtitle="Gross profit / discount revenue"
        />
      </div>
    </div>
  );
}

export default CompanyPlReport;
