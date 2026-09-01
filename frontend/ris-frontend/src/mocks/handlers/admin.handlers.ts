import { http, HttpResponse, delay } from 'msw';
import type { AdminUser, RiskConfigEntry } from '../../types/admin.types';
import type { Role } from '../../types/auth.types';

// ── Seed: users ───────────────────────────────────────────────────────────────

// Mirrors the login credential registry (auth.handlers.ts USERS) one-to-one so
// every account shown in User Management is a real, loginnable user. All
// non-supplier staff are active so each role can sign in and use the system.
let usersStore: AdminUser[] = [
  {
    id: 'usr_001', name: 'Admin User', email: 'admin@ris.ug', role: 'finance_manager',
    status: 'active', lastLogin: '2026-03-25T14:22:00Z', createdAt: '2023-01-10T08:00:00Z',
  },
  {
    id: 'usr_003', name: 'Credit Officer', email: 'officer@ris.ug', role: 'credit_officer',
    status: 'active', lastLogin: '2026-03-23T11:30:00Z', createdAt: '2023-03-01T08:00:00Z',
  },
  {
    id: 'usr_004', name: 'Grace Nakamya', email: 'finance2@ris.ug', role: 'finance_manager',
    status: 'active', lastLogin: '2026-03-22T16:55:00Z', createdAt: '2023-04-05T08:00:00Z',
  },
  {
    id: 'usr_005', name: 'David Mukasa', email: 'management@ris.ug', role: 'management',
    status: 'active', lastLogin: '2026-03-21T08:00:00Z', createdAt: '2023-05-20T08:00:00Z',
  },
  {
    id: 'usr_006', name: 'Agnes Nambi', email: 'compliance@ris.ug', role: 'compliance_officer',
    status: 'active', lastLogin: '2026-03-20T13:00:00Z', createdAt: '2023-06-15T08:00:00Z',
  },
  {
    id: 'usr_007', name: 'Robert Kizza', email: 'auditor@ris.ug', role: 'auditor',
    status: 'active', lastLogin: '2026-03-19T10:00:00Z', createdAt: '2023-07-01T08:00:00Z',
  },
  {
    id: 'usr_009', name: 'Patricia Acen', email: 'legal@ris.ug', role: 'legal',
    status: 'active', lastLogin: '2026-03-18T09:30:00Z', createdAt: '2023-08-12T08:00:00Z',
  },
  {
    id: 'usr_002', name: 'Kampala Traders Ltd', email: 'supplier@ris.ug', role: 'supplier',
    status: 'active', lastLogin: '2026-03-24T09:10:00Z', createdAt: '2023-02-14T08:00:00Z',
  },
  {
    id: 'usr_008', name: 'Jinja Fresh Produce', email: 'newsupplier@ris.ug', role: 'supplier',
    status: 'active', lastLogin: null, createdAt: '2023-09-01T08:00:00Z',
  },
];

let userIdCounter = usersStore.length + 1;

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Seed: risk config ─────────────────────────────────────────────────────────

