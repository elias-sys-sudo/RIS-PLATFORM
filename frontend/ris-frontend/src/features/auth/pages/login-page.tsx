import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Loader2 } from 'lucide-react';

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

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setIsSubmitting(true);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = parseApiError(err);
      form.setError('root', { message: msg });
      // Suppress toast for lockout — inline message is sufficient
      if (!(isAxiosError(err) && err.response?.status === 403 && msg.toLowerCase().includes('lock'))) {
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
            R
          </div>
          <CardTitle className="text-2xl">RIS Platform</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, scrollToFirstError)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="name@company.com"
                        autoComplete="email"
                        autoFocus
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
                        autoComplete="current-password"
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
                    ? 'rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700'
                    : 'text-sm text-destructive'
                }>
                  {form.formState.errors.root.message}
                </div>
              )}

              {form.formState.errors.root?.message?.toLowerCase().includes('verify your email') && (
                <p className="text-sm">
                  Didn't receive it?{' '}
                  <Link to="/resend-verification" className="underline hover:text-primary font-medium">
                    Resend verification email
                  </Link>
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Sign in
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/forgot-password" className="underline hover:text-primary">
                  Forgot your password?
                </Link>
              </p>
              <p className="text-center text-sm text-muted-foreground">
                New supplier?{' '}
                <Link to="/eligibility" className="underline hover:text-primary font-medium">
                  Check your eligibility
                </Link>
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export default LoginPage;
