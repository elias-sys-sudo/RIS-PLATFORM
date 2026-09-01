import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

import { Link } from 'react-router-dom';
import { formatUGX } from '@/lib/format-ugx';
import { parseApiError } from '@/lib/parse-api-error';
import {
  eligibilitySchema,
  type EligibilityFormValues,
} from '../schemas/onboarding.schemas';
import {
  checkEligibility,
  type EligibilityResult,
} from '../api/onboarding.api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBooleanFlag(value: 'yes' | 'no'): boolean {
  return value === 'yes';
}

// ── Component ────────────────────────────────────────────────────────────────

export function EligibilityPage(): React.ReactElement {
  const navigate = useNavigate();
  const [result, setResult] = useState<EligibilityResult | null>(null);

  const form = useForm<EligibilityFormValues>({
    resolver: zodResolver(eligibilitySchema),
    defaultValues: {
      registeredCompany: undefined,
      authorizedPerson: undefined,
      yearsInBusiness: undefined,
      revenueYear1: undefined,
      revenueYear2: undefined,
    },
  });

  const mutation = useMutation({
    mutationFn: checkEligibility,
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (err: unknown) => {
      const msg = parseApiError(err);
      toast.error(msg);
    },
  });

  function onSubmit(values: EligibilityFormValues): void {
    setResult(null);
    mutation.mutate({
      registeredCompany: toBooleanFlag(values.registeredCompany),
      authorizedPerson: toBooleanFlag(values.authorizedPerson),
      yearsInBusiness: values.yearsInBusiness,
      revenueYear1: values.revenueYear1,
      revenueYear2: values.revenueYear2,
    });
  }

  function handleContinue(): void {
    if (result?.sessionToken) {
      // Persist the token in sessionStorage so a page reload on /register
      // does not strand the user with a populated form but no session token
      // (which used to surface as a vague "Validation failed" on submit).
      // Cleared on successful registration in registration-page.tsx.
      sessionStorage.setItem('ris-eligibility-session-token', result.sessionToken);
      navigate('/register', {
        state: { sessionToken: result.sessionToken },
      });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Branding */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
            R
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight">
            RIS Platform
          </h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</span>
            <span className="font-medium text-foreground">Eligibility</span>
          </div>
          <div className="h-px w-8 bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-medium">2</span>
            <span>Registration</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Check Your Eligibility
            </CardTitle>
            <CardDescription>
              Answer a few questions to see if your business qualifies for
              invoice financing with RIS.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                {/* Q1: Registered company */}
                <FormField
                  control={form.control}
                  name="registeredCompany"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>
                        Is your business a registered company in Uganda?
                      </FormLabel>
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          id="reg-yes"
                          variant={field.value === 'yes' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => field.onChange('yes')}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          id="reg-no"
                          variant={field.value === 'no' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => field.onChange('no')}
                        >
                          No
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Q2: Authorized signatory */}
                <FormField
                  control={form.control}
                  name="authorizedPerson"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>
                        Are you an authorized signatory for the company?
                      </FormLabel>
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          id="sig-yes"
                          variant={field.value === 'yes' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => field.onChange('yes')}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          id="sig-no"
                          variant={field.value === 'no' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => field.onChange('no')}
                        >
                          No
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Q3 — D1: Years in business (dropdown) */}
                <FormField
                  control={form.control}
                  name="yearsInBusiness"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        How long has the business been operating?
                      </FormLabel>
                      <FormControl>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? undefined : e.target.value)
                          }
                        >
                          <option value="">Select a range</option>
                          <option value="0-1">Less than 2 years</option>
                          <option value="2-5">2 to 5 years</option>
                          <option value="6-10">6 to 10 years</option>
                          <option value="10+">More than 10 years</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Q4 — G8: Revenue over the past 2 years (split) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="revenueYear1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Most recent year revenue (UGX)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder="e.g. 500,000,000"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === '' ? undefined : Number(val));
                            }}
                          />
                        </FormControl>
                        {field.value != null && field.value > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {formatUGX(field.value)}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="revenueYear2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prior year revenue (UGX)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder="e.g. 450,000,000"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === '' ? undefined : Number(val));
                            }}
                          />
                        </FormControl>
                        {field.value != null && field.value > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {formatUGX(field.value)}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={mutation.isPending}
                >
                  {mutation.isPending && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Check Eligibility
                </Button>
              </form>
            </Form>

            {/* ── Result ── */}
            {result && (
              <div className="mt-6 space-y-4">
                {result.passed ? (
                  <>
                    <Alert variant="success">
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>Eligible</AlertTitle>
                      <AlertDescription>
                        {result.message}
                      </AlertDescription>
                    </Alert>
                    <Button
                      onClick={handleContinue}
                      className="w-full"
                      disabled={!result.sessionToken}
                    >
                      Continue to Registration
                    </Button>
                  </>
                ) : (
                  <>
                    <Alert variant="warning">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Not Eligible</AlertTitle>
                      <AlertDescription>
                        {result.message}
                      </AlertDescription>
                    </Alert>
                    <p className="text-center text-sm text-muted-foreground">
                      <a
                        href="mailto:support@ris.co.ug"
                        className="underline hover:text-primary"
                      >
                        Contact us for more information
                      </a>
                    </p>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 underline hover:text-primary font-medium"
          >
            <ArrowLeft className="size-3" />
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default EligibilityPage;
