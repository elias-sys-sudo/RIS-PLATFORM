import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, ArrowLeft, KeyRound, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';

import { twoFactorSchema, type TwoFactorFormValues } from '../schemas/auth.schemas';
import { verify2fa } from '../api/auth.api';
import { useAuthStore } from '@/store/auth.store';
import { parseApiError } from '@/lib/parse-api-error';

export function TwoFactorPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const partialToken = (location.state as { partialAuthToken?: string })?.partialAuthToken ?? '';

  const form = useForm<TwoFactorFormValues>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { code: '' },
  });

  async function onSubmit(values: TwoFactorFormValues): Promise<void> {
    if (!partialToken) {
      toast.error('Missing authentication token. Please log in again.');
      navigate('/login', { replace: true });
      return;
    }
    setIsSubmitting(true);
    try {
      const data = await verify2fa(values.code, partialToken);
      useAuthStore.getState().setTokens(data.accessToken);
      if (data.user) {
        setUser(data.user);
        useAuthStore.setState({ isAuthenticated: true, role: data.user.role });
      }
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(parseApiError(err));
      form.setError('code', { message: 'Invalid code. Please check your authenticator.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-gradient-to-tr from-primary/15 via-emerald-500/10 to-amber-500/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-sm space-y-6 relative z-10">
        <Card className="glass-card shadow-xl border border-border/80">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-md">
              <ShieldCheck className="size-7 text-amber-300" />
            </div>
            <CardTitle className="text-xl font-bold font-display">Two-Factor Authentication</CardTitle>
            <CardDescription className="text-xs">
              Enter the 6-digit verification code from your authenticator app (Google Authenticator / Authy)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                        <span>One-Time Passcode</span>
                        <KeyRound className="size-3 text-muted-foreground" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="••••••"
                          autoFocus
                          autoComplete="one-time-code"
                          className="text-center text-3xl tracking-[0.4em] font-mono h-14 rounded-xl bg-background/60 font-bold border-border/90 focus-visible:ring-primary"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" variant="gradient" className="w-full h-10 font-bold shadow-md" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Verifying Token...
                    </>
                  ) : (
                    <>
                      Confirm & Sign In
                      <ArrowRight className="ml-1.5 size-4" />
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline">
            <ArrowLeft className="size-3.5" />
            Return to Login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default TwoFactorPage;

