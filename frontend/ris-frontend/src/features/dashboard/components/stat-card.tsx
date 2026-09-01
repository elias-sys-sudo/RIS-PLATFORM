import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sparkline } from '@/components/charts/sparkline';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  change?: number;
  subtitle?: string;
  sparklineData?: number[];
  valueClassName?: string;
  hero?: boolean;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  change,
  subtitle,
  sparklineData,
  valueClassName,
  hero,
}: StatCardProps): React.ReactElement {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const trend: 'up' | 'down' | 'flat' =
    change !== undefined && change > 0 ? 'up' : change !== undefined && change < 0 ? 'down' : 'flat';

  return (
    <Card className="relative overflow-hidden group hover:border-primary/40 transition-all duration-300">
      <CardContent className={cn('p-5', hero && 'p-7')}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary group-hover:bg-primary/20 group-hover:scale-105 transition-all">
            <Icon className="size-4" />
          </div>
        </div>
        <div className="mt-3">
          <p className={cn('font-bold font-display tracking-tight tabular-nums', hero ? 'text-3xl lg:text-4xl' : 'text-2xl', valueClassName)}>
            {value}
          </p>
          {sparklineData && sparklineData.length > 2 && (
            <div className="mt-2.5">
              <Sparkline data={sparklineData} trend={trend} label={title} />
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            {change !== undefined && (
              <span className={cn(
                'inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5 border',
                isPositive && 'border-emerald-500/20 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
                isNegative && 'border-red-500/20 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                !isPositive && !isNegative && 'border-border bg-muted/60 text-muted-foreground',
              )}>
                {isPositive && <TrendingUp className="mr-1 size-3" />}
                {isNegative && <TrendingDown className="mr-1 size-3" />}
                {!isPositive && !isNegative && <Minus className="mr-1 size-3" />}
                {change > 0 ? '+' : ''}{change.toFixed(1)}%
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground font-medium">{subtitle}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
