import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import axios from 'axios';
import { Loader2, ArrowLeft, ArrowRight, Check, ShieldCheck, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

import {
  parseApiError,
  getApiFieldErrors,
  applyFieldErrorsToForm,
} from '@/lib/parse-api-error';
import { useFormPersist } from '@/hooks/use-form-persist';
import {
  registrationSchema,
  type RegistrationFormValues,
} from '../schemas/onboarding.schemas';
import { registerSupplier } from '../api/onboarding.api';

// ── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'Agriculture',
  'Construction',
  'Financial Services',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Technology',
  'Trade & Commerce',
  'Transport & Logistics',
  'Other',
] as const;

const PAYMENT_METHODS = [{ value: 'bank_transfer', label: 'Bank Transfer' }] as const;

const STEPS = [
  'Company Details',
  'Contact Person',
  'Banking Details',
  'Payment Preference',
  'Review & Consent',
] as const;

// ── Step content components ──────────────────────────────────────────────────

function CompanyDetailsStep({ form }: StepProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="companyName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Company Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Kampala Trading Ltd" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="registrationNumber"
        render={({ field }) => (
          <FormItem>
            <FormLabel>URSB Registration Number</FormLabel>
            <FormControl>
              <Input placeholder="e.g. 80020000123456" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="industry"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Industry</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an industry" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {INDUSTRIES.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="companyAddress"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Company Address</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Plot 12, Kampala Road, Kampala" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function ContactPersonStep({ form }: StepProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="contactPersonName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Full Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. John Doe" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="contactEmail"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input
                type="email"
                placeholder="e.g. john@company.co.ug"
                autoComplete="email"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="contactPhone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone</FormLabel>
            <FormControl>
              <Input type="tel" placeholder="+256XXXXXXXXX" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl>
              <Input
                type="password"
                placeholder="Min 8 chars, uppercase, lowercase, number, special"
                autoComplete="new-password"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="confirmPassword"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Confirm Password</FormLabel>
            <FormControl>
              <Input
                type="password"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function BankingDetailsStep({ form }: StepProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="bankName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Bank Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Stanbic Bank Uganda" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="bankAccountNumber"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Account Number</FormLabel>
            <FormControl>
              <Input placeholder="e.g. 9030012345678" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="bankBranch"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Branch</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Kampala Main Branch" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function PaymentPreferenceStep({ form }: StepProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="preferredPaymentMethod"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Preferred Payment Method</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function ReviewConsentStep({ form, values }: StepProps & { values: RegistrationFormValues }): React.ReactElement {
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === values.preferredPaymentMethod)?.label ?? '—';

  return (
    <div className="space-y-6">
      {/* Review summary */}
      <div className="space-y-3 text-sm">
        <h4 className="font-semibold text-base">Review Your Information</h4>
        <ReviewRow label="Company" value={values.companyName} />
        <ReviewRow label="Reg. Number" value={values.registrationNumber} />
        <ReviewRow label="Industry" value={values.industry} />
        <ReviewRow label="Address" value={values.companyAddress} />
        <ReviewRow label="Contact" value={values.contactPersonName} />
        <ReviewRow label="Email" value={values.contactEmail} />
        <ReviewRow label="Phone" value={values.contactPhone} />
        <ReviewRow label="Bank" value={values.bankName} />
        <ReviewRow label="Account" value={values.bankAccountNumber} />
        <ReviewRow label="Branch" value={values.bankBranch} />
        <ReviewRow label="Payment" value={methodLabel} />
      </div>

      {/* Consent checkboxes */}
      <div className="space-y-4 pt-4 border-t">
        <h4 className="font-semibold text-base">Consent & Authorization</h4>
        <ConsentField form={form} name="consentUrsbVerification" label="I authorize RIS to verify our company registration with URSB" />
        <ConsentField form={form} name="consentLitigationScreening" label="I authorize RIS to conduct litigation screening" />
        <ConsentField form={form} name="consentContactReferences" label="I authorize RIS to contact our trade references" />

        {/* G3 — optional disclosure of known ongoing litigation */}
        <FormField
          control={form.control}
          name="litigationDisclosure"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Disclose any known ongoing litigation (optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="e.g. Case XYZ filed 2024-02-10 at HCCS Commercial Division — describe case, parties, and current status."
                  rows={3}
                  maxLength={2000}
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                If your business has no ongoing litigation, leave this blank. Disclosures are reviewed by compliance before KYC approval.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Trust signals */}
      <div className="flex items-center gap-4 mt-6 pt-4 border-t text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldCheck className="size-3.5 text-primary" />
          Bank of Uganda Regulated
        </span>
        <span className="flex items-center gap-1">
          <Lock className="size-3.5 text-primary" />
          AES-256 Encrypted
        </span>
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

interface StepProps {
  form: ReturnType<typeof useForm<RegistrationFormValues>>;
}

function ReviewRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}

function ConsentField({
  form,
  name,
  label,
}: {
  form: StepProps['form'];
  name: 'consentUrsbVerification' | 'consentLitigationScreening' | 'consentContactReferences';
  label: string;
}): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start gap-3 space-y-0">
          <FormControl>
            <Checkbox checked={field.value as boolean} onCheckedChange={field.onChange} />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel className="text-sm font-normal">{label}</FormLabel>
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

/** Extract a backend error `code` (e.g. `EMAIL_TAKEN`) from an axios error, if present. */
function getApiErrorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const code = err.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Fields owned by each step — used to run per-step Zod validation on Next. */
const STEP_FIELDS: Array<Array<keyof RegistrationFormValues>> = [
  ['companyName', 'registrationNumber', 'industry', 'companyAddress'],
  ['contactPersonName', 'contactEmail', 'contactPhone', 'password', 'confirmPassword'],
  ['bankName', 'bankAccountNumber', 'bankBranch'],
  ['preferredPaymentMethod'],
  ['consentUrsbVerification', 'consentLitigationScreening', 'consentContactReferences'],
];

/** Camel-case form field names — used by applyFieldErrorsToForm to decide
 *  whether a backend field maps to an existing input or should be folded
 *  into the root error.
 */
const KNOWN_FORM_FIELDS = STEP_FIELDS.flat() as ReadonlyArray<string>;

/**
 * Backend → frontend field-name aliases for cases where a naïve snake→camel
 * map would miss. Keep this minimal — every entry is a real production
 * mismatch we need to translate.
 */
const BACKEND_FIELD_ALIASES: Record<string, string> = {
  email: 'contactEmail',
  consent_ursb_check: 'consentUrsbVerification',
  consent_supplier_refs: 'consentContactReferences',
  consent_litigation_check: 'consentLitigationScreening',
};

function snakeToCamelLocal(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ── Main Component ──────────────────────────────────────────────────────────

export function RegistrationPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(0);

  // sessionStorage is the persistent fallback for the eligibility token —
  // location.state is wiped on page reload, which used to strand the user.
  const sessionToken =
    (location.state as { sessionToken?: string } | null)?.sessionToken ??
    (typeof window !== 'undefined'
      ? sessionStorage.getItem('ris-eligibility-session-token') ?? undefined
      : undefined);

  // Redirect to eligibility if no session token
  useEffect(() => {
    if (!sessionToken) {
      navigate('/eligibility', { replace: true });
    }
  }, [sessionToken, navigate]);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      companyName: '',
      registrationNumber: '',
      industry: '',
      companyAddress: '',
      contactPersonName: '',
      contactEmail: '',
      contactPhone: '+256',
      password: '',
      confirmPassword: '',
      bankName: '',
      bankAccountNumber: '',
      bankBranch: '',
      preferredPaymentMethod: undefined,
      consentUrsbVerification: false as unknown as true,
      consentLitigationScreening: false as unknown as true,
      consentContactReferences: false as unknown as true,
      litigationDisclosure: '',
    },
  });

  const values = form.watch();
  const progress = ((step + 1) / STEPS.length) * 100;

  // Draft recovery
  const savedValues = useFormPersist('registration', values, form.formState.isDirty);
  if (savedValues && !form.formState.isDirty) {
    form.reset(savedValues);
  }

  const mutation = useMutation({
    mutationFn: registerSupplier,
    onSuccess: () => {
      toast.success('Registration successful! Sign in with your email and password to begin KYC.');
      sessionStorage.removeItem('ris-form-registration');
      sessionStorage.removeItem('ris-eligibility-session-token');
      navigate('/login', { replace: true });
    },
    onError: (err: unknown) => {
      // EMAIL_TAKEN means the account already exists — route to login.
      if (getApiErrorCode(err) === 'EMAIL_TAKEN') {
        toast.success('An account already exists for this email. Please sign in.');
        sessionStorage.removeItem('ris-form-registration');
        sessionStorage.removeItem('ris-eligibility-session-token');
        navigate('/login', { replace: true });
        return;
      }

      // Backend validation errors carry field-level detail; surface them
      // inline under each field so the user sees exactly what's wrong.
      const fieldErrors = getApiFieldErrors(err);
      const applied = applyFieldErrorsToForm(
        (name, message) => {
          form.setError(name as keyof RegistrationFormValues, {
            type: 'server',
            message,
          });
        },
        fieldErrors,
        KNOWN_FORM_FIELDS,
        BACKEND_FIELD_ALIASES,
      );
      if (applied) {
        // Jump to the earliest step that has an error so it's visible.
        const firstField = fieldErrors[0]?.field
          ? (BACKEND_FIELD_ALIASES[fieldErrors[0].field] ?? snakeToCamelLocal(fieldErrors[0].field))
          : undefined;
        if (firstField) {
          const badStep = STEP_FIELDS.findIndex((fs) => fs.includes(firstField as keyof RegistrationFormValues));
          if (badStep >= 0 && badStep !== step) setStep(badStep);
        }
        toast.error('Please fix the highlighted errors and try again.');
        return;
      }

      const msg = parseApiError(err);
      form.setError('root', { message: msg });
      toast.error(msg);
    },
  });

  function onSubmit(data: RegistrationFormValues): void {
    if (!sessionToken) return;
    if (mutation.isPending) return; // guard against double-click while in flight

    mutation.mutate({
      sessionToken,
      companyName: data.companyName,
      registrationNumber: data.registrationNumber,
      industry: data.industry,
      companyAddress: data.companyAddress,
      contactPersonName: data.contactPersonName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      password: data.password,
      bankName: data.bankName,
      bankAccountNumber: data.bankAccountNumber,
      bankBranch: data.bankBranch,
      preferredPaymentMethod: data.preferredPaymentMethod,
      consentUrsbVerification: Boolean(data.consentUrsbVerification),
      consentLitigationScreening: Boolean(data.consentLitigationScreening),
      consentContactReferences: Boolean(data.consentContactReferences),
      litigationDisclosure: data.litigationDisclosure?.trim() || undefined,
    });
  }

  // Prevent rendering the form while redirecting
  if (!sessionToken) return <></>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Branding */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
            R
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight">RIS Platform</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-medium">
              &#10003;
            </span>
            <span>Eligibility</span>
          </div>
          <div className="h-px w-8 bg-primary" />
          <div className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              2
            </span>
            <span className="font-medium text-foreground">Registration</span>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
          <Progress value={progress} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{STEPS[step]}</CardTitle>
            <CardDescription>
              {step < STEPS.length - 1
                ? 'Complete the fields below, then click Next to continue.'
                : 'Review your information and provide consent to submit.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit, (errs) => {
                  const firstErrField = Object.keys(errs)[0] as keyof RegistrationFormValues | undefined;
                  if (firstErrField) {
                    const badStep = STEP_FIELDS.findIndex((fs) => fs.includes(firstErrField));
                    if (badStep >= 0 && badStep !== step) setStep(badStep);
                  }
                  toast.error('Please fix the highlighted errors.');
                })}
                className="space-y-6"
              >
                {step === 0 && <CompanyDetailsStep form={form} />}
                {step === 1 && <ContactPersonStep form={form} />}
                {step === 2 && <BankingDetailsStep form={form} />}
                {step === 3 && <PaymentPreferenceStep form={form} />}
                {step === 4 && <ReviewConsentStep form={form} values={values} />}

                {/* Root error */}
                {form.formState.errors.root && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.root.message}
                  </p>
                )}

                {/* Navigation */}
                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={step === 0}
                    onClick={() => setStep(step - 1)}
                  >
                    <ArrowLeft className="mr-2 size-4" /> Back
                  </Button>
                  {step < STEPS.length - 1 ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        const ok = await form.trigger(STEP_FIELDS[step]);
                        if (ok) setStep(step + 1);
                        else toast.error('Please fix the errors on this step before continuing.');
                      }}
                    >
                      Next <ArrowRight className="ml-2 size-4" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={mutation.isPending}
                    >
                      {mutation.isPending ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 size-4" />
                      )}
                      Submit Registration
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/eligibility"
            className="inline-flex items-center gap-1 underline hover:text-primary font-medium"
          >
            <ArrowLeft className="size-3" />
            Back to Eligibility Check
          </Link>
        </p>
      </div>
    </div>
  );
}

export default RegistrationPage;
