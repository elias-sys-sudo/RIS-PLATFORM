import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { AmountDisplay } from '@/components/display/amount-display';
import { AmountInput } from '@/components/forms/amount-input';
import { useBuyerDetail, useUpdateBuyer } from '../hooks/use-buyers';

const editSchema = z.object({
  industry: z.string().min(2, 'Industry is required').max(80),
  credit_limit: z.number().min(1_000_000, 'Minimum UGX 1,000,000'),
  payment_terms_days: z.number().min(7).max(120),
});
type EditValues = z.infer<typeof editSchema>;

export function BuyerDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: b, isLoading } = useBuyerDetail(id ?? '');
  const updateMutation = useUpdateBuyer();
  const [showEdit, setShowEdit] = useState(false);

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      industry: b?.industry && b.industry !== 'Pending classification' ? b.industry : '',
      credit_limit: b?.creditLimit ?? 0,
      payment_terms_days: b?.paymentTermsDays ?? 30,
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!b) return <div className="py-20 text-center text-muted-foreground">Buyer not found.</div>;

  const utilisation = b.creditLimit > 0 ? 0 : 0;

  async function handleEdit(vals: EditValues): Promise<void> {
    await updateMutation.mutateAsync({ id: id!, payload: vals });
    setShowEdit(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/buyers')}><ArrowLeft className="size-4" /></Button>
        <h1 className="text-2xl font-bold flex-1">{b.name}</h1>
        <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
          <Pencil className="mr-1 size-3" /> Edit
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Industry</p><p className="text-sm font-medium">{b.industry}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Credit Limit</p><AmountDisplay value={b.creditLimit} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Payment Terms</p><p className="text-lg font-bold">{b.paymentTermsDays} days</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Utilisation</p><div className="flex items-center gap-2 mt-1"><Progress value={utilisation} className="h-2 flex-1" /><span className="text-sm font-bold">{utilisation}%</span></div></CardContent></Card>
      </div>

      {(b.contactPerson || b.contactEmail || b.contactPhone) && (
        <Card>
          <CardContent className="p-4 grid gap-2 text-sm md:grid-cols-3">
            {b.contactPerson && <div><span className="text-muted-foreground">Contact</span><p className="font-medium">{b.contactPerson}</p></div>}
            {b.contactEmail && <div><span className="text-muted-foreground">Email</span><p className="font-medium">{b.contactEmail}</p></div>}
            {b.contactPhone && <div><span className="text-muted-foreground">Phone</span><p className="font-medium">{b.contactPhone}</p></div>}
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Buyer</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEdit)} className="space-y-4">
              <FormField control={editForm.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Telecommunications, Banking, FMCG" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="credit_limit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit Limit (UGX)</FormLabel>
                  <FormControl><AmountInput value={field.value} onChange={field.onChange} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="payment_terms_days" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Terms (days)</FormLabel>
                  <FormControl>
                    <Input type="number" min={7} max={120} {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default BuyerDetailPage;
