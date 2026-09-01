import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Camera, Loader2, AlertTriangle, FileUp, FileText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AmountInput } from '@/components/forms/amount-input';
import { SearchableSelect, type SelectOption } from '@/components/forms/searchable-select';
import { AmountDisplay } from '@/components/display/amount-display';
import { AmountComparison } from '@/components/display/amount-comparison';
import { useCreateInvoice } from '../hooks/use-invoices';
import type { CreateInvoicePayload } from '@/types/invoice.types';
import { useFormPersist } from '@/hooks/use-form-persist';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useIsMobile } from '@/hooks/use-mobile';
import { parseApiError } from '@/lib/parse-api-error';
import { scrollToFirstError } from '@/lib/scroll-to-error';
import { apiClient } from '@/lib/axios';
import { useQuery } from '@tanstack/react-query';
import { RequestBuyerDialog } from '@/features/buyers/components/request-buyer-dialog';

const schema = z.object({
  buyer_id: z.string().min(1, 'Buyer is required'),
  invoice_number: z.string().min(1, 'Invoice number is required'),
  // URA EFRIS reference — required for e-invoice authenticity verification (G1)
  ura_efris_ref: z.string().min(1, 'URA EFRIS reference is required').max(50),
  face_value: z.number().min(1, 'Face value must be at least UGX 1'),
  due_date: z.string().min(1, 'Due date is required'),
  document_type: z.string().min(1, 'Document type is required'),
  description: z.string().optional(),
  // Optional: how long supplier needs the funding — triggers reminder email (G9)
  funding_timeline_days: z.number().int().positive().max(365).optional(),
  consent_accurate: z.boolean().refine((v) => v === true, {
    message: 'Please confirm that all invoice details are accurate and complete',
  }),
  consent_authorize: z.boolean().refine((v) => v === true, {
    message: 'Please authorize RIS to present this invoice to the buyer',
  }),
  consent_terms: z.boolean().refine((v) => v === true, {
    message: 'Please confirm you understand and agree to the early payment terms',
  }),
}).refine((data) => {
  if (!data.due_date) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(data.due_date);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 7 && diffDays <= 90;
}, {
  message: 'Due date must be between 7 and 90 days from today',
  path: ['due_date'],
});
type FormValues = z.infer<typeof schema>;

const STEPS = ['Select Buyer', 'Invoice Details', 'Upload Document', 'Review', 'Submit'];

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'tax_invoice', label: 'Tax Invoice' },
  { value: 'proforma_invoice', label: 'Proforma Invoice' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'delivery_note', label: 'Delivery Note' },
  { value: 'contract', label: 'Contract' },
];

