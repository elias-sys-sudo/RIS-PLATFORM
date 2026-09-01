import { Search, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DataTableToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onRefresh?: () => void;
  onExport?: () => void;
  children?: React.ReactNode;
}

export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  onRefresh,
  onExport,
  children,
}: DataTableToolbarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      {onSearchChange && (
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      {children}
      <div className="flex-1" />
      {onRefresh && (
        <Button variant="outline" size="icon" className="size-8" onClick={onRefresh} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      )}
      {onExport && (
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="mr-2 size-4" /> Export
        </Button>
      )}
    </div>
  );
}
