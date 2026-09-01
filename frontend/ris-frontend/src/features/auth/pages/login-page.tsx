import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Loader2, Shield, ArrowRight, Sparkles, Building2, Landmark, Briefcase } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

import { loginSchema, type LoginFormValues } from '../schemas/auth.schemas';
import { useAuthStore } from '@/store/auth.store';
import { parseApiError } from '@/lib/parse-api-error';
import { scrollToFirstError } from '@/lib/scroll-to-error';

// Demo accounts for rapid testing & evaluation
const DEMO_ACCOUNTS = [
  { label: 'Supplier', email: 'supplier1@test.ris.co.ug', role: 'Supplier', icon: Building2 },
  { label: 'Credit Officer', email: 'credit1@test.ris.co.ug', role: 'Credit', icon: Briefcase },
  { label: 'Finance Manager', email: 'finance1@test.ris.co.ug', role: 'Finance', icon: Landmark },
  { label: 'Management', email: 'md1@test.ris.co.ug', role: 'Executive', icon: Shield },
];

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/';

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  function quickFill(email: string): void {
    form.setValue('email', email);
    form.setValue('password', 'TestPassword123!');
  }

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setIsSubmitting(true);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = parseApiError(err);
      form.setError('root', { message: msg });
      if (!(isAxiosError(err) && err.response?.status === 403 && msg.toLowerCase().includes('lock'))) {
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-primary/15 via-emerald-500/10 to-amber-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-lg shadow-primary/25 ring-4 ring-primary/10">
            <Shield className="size-7 text-amber-300" />
          </div>
          <h1 className="text-2xl font-extrabold font-display tracking-tight sm:text-3xl">
            Rapha Integrated Solutions
          </h1>
          <p className="text-sm text-muted-foreground font-medium">
            Uganda's Premier Invoice Discounting & Early Payment Platform
          </p>
        </div>

        {/* Login Card */}
        <Card className="glass-card shadow-xl border border-border/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-bold font-display">Sign In</CardTitle>
            <CardDescription>Enter your verified credentials to access your portal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit, scrollToFirstError)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="name@company.com"
                          autoComplete="email"
                          autoFocus
                          className="h-10 rounded-lg bg-background/50 focus-visible:ring-primary"
                          {...field}
                        />
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
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</FormLabel>
                        <Link
                          to="/forgot-password"
                          className="text-xs text-primary hover:text-primary/80 font-medium hover:underline transition-colors"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••••••"
                          autoComplete="current-password"
                          className="h-10 rounded-lg bg-background/50 focus-visible:ring-primary"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.formState.errors.root && (
                  <div className={
                    form.formState.errors.root.message?.toLowerCase().includes('lock')
                      ? 'rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-600 dark:text-red-400'
                      : 'rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive'
                  }>
                    {form.formState.errors.root.message}
                  </div>
                )}

                {form.formState.errors.root?.message?.toLowerCase().includes('verify your email') && (
                  <p className="text-xs text-muted-foreground">
                    Didn't receive verification email?{' '}
                    <Link to="/resend-verification" className="text-primary underline hover:text-primary/80 font-semibold">
                      Resend link
                    </Link>
                  </p>
                )}

                <Button type="submit" className="w-full h-10 font-semibold text-sm shadow-md" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      Sign In to Account
                      <ArrowRight className="ml-1.5 size-4" />
                    </>
                  )}
                </Button>
              </form>
            </Form>

            {/* Quick Demo Switcher */}
            <div className="pt-3 border-t border-border/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Sparkles className="size-3 text-amber-500" /> Demo Quick-Fill
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">Password: TestPassword123!</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <Button
                    key={acc.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => quickFill(acc.email)}
                    className="justify-start text-xs h-7 text-left font-normal border-border/70 hover:border-primary/50"
                  >
                    <acc.icon className="size-3 mr-1 text-primary shrink-0" />
                    <span className="truncate">{acc.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer Actions */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            New supplier looking for early invoice payment?{' '}
            <Link to="/eligibility" className="text-primary font-bold hover:underline">
              Check Eligibility (2 mins)
            </Link>
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            Protected by 256-bit AES-GCM encryption & Bank-Grade Security
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
