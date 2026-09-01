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
    <Card>
      <CardContent className={cn('p-6', hero && 'p-8')}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-2">
          <p className={cn('font-bold font-display', hero ? 'text-3xl' : 'text-2xl', valueClassName)}>
            {value}
          </p>
          {sparklineData && sparklineData.length > 2 && (
            <div className="mt-2">
              <Sparkline data={sparklineData} trend={trend} label={title} />
            </div>
          )}
          <div className="flex items-center gap-1 mt-1">
            {change !== undefined && (
              <span className={cn(
                'inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5',
                isPositive && 'bg-green-50 text-green-700',
                isNegative && 'bg-red-50 text-red-700',
                !isPositive && !isNegative && 'bg-muted text-muted-foreground',
              )}>
                {isPositive && <TrendingUp className="mr-0.5 size-3" />}
                {isNegative && <TrendingDown className="mr-0.5 size-3" />}
                {!isPositive && !isNegative && <Minus className="mr-0.5 size-3" />}
                {change > 0 ? '+' : ''}{change.toFixed(1)}%
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
