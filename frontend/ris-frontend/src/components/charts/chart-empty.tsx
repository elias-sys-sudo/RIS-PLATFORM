import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ChartEmptyProps {
  message?: string;
  hint?: string;
  className?: string;
}

export function ChartEmpty({
  message = 'No data for this period',
  hint = 'Try selecting a different date range',
  className,
}: ChartEmptyProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <BarChart3 className="size-12 text-muted-foreground/20 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground/60 mt-1">{hint}</p>}
    </div>
  );
}
