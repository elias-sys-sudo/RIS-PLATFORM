import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16', className)}>
      <Icon className="size-12 text-muted-foreground/50" />
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm text-center">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
