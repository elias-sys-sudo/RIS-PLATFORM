import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Plus, ArrowUp, ArrowDown, CheckCircle2, Loader2, FileText, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ConfirmationDialog } from '@/components/overlays/confirmation-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AmountDisplay } from '@/components/display/amount-display';
import { AmountInput } from '@/components/forms/amount-input';
import { EscalationBadge } from '@/components/display/status-badge';
import { AmountComparison } from '@/components/display/amount-comparison';
import { downloadDocument } from '../api/collections.api';
import type { EscalationDocumentSummary } from '../api/collections.api';
import { EscalationTimeline } from '../components/escalation-timeline';
import { formatDate } from '@/lib/format-date';
import {
  useCollectionDetail, useRecordPayment, useEscalate, useDeescalate, useResolveCollection,
  useCollectionDocuments, useGenerateDocument, useSendDocument, useUpdateDocument,
} from '../hooks/use-collections';
import { scrollToFirstError } from '@/lib/scroll-to-error';

const paymentSchema = z.object({
  amount: z.number().min(1, 'Amount is required'),
  method: z.enum(['mtn_momo', 'airtel_money', 'bank_transfer', 'cash', 'cheque']),
  reference: z.string().optional(),
  paid_by: z.string().min(1, 'Paid by is required'),
  payment_date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
});

