import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface HeatmapCell {
  supplierId: string;
  supplierName: string;
  buyerId: string;
  buyerName: string;
  riskLevel: RiskLevel;
  exposure: string;
}

interface RiskHeatmapProps {
  cells: HeatmapCell[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Color + pattern mapping
// ---------------------------------------------------------------------------

const RISK_STYLES: Record<
  RiskLevel,
  { bg: string; label: string; pattern: string }
> = {
  low: {
    bg: 'bg-green-500',
    label: 'Low',
    pattern: '', // no pattern for low risk
  },
  medium: {
    bg: 'bg-blue-500',
    label: 'Medium',
    // diagonal lines for color-blind safety
    pattern: [
      'repeating-linear-gradient(',
      '45deg,',
      'transparent,',
      'transparent 3px,',
      'rgba(255,255,255,0.25) 3px,',
      'rgba(255,255,255,0.25) 5px',
      ')',
    ].join(' '),
  },
  high: {
    bg: 'bg-amber-500',
    label: 'High',
    // dot pattern for color-blind safety
    pattern: [
      'radial-gradient(',
      'circle,',
      'rgba(255,255,255,0.3) 1px,',
      'transparent 1px',
      ')',
    ].join(' '),
  },
  critical: {
    bg: 'bg-red-600',
    label: 'Critical',
    // crosshatch for color-blind safety
    pattern: [
      'repeating-linear-gradient(',
      '45deg,',
      'transparent,',
      'transparent 3px,',
      'rgba(255,255,255,0.3) 3px,',
      'rgba(255,255,255,0.3) 5px',
      '),',
      'repeating-linear-gradient(',
      '-45deg,',
      'transparent,',
      'transparent 3px,',
      'rgba(255,255,255,0.3) 3px,',
      'rgba(255,255,255,0.3) 5px',
      ')',
    ].join(' '),
  },
};

function patternStyle(level: RiskLevel): React.CSSProperties {
  const { pattern } = RISK_STYLES[level];
  if (!pattern) return {};

  const base: React.CSSProperties = { backgroundImage: pattern };

  // dots need background-size
  if (level === 'high') {
    return { ...base, backgroundSize: '6px 6px' };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

interface GridData {
  suppliers: { id: string; name: string }[];
  buyers: { id: string; name: string }[];
  lookup: Map<string, HeatmapCell>;
}

function buildGrid(cells: HeatmapCell[]): GridData {
  const supplierIds = uniqueSorted(cells.map((c) => c.supplierId));
  const buyerIds = uniqueSorted(cells.map((c) => c.buyerId));

  const supplierMap = new Map<string, string>();
  const buyerMap = new Map<string, string>();
  const lookup = new Map<string, HeatmapCell>();

  for (const cell of cells) {
    supplierMap.set(cell.supplierId, cell.supplierName);
    buyerMap.set(cell.buyerId, cell.buyerName);
    lookup.set(`${cell.supplierId}::${cell.buyerId}`, cell);
  }

  return {
    suppliers: supplierIds.map((id) => ({
      id,
      name: supplierMap.get(id) ?? id,
    })),
    buyers: buyerIds.map((id) => ({
      id,
      name: buyerMap.get(id) ?? id,
    })),
    lookup,
  };
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function HeatmapLegend(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      {(Object.keys(RISK_STYLES) as RiskLevel[]).map((level) => (
        <div key={level} className="flex items-center gap-1.5">
          <div
            className={cn(
              'size-3 rounded-sm',
              RISK_STYLES[level].bg,
            )}
            style={patternStyle(level)}
            aria-hidden="true"
          />
          <span className="text-xs text-muted-foreground">
            {RISK_STYLES[level].label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RiskHeatmap({
  cells,
  className,
}: RiskHeatmapProps): React.ReactElement {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const grid = useMemo(() => buildGrid(cells), [cells]);

  if (cells.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle className="text-base">Risk Concentration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-12 text-center text-sm text-muted-foreground">
            No data
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">Risk Concentration</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <TooltipProvider>
            <div
              role="table"
              aria-label="Supplier by buyer risk concentration heatmap"
            >
              {/* Header row: buyer names */}
              <div
                role="row"
                className="flex"
              >
                {/* Top-left corner spacer */}
                <div
                  role="columnheader"
                  className="w-24 shrink-0"
                  aria-label="Supplier"
                />
                {grid.buyers.map((buyer) => (
                  <div
                    key={buyer.id}
                    role="columnheader"
                    className="flex w-12 shrink-0 items-end justify-center pb-1"
                  >
                    <span
                      className="max-w-12 origin-bottom-left -rotate-45 truncate text-xs text-muted-foreground"
                      title={buyer.name}
                    >
                      {truncate(buyer.name, 8)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {grid.suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  role="row"
                  className="flex"
                >
                  {/* Row header: supplier name */}
                  <div
                    role="rowheader"
                    className="flex w-24 shrink-0 items-center pr-2"
                  >
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={supplier.name}
                    >
                      {truncate(supplier.name, 10)}
                    </span>
                  </div>

                  {/* Cells */}
                  {grid.buyers.map((buyer) => {
                    const cellKey = `${supplier.id}::${buyer.id}`;
                    const cell = grid.lookup.get(cellKey);

                    if (!cell) {
                      return (
                        <div
                          key={cellKey}
                          role="cell"
                          className="m-0.5 size-12 shrink-0 rounded-sm bg-muted/30"
                          aria-label={`${supplier.name} and ${buyer.name}: no exposure`}
                        />
                      );
                    }

                    const style = RISK_STYLES[cell.riskLevel];
                    const isFocused = focusedKey === cellKey;

                    return (
                      <Tooltip key={cellKey}>
                        <TooltipTrigger asChild>
                          <div
                            role="cell"
                            aria-label={`${supplier.name} and ${buyer.name}: ${formatUGX(cell.exposure)}, Risk ${style.label}`}
                            className={cn(
                              'm-0.5 size-12 shrink-0 cursor-pointer rounded-sm transition-shadow',
                              style.bg,
                              isFocused && 'ring-2 ring-foreground ring-offset-1',
                            )}
                            style={patternStyle(cell.riskLevel)}
                            tabIndex={0}
                            onFocus={() => setFocusedKey(cellKey)}
                            onBlur={() => setFocusedKey(null)}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4}>
                          <p className="text-xs font-medium">
                            {supplier.name} &times; {buyer.name}
                          </p>
                          <p className="text-xs font-mono">
                            {formatUGX(cell.exposure)}
                          </p>
                          <p className="text-xs">
                            Risk: {style.label}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </TooltipProvider>
        </div>

        <HeatmapLegend />
      </CardContent>
    </Card>
  );
}