let riskConfigStore: RiskConfigEntry[] = [
  // Risk scoring weights (must sum to 100)
  { key: 'buyer_credit_weight',           value: 30,  description: 'Weight applied to buyer credit score factor',           category: 'weight',    lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'supplier_track_record_weight',  value: 25,  description: 'Weight applied to supplier track record factor',        category: 'weight',    lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'collateral_weight',             value: 20,  description: 'Weight applied to collateral coverage factor',          category: 'weight',    lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'concentration_weight',          value: 15,  description: 'Weight applied to concentration risk factor',           category: 'weight',    lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tenor_weight',                  value: 10,  description: 'Weight applied to tenor (duration) risk factor',        category: 'weight',    lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },

  // Approval tier thresholds (Stage 9 — workflow document)
  { key: 'auto_approve_max_ugx',          value: 10000000,  description: 'Max face value for auto-approval (UGX)',                  category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'auto_approve_min_risk_score',   value: 75,  description: 'Min risk score for auto-approval',                            category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tier3_min_face_value_ugx',      value: 50000000,  description: 'Min face value for Tier 3 committee review (UGX)',       category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tier3_max_risk_score',          value: 50,  description: 'Risk score below this triggers Tier 3 review',                 category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tier4_min_face_value_ugx',      value: 200000000, description: 'Min face value for Tier 4 board-level review (UGX)',     category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tier4_max_risk_score',          value: 30,  description: 'Risk score below this triggers Tier 4 review',                 category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'tier3_auto_reject_threshold',   value: 3,   description: 'Rejections before Tier 3 auto-rejects invoice',               category: 'threshold', lastUpdated: '2026-02-01T09:00:00Z', updatedBy: 'Admin User' },
  { key: 'min_risk_score',                value: 40,  description: 'Minimum composite risk score to proceed to pricing',           category: 'threshold', lastUpdated: '2026-02-01T09:00:00Z', updatedBy: 'Grace Atim' },
  { key: 'aml_flag_threshold_ugx',        value: 100000000, description: 'AML flag threshold in UGX (Bank of Uganda FIA 2004)',    category: 'threshold', lastUpdated: '2026-01-01T00:00:00Z', updatedBy: 'Admin User' },
  { key: 'approval_sla_hours',            value: 24,  description: 'SLA hours from scored to approval decision',                   category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'payment_sla_hours',             value: 72,  description: 'SLA hours from approval to payment disbursement',              category: 'threshold', lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },

  // Operational limits
  { key: 'concentration_risk_limit_pct',  value: 30,  description: 'Max portfolio exposure to a single buyer (%)',                 category: 'limit',     lastUpdated: '2026-02-20T14:00:00Z', updatedBy: 'David Ojiambo' },
  { key: 'max_invoice_tenor_days',        value: 90,  description: 'Maximum allowed invoice tenor in days',                        category: 'limit',     lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'min_invoice_tenor_days',        value: 7,   description: 'Minimum allowed invoice tenor in days',                        category: 'limit',     lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'max_advance_pct',              value: 95,   description: 'Maximum advance percentage of face value (%)',                 category: 'limit',     lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
  { key: 'overdue_days_to_default',       value: 90,  description: 'Days overdue before invoice auto-defaults',                    category: 'limit',     lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },

  // Pricing rates
  { key: 'base_discount_rate_pct',        value: 3.5, description: 'Base annual discount rate for pricing (%)',                    category: 'rate',      lastUpdated: '2026-03-01T08:00:00Z', updatedBy: 'Grace Atim' },
  { key: 'high_risk_premium_pct',         value: 2.0, description: 'Additional rate premium for high-risk invoices (%)',           category: 'rate',      lastUpdated: '2026-03-01T08:00:00Z', updatedBy: 'Grace Atim' },
  { key: 'penalty_rate_daily_pct',        value: 0.05, description: 'Daily penalty rate for overdue invoices (%)',                 category: 'rate',      lastUpdated: '2026-01-15T10:00:00Z', updatedBy: 'Admin User' },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const adminHandlers = [

  // GET /api/admin/users
  http.get('/api/admin/users', async ({ request }) => {
    await delay(400);
    const url    = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const size   = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    const filtered = search
      ? usersStore.filter(
          (u) => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search),
        )
      : usersStore;

    const total  = filtered.length;
    const start  = (page - 1) * size;
    const data   = filtered.slice(start, start + size);

    return HttpResponse.json({ data, total, page, page_size: size });
  }),

  // POST /api/admin/users
  http.post('/api/admin/users', async ({ request }) => {
    await delay(600);
    const body = await request.json() as { name?: string; email?: string; role?: Role };

    if (!body.name?.trim()) {
      return HttpResponse.json({ message: 'Name is required.' }, { status: 400 });
    }
    if (!body.email?.trim()) {
      return HttpResponse.json({ message: 'Email is required.' }, { status: 400 });
    }
    if (usersStore.some((u) => u.email === body.email)) {
      return HttpResponse.json({ message: 'Email is already in use.' }, { status: 409 });
    }

    const newUser: AdminUser = {
      id:         `usr_${String(++userIdCounter).padStart(3, '0')}`,
      name:       body.name.trim(),
      email:      body.email.trim(),
      role:       body.role ?? 'credit_officer',
      status:     'active',
      lastLogin:  null,
      createdAt:  new Date().toISOString(),
    };
    usersStore = [...usersStore, newUser];

    return HttpResponse.json({ user: newUser, temporaryPassword: generateTempPassword() }, { status: 201 });
  }),

  // PATCH /api/admin/users/:id
  http.patch('/api/admin/users/:id', async ({ params, request }) => {
    await delay(400);
    const { id } = params;
    const body   = await request.json() as { role?: Role; status?: 'active' | 'inactive' };
    const idx    = usersStore.findIndex((u) => u.id === id);

    if (idx === -1) {
      return HttpResponse.json({ message: 'User not found.' }, { status: 404 });
    }

    usersStore = usersStore.map((u, i) =>
      i === idx
        ? {
            ...u,
            ...(body.role   !== undefined ? { role:   body.role   } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          }
        : u,
    );

    return HttpResponse.json(usersStore[idx]);
  }),

  // GET /api/admin/risk-config
  http.get('/api/admin/risk-config', async () => {
    await delay(350);
    return HttpResponse.json([...riskConfigStore]);
  }),

  // PUT /api/admin/risk-config/:key
  http.put('/api/admin/risk-config/:key', async ({ params, request }) => {
    await delay(500);
    const { key }  = params;
    const body     = await request.json() as { value?: number };
    const idx      = riskConfigStore.findIndex((e) => e.key === key);

    if (idx === -1) {
      return HttpResponse.json({ message: 'Config key not found.' }, { status: 404 });
    }
    if (body.value === undefined || !Number.isFinite(body.value) || body.value < 0) {
      return HttpResponse.json({ message: 'Value must be a non-negative number.' }, { status: 400 });
    }

    riskConfigStore = riskConfigStore.map((e, i) =>
      i === idx
        ? { ...e, value: body.value as number, lastUpdated: new Date().toISOString(), updatedBy: 'Admin User' }
        : e,
    );

    return HttpResponse.json<RiskConfigEntry>(riskConfigStore[idx]);
  }),

];
