import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/lib/axios';
import { parseApiError } from '@/lib/parse-api-error';
import { ROLE_LABELS, type Role } from '@/lib/constants';

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(10, 'Valid phone required'),
});

export function ProfilePage(): React.ReactElement {
  const { user, role } = useAuthStore();
  const [saving, setSaving] = useState(false);

  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name ?? '', email: user?.email ?? '', phone: '' },
  });

  async function onSubmit(vals: z.infer<typeof profileSchema>): Promise<void> {
    setSaving(true);
    try {
      await apiClient.put('/settings/profile', vals);
      useAuthStore.setState({ user: user ? { ...user, ...vals } : null });
      toast.success('Profile updated');
    } catch (err) { toast.error(parseApiError(err)); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold font-display">Profile</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Your Information</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="text-sm"><span className="text-muted-foreground">Role:</span> <span className="font-medium">{role ? ROLE_LABELS[role as Role] : '—'}</span></div>
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone</FormLabel><FormControl><Input type="tel" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Save Changes</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
export default ProfilePage;
