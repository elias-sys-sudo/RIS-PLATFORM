import { apiClient } from '@/lib/axios';

// ── Eligibility ──────────────────────────────────────────────────────────────

/** D1 — years-in-business bucket (dropdown value). */
export type YearsInBusinessBucket = '0-1' | '2-5' | '6-10' | '10+';

export interface EligibilityCheckPayload {
  /** Maps to backend `registered_company` after axios snake_case interceptor. */
  registeredCompany: boolean;
  /** Maps to backend `authorized_person` after axios snake_case interceptor. */
  authorizedPerson: boolean;
  /** D1 — dropdown bucket, not a raw number. */
  yearsInBusiness: YearsInBusinessBucket;
  /** G8 — revenue split: most recent full financial year (UGX). */
  revenueYear1: number;
  /** G8 — revenue split: prior full financial year (UGX). */
  revenueYear2: number;
}

/**
 * Wire shape returned by POST /onboarding/eligibility/check.
 * After axios snake_case interceptor:
 *   - backend `passed`        → `passed`        (no underscore to convert)
 *   - backend `session_token` → `sessionToken`
 *   - backend `message`       → `message`
 * sessionToken is only present when passed === true.
 */
export interface EligibilityResult {
  passed: boolean;
  message: string;
  sessionToken?: string;
}

export async function checkEligibility(
  payload: EligibilityCheckPayload,
): Promise<EligibilityResult> {
  const { data } = await apiClient.post<EligibilityResult>(
    '/onboarding/eligibility/check',
    payload,
  );
  return data;
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Supplier-side payout channel. Only EFT (bank ACH) is supported — mobile
 * money providers (MTN MoMo, Airtel) have been retired.
 */
export type PaymentMethod = 'bank_transfer';

export interface RegistrationPayload {
  sessionToken: string;
  companyName: string;
  registrationNumber: string;
  industry: string;
  companyAddress: string;
  contactPersonName: string;
  contactEmail: string;
  contactPhone: string;
  password: string;
  bankName: string;
  bankAccountNumber: string;
  bankBranch: string;
  preferredPaymentMethod: PaymentMethod;
  consentUrsbVerification: boolean;
  consentLitigationScreening: boolean;
  consentContactReferences: boolean;
  /** G3: optional free-text declaration of any known ongoing litigation. */
  litigationDisclosure?: string;
}

export interface RegistrationResult {
  supplierId: string;
  message: string;
}

/**
 * Map the frontend `bank_transfer` enum to the backend `EFT` enum.
 * Mobile-money methods were removed; bank transfer maps to EFT.
 */
function toBackendPaymentMethod(_m: PaymentMethod): 'EFT' {
  return 'EFT';
}

/**
 * Wire-shaped body POSTed to /onboarding/suppliers/register.
 * Field names are camelCase → axios snake_case interceptor will convert them
 * before the network call. Fields the backend Joi schema requires but the
 * current registration form does not collect (tax_id, directors[],
 * bank_account_name) are seeded with PENDING_KYC placeholders; the KYC
 * document upload step replaces them with verified values.
 */
interface RegistrationWireBody {
  email: string;
  password: string;
  companyName: string;
  registrationNumber: string;
  taxId: string;
  directors: Array<{ name: string; idType: string; idNumber: string }>;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankBranch: string;
  preferredPaymentMethod: 'EFT';
  eligibilitySessionToken: string;
  consentUrsbCheck: true;
  consentSupplierRefs: true;
  consentLitigationCheck: true;
  litigationDisclosure?: string;
}

export async function registerSupplier(
  payload: RegistrationPayload,
): Promise<RegistrationResult> {
  const body: RegistrationWireBody = {
    email: payload.contactEmail,
    password: payload.password,
    companyName: payload.companyName,
    registrationNumber: payload.registrationNumber,
    // Backend requires tax_id; the supplier supplies it on the KYC documents
    // step (TAX_REGISTRATION upload) which writes the verified value.
    taxId: 'PENDING_KYC',
    // Backend requires directors[].min(1); seed one entry from the contact
    // person. The DIRECTOR_ID document upload provides the verified id_number
    // and id_type during KYC review.
    directors: [
      {
        name: payload.contactPersonName,
        idType: 'PENDING_KYC',
        idNumber: 'PENDING_KYC',
      },
    ],
    bankName: payload.bankName,
    bankAccountNumber: payload.bankAccountNumber,
    // Default the account holder name to the company name; supplier can edit
    // during KYC if it differs.
    bankAccountName: payload.companyName,
    bankBranch: payload.bankBranch,
    preferredPaymentMethod: toBackendPaymentMethod(payload.preferredPaymentMethod),
    eligibilitySessionToken: payload.sessionToken,
    consentUrsbCheck: true,
    consentSupplierRefs: true,
    consentLitigationCheck: true,
    litigationDisclosure: payload.litigationDisclosure,
  };

  const { data } = await apiClient.post<RegistrationResult>(
    '/onboarding/suppliers/register',
    body,
  );
  return data;
}
