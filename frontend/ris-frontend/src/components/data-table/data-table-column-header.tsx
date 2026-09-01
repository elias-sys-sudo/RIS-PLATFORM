import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface DataTableColumnHeaderProps {
  title: string;
  sortKey?: string;
  currentSort?: string;
  currentDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  className?: string;
}

export function DataTableColumnHeader({
  title,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
}: DataTableColumnHeaderProps): React.ReactElement {
  if (!sortKey || !onSort) {
    return <span className={className}>{title}</span>;
  }

  const isActive = currentSort === sortKey;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-3 h-8 data-[state=open]:bg-accent', className)}
      onClick={() => onSort(sortKey)}
    >
      {title}
      {isActive && currentDir === 'asc' ? (
        <ArrowUp className="ml-1 size-3" />
      ) : isActive && currentDir === 'desc' ? (
        <ArrowDown className="ml-1 size-3" />
      ) : (
        <ChevronsUpDown className="ml-1 size-3 text-muted-foreground/50" />
      )}
    </Button>
  );
}
