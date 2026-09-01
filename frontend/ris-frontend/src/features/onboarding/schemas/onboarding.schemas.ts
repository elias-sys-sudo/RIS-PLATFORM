import { z } from 'zod';

// ── Eligibility check schema ─────────────────────────────────────────────────

export const eligibilitySchema = z.object({
  registeredCompany: z.enum(['yes', 'no'], {
    error: 'Please select whether your business is registered',
  }),
  authorizedPerson: z.enum(['yes', 'no'], {
    error: 'Please select whether you are an authorized signatory',
  }),
  // D1 — dropdown (was free-entry number). Buckets match the checkers.docx spec.
  yearsInBusiness: z.enum(['0-1', '2-5', '6-10', '10+'], {
    error: 'Please select how long your business has been operating',
  }),
  // G8 — revenue over the past 2 years, captured as two separate inputs
  // (was a single annualRevenue field).
  revenueYear1: z
    .number({ error: 'Most recent year revenue is required' })
    .int('Must be a whole number')
    .min(0, 'Cannot be negative'),
  revenueYear2: z
    .number({ error: 'Prior year revenue is required' })
    .int('Must be a whole number')
    .min(0, 'Cannot be negative'),
});

export type EligibilityFormValues = z.infer<typeof eligibilitySchema>;

// ── Registration schema ──────────────────────────────────────────────────────

export const registrationSchema = z
  .object({
    // Company details
    companyName: z.string().min(1, 'Company name is required'),
    registrationNumber: z.string().min(1, 'Registration number is required'),
    industry: z.string().min(1, 'Industry is required'),
    companyAddress: z.string().min(1, 'Company address is required'),

    // Contact person
    contactPersonName: z.string().min(1, 'Contact person name is required'),
    contactEmail: z
      .string()
      .min(1, 'Email is required')
      .email('Please enter a valid email address'),
    contactPhone: z
      .string()
      .min(1, 'Phone number is required')
      .regex(/^\+256\d{9}$/, 'Phone must be in format +256XXXXXXXXX'),

    // Banking details
    bankName: z.string().min(1, 'Bank name is required'),
    bankAccountNumber: z.string().min(1, 'Account number is required'),
    bankBranch: z.string().min(1, 'Branch is required'),

    // Payment preferences — bank transfer (EFT) is the only supported channel.
    preferredPaymentMethod: z.enum(['bank_transfer'], {
      error: 'Please select a payment method',
    }),

    // Account credentials
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
        'Must include uppercase, lowercase, number, and special character',
      ),
    confirmPassword: z.string().min(1, 'Please confirm your password'),

    // Consent
    consentUrsbVerification: z.literal(true, {
      error: 'URSB verification consent is required',
    }),
    consentLitigationScreening: z.literal(true, {
      error: 'Litigation screening consent is required',
    }),
    // G3: optional free-text declaration of any known ongoing litigation
    litigationDisclosure: z.string().max(2000).optional(),
    consentContactReferences: z.literal(true, {
      error: 'Contact references consent is required',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type RegistrationFormValues = z.infer<typeof registrationSchema>;
