import { http, HttpResponse, delay, passthrough } from 'msw';
import { v4 as uuidv4 } from 'uuid';
import type {
  PricingBreakdown,
  PricingDispute,
  PricingDisputePayload,
} from '../../features/pricing/api/pricing.api';

// ── Seed data ────────────────────────────────────────────────────────────────
// Covers every invoice whose status is in PRICING_VISIBLE_STATUSES on the
// invoice detail page: priced, approved, rejected, pending_first_auth,
// pending_second_auth, executing, funded, collecting, overdue, collected, defaulted.
//
// discountAmount = advanceAmount × discountRate / 100
// netPaymentToSupplier = advanceAmount − discountAmount
// bankCost + riskPremium + risMargin = discountAmount

export const PRICING_DATA: Map<string, PricingBreakdown> = new Map([
  // Pending — waiting for supplier to accept (Kampala Steel Works, 100M UGX)
  [
    'inv_pricing_001',
    {
      invoiceId:          'inv_pricing_001',
      faceValue:          100_000_000,
      advancePercentage:  95,
      advanceAmount:      95_000_000,
      discountRate:       3.78,
      discountAmount:     3_591_000,
      bankCost:           1_200_000,
      riskPremium:        800_000,
      risMargin:          1_591_000,
      tenor:              60,
      netPaymentToSupplier: 91_409_000,
      status:             'pending',
      acceptedAt:         null,
      rejectedAt:         null,
      disputedAt:         null,
      dispute:            null,
    },
  ],
  // Pending — waiting for supplier to accept (Entebbe Fish Exports, 75M UGX)
  [
    'inv_pricing_002',
    {
      invoiceId:          'inv_pricing_002',
      faceValue:          75_000_000,
      advancePercentage:  92,
      advanceAmount:      69_000_000,
      discountRate:       4.25,
      discountAmount:     2_932_500,
      bankCost:           900_000,
      riskPremium:        650_000,
      risMargin:          1_382_500,
      tenor:              45,
      netPaymentToSupplier: 66_067_500,
      status:             'pending',
      acceptedAt:         null,
      rejectedAt:         null,
      disputedAt:         null,
      dispute:            null,
    },
  ],
  // Accepted — Pearl Foods Uganda, 200M UGX (matches inv_004 approved invoice)
  [
    'inv_004',
    {
      invoiceId:          'inv_004',
      faceValue:          200_000_000,
      advancePercentage:  90,
      advanceAmount:      180_000_000,
      discountRate:       2.50,
      discountAmount:     4_500_000,
      bankCost:           1_800_000,
      riskPremium:        700_000,
      risMargin:          2_000_000,
      tenor:              90,
      netPaymentToSupplier: 175_500_000,
      status:             'accepted',
      acceptedAt:         '2025-03-04T08:30:00Z',
      rejectedAt:         null,
      disputedAt:         null,
      dispute:            null,
    },
  ],
  // Rejected pricing — Kampala Traders Ltd, 45M UGX (inv_001 funded)
  [
    'inv_001',
    {
      invoiceId:            'inv_001',
      faceValue:            45_000_000,
      advancePercentage:    90,
      advanceAmount:        40_500_000,
      discountRate:         3.20,
      discountAmount:       1_296_000,
      bankCost:               520_000,
      riskPremium:            350_000,
      risMargin:              426_000,
      tenor:                45,
      netPaymentToSupplier: 39_204_000,
      status:               'rejected',
      acceptedAt:           null,
      rejectedAt:           '2025-02-11T14:20:00Z',
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Kampala Traders Ltd, 120M UGX (inv_002 collecting)
  // discountAmount = 108_000_000 × 2.8% = 3_024_000
  [
    'inv_002',
    {
      invoiceId:            'inv_002',
      faceValue:            120_000_000,
      advancePercentage:    90,
      advanceAmount:        108_000_000,
      discountRate:         2.80,
      discountAmount:       3_024_000,
      bankCost:             1_210_000,
      riskPremium:            690_000,
      risMargin:            1_124_000,
      tenor:                60,
      netPaymentToSupplier: 104_976_000,
      status:               'accepted',
      acceptedAt:           '2025-01-21T09:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Nile Agro Exports, 78.5M UGX (inv_003 overdue)
  // discountAmount = 70_650_000 × 3.5% = 2_472_750
  [
    'inv_003',
    {
      invoiceId:            'inv_003',
      faceValue:             78_500_000,
      advancePercentage:    90,
      advanceAmount:         70_650_000,
      discountRate:          3.50,
      discountAmount:        2_472_750,
      bankCost:                990_000,
      riskPremium:             750_000,
      risMargin:               732_750,
      tenor:                30,
      netPaymentToSupplier:  68_177_250,
      status:               'accepted',
      acceptedAt:           '2025-01-06T11:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Fort Portal Farms, 165M UGX (inv_009 pending_first_auth)
  // discountAmount = 148_500_000 × 2.7% = 4_009_500
  [
    'inv_009',
    {
      invoiceId:            'inv_009',
      faceValue:            165_000_000,
      advancePercentage:    90,
      advanceAmount:        148_500_000,
      discountRate:          2.70,
      discountAmount:        4_009_500,
      bankCost:              1_600_000,
      riskPremium:             900_000,
      risMargin:             1_509_500,
      tenor:                75,
      netPaymentToSupplier: 144_490_500,
      status:               'accepted',
      acceptedAt:           '2025-03-18T14:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Jinja Industrial Supplies, 43.2M UGX (inv_010 pending_second_auth)
  // discountAmount = 38_880_000 × 3.6% = 1_399_680
  [
    'inv_010',
    {
      invoiceId:            'inv_010',
      faceValue:             43_200_000,
      advancePercentage:    90,
      advanceAmount:         38_880_000,
      discountRate:          3.60,
      discountAmount:        1_399_680,
      bankCost:                560_000,
      riskPremium:             390_000,
      risMargin:               449_680,
      tenor:                30,
      netPaymentToSupplier:  37_480_320,
      status:               'accepted',
      acceptedAt:           '2025-03-20T10:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Gulu Trade Centre, 310M UGX (inv_011 executing)
  // discountAmount = 279_000_000 × 2.3% = 6_417_000
  [
    'inv_011',
    {
      invoiceId:            'inv_011',
      faceValue:            310_000_000,
      advancePercentage:    90,
      advanceAmount:        279_000_000,
      discountRate:          2.30,
      discountAmount:        6_417_000,
      bankCost:              2_500_000,
      riskPremium:           1_500_000,
      risMargin:             2_417_000,
      tenor:                90,
      netPaymentToSupplier: 272_583_000,
      status:               'accepted',
      acceptedAt:           '2025-03-21T09:30:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Mbarara Dairy Co., 61.5M UGX (inv_012 collected)
  // discountAmount = 55_350_000 × 3.3% = 1_826_550
  [
    'inv_012',
    {
      invoiceId:            'inv_012',
      faceValue:             61_500_000,
      advancePercentage:    90,
      advanceAmount:         55_350_000,
      discountRate:          3.30,
      discountAmount:        1_826_550,
      bankCost:                730_000,
      riskPremium:             500_000,
      risMargin:               596_550,
      tenor:                45,
      netPaymentToSupplier:  53_523_450,
      status:               'accepted',
      acceptedAt:           '2024-12-02T08:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Soroti Grains Ltd, 28.8M UGX (inv_013 defaulted)
  // discountAmount = 25_920_000 × 4.2% = 1_088_640
  [
    'inv_013',
    {
      invoiceId:            'inv_013',
      faceValue:             28_800_000,
      advancePercentage:    90,
      advanceAmount:         25_920_000,
      discountRate:          4.20,
      discountAmount:        1_088_640,
      bankCost:                435_000,
      riskPremium:             300_000,
      risMargin:               353_640,
      tenor:                21,
      netPaymentToSupplier:  24_831_360,
      status:               'accepted',
      acceptedAt:           '2024-11-16T10:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],

  // Accepted — Tororo Cement Dealers, 145.5M UGX (inv_015 funded)
  // discountAmount = 130_950_000 × 3.0% = 3_928_500
  [
    'inv_015',
    {
      invoiceId:            'inv_015',
      faceValue:            145_500_000,
      advancePercentage:    90,
      advanceAmount:        130_950_000,
      discountRate:          3.00,
      discountAmount:        3_928_500,
      bankCost:              1_570_000,
      riskPremium:             900_000,
      risMargin:             1_458_500,
      tenor:                75,
      netPaymentToSupplier: 127_021_500,
      status:               'accepted',
      acceptedAt:           '2025-02-28T12:00:00Z',
      rejectedAt:           null,
      disputedAt:           null,
      dispute:              null,
    },
  ],
]);

// ── Handlers ─────────────────────────────────────────────────────────────────

export const pricingHandlers = [

  // GET /api/invoices/:invoiceId/pricing — fetch pricing breakdown
  // Falls through to real backend for non-demo invoice IDs.
  http.get('/api/invoices/:invoiceId/pricing', async ({ params }) => {
    const invoiceId = params.invoiceId as string;
    const pricing = PRICING_DATA.get(invoiceId);
    if (!pricing) return passthrough();
    await delay(300);
    return HttpResponse.json<PricingBreakdown>(pricing);
  }),

  // POST /api/invoices/:invoiceId/pricing/accept — supplier accepts pricing
  http.post('/api/invoices/:invoiceId/pricing/accept', async ({ params }) => {
    const invoiceId = params.invoiceId as string;
    const pricing = PRICING_DATA.get(invoiceId);
    if (!pricing) return passthrough();
    await delay(300);
    if (pricing.status !== 'pending') {
      return HttpResponse.json(
        { code: 'PRICING_ALREADY_RESOLVED', message: 'Pricing has already been resolved.' },
        { status: 400 },
      );
    }
    pricing.status = 'accepted';
    pricing.acceptedAt = new Date().toISOString();
    return HttpResponse.json({ message: 'Pricing accepted' });
  }),

  // POST /api/invoices/:invoiceId/pricing/dispute — supplier raises a pricing concern
  http.post('/api/invoices/:invoiceId/pricing/dispute', async ({ params, request }) => {
    const invoiceId = params.invoiceId as string;
    const pricing   = PRICING_DATA.get(invoiceId);
    if (!pricing) return passthrough();
    await delay(350);
    if (pricing.status !== 'pending') {
      return HttpResponse.json(
        { code: 'PRICING_ALREADY_RESOLVED', message: 'Pricing has already been resolved.' },
        { status: 400 },
      );
    }
    const body       = await request.json() as PricingDisputePayload;
    const now        = new Date();
    const slaDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const dispute: PricingDispute = {
      id:                        uuidv4(),
      invoiceId,
      reason:                    body.reason,
      proposedRate:              body.proposedRate ?? null,
      proposedAdvancePercentage: body.proposedAdvancePercentage ?? null,
      notes:                     body.notes ?? null,
      submittedAt:               now.toISOString(),
      slaDeadline,
      status:                    'open',
    };
    pricing.status     = 'disputed';
    pricing.disputedAt = now.toISOString();
    pricing.dispute    = dispute;
    return HttpResponse.json<PricingDispute>(dispute, { status: 201 });
  }),

  // POST /api/invoices/:invoiceId/pricing/reject — supplier rejects pricing
  http.post('/api/invoices/:invoiceId/pricing/reject', async ({ params, request }) => {
    const invoiceId = params.invoiceId as string;
    const pricing = PRICING_DATA.get(invoiceId);
    if (!pricing) return passthrough();
    await delay(300);
    if (pricing.status !== 'pending') {
      return HttpResponse.json(
        { code: 'PRICING_ALREADY_RESOLVED', message: 'Pricing has already been resolved.' },
        { status: 400 },
      );
    }
    const body = await request.json() as { reason?: string };
    pricing.status = 'rejected';
    pricing.rejectedAt = new Date().toISOString();
    // rejectionReason is not on the PricingBreakdown type from pricing.api.ts,
    // so we log it but don't store it on the object
    if (body.reason) {
      console.info('[MSW] Pricing rejected with reason:', body.reason);
    }
    return HttpResponse.json({ message: 'Pricing rejected' });
  }),
];
