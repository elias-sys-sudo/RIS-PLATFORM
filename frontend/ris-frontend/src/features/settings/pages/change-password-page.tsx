import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PasswordInput } from '@/components/forms/password-input';
import { changePasswordSchema, type ChangePasswordFormValues } from '@/features/auth/schemas/auth.schemas';
import { useAuthStore } from '@/store/auth.store';
import { parseApiError } from '@/lib/parse-api-error';

export function ChangePasswordPage(): React.ReactElement {
  const changePassword = useAuthStore((s) => s.changePassword);
  const [saving, setSaving] = useState(false);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(vals: ChangePasswordFormValues): Promise<void> {
    setSaving(true);
    try {
      await changePassword({ current_password: vals.currentPassword, new_password: vals.newPassword, confirm_password: vals.confirmPassword });
      toast.success('Password changed successfully');
      form.reset();
    } catch (err) { toast.error(parseApiError(err)); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold font-display">Change Password</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Update your password</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="currentPassword" render={({ field }) => (<FormItem><FormLabel>Current Password</FormLabel><FormControl><PasswordInput autoComplete="current-password" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="newPassword" render={({ field }) => (<FormItem><FormLabel>New Password</FormLabel><FormControl><PasswordInput showStrength autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="confirmPassword" render={({ field }) => (<FormItem><FormLabel>Confirm New Password</FormLabel><FormControl><PasswordInput autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Change Password</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
export default ChangePasswordPage;
