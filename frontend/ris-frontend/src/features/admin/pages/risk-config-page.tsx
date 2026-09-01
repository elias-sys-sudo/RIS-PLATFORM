import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useRiskConfig, useUpdateRiskConfig } from '../hooks/use-admin';
import type { RiskConfigCategory } from '@/types/admin.types';

const CATEGORY_LABELS: Record<RiskConfigCategory, string> = {
  weight: 'Risk Weights', threshold: 'Thresholds', limit: 'Limits', rate: 'Rates',
};
const CATEGORY_COLORS: Record<RiskConfigCategory, string> = {
  weight: 'bg-blue-50 text-blue-700', threshold: 'bg-amber-50 text-amber-700',
  limit: 'bg-green-50 text-green-700', rate: 'bg-purple-50 text-purple-700',
};

export function RiskConfigPage(): React.ReactElement {
  const { data: entries, isLoading } = useRiskConfig();
  const update = useUpdateRiskConfig();
  const [edits, setEdits] = useState<Record<string, number>>({});

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  const categories = [...new Set(entries?.map((e) => e.category) ?? [])];

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold font-display">Risk Configuration</h1><p className="text-sm text-muted-foreground">Adjust risk engine parameters</p></div>
      {categories.map((cat) => {
        const items = entries?.filter((e) => e.category === cat) ?? [];
        return (
          <Card key={cat}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{CATEGORY_LABELS[cat] ?? cat}</CardTitle>
                <Badge variant="outline" className={CATEGORY_COLORS[cat] ?? ''}>{items.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((entry) => (
                <div key={entry.key} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{entry.description}</p>
                    <p className="text-xs text-muted-foreground font-mono">{entry.key}</p>
                  </div>
                  <Input
                    type="number"
                    step="any"
                    className="w-28 text-right font-mono"
                    defaultValue={entry.value}
                    onChange={(e) => setEdits({ ...edits, [entry.key]: Number(e.target.value) })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={edits[entry.key] === undefined || update.isPending}
                    onClick={() => {
                      if (edits[entry.key] !== undefined) {
                        void update.mutateAsync({ key: entry.key, value: edits[entry.key] });
                      }
                    }}
                  >
                    {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
export default RiskConfigPage;
