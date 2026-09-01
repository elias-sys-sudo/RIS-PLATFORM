import { http, HttpResponse, delay } from 'msw';
import type { Buyer, BuyerListResponse } from '../../types/buyer.types';

// ── Seed data ─────────────────────────────────────────────────────────────────

const MOCK_BUYERS: Buyer[] = [
  {
    id:                 'buyer_101',
    name:               'Stanbic Bank Uganda',
    industry:           'Banking & Finance',
    creditLimit:        500_000_000,
    paymentTermsDays:   45,
  },
  {
    id:                 'buyer_102',
    name:               'MTN Uganda Ltd',
    industry:           'Telecommunications',
    creditLimit:        1_000_000_000,
    paymentTermsDays:   30,
  },
  {
    id:                 'buyer_103',
    name:               'Umeme Ltd',
    industry:           'Utilities',
    creditLimit:        800_000_000,
    paymentTermsDays:   60,
  },
  {
    id:                 'buyer_104',
    name:               'Centenary Bank',
    industry:           'Banking & Finance',
    creditLimit:        400_000_000,
    paymentTermsDays:   45,
  },
  {
    id:                 'buyer_105',
    name:               'Uganda Telecom',
    industry:           'Telecommunications',
    creditLimit:        300_000_000,
    paymentTermsDays:   30,
  },
  {
    id:                 'buyer_106',
    name:               'DFCU Bank',
    industry:           'Banking & Finance',
    creditLimit:        600_000_000,
    paymentTermsDays:   45,
  },
  {
    id:                 'buyer_107',
    name:               'Airtel Uganda',
    industry:           'Telecommunications',
    creditLimit:        750_000_000,
    paymentTermsDays:   30,
  },
  {
    id:                 'buyer_108',
    name:               'Uganda National Roads Authority',
    industry:           'Government',
    creditLimit:        2_000_000_000,
    paymentTermsDays:   90,
  },
  {
    id:                 'buyer_109',
    name:               'Kampala Capital City Authority',
    industry:           'Government',
    creditLimit:        1_500_000_000,
    paymentTermsDays:   60,
  },
  {
    id:                 'buyer_110',
    name:               'Nile Breweries Ltd',
    industry:           'FMCG',
    creditLimit:        350_000_000,
    paymentTermsDays:   30,
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

// ── Buyer onboarding requests (in-memory) ────────────────────────────────────

interface BuyerRequest {
  id: string;
  supplierId: string;
  companyName: string;
  registrationNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  reason: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewerComments: string | null;
  linkedBuyerId: string | null;
  createdAt: string;
  updatedAt: string;
}

const BUYER_REQUESTS: BuyerRequest[] = [];

export const buyersHandlers = [
  /**
   * GET /api/buyers
   * Returns list of buyers, optionally filtered by ?search=
   */
  http.get('/api/buyers', async ({ request }) => {
    await delay(300);
    const url    = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';

    const filtered = search
      ? MOCK_BUYERS.filter(
          (b) =>
            b.name.toLowerCase().includes(search) ||
            b.industry.toLowerCase().includes(search),
        )
      : MOCK_BUYERS;

    const response: BuyerListResponse = {
      data:  filtered,
      total: filtered.length,
    };
    return HttpResponse.json(response);
  }),

  // POST /api/onboarding/buyer-requests — supplier creates a buyer onboarding request
  http.post('/api/onboarding/buyer-requests', async ({ request }) => {
    await delay(400);
    const body = await request.json() as {
      company_name: string;
      registration_number?: string;
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
      reason: string;
    };
    const now = new Date().toISOString();
    const entry: BuyerRequest = {
      id: `breq_${Date.now()}`,
      supplierId: 'usr_002',
      companyName: body.company_name,
      registrationNumber: body.registration_number ?? null,
      contactName: body.contact_name ?? null,
      contactEmail: body.contact_email ?? null,
      contactPhone: body.contact_phone ?? null,
      reason: body.reason,
      status: 'pending',
      reviewedBy: null,
      reviewerComments: null,
      linkedBuyerId: null,
      createdAt: now,
      updatedAt: now,
    };
    BUYER_REQUESTS.push(entry);
    return HttpResponse.json({ data: entry }, { status: 201 });
  }),

  // GET /api/onboarding/buyer-requests/mine — supplier's own requests
  http.get('/api/onboarding/buyer-requests/mine', async () => {
    await delay(300);
    return HttpResponse.json({ data: BUYER_REQUESTS, total: BUYER_REQUESTS.length });
  }),

  // GET /api/onboarding/admin/buyer-requests — credit officer views all requests
  http.get('/api/onboarding/admin/buyer-requests', async ({ request }) => {
    await delay(300);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const filtered = status ? BUYER_REQUESTS.filter((r) => r.status === status) : BUYER_REQUESTS;
    return HttpResponse.json({ data: filtered, total: filtered.length });
  }),

  // PUT /api/onboarding/admin/buyer-requests/:id — credit officer approves/rejects
  http.put('/api/onboarding/admin/buyer-requests/:id', async ({ params, request }) => {
    await delay(400);
    const idx = BUYER_REQUESTS.findIndex((r) => r.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Request not found.' }, { status: 404 });
    const body = await request.json() as {
      status: 'approved' | 'rejected';
      reviewer_comments?: string;
      linked_buyer_id?: string;
    };
    const now = new Date().toISOString();
    BUYER_REQUESTS[idx] = {
      ...BUYER_REQUESTS[idx],
      status: body.status,
      reviewedBy: 'Credit Officer',
      reviewerComments: body.reviewer_comments ?? null,
      linkedBuyerId: body.linked_buyer_id ?? null,
      updatedAt: now,
    };
    // If approved, add buyer to the pool so it appears in invoice dropdown
    if (body.status === 'approved') {
      const req = BUYER_REQUESTS[idx];
      const newBuyer = {
        id: `buyer_${Date.now()}`,
        name: req.companyName,
        industry: 'General',
        creditLimit: 100_000_000,
        paymentTermsDays: 30,
        contactPerson: req.contactName ?? 'N/A',
        contactEmail: req.contactEmail ?? 'N/A',
        contactPhone: req.contactPhone ?? 'N/A',
      };
      MOCK_BUYERS.push(newBuyer as (typeof MOCK_BUYERS)[number]);
    }
    return HttpResponse.json({ data: BUYER_REQUESTS[idx] });
  }),
];
