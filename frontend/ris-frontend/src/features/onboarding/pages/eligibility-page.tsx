import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Loader2, ArrowLeft, ArrowRight, ShieldCheck, Sparkles, Building } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

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

function toBooleanFlag(value: 'yes' | 'no'): boolean {
  return value === 'yes';
}

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
      sessionStorage.setItem('ris-eligibility-session-token', result.sessionToken);
      navigate('/register', {
        state: { sessionToken: result.sessionToken },
      });
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-primary/15 via-emerald-500/10 to-amber-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-lg space-y-6 relative z-10">
        {/* Header & Step progress */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-md">
            <Sparkles className="size-6 text-amber-300" />
          </div>
          <h1 className="text-2xl font-extrabold font-display tracking-tight sm:text-3xl">
            Supplier Pre-Qualification
          </h1>
          <p className="text-sm text-muted-foreground font-medium">
            Find out in 2 minutes if your invoices qualify for immediate cash advance
          </p>

          {/* Stepper */}
          <div className="flex items-center justify-center gap-3 pt-2">
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px]">1</span>
              <span>Eligibility Assessment</span>
            </div>
            <div className="h-px w-6 bg-border" />
            <div className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px]">2</span>
              <span>Account Setup</span>
            </div>
          </div>
        </div>

        <Card className="glass-card shadow-xl border border-border/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold font-display">Business Criteria</CardTitle>
            <CardDescription>
              Answer the standard trade finance qualification questions below
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                {/* Q1: Registered company */}
                <FormField
                  control={form.control}
                  name="registeredCompany"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Is your business registered in Uganda? (URSB / Tax PIN)
                      </FormLabel>
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          type="button"
                          id="reg-yes"
                          variant={field.value === 'yes' ? 'default' : 'outline'}
                          className={field.value === 'yes' ? 'shadow-sm font-semibold' : 'border-border/80'}
                          onClick={() => field.onChange('yes')}
                        >
                          <Building className="size-4 mr-2" />
                          Yes, Registered
                        </Button>
                        <Button
                          type="button"
                          id="reg-no"
                          variant={field.value === 'no' ? 'destructive' : 'outline'}
                          className={field.value === 'no' ? 'shadow-sm font-semibold' : 'border-border/80'}
                          onClick={() => field.onChange('no')}
                        >
                          No / In-Progress
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
                    <FormItem className="space-y-2">
                      <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Are you an authorized company director or signatory?
                      </FormLabel>
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          type="button"
                          id="sig-yes"
                          variant={field.value === 'yes' ? 'default' : 'outline'}
                          className={field.value === 'yes' ? 'shadow-sm font-semibold' : 'border-border/80'}
                          onClick={() => field.onChange('yes')}
                        >
                          <ShieldCheck className="size-4 mr-2" />
                          Yes, Authorized
                        </Button>
                        <Button
                          type="button"
                          id="sig-no"
                          variant={field.value === 'no' ? 'destructive' : 'outline'}
                          className={field.value === 'no' ? 'shadow-sm font-semibold' : 'border-border/80'}
                          onClick={() => field.onChange('no')}
                        >
                          No
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Q3: Years in business */}
                <FormField
                  control={form.control}
                  name="yearsInBusiness"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Operating Track Record
                      </FormLabel>
                      <FormControl>
                        <select
                          className="flex h-10 w-full rounded-lg border border-border/80 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-medium"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? undefined : e.target.value)
                          }
                        >
                          <option value="">Select track record length...</option>
                          <option value="0-1">Less than 2 years</option>
                          <option value="2-5">2 to 5 years (Established)</option>
                          <option value="6-10">6 to 10 years (Mature)</option>
                          <option value="10+">More than 10 years (Enterprise)</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Q4: Revenue */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="revenueYear1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Latest Year Turnover (UGX)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder="500000000"
                            className="h-10 rounded-lg bg-background/50 font-mono"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === '' ? undefined : Number(val));
                            }}
                          />
                        </FormControl>
                        {field.value != null && field.value > 0 && (
                          <div className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                            {formatUGX(field.value)}
                          </div>
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
                        <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Prior Year Turnover (UGX)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder="450000000"
                            className="h-10 rounded-lg bg-background/50 font-mono"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === '' ? undefined : Number(val));
                            }}
                          />
                        </FormControl>
                        {field.value != null && field.value > 0 && (
                          <div className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                            {formatUGX(field.value)}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full h-10 font-semibold shadow-md"
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Evaluating Criteria...
                    </>
                  ) : (
                    <>
                      Run Instant Pre-Qualification
                      <ArrowRight className="ml-2 size-4" />
                    </>
                  )}
                </Button>
              </form>
            </Form>

            {/* Assessment Result */}
            {result && (
              <div className="mt-6 space-y-4 rounded-xl border p-4 transition-all">
                {result.passed ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold">Congratulations! Your Business Qualifies</p>
                        <p className="text-xs opacity-90">{result.message}</p>
                      </div>
                    </div>
                    <Button
                      onClick={handleContinue}
                      variant="gradient"
                      className="w-full h-10 font-bold shadow-md"
                      disabled={!result.sessionToken}
                    >
                      Continue to Registration Wizard
                      <ArrowRight className="ml-2 size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold">Criteria Not Met at This Time</p>
                        <p className="text-xs opacity-90">{result.message}</p>
                      </div>
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      Need help or have special contracts?{' '}
                      <a href="mailto:support@ris.co.ug" className="text-primary font-bold hover:underline">
                        Contact our Trade Finance Advisory Desk
                      </a>
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline">
            <ArrowLeft className="size-3.5" />
            Already registered? Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default EligibilityPage;