function useBuyerOptions() {
  return useQuery({
    queryKey: ['buyers', 'options'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { id: string; name?: string; companyName?: string }[] }>('/buyers');
      return data.data.map((b): SelectOption => ({ value: b.id, label: b.companyName ?? b.name ?? b.id }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function InvoiceCreatePage(): React.ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [requestBuyerOpen, setRequestBuyerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mutation = useCreateInvoice();

  // Inline client-side preview of the selected file BEFORE the invoice is
  // created. Object URL lifecycle: created when uploadedFile changes,
  // revoked on unmount or when the file is replaced/removed (preventing
  // memory leaks if the user re-selects multiple times).
  const localPreviewUrl = useMemo(
    () => (uploadedFile ? URL.createObjectURL(uploadedFile) : null),
    [uploadedFile],
  );
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);
  const { data: buyers = [] } = useBuyerOptions();
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      buyer_id: '', invoice_number: '', ura_efris_ref: '', face_value: 0,
      due_date: '', document_type: 'tax_invoice', description: '',
      funding_timeline_days: undefined,
      consent_accurate: false,
      consent_authorize: false,
      consent_terms: false,
    },
  });

  const values = form.watch();
  const progress = ((step + 1) / STEPS.length) * 100;

  const savedValues = useFormPersist('invoice-create', values, form.formState.isDirty);
  if (savedValues && !form.formState.isDirty) {
    form.reset(savedValues);
  }

  function canAdvance(): boolean {
    if (step === 0) return !!values.buyer_id;
    if (step === 1) return !!values.invoice_number && !!values.ura_efris_ref && values.face_value > 0 && !!values.due_date;
    if (step === 2) return !!uploadedFile;
    return true;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploadedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(): void {
    setUploadedFile(null);
  }

  async function onSubmit(data: FormValues): Promise<void> {
    try {
      const payload: CreateInvoicePayload = {
        buyer_id: data.buyer_id,
        invoice_number: data.invoice_number,
        face_value: data.face_value,
        due_date: data.due_date,
        issue_date: new Date().toISOString().split('T')[0],
        advance_percentage: 90,
        description: data.description ?? '',
        ura_efris_ref: data.ura_efris_ref,
        funding_timeline_days: data.funding_timeline_days,
      };
      const created = await mutation.mutateAsync(payload);

      // Persist the document chosen in step 3. The invoice record is now in the
      // database, so failure here is recoverable — surface a non-fatal toast and
      // let the supplier re-upload from the invoice detail page rather than
      // blocking the navigation.
      if (uploadedFile && created?.invoiceId) {
        try {
          const formData = new FormData();
          formData.append('file', uploadedFile);
          formData.append('document_type', data.document_type);
          await apiClient.post(`/invoices/${created.invoiceId}/documents`, formData);
        } catch (uploadErr) {
          toast.warning(
            `Invoice created but document upload failed: ${parseApiError(uploadErr)}. ` +
              'You can retry from the invoice detail page.',
          );
        }
      }

      sessionStorage.removeItem('ris-form-invoice-create');
      navigate('/invoices');
    } catch (err) {
      toast.error(parseApiError(err));
    }
  }

  function onValidationError(): void {
    scrollToFirstError();
  }

  const buyerName = buyers.find((b) => b.value === values.buyer_id)?.label ?? '—';
  const docTypeLabel = DOCUMENT_TYPES.find((d) => d.value === values.document_type)?.label ?? values.document_type;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-display">New Invoice</h1>
          <p className="text-sm text-muted-foreground">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </div>
      </div>

      <Progress value={progress} className="h-2" />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onValidationError)}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{STEPS[step]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step 0: Buyer */}
              {step === 0 && (
                <>
                  <FormField control={form.control} name="buyer_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Buyer</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={buyers}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Search for a buyer..."
                          searchPlaceholder="Type buyer name..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {buyers.length === 0 && (
                    <Alert className="mt-3">
                      <AlertDescription>
                        No buyers available yet. Request a buyer to be onboarded by your credit officer.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Can&apos;t find your buyer?</span>
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setRequestBuyerOpen(true)}>
                      Request New Buyer
                    </Button>
                  </div>
                  <RequestBuyerDialog open={requestBuyerOpen} onOpenChange={setRequestBuyerOpen} />
                </>
              )}

              {/* Step 1: Invoice details */}
              {step === 1 && (
                <>
                  <FormField control={form.control} name="invoice_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Number</FormLabel>
                      <FormControl><Input placeholder="INV-2025-001" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="ura_efris_ref" render={({ field }) => (
                    <FormItem>
                      <FormLabel>URA EFRIS Reference</FormLabel>
                      <FormControl><Input placeholder="e.g. EFRIS-2025-00001" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">
                        Required for URA e-invoice verification before buyer confirmation.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="face_value" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Face Value (UGX)</FormLabel>
                      <FormControl>
                        <AmountInput value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="due_date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="funding_timeline_days" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Funding Needed For (days, optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          placeholder="e.g. 30"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === '' ? undefined : Number(v));
                          }}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        We&apos;ll email a reminder when your declared timeline lapses.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="document_type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {DOCUMENT_TYPES.map((dt) => (
                            <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}

              {/* Step 2: Upload Document */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">
                      Upload your {DOCUMENT_TYPES.find((d) => d.value === values.document_type)?.label ?? 'document'}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Accepted formats: PDF, JPEG, PNG. Max size: {MAX_FILE_SIZE_MB}MB.
                    </p>
                    {!uploadedFile ? (
                      <div className="space-y-3">
                        {isMobile && (
                          <Button
                            type="button"
                            className="w-full min-h-[44px]"
                            onClick={() => {
                              if (fileInputRef.current) {
                                fileInputRef.current.accept = 'image/*';
                                fileInputRef.current.setAttribute('capture', 'environment');
                                fileInputRef.current.click();
                              }
                            }}
                          >
                            <Camera className="mr-2 size-5" />
                            Take Photo
                          </Button>
                        )}
                        <div
                          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                          onClick={() => {
                            if (fileInputRef.current) {
                              fileInputRef.current.accept = ACCEPTED_FILE_TYPES;
                              fileInputRef.current.removeAttribute('capture');
                              fileInputRef.current.click();
                            }
                          }}
                        >
                          <FileUp className="mx-auto size-10 text-muted-foreground mb-3" />
                          <p className="text-sm font-medium">{isMobile ? 'Upload File' : 'Click to upload'}</p>
                          <p className="text-xs text-muted-foreground mt-1">or drag and drop your file here</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 border rounded-lg p-4 bg-muted/20">
                          <FileText className="size-8 text-blue-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {(uploadedFile.size / 1024).toFixed(1)} KB &middot; {uploadedFile.type || 'unknown'}
                            </p>
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={removeFile} aria-label="Remove file">
                            <X className="size-4" />
                          </Button>
                        </div>

                        {/* Inline preview — image or PDF rendered from a blob URL.
                            Falls back to "Open in new tab" link if the embed fails
                            (some Android browsers refuse to render PDFs inline). */}
                        {localPreviewUrl && (
                          <div className="border rounded-lg overflow-hidden bg-muted/10">
                            {uploadedFile.type.startsWith('image/') ? (
                              <img
                                src={localPreviewUrl}
                                alt={`Preview of ${uploadedFile.name}`}
                                className="w-full max-h-[480px] object-contain bg-white"
                              />
                            ) : uploadedFile.type === 'application/pdf' ? (
                              <object
                                data={localPreviewUrl}
                                type="application/pdf"
                                className="w-full h-[480px] bg-white"
                                aria-label={`Preview of ${uploadedFile.name}`}
                              >
                                <iframe
                                  src={localPreviewUrl}
                                  title={`Preview of ${uploadedFile.name}`}
                                  className="w-full h-[480px] border-0"
                                />
                              </object>
                            ) : (
                              <p className="p-4 text-sm text-muted-foreground">
                                Preview not available for this file type.
                              </p>
                            )}
                            <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                              <span>Preview is local only — file uploads after you submit.</span>
                              <a
                                href={localPreviewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                Open in new tab
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_FILE_TYPES}
                      className="hidden"
                      onChange={handleFileSelect}
                      aria-label="Upload invoice document"
                    />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Goods delivered, contract reference, etc." rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              {/* Step 3: Review */}
              {step === 3 && (
                <div className="space-y-3 text-sm">
                  <AmountComparison
                    heroLabel="Estimated Advance"
                    heroAmount={String(Math.round(Number(values.face_value || 0) * 0.9))}
                    items={[
                      { label: 'Face Value', amount: String(values.face_value || 0), type: 'neutral' },
                      { label: 'Est. Discount (~10%)', amount: String(Math.round(Number(values.face_value || 0) * 0.1)), type: 'debit' },
                    ]}
                    className="mb-4"
                  />
                  <div className="flex justify-between"><span className="text-muted-foreground">Buyer</span><span className="font-medium">{buyerName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Invoice #</span><span className="font-mono">{values.invoice_number}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Face Value</span><AmountDisplay value={values.face_value} /></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span>{values.due_date}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Document Type</span><span>{docTypeLabel}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Document</span>
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-3.5 text-blue-600" />
                      {uploadedFile?.name ?? '—'}
                    </span>
                  </div>
                  {values.description && <div className="flex justify-between"><span className="text-muted-foreground">Description</span><span className="max-w-xs truncate">{values.description}</span></div>}
                </div>
              )}

              {/* Step 5: Consent & Submit */}
              {step === 4 && (
                <div className="space-y-5">
                  {/* Invoice summary recap */}
                  <div className="space-y-2 text-sm border rounded-lg p-4 bg-muted/30">
                    <p className="font-medium text-base mb-3">Invoice Summary</p>
                    <div className="flex justify-between"><span className="text-muted-foreground">Buyer</span><span className="font-medium">{buyerName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Invoice #</span><span className="font-mono">{values.invoice_number}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Face Value</span><AmountDisplay value={values.face_value} /></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Estimated Advance (90%)</span><AmountDisplay value={Math.round(Number(values.face_value || 0) * 0.9)} /></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span>{values.due_date}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Document</span>
                      <span className="flex items-center gap-1.5">
                        <FileText className="size-3.5 text-blue-600" />
                        {uploadedFile?.name ?? '—'}
                      </span>
                    </div>
                  </div>

                  {/* Consent checkboxes */}
                  <div className="space-y-4">
                    <p className="text-sm font-medium">Before submitting, please confirm:</p>

                    <FormField control={form.control} name="consent_accurate" render={({ field }) => (
                      <FormItem className="flex items-start gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-normal leading-snug">
                            I confirm that all invoice details provided are accurate and complete, and the goods or services have been delivered as described.
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="consent_authorize" render={({ field }) => (
                      <FormItem className="flex items-start gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-normal leading-snug">
                            I authorize RIS to present this invoice to the buyer for confirmation and to verify its validity with relevant parties.
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="consent_terms" render={({ field }) => (
                      <FormItem className="flex items-start gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-normal leading-snug">
                            I understand and agree to the early payment terms, including the applicable discount rate, and that payment is subject to buyer confirmation and credit approval.
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )} />
                  </div>

                  {!isOnline && (
                    <Alert className="bg-amber-50 border-amber-200">
                      <AlertTriangle className="size-4 text-amber-600" />
                      <AlertDescription className="text-amber-700">
                        You are offline. Your draft is saved locally and will be ready to submit when you reconnect.
                      </AlertDescription>
                    </Alert>
                  )}

                  {values.face_value >= 100_000_000 && (
                    <Alert className="bg-amber-50 border-amber-200">
                      <AlertTriangle className="size-4 text-amber-600" />
                      <AlertTitle className="text-amber-800">AML Review Required</AlertTitle>
                      <AlertDescription className="text-amber-700">
                        This invoice exceeds UGX 100,000,000 and will undergo mandatory Anti-Money Laundering review before approval.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
              <ArrowLeft className="mr-2 size-4" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" disabled={!canAdvance()} onClick={() => setStep(step + 1)}>
                Next <ArrowRight className="ml-2 size-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={mutation.isPending || !isOnline}
                title={!isOnline ? 'Submit unavailable while offline' : undefined}
              >
                {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Submit Invoice
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}

export default InvoiceCreatePage;