export function CollectionDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: col, isLoading } = useCollectionDetail(id ?? '');
  const recordPayment = useRecordPayment();
  const escalate = useEscalate();
  const deescalate = useDeescalate();
  const resolve = useResolveCollection();
  const { data: documents } = useCollectionDocuments(id ?? '');
  const generateDoc = useGenerateDocument();
  const sendDoc = useSendDocument();

  const [showPayment, setShowPayment] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [showDeescalate, setShowDeescalate] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [escReason, setEscReason] = useState('');
  const [deescReason, setDeescReason] = useState('');

  const form = useForm({ resolver: zodResolver(paymentSchema), defaultValues: { amount: 0, method: 'mtn_momo' as const, reference: '', paid_by: '', payment_date: new Date().toISOString().slice(0, 10), notes: '' } });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!col) return <div className="py-20 text-center text-muted-foreground">Collection not found.</div>;

  async function handlePayment(vals: z.infer<typeof paymentSchema>): Promise<void> {
    await recordPayment.mutateAsync({ id: id!, payload: vals });
    setShowPayment(false);
    form.reset();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/collections')}><ArrowLeft className="size-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono">{col.invoiceNumber}</h1>
            <Badge variant="outline" className="capitalize">{col.status}</Badge>
            <EscalationBadge level={col.escalationLevel} />
            {col.sarFlagged && <Badge variant="destructive">SAR Filed</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{col.buyerName}</p>
        </div>
        {col.status !== 'collected' && col.status !== 'bad_debt' && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setShowPayment(true)}><Plus className="mr-1 size-3" /> Record Payment</Button>
            <Button size="sm" variant="outline" onClick={() => setShowEscalate(true)}><ArrowUp className="mr-1 size-3" /> Escalate</Button>
            {col.escalationLevel !== 'none' && <Button size="sm" variant="outline" onClick={() => setShowDeescalate(true)}><ArrowDown className="mr-1 size-3" /> De-escalate</Button>}
            {(col.status === 'overdue' || col.status === 'escalated') && (
              <DocumentButton collectionId={id!} documents={documents} generateDoc={generateDoc} sendDoc={sendDoc} />
            )}
            <Button size="sm" variant="outline" onClick={() => setShowResolve(true)}><CheckCircle2 className="mr-1 size-3" /> Resolve</Button>
          </div>
        )}
      </div>

      {col.status === 'collected' && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="size-4 text-green-600" />
          <AlertDescription className="text-green-700">
            This collection has been fully resolved. All payments received.
          </AlertDescription>
        </Alert>
      )}

      {/* Amount breakdown */}
      <AmountComparison
        heroLabel="Outstanding Balance"
        heroAmount={String(col.outstandingAmount ?? '0')}
        items={[
          { label: 'Face Value', amount: String(col.faceValue ?? '0'), type: 'neutral' },
          { label: 'Collected', amount: String(col.collectedAmount ?? '0'), type: 'credit' },
          { label: 'Penalty Accrued', amount: String(col.penaltyAmount ?? '0'), type: 'debit' },
        ]}
        className="mb-2"
      />

      {/* Financial cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Face Value</p><AmountDisplay value={col.faceValue} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Collected</p><AmountDisplay value={col.collectedAmount} className="text-lg font-bold text-green-600" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><AmountDisplay value={col.outstandingAmount} className="text-lg font-bold text-orange-600" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Days Overdue</p><p className="text-lg font-bold">{col.daysOverdue > 0 ? <span className="text-red-600">{col.daysOverdue}d</span> : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Due Date</p><p className="text-sm font-medium">{formatDate(col.dueDate)}</p></CardContent></Card>
        <Card className={col.penaltyAmount > 0 ? 'border-l-4 border-l-red-500' : ''}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Penalty Accrued</p><AmountDisplay value={col.penaltyAmount} className={`text-xl font-bold ${col.penaltyAmount > 0 ? 'text-red-600' : ''}`} /><p className="text-xs text-muted-foreground mt-1">{(col.dailyPenaltyRate * 100).toFixed(2)}%/day</p></CardContent></Card>
      </div>

      {/* Auto-default warning */}
      {col.daysOverdue > 0 && col.daysOverdue < 90 && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Auto-default Warning</AlertTitle>
          <AlertDescription className="text-amber-700">
            This collection will auto-default in {90 - col.daysOverdue} days if payment is not received.
          </AlertDescription>
        </Alert>
      )}
      {col.daysOverdue >= 90 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Auto-defaulted</AlertTitle>
          <AlertDescription>
            This collection has exceeded the 90-day overdue threshold and has been auto-defaulted.
          </AlertDescription>
        </Alert>
      )}

      {/* Buyer contact */}
      <Card>
        <CardHeader><CardTitle className="text-base">Buyer Contact</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-3">
          <div><span className="text-muted-foreground">Company</span><p className="font-medium">{col.buyerContact.company}</p></div>
          <div><span className="text-muted-foreground">Contact</span><p className="font-medium">{col.buyerContact.contactPerson}</p></div>
          <div><span className="text-muted-foreground">Email</span><p className="font-medium">{col.buyerContact.email}</p></div>
          <div><span className="text-muted-foreground">Phone</span><p className="font-medium">{col.buyerContact.phone}</p></div>
          <div><span className="text-muted-foreground">Terms</span><p className="font-medium">{col.buyerContact.paymentTermsDays} days</p></div>
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader><CardTitle className="text-base">Payment History ({col.paymentHistory.length})</CardTitle></CardHeader>
        <CardContent>
          {col.paymentHistory.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {col.paymentHistory.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{formatDate(p.paymentDate)}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={p.amount} /></TableCell>
                    <TableCell className="text-xs">{p.method}</TableCell>
                    <TableCell className="text-xs font-mono">{p.reference || '—'}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={p.runningBalance} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Escalation timeline */}
      <Card>
        <CardHeader><CardTitle className="text-base">Escalation Timeline</CardTitle></CardHeader>
        <CardContent>
          <EscalationTimeline events={col.escalationHistory} currentLevel={col.escalationLevel} />
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handlePayment, scrollToFirstError)} className="space-y-4">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount (UGX)</FormLabel><FormControl><AmountInput value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="method" render={({ field }) => (
                <FormItem><FormLabel>Method</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="mtn_momo">MTN Mobile Money</SelectItem><SelectItem value="airtel_money">Airtel Money</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent></Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="paid_by" render={({ field }) => (
                <FormItem><FormLabel>Paid By</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="payment_date" render={({ field }) => (
                <FormItem><FormLabel>Payment Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="reference" render={({ field }) => (
                <FormItem><FormLabel>Reference (optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={recordPayment.isPending}>
                  {recordPayment.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Record
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Escalation dialogs */}
      <Dialog open={showEscalate} onOpenChange={setShowEscalate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Escalate Collection</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for escalation (required)..." value={escReason} onChange={(e) => setEscReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button onClick={async () => { await escalate.mutateAsync({ id: id!, payload: { reason: escReason } }); setShowEscalate(false); setEscReason(''); }} disabled={escalate.isPending || escReason.length < 1}>
              {escalate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Escalate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeescalate} onOpenChange={setShowDeescalate}>
        <DialogContent>
          <DialogHeader><DialogTitle>De-escalate Collection</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for de-escalation (required)..." value={deescReason} onChange={(e) => setDeescReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button onClick={async () => { await deescalate.mutateAsync({ id: id!, reason: deescReason }); setShowDeescalate(false); setDeescReason(''); }} disabled={deescalate.isPending || deescReason.length < 1}>
              {deescalate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} De-escalate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog open={showResolve} onOpenChange={setShowResolve} title="Resolve Collection" description="Mark this collection as resolved. Outstanding balance must be zero." confirmLabel="Resolve" onConfirm={async () => { await resolve.mutateAsync(id!); setShowResolve(false); }} isLoading={resolve.isPending} />
    </div>
  );
}

// -------------------------------------------------------------------------
// Document Actions — replaces the old dead Demand Letter button
// -------------------------------------------------------------------------

function DocumentButton({ collectionId, documents, generateDoc, sendDoc }: {
  collectionId: string;
  documents: EscalationDocumentSummary[] | undefined;
  generateDoc: ReturnType<typeof useGenerateDocument>;
  sendDoc: ReturnType<typeof useSendDocument>;
}) {
  const [showReview, setShowReview] = useState(false);
  const draft = documents?.find((d) => d.documentType === 'demand_letter' && d.status === 'draft');
  const sent = documents?.find((d) => d.documentType === 'demand_letter' && d.status === 'sent');

  if (sent) {
    return (
      <Badge variant="outline" className="text-green-700 border-green-300">
        <FileText className="mr-1 size-3" /> Letter sent {sent.sentAt ? formatDate(sent.sentAt) : ''}
      </Badge>
    );
  }

  if (draft) {
    return (
      <>
        <Button size="sm" variant="outline" className="border-amber-300 text-amber-700"
          onClick={() => setShowReview(true)}>
          <FileText className="mr-1 size-3" /> Review & Send
        </Button>
        <LetterReviewDialog
          open={showReview}
          onOpenChange={setShowReview}
          collectionId={collectionId}
          draft={draft}
          sendDoc={sendDoc}
        />
      </>
    );
  }

  return (
    <Button size="sm" variant="outline"
      disabled={generateDoc.isPending}
      onClick={() => generateDoc.mutate({ collectionId, documentType: 'demand_letter' })}>
      {generateDoc.isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <FileText className="mr-1 size-3" />}
      Generate Draft Letter
    </Button>
  );
}

// -------------------------------------------------------------------------
// Letter Review Dialog — shows letter preview + editable params
// -------------------------------------------------------------------------

function LetterReviewDialog({ open, onOpenChange, collectionId, draft, sendDoc }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  collectionId: string;
  draft: EscalationDocumentSummary;
  sendDoc: ReturnType<typeof useSendDocument>;
}) {
  const updateDoc = useUpdateDocument();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deadlineDays, setDeadlineDays] = useState(draft.draftParams.deadlineDays);
  const [notes, setNotes] = useState(draft.draftParams.additionalNotes);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const blob = await downloadDocument(collectionId, draft.id);
      const url = URL.createObjectURL(blob);
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    } finally { setLoading(false); }
  }, [collectionId, draft.id]);

  useEffect(() => {
    if (open) void loadPreview();
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleUpdate(): Promise<void> {
    await updateDoc.mutateAsync({
      collectionId, docId: draft.id,
      params: { deadlineDays, additionalNotes: notes },
    });
    await loadPreview();
  }

  async function handleSend(): Promise<void> {
    await sendDoc.mutateAsync({ collectionId, docId: draft.id });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review Demand Letter</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review the letter below, adjust parameters if needed, then approve and send to the buyer.
          </p>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-3 gap-4 min-h-0 overflow-hidden">
          {/* Left: Letter preview */}
          <div className="col-span-2 border rounded-lg overflow-hidden bg-white">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewUrl ? (
              <iframe src={previewUrl} title="Demand Letter Preview" className="w-full h-full min-h-[500px]" />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No preview available
              </div>
            )}
          </div>

          {/* Right: Edit params */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Letter Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="deadline" className="text-xs font-medium text-muted-foreground">
                    Payment deadline (days)
                  </label>
                  <Input
                    id="deadline" type="number" min={7} max={90}
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="notes" className="text-xs font-medium text-muted-foreground">
                    Additional notes
                  </label>
                  <Textarea
                    id="notes" rows={5} maxLength={2000}
                    placeholder="Add any notes to include in the letter..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" className="w-full"
                  disabled={updateDoc.isPending}
                  onClick={() => void handleUpdate()}>
                  {updateDoc.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
                  Update & Regenerate
                </Button>
              </CardContent>
            </Card>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="size-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-700">
                Sending this letter will email it directly to the buyer. This action cannot be undone.
              </AlertDescription>
            </Alert>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSend()} disabled={sendDoc.isPending}>
            {sendDoc.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Approve & Send to Buyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CollectionDetailPage;
