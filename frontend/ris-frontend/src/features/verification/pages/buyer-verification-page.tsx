import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, CheckCircle2, AlertTriangle, ShieldAlert, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';

import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { getErrorStatus, parseApiError } from '@/lib/parse-api-error';
import {
  useVerification, useConfirmVerification, useDisputeVerification,
} from '../hooks/use-verification';
import {
  confirmVerificationSchema,
  disputeVerificationSchema,
} from '../schemas/verification.schemas';
import type {
  ConfirmVerificationFormValues,
  DisputeVerificationFormValues,
} from '../schemas/verification.schemas';
import { TrustHeader } from '../components/trust-header';
import { PostConfirmationTimeline } from '../components/post-confirmation-timeline';

// ── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton(): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <Skeleton className="mx-auto h-6 w-48" />
        <Skeleton className="mx-auto mt-2 h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

function ErrorState({ status }: { status: number | undefined }): React.ReactElement {
  if (status === 401 || status === 404) {
    return (
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <ShieldAlert className="size-12 text-destructive" />
          <p className="text-center text-lg font-medium">
            This verification link has expired or is invalid.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Please contact the supplier if you believe this is an error.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === 409) {
    return (
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle2 className="size-12 text-primary" />
          <p className="text-center text-lg font-medium">
            This invoice has already been verified.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            No further action is required.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-12">
        <AlertTriangle className="size-12 text-yellow-500" />
        <p className="text-center text-lg font-medium">
          Something went wrong
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Please try refreshing the page. If the problem persists, contact support.
        </p>
      </CardContent>
    </Card>
  );
}

function SuccessState({ message }: { message: string }): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-12">
        <CheckCircle2 className="size-12 text-green-600" />
        <p className="text-center text-lg font-medium">{message}</p>
      </CardContent>
    </Card>
  );
}

// ── Confirm form ─────────────────────────────────────────────────────────────

function ConfirmForm({
  token,
  faceValue,
  dueDate,
  onSuccess,
}: {
  token: string;
  faceValue: number;
  dueDate: string;
  onSuccess: () => void;
}): React.ReactElement {
  const { mutate, isPending } = useConfirmVerification(token);
  const [submitError, setSubmitError] = useState('');

  const form = useForm<ConfirmVerificationFormValues>({
    resolver: zodResolver(confirmVerificationSchema),
    defaultValues: {
      invoiceIsValid: false as unknown as true,
      amountIsCorrect: false as unknown as true,
      dueDateIsCorrect: false as unknown as true,
      agreesToPayRis: false as unknown as true,
    },
  });

  function onSubmit(values: ConfirmVerificationFormValues): void {
    setSubmitError('');
    mutate(values, {
      onSuccess,
      onError: (err) => setSubmitError(parseApiError(err)),
    });
  }

  const allChecked = form.watch('invoiceIsValid')
    && form.watch('amountIsCorrect')
    && form.watch('dueDateIsCorrect')
    && form.watch('agreesToPayRis');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="invoiceIsValid"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  id="invoiceIsValid"
                />
              </FormControl>
              <FormLabel htmlFor="invoiceIsValid" className="text-sm leading-snug font-normal">
                I confirm this invoice is valid and relates to goods/services received
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="amountIsCorrect"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  id="amountIsCorrect"
                />
              </FormControl>
              <FormLabel htmlFor="amountIsCorrect" className="text-sm leading-snug font-normal">
                I confirm the amount of {formatUGX(faceValue)} is correct
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dueDateIsCorrect"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  id="dueDateIsCorrect"
                />
              </FormControl>
              <FormLabel htmlFor="dueDateIsCorrect" className="text-sm leading-snug font-normal">
                I confirm the due date of {formatDate(dueDate)} is correct
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="agreesToPayRis"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  id="agreesToPayRis"
                />
              </FormControl>
              <FormLabel htmlFor="agreesToPayRis" className="text-sm leading-snug font-normal">
                I agree to pay RIS (as assignee) on the due date
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <Button type="submit" variant="gradient" size="lg" className="w-full font-bold shadow-md h-11 text-sm cursor-pointer" disabled={!allChecked || isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Recording Confirmation...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 size-4" />
              Confirm &amp; Acknowledge Assignment
            </>
          )}
        </Button>
      </form>
    </Form>
  );
}

