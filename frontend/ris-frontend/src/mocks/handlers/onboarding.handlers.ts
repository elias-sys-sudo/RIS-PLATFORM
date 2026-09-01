import { http, HttpResponse, delay } from 'msw';

/* ------------------------------------------------------------------ */
/*  Onboarding mock handlers — Stage 1 (Eligibility) & Stage 2        */
/*  (Registration) per workflow document.                              */
/*                                                                     */
/*  GATE: All eligibility questions must pass before registration      */
/*  opens. Pass → session token issued. Fail → reasons returned.       */
/* ------------------------------------------------------------------ */

/** Eligibility rules (aligned with workflow document Stage 1) */
const MIN_YEARS_IN_BUSINESS = 2;
const MIN_ANNUAL_REVENUE_UGX = 50_000_000; // 50M UGX

export const onboardingHandlers = [

  /** POST /api/eligibility/check — pre-qualification gate (D1 + G8) */
  http.post('/api/eligibility/check', async ({ request }) => {
    await delay(500);
    const body = await request.json() as {
      is_registered_company: boolean;
      is_authorized_signatory: boolean;
      /** D1 — accepts bucket string from dropdown or legacy raw number. */
      years_in_business: string | number;
      /** G8 — new split revenue fields (optional for back-compat). */
      revenue_year1?: number;
      revenue_year2?: number;
      /** legacy single field, still accepted for back-compat. */
      annual_revenue?: number;
    };

    // D1: resolve bucket → numeric floor for eligibility comparison.
    const years =
      typeof body.years_in_business === 'number'
        ? body.years_in_business
        : body.years_in_business === '0-1' ? 0
        : body.years_in_business === '2-5' ? 2
        : body.years_in_business === '6-10' ? 6
        : body.years_in_business === '10+' ? 10
        : 0;
    // G8: revenue over the past 2 years — sum the two new fields if present,
    // otherwise fall back to the legacy single value.
    const revenue =
      (body.revenue_year1 ?? 0) + (body.revenue_year2 ?? 0)
      || body.annual_revenue
      || 0;

    const reasons: string[] = [];

    if (!body.is_registered_company) {
      reasons.push('Business must be a registered company in Uganda with a valid certificate of incorporation.');
    }
    if (!body.is_authorized_signatory) {
      reasons.push('Applicant must be an authorized signatory or director of the company.');
    }
    if (years < MIN_YEARS_IN_BUSINESS) {
      reasons.push(`Business must have been operating for at least ${MIN_YEARS_IN_BUSINESS} years.`);
    }
    if (revenue < MIN_ANNUAL_REVENUE_UGX) {
      reasons.push('Combined revenue over the past 2 years must be at least UGX 50,000,000.');
    }

    if (reasons.length > 0) {
      // FAIL — log attempt, return reasons
      return HttpResponse.json({
        eligible: false,
        session_token: null,
        reasons,
      });
    }

    // PASS — issue session token for registration
    const sessionToken = `elig_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return HttpResponse.json({
      eligible: true,
      session_token: sessionToken,
      reasons: [],
    });
  }),

  /** POST /api/suppliers/register — supplier registration (requires session token) */
  http.post('/api/suppliers/register', async ({ request }) => {
    await delay(800);
    const body = await request.json() as {
      session_token?: string;
      company_name?: string;
      registration_number?: string;
      contact_email?: string;
    };

    // Validate session token
    if (!body.session_token || !body.session_token.startsWith('elig_')) {
      return HttpResponse.json(
        { message: 'Invalid or expired eligibility session. Please complete the eligibility check first.' },
        { status: 403 },
      );
    }

    // Validate required fields
    if (!body.company_name?.trim()) {
      return HttpResponse.json({ message: 'Company name is required.' }, { status: 400 });
    }
    if (!body.registration_number?.trim()) {
      return HttpResponse.json({ message: 'URSB registration number is required.' }, { status: 400 });
    }

    // Duplicate email check
    if (body.contact_email === 'supplier@ris.ug') {
      return HttpResponse.json(
        { message: 'An account with this email already exists.' },
        { status: 409 },
      );
    }

    // Success — supplier created
    const supplierId = `sup_${Date.now().toString(36)}`;
    return HttpResponse.json(
      {
        supplier_id: supplierId,
        message: 'Registration successful. You will receive an email with your login credentials. Your account is pending KYC document submission.',
      },
      { status: 201 },
    );
  }),
];
