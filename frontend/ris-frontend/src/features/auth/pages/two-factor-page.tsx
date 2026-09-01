import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

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
      form.setError('code', { message: 'Invalid code' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">
            <ShieldCheck className="size-10 text-primary" />
          </div>
          <CardTitle className="text-xl">Two-factor authentication</CardTitle>
          <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        autoFocus
                        autoComplete="one-time-code"
                        className="text-center text-2xl tracking-[0.5em] font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Verify
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export default TwoFactorPage;
