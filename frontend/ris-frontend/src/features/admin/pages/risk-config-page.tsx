import { useState } from 'react';
import { Loader2, Save, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useRiskConfig, useUpdateRiskConfig } from '../hooks/use-admin';
import type { RiskConfigCategory } from '@/types/admin.types';

const CATEGORY_LABELS: Record<RiskConfigCategory, string> = {
  weight: '5-Factor Risk Model Weights',
  threshold: 'Operational Thresholds & Triggers',
  limit: 'Facility Exposure Limits',
  rate: 'Base Pricing Rates & Margins',
};

const CATEGORY_DESCRIPTIONS: Record<RiskConfigCategory, string> = {
  weight: 'Relative percentage weights assigned to buyer rating, tenor, supplier track record, and collateral.',
  threshold: 'Automated approval and AML threshold rules that govern straight-through processing.',
  limit: 'Maximum facility caps per supplier, single-buyer concentration limits, and drawdown ceilings.',
  rate: 'Benchmark cost of funds, risk spread multipliers, and platform margins.',
};

export function RiskConfigPage(): React.ReactElement {
  const { data: entries, isLoading } = useRiskConfig();
  const update = useUpdateRiskConfig();
  const [edits, setEdits] = useState<Record<string, number>>({});

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const categories = [...new Set(entries?.map((e) => e.category) ?? [])];

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Risk & Pricing Engine</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <Sliders className="size-3 mr-1" />
              Live Governance
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure algorithmic risk weights, approval thresholds, and base rate parameters
          </p>
        </div>
      </div>

      {categories.map((cat) => {
        const items = entries?.filter((e) => e.category === cat) ?? [];
        return (
          <Card key={cat} className="glass-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold font-display">{CATEGORY_LABELS[cat] ?? cat}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{CATEGORY_DESCRIPTIONS[cat] ?? ''}</CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {items.length} Parameters
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((entry) => {
                const isEdited = edits[entry.key] !== undefined && edits[entry.key] !== entry.value;
                return (
                  <div
                    key={entry.key}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/60 p-3 bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-sm font-semibold text-foreground">{entry.description}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{entry.key}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        step="any"
                        className="w-32 text-right font-mono font-bold bg-background/80 h-9 rounded-lg"
                        defaultValue={entry.value}
                        onChange={(e) => setEdits({ ...edits, [entry.key]: Number(e.target.value) })}
                      />
                      <Button
                        size="sm"
                        variant={isEdited ? 'gradient' : 'outline'}
                        disabled={!isEdited || update.isPending}
                        className="h-9 px-3 font-semibold rounded-lg shadow-2xs"
                        onClick={() => {
                          if (edits[entry.key] !== undefined) {
                            void update.mutateAsync({ key: entry.key, value: edits[entry.key] });
                          }
                        }}
                      >
                        {update.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <>
                            <Save className="size-3.5 mr-1" />
                            Save
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default RiskConfigPage;

