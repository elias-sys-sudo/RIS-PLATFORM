import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AmountInput } from '@/components/forms/amount-input';
import { useCreateBuyer } from '../hooks/use-buyers';
import { parseApiError } from '@/lib/parse-api-error';
import { scrollToFirstError } from '@/lib/scroll-to-error';

const INDUSTRIES = [
  'Manufacturing', 'Agriculture', 'Construction', 'Services',
  'Technology', 'Healthcare', 'Education', 'Other',
];

const schema = z.object({
  name: z.string().min(2, 'Company name is required'),
  industry: z.string().min(1, 'Industry is required'),
  credit_limit: z.number().min(1_000_000, 'Minimum credit limit is UGX 1,000,000'),
  payment_terms_days: z.number().min(7, 'Minimum 7 days').max(120, 'Maximum 120 days'),
  contact_person: z.string().min(2, 'Contact person is required'),
  contact_email: z.string().email('Valid email required'),
  contact_phone: z.string().min(10, 'Phone number is required'),
});
type FormValues = z.infer<typeof schema>;

export function BuyerCreatePage(): React.ReactElement {
  const navigate = useNavigate();
  const mutation = useCreateBuyer();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', industry: '', credit_limit: 0,
      payment_terms_days: 30, contact_person: '',
      contact_email: '', contact_phone: '',
    },
  });

  async function onSubmit(data: FormValues): Promise<void> {
    try {
      await mutation.mutateAsync(data);
      navigate('/buyers');
    } catch (err) {
      toast.error(parseApiError(err));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/buyers')}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-bold font-display">New Buyer</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, scrollToFirstError)} className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Company Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input placeholder="Acme Ltd" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="credit_limit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Credit Limit (UGX)</FormLabel>
                    <FormControl><AmountInput value={field.value} onChange={field.onChange} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payment_terms_days" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Terms (days)</FormLabel>
                    <FormControl>
                      <Input type="number" min={7} max={120} {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="contact_person" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Person</FormLabel>
                  <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="contact_email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="john@acme.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="contact_phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input placeholder="+256 700 000 000" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create Buyer
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default BuyerCreatePage;
