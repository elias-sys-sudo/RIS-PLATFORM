import { http, HttpResponse, delay } from 'msw';
import type {
  Facility,
  FacilityDetail,
  FacilityDrawdown,
  FacilityRepayment,
} from '../../types/facility.types';
import { MOCK_INVOICES } from './invoice.handlers';

/* ------------------------------------------------------------------ */
/*  Seed data — aligned with workflow document Stage 10/11             */
/*  Bank facilities are credit lines used to fund invoice advances.    */
/*  Drawdowns happen when invoices are funded (Stage 11).              */
/*  Repayments happen when buyer payments are collected (Stage 12/13). */
/* ------------------------------------------------------------------ */

const DRAWDOWNS: Record<string, FacilityDrawdown[]> = {
  fac_001: [
    { id: 'dd_001', amount: 180000000, invoiceRef: 'INV-2025-001', drawnAt: '2025-02-10T09:00:00Z' },
    { id: 'dd_002', amount: 142500000, invoiceRef: 'INV-2025-002', drawnAt: '2025-02-15T10:30:00Z' },
    { id: 'dd_003', amount: 180000000, invoiceRef: 'INV-2025-004', drawnAt: '2025-03-08T14:00:00Z' },
    { id: 'dd_004', amount: 427500000, invoiceRef: 'INV-2025-005', drawnAt: '2025-03-12T11:00:00Z' },
    { id: 'dd_005', amount: 85500000,  invoiceRef: 'INV-2025-006', drawnAt: '2025-03-20T08:45:00Z' },
  ],
  fac_002: [
    { id: 'dd_006', amount: 95000000,  invoiceRef: 'INV-2025-007', drawnAt: '2025-01-20T09:00:00Z' },
    { id: 'dd_007', amount: 120000000, invoiceRef: 'INV-2025-008', drawnAt: '2025-02-05T14:30:00Z' },
  ],
  fac_003: [],
};

const REPAYMENTS: Record<string, FacilityRepayment[]> = {
  fac_001: [
    { id: 'rp_001', amount: 181200000, paidAt: '2025-03-10T16:00:00Z', reference: 'COL-2025-001' },
    { id: 'rp_002', amount: 143800000, paidAt: '2025-03-25T10:00:00Z', reference: 'COL-2025-002' },
  ],
  fac_002: [
    { id: 'rp_003', amount: 96200000,  paidAt: '2025-03-15T11:00:00Z', reference: 'COL-2025-003' },
  ],
  fac_003: [],
};

// defaultedExposure is filled dynamically per request — see withDefaultedExposure()
// below. The seed value of 0 here is a placeholder; the mock assigns all defaulted
// advance to fac_001 (the primary facility) since MOCK_INVOICES doesn't carry a
// facility-id link. Real backend joins facility_drawdowns → invoices on status.
const FACILITIES: Facility[] = [
  {
    id: 'fac_001',
    bankName: 'Stanbic Bank Uganda',
    totalLimit: 2000000000,
    drawnAmount: 693000000,
    availableAmount: 1307000000,
    utilisationPct: 34.65,
    interestRate: 18,
    interestAccrued: 4880000,
    defaultedExposure: 0,
    maturityDate: '2026-06-30T00:00:00Z',
    status: 'active',
    createdAt: '2025-01-01T08:00:00Z',
  },
  {
    id: 'fac_002',
    bankName: 'Centenary Bank',
    totalLimit: 500000000,
    drawnAmount: 120000000,
    availableAmount: 380000000,
    utilisationPct: 24.0,
    interestRate: 20,
    interestAccrued: 1250000,
    defaultedExposure: 0,
    maturityDate: '2025-12-31T00:00:00Z',
    status: 'active',
    createdAt: '2024-06-15T08:00:00Z',
  },
  {
    id: 'fac_003',
    bankName: 'dfcu Bank',
    totalLimit: 300000000,
    drawnAmount: 0,
    availableAmount: 300000000,
    utilisationPct: 0,
    interestRate: 19,
    interestAccrued: 0,
    defaultedExposure: 0,
    maturityDate: '2025-03-31T00:00:00Z',
    status: 'matured',
    createdAt: '2024-01-10T08:00:00Z',
  },
];

/** Sum advance_amount of defaulted invoices, assigned to the primary facility. */
function computeDefaultedExposureByFacility(): Record<string, number> {
  const total = MOCK_INVOICES
    .filter((inv) => inv.status === 'defaulted')
    .reduce((n, inv) => n + Number(inv.advanceAmount), 0);
  return { fac_001: total };
}

function withDefaultedExposure(facilities: Facility[]): Facility[] {
  const byFacility = computeDefaultedExposureByFacility();
  return facilities.map((f) => ({ ...f, defaultedExposure: byFacility[f.id] ?? 0 }));
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */

export const facilitiesHandlers = [
  /** GET /api/reports/facilities — list all bank facilities with at-risk exposure */
  http.get('/api/reports/facilities', async () => {
    await delay(300);
    const data = withDefaultedExposure(FACILITIES);
    return HttpResponse.json({ data, total: data.length });
  }),

  /** GET /api/facilities/:id — facility detail with drawdowns & repayments */
  http.get('/api/facilities/:id', async ({ params }) => {
    await delay(250);
    const facility = FACILITIES.find((f) => f.id === params.id);
    if (!facility) {
      return HttpResponse.json({ message: 'Facility not found' }, { status: 404 });
    }
    const byFacility = computeDefaultedExposureByFacility();
    const detail: FacilityDetail = {
      ...facility,
      defaultedExposure: byFacility[facility.id] ?? 0,
      drawdowns: DRAWDOWNS[facility.id] ?? [],
      repayments: REPAYMENTS[facility.id] ?? [],
    };
    return HttpResponse.json({ data: detail });
  }),
];