// ── Dispute form ─────────────────────────────────────────────────────────────

function DisputeForm({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: () => void;
}): React.ReactElement {
  const { mutate, isPending } = useDisputeVerification(token);
  const [submitError, setSubmitError] = useState('');

  const form = useForm<DisputeVerificationFormValues>({
    resolver: zodResolver(disputeVerificationSchema),
    defaultValues: { disputeType: undefined, reason: '' },
  });

  function onSubmit(values: DisputeVerificationFormValues): void {
    setSubmitError('');
    mutate(values, {
      onSuccess,
      onError: (err) => setSubmitError(parseApiError(err)),
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="disputeType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dispute reason</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="incorrect_amount">Incorrect Amount</SelectItem>
                  <SelectItem value="incorrect_date">Incorrect Date</SelectItem>
                  <SelectItem value="not_recognized">Not Recognized</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Details</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Please explain the issue in detail (minimum 20 characters)..."
                  rows={4}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <Button type="submit" variant="destructive" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Submit Dispute
        </Button>
      </form>
    </Form>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type PageView = 'details' | 'dispute' | 'confirm-success' | 'dispute-success';

export function BuyerVerificationPage(): React.ReactElement {
  const { token = '' } = useParams<{ token: string }>();
  const { data, isPending, isError, error } = useVerification(token);
  const [view, setView] = useState<PageView>('details');

  const content = (() => {
    if (isPending) return <LoadingSkeleton />;
    if (isError) return <ErrorState status={getErrorStatus(error)} />;

    if (view === 'confirm-success') {
      return (
        <PostConfirmationTimeline
          supplierName={data?.supplierName ?? 'the supplier'}
          dueDate={data?.dueDate ?? ''}
        />
      );
    }
    if (view === 'dispute-success') {
      return <SuccessState message="Your dispute has been submitted for review." />;
    }

    return (
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Invoice Verification</CardTitle>
          <CardDescription>
            Please review the invoice details below and confirm or dispute.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invoice details */}
          <div className="space-y-3 rounded-md border p-4">
            <DetailRow label="Invoice Number" value={data.invoiceNumber} />
            <DetailRow label="Supplier" value={data.supplierName} />
            <DetailRow label="Buyer" value={data.buyerName} />
            <DetailRow label="Face Value" value={formatUGX(data.faceValue)} />
            <DetailRow label="Due Date" value={formatDate(data.dueDate)} />
            {data.description && (
              <DetailRow label="Description" value={data.description} />
            )}
          </div>

          {/* Notice of Assignment */}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
            <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
              <strong>Notice of Assignment:</strong> Your supplier has assigned
              this invoice to RIS for early payment. By confirming below, you
              agree to pay RIS directly on the due date shown above.
            </p>
          </div>

          {/* Action area */}
          {view === 'details' && (
            <div className="space-y-4">
              <ConfirmForm
                token={token}
                faceValue={data.faceValue}
                dueDate={data.dueDate}
                onSuccess={() => setView('confirm-success')}
              />
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full text-muted-foreground"
                onClick={() => setView('dispute')}
              >
                <AlertTriangle className="mr-2 size-4" />
                Dispute This Invoice
              </Button>
            </div>
          )}

          {view === 'dispute' && (
            <div className="space-y-3">
              <DisputeForm
                token={token}
                onSuccess={() => setView('dispute-success')}
              />
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setView('details')}
              >
                Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  })();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <TrustHeader />
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-4">
        <Lock className="size-3.5 text-primary" />
        This page is secured with encryption
      </p>
      {content}
      <p className="mt-6 text-[10px] text-muted-foreground text-center max-w-xs">
        Your data is protected under the Uganda Personal Data Protection Act 2019.
        For questions, contact RIS at <strong>+256 800 100 200</strong>.
      </p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default BuyerVerificationPage;
