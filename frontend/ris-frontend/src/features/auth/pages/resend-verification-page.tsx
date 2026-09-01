import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Loader2, CheckCircle2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';

import {
  resendVerificationSchema,
  type ResendVerificationFormValues,
} from '../schemas/auth.schemas';
import { resendVerificationEmail } from '../api/auth.api';

export function ResendVerificationPage(): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const form = useForm<ResendVerificationFormValues>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ResendVerificationFormValues): Promise<void> {
    setIsSubmitting(true);
    try {
      await resendVerificationEmail(values.email);
    } catch { /* Backend always returns 200 — silent for security */ }
    setSent(true);
    setIsSubmitting(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Resend verification email</CardTitle>
          <CardDescription>
            {sent
              ? 'Check your email for a new verification link.'
              : 'Enter your email to receive a new verification link.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="size-12 text-green-600" />
              <p className="text-sm text-muted-foreground text-center">
                If a matching unverified account exists, a new verification link has been sent.
              </p>
              <Link to="/login" className="w-full">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="mr-2 size-4" /> Back to login
                </Button>
              </Link>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 size-4" />
                  )}
                  Send verification link
                </Button>
                <p className="text-center text-sm">
                  <Link to="/login" className="text-muted-foreground underline hover:text-primary">
                    <ArrowLeft className="mr-1 inline size-3" />Back to login
                  </Link>
                </p>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ResendVerificationPage;
