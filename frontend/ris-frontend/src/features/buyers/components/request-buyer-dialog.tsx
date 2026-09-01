import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useCreateBuyerRequest } from '../hooks/use-buyer-requests';

// ── Zod schema (mirrors backend Joi for POST /buyer-requests) ───────────────

const buyerRequestSchema = z.object({
  company_name: z
    .string()
    .min(1, 'Company name is required')
    .max(200, 'Company name must be 200 characters or fewer'),
  registration_number: z
    .string()
    .max(50, 'Registration number must be 50 characters or fewer')
    .optional()
    .or(z.literal('')),
  contact_name: z
    .string()
    .max(100, 'Contact name must be 100 characters or fewer')
    .optional()
    .or(z.literal('')),
  contact_email: z
    .string()
    .email('Please enter a valid email address')
    .optional()
    .or(z.literal('')),
  contact_phone: z
    .string()
    .max(20, 'Phone number must be 20 characters or fewer')
    .optional()
    .or(z.literal('')),
  reason: z
    .string()
    .min(10, 'Please provide at least 10 characters explaining why')
    .max(1000, 'Reason must be 1000 characters or fewer'),
});

type BuyerRequestFormValues = z.infer<typeof buyerRequestSchema>;

// ── Props ───────────────────────────────────────────────────────────────────

interface RequestBuyerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function RequestBuyerDialog({
  open,
  onOpenChange,
}: RequestBuyerDialogProps): React.ReactElement {
  const mutation = useCreateBuyerRequest();

  const form = useForm<BuyerRequestFormValues>({
    resolver: zodResolver(buyerRequestSchema),
    defaultValues: {
      company_name: '',
      registration_number: '',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      reason: '',
    },
  });

  async function onSubmit(values: BuyerRequestFormValues): Promise<void> {
    await mutation.mutateAsync(values);
    form.reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request New Buyer</DialogTitle>
          <DialogDescription>
            Submit a request for RIS to onboard a new buyer. Your credit officer
            will review and process it.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <CompanyNameField form={form} />
            <RegistrationNumberField form={form} />
            <ContactNameField form={form} />
            <ContactEmailField form={form} />
            <ContactPhoneField form={form} />
            <ReasonField form={form} />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Submit Request
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Field components (keeps main component under 25 lines of JSX) ──────────

type FormProp = { form: ReturnType<typeof useForm<BuyerRequestFormValues>> };

function CompanyNameField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="company_name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Company Name *</FormLabel>
          <FormControl>
            <Input placeholder="e.g. Kampala Trading Ltd" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function RegistrationNumberField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="registration_number"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Registration Number</FormLabel>
          <FormControl>
            <Input placeholder="URSB number if known" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ContactNameField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="contact_name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Contact Person Name</FormLabel>
          <FormControl>
            <Input placeholder="Buyer's contact person" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ContactEmailField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="contact_email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Contact Email</FormLabel>
          <FormControl>
            <Input
              type="email"
              placeholder="buyer@example.com"
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ContactPhoneField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="contact_phone"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Contact Phone</FormLabel>
          <FormControl>
            <Input type="tel" placeholder="+256..." {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ReasonField({ form }: FormProp): React.ReactElement {
  return (
    <FormField
      control={form.control}
      name="reason"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Reason *</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Why do you need this buyer onboarded? e.g. We supply them monthly..."
              rows={3}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
