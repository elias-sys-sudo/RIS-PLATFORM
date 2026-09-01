import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AmountDisplay } from '@/components/display/amount-display';
import { AmountInput } from '@/components/forms/amount-input';
import { apiClient } from '@/lib/axios';
import { parseApiError } from '@/lib/parse-api-error';
import type { CollateralItem, CollateralType, CreateCollateralPayload } from '@/types/collateral.types';

const COLLATERAL_TYPES: { value: CollateralType; label: string }[] = [
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'receivables', label: 'Receivables' },
  { value: 'other', label: 'Other' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', verified: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700',
};

const schema = z.object({
  type: z.enum(['property', 'vehicle', 'equipment', 'inventory', 'receivables', 'other']),
  description: z.string().min(5, 'Description is required'),
  estimated_value: z.number().min(1, 'Value is required'),
  expiry_date: z.string().optional(),
});

interface CollateralSectionProps {
  invoiceId: string;
  items: CollateralItem[];
  readOnly?: boolean;
}

export function CollateralSection({ invoiceId, items, readOnly }: CollateralSectionProps): React.ReactElement {
  const [showAdd, setShowAdd] = useState(false);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: CreateCollateralPayload) =>
      apiClient.post(`/invoices/${invoiceId}/collateral`, payload),
    onSuccess: () => {
      toast.success('Collateral added');
      void qc.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      setShowAdd(false);
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { type: 'property' as CollateralType, description: '', estimated_value: 0, expiry_date: '' },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Collateral ({items.length})</CardTitle>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 size-3" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No collateral pledged.</p>
        ) : (
          <div className="space-y-2">
            {items.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize">{c.type}</span>
                    <Badge variant="outline" className={STATUS_COLORS[c.status] ?? ''}>{c.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                <AmountDisplay value={c.estimatedValue} />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Collateral</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Type</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{COLLATERAL_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="estimated_value" render={({ field }) => (
                <FormItem><FormLabel>Estimated Value (UGX)</FormLabel><FormControl><AmountInput value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expiry_date" render={({ field }) => (
                <FormItem><FormLabel>Expiry Date (optional)</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Add Collateral
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
