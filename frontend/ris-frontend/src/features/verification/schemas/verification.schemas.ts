import { z } from 'zod';

/**
 * Zod schema for buyer confirmation form.
 * All four checkboxes must be checked (true) before submission.
 * Mirrors backend Joi: all booleans required, must be true.
 */
export const confirmVerificationSchema = z.object({
  invoiceIsValid: z.literal(true, {
    error: 'You must confirm the invoice is valid.',
  }),
  amountIsCorrect: z.literal(true, {
    error: 'You must confirm the amount is correct.',
  }),
  dueDateIsCorrect: z.literal(true, {
    error: 'You must confirm the due date is correct.',
  }),
  agreesToPayRis: z.literal(true, {
    error: 'You must agree to pay RIS as assignee.',
  }),
});

export type ConfirmVerificationFormValues = z.infer<typeof confirmVerificationSchema>;

/**
 * Zod schema for buyer dispute form.
 * Mirrors backend Joi: disputeType enum required, reason string min 20 chars.
 */
export const disputeVerificationSchema = z.object({
  disputeType: z.enum(['incorrect_amount', 'incorrect_date', 'not_recognized', 'other'], {
    error: 'Please select a dispute reason.',
  }),
  reason: z
    .string()
    .min(20, 'Please provide at least 20 characters explaining the dispute.')
    .max(1000, 'Dispute reason must be under 1,000 characters.'),
});

export type DisputeVerificationFormValues = z.infer<typeof disputeVerificationSchema>;
