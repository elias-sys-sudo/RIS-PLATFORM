/**
 * G6 — Post-approval bank details capture section.
 *
 * Visible only to the supplier who owns the invoice, and only while the
 * invoice is `approved` and bank details have not yet been captured. After
 * successful submission the card collapses to a confirmation line so the
 * supplier sees the capture succeeded.
 *
 * Backend: POST /invoices/:id/bank-details (src/services/invoices/invoices.routes.ts)
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check, Landmark, Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { parseApiError } from '@/lib/parse-api-error';
import { formatAbsolute } from '@/lib/format-date';
import {
  setInvoiceBankDetails,
  type InvoiceBankDetailsPayload,
} from '../api/invoices.api';

const schema = z.object({
  bank_account_number: z.string().min(5, 'Account number is required').max(50),
  bank_account_name:   z.string().min(2, 'Account name is required').max(255),
  bank_name:           z.string().min(2, 'Bank name is required').max(100),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  invoiceId: string;
  status: string;
  bankDetailsCapturedAt?: string | null;
  /** True when the viewer is a supplier (not staff). UI-only gate. */
  canCapture: boolean;
}

export function InvoiceBankDetailsSection({
  invoiceId,
  status,
  bankDetailsCapturedAt,
  canCapture,
}: Props): React.ReactElement | null {
  const qc = useQueryClient();
  const [justSaved, setJustSaved] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { bank_account_number: '', bank_account_name: '', bank_name: '' },
  });

  const mutation = useMutation({
    mutationFn: (payload: InvoiceBankDetailsPayload) =>
      setInvoiceBankDetails(invoiceId, payload),
    onSuccess: () => {
      setJustSaved(true);
      toast.success('Bank details captured');
      void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  if (status !== 'approved' || !canCapture) {
    return null;
  }

  if (bankDetailsCapturedAt || justSaved) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Check className="size-4 text-green-600" />
            Bank details on file
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Captured {bankDetailsCapturedAt ? formatAbsolute(bankDetailsCapturedAt) : 'just now'}.
          RIS will use these details for disbursement.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="size-4" />
          Bank details required
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your invoice is approved. Enter the bank account RIS should disburse to.
          Details are encrypted and used only for this invoice.
        </p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Stanbic Bank Uganda" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bank_account_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account name</FormLabel>
                  <FormControl>
                    <Input placeholder="Name on account" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bank_account_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 9030012345678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save bank details
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
