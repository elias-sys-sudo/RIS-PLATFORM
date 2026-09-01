import { http, HttpResponse, delay, passthrough } from 'msw';
import type {
  ApprovalQueueItem,
  ApprovalDetail,
  ApprovalHistoryItem,
  ApprovalStats,
  PaginatedApprovals,
  PaginatedApprovalHistory,
  TierDecision,
  ApprovalTier,
} from '../../types/approval.types';
import type { InvoiceDetail, RiskBreakdown, InvoiceStatus } from '../../types/invoice.types';
import { MOCK_INVOICES } from './invoice.handlers';

// ── Seed helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function todayISO(): string {
  return new Date().toISOString();
}

// ── Risk breakdown factory ────────────────────────────────────────────────────

function mkRisk(composite: number): RiskBreakdown {
  return {
    composite,
    buyerCredit:          Math.min(100, composite + Math.round((Math.random() - 0.5) * 20)),
    supplierTrackRecord:  Math.min(100, composite + Math.round((Math.random() - 0.5) * 15)),
    concentrationRisk:    Math.min(100, composite + Math.round((Math.random() - 0.5) * 25)),
    collateral:           Math.min(100, composite + Math.round((Math.random() - 0.5) * 18)),
    tenor:                Math.min(100, composite + Math.round((Math.random() - 0.5) * 12)),
  };
}

// ── Tier-decision factory ─────────────────────────────────────────────────────

function mkPendingTier(tier: ApprovalTier): TierDecision {
  const labels: Record<ApprovalTier, string> = {
    AUTO: 'Auto Approval',
    TIER_2: 'Credit Officer',
    TIER_3: 'Finance Manager',
    TIER_4: 'Management / Board',
  };
  return {
    tier,
    tierLabel:  labels[tier],
    decision:   null,
    actorName:  null,
    actorRole:  null,
    decidedAt:  null,
    reason:     null,
  };
}

function mkApprovedTier(
  tier: ApprovalTier,
  actor: string,
  role: string,
  daysBack: number,
): TierDecision {
  const labels: Record<ApprovalTier, string> = {
    AUTO: 'Auto Approval',
    TIER_2: 'Credit Officer',
    TIER_3: 'Finance Manager',
    TIER_4: 'Management / Board',
  };
  return {
    tier,
    tierLabel:  labels[tier],
    decision:   'APPROVED',
    actorName:  actor,
    actorRole:  role,
    decidedAt:  daysAgo(daysBack),
    reason:     null,
  };
}

// ── Mutable seed data (8 pending approvals) ────────────────────────────────────

const MOCK_APPROVALS: ApprovalQueueItem[] = [
  {
    id: 'apr_001', invoiceId: 'inv_010', invoiceNumber: 'INV-2026-010',
    supplierName: 'Kampala Traders Ltd', buyerName: 'Stanbic Bank Uganda',
    faceValue: 85_000_000, riskScore: 78, riskLevel: 'low',
    submittedAt: daysAgo(2), daysInQueue: 2, currentTier: 'TIER_2', status: 'PENDING',
  },
  {
    id: 'apr_002', invoiceId: 'inv_011', invoiceNumber: 'INV-2026-011',
    supplierName: 'Nile Agro Exports', buyerName: 'MTN Uganda Ltd',
    faceValue: 210_000_000, riskScore: 61, riskLevel: 'medium',
    submittedAt: daysAgo(3), daysInQueue: 3, currentTier: 'TIER_2', status: 'PENDING',
  },
  {
    id: 'apr_003', invoiceId: 'inv_012', invoiceNumber: 'INV-2026-012',
    supplierName: 'Pearl Foods Uganda', buyerName: 'Umeme Ltd',
    faceValue: 47_500_000, riskScore: 82, riskLevel: 'low',
    submittedAt: daysAgo(1), daysInQueue: 1, currentTier: 'TIER_2', status: 'PENDING',
  },
  {
    id: 'apr_004', invoiceId: 'inv_013', invoiceNumber: 'INV-2026-013',
    supplierName: 'Uganda Steel Works', buyerName: 'Centenary Bank',
    faceValue: 320_000_000, riskScore: 44, riskLevel: 'medium',
    submittedAt: daysAgo(4), daysInQueue: 4, currentTier: 'TIER_3', status: 'PENDING',
  },
  {
    id: 'apr_005', invoiceId: 'inv_014', invoiceNumber: 'INV-2026-014',
    supplierName: 'Equator Flowers Ltd', buyerName: 'Dfcu Bank',
    faceValue: 68_000_000, riskScore: 35, riskLevel: 'high',
    submittedAt: daysAgo(5), daysInQueue: 5, currentTier: 'TIER_3', status: 'PENDING',
  },
  {
    id: 'apr_006', invoiceId: 'inv_015', invoiceNumber: 'INV-2026-015',
    supplierName: 'Lira Transport Co', buyerName: 'Airtel Uganda',
    faceValue: 155_000_000, riskScore: 72, riskLevel: 'low',
    submittedAt: daysAgo(1), daysInQueue: 1, currentTier: 'TIER_2', status: 'PENDING',
  },
  {
    id: 'apr_007', invoiceId: 'inv_016', invoiceNumber: 'INV-2026-016',
    supplierName: 'Mbarara Dairy Products', buyerName: 'Nile Breweries Ltd',
    faceValue: 540_000_000, riskScore: 27, riskLevel: 'critical',
    submittedAt: daysAgo(6), daysInQueue: 6, currentTier: 'TIER_4', status: 'PENDING',
  },
  {
    id: 'apr_008', invoiceId: 'inv_017', invoiceNumber: 'INV-2026-017',
    supplierName: 'Gulu Hardware Supplies', buyerName: 'Uganda Telecom Ltd',
    faceValue: 92_000_000, riskScore: 55, riskLevel: 'medium',
    submittedAt: daysAgo(3), daysInQueue: 3, currentTier: 'TIER_2', status: 'PENDING',
  },
];

// ── Resolved items (approved / rejected) ──────────────────────────────────────

const RESOLVED_APPROVALS: ApprovalQueueItem[] = [
  {
    id: 'apr_020', invoiceId: 'inv_001', invoiceNumber: 'INV-2025-001',
    supplierName: 'Kampala Traders Ltd', buyerName: 'Stanbic Bank Uganda',
    faceValue: 45_000_000, riskScore: 72, riskLevel: 'low',
    submittedAt: daysAgo(10), daysInQueue: 2, currentTier: 'TIER_3', status: 'APPROVED',
  },
  {
    id: 'apr_021', invoiceId: 'inv_003', invoiceNumber: 'INV-2025-003',
    supplierName: 'Nile Agro Exports', buyerName: 'Umeme Ltd',
    faceValue: 78_500_000, riskScore: 38, riskLevel: 'high',
    submittedAt: daysAgo(15), daysInQueue: 3, currentTier: 'TIER_4', status: 'REJECTED',
  },
  {
    id: 'apr_022', invoiceId: 'inv_004', invoiceNumber: 'INV-2025-004',
    supplierName: 'Pearl Foods Uganda', buyerName: 'Centenary Bank',
    faceValue: 200_000_000, riskScore: 68, riskLevel: 'low',
    submittedAt: daysAgo(8), daysInQueue: 2, currentTier: 'TIER_3', status: 'APPROVED',
  },
];

// ── Build InvoiceDetail stub for approval detail ──────────────────────────────

function buildInvoiceDetail(item: ApprovalQueueItem): InvoiceDetail {
  return {
    id:             item.invoiceId,
    invoiceNumber:  item.invoiceNumber,
    supplierId:     'sup_auto',
    supplierName:   item.supplierName,
    buyerId:        'buyer_auto',
    buyerName:      item.buyerName,
    faceValue:      item.faceValue,
    advanceAmount:  Math.round(item.faceValue * 0.9),
    discountAmount: Math.round(item.faceValue * 0.1),
    advancePercentage: 90,
    discountRate:   3.2,
    tenor:          45,
    status:         'scored',
    riskScore:      item.riskScore,
    riskLevel:      item.riskLevel,
    issueDate:      daysAgo(10),
    dueDate:        new Date(Date.now() + 35 * 86400_000).toISOString(),
    fundedAt:       null,
    collectedAt:    null,
    createdAt:      item.submittedAt,
    updatedAt:      item.submittedAt,
    buyerInfo: {
      id:               'buyer_auto',
      name:             item.buyerName,
      industry:         'Financial Services',
      creditLimit:      500_000_000,
      paymentTermsDays: 45,
      contactEmail:     'payables@buyer.co.ug',
      contactPhone:     '+256 312 100 000',
    },
    supplierInfo: {
      id:                 'sup_auto',
      name:               item.supplierName,
      industry:           'Trade & Commerce',
      registrationNumber: 'UG-2020-0' + item.id.slice(-3),
      contactEmail:       'accounts@supplier.co.ug',
      contactPhone:       '+256 414 200 000',
    },
    statusTimeline: [
      {
        status:          'submitted',
        transitionedAt:  item.submittedAt,
        actorName:       'System',
        actorRole:       'system',
        notes:           null,
      },
      {
        status:          'buyer_confirmed',
        transitionedAt:  daysAgo(Math.max(0, item.daysInQueue - 1)),
        actorName:       item.buyerName,
        actorRole:       'buyer',
        notes:           'Invoice verified and confirmed.',
      },
      {
        status:          'scored',
        transitionedAt:  daysAgo(Math.max(0, item.daysInQueue - 1)),
        actorName:       'Risk Engine',
        actorRole:       'system',
        notes:           `Risk score: ${item.riskScore ?? 'N/A'}`,
      },
    ],
    approvalHistory: [],
    riskBreakdown:   item.riskScore !== null ? mkRisk(item.riskScore) : null,
    documents: [
      {
        id:          `doc_${item.invoiceId}_1`,
        name:        'Invoice_Document.pdf',
        type:        'invoice_pdf',
        uploadedAt:  item.submittedAt,
        sizeBytes:   245_120,
      },
      {
        id:          `doc_${item.invoiceId}_2`,
        name:        'Notice_of_Assignment.pdf',
        type:        'notice_of_assignment',
        uploadedAt:  item.submittedAt,
        sizeBytes:   88_064,
      },
    ],
    collateral: [
      {
        id:              `col_${item.invoiceId}_1`,
        type:            'property',
        description:     'First class bank guarantee from Stanbic Bank Uganda',
        estimatedValue:  Math.round(item.faceValue * 1.1),
        status:          'verified',
      },
    ],
  };
}

// ── Build full ApprovalDetail ─────────────────────────────────────────────────

const TIER_ORDER: ApprovalTier[] = ['AUTO', 'TIER_2', 'TIER_3', 'TIER_4'];

function buildApprovalDetail(item: ApprovalQueueItem): ApprovalDetail {
  const tierDecisions: TierDecision[] = [];
  const currentIdx = TIER_ORDER.indexOf(item.currentTier);

  if (currentIdx >= 2) {
    tierDecisions.push(mkApprovedTier('TIER_2', 'Alice Nakato', 'credit_officer', item.daysInQueue - 1));
  } else {
    tierDecisions.push(mkPendingTier('TIER_2'));
  }

  if (currentIdx >= 3) {
    tierDecisions.push(mkApprovedTier('TIER_3', 'Robert Ssali', 'finance_manager', item.daysInQueue - 2));
  } else {
    tierDecisions.push(mkPendingTier('TIER_3'));
  }

  tierDecisions.push(mkPendingTier('TIER_4'));

  return {
    id:             item.id,
    invoiceId:      item.invoiceId,
    invoice:        buildInvoiceDetail(item),
    currentTier:    item.currentTier,
    status:         item.status,
    tierDecisions,
    riskBreakdown:  item.riskScore !== null ? mkRisk(item.riskScore) : null,
    submittedAt:    item.submittedAt,
    daysInQueue:    item.daysInQueue,
  };
}

// ── History seed data ─────────────────────────────────────────────────────────

const MOCK_HISTORY: ApprovalHistoryItem[] = [
  {
    id: 'hist_001', invoiceId: 'inv_001', invoiceNumber: 'INV-2025-001',
    supplierName: 'Kampala Traders Ltd', buyerName: 'Stanbic Bank Uganda',
    faceValue: 45_000_000, riskScore: 72, riskLevel: 'low',
    finalDecision: 'APPROVED', decidedBy: 'Alice Nakato',
    decidedAt: daysAgo(8), tier: 'TIER_3', reason: null,
  },
  {
    id: 'hist_002', invoiceId: 'inv_003', invoiceNumber: 'INV-2025-003',
    supplierName: 'Nile Agro Exports', buyerName: 'Umeme Ltd',
    faceValue: 78_500_000, riskScore: 38, riskLevel: 'high',
    finalDecision: 'REJECTED', decidedBy: 'Robert Ssali',
    decidedAt: daysAgo(12), tier: 'TIER_4',
    reason: 'Concentration risk exceeds portfolio threshold. Buyer exposure already at 28% of total portfolio.',
  },
  {
    id: 'hist_003', invoiceId: 'inv_004', invoiceNumber: 'INV-2025-004',
    supplierName: 'Pearl Foods Uganda', buyerName: 'Centenary Bank',
    faceValue: 200_000_000, riskScore: 68, riskLevel: 'low',
    finalDecision: 'APPROVED', decidedBy: 'Grace Mugisha',
    decidedAt: daysAgo(6), tier: 'TIER_3', reason: null,
  },
  {
    id: 'hist_004', invoiceId: 'inv_018', invoiceNumber: 'INV-2026-018',
    supplierName: 'Uganda Steel Works', buyerName: 'Dfcu Bank',
    faceValue: 95_000_000, riskScore: 55, riskLevel: 'medium',
    finalDecision: 'ESCALATED', decidedBy: 'Alice Nakato',
    decidedAt: daysAgo(2), tier: 'TIER_2',
    reason: 'Please provide audited financial statements for the last 2 years.',
  },
  {
    id: 'hist_005', invoiceId: 'inv_019', invoiceNumber: 'INV-2026-019',
    supplierName: 'Lira Transport Co', buyerName: 'Airtel Uganda',
    faceValue: 38_000_000, riskScore: 81, riskLevel: 'low',
    finalDecision: 'APPROVED', decidedBy: 'Alice Nakato',
    decidedAt: todayISO(), tier: 'TIER_2', reason: null,
  },
  {
    id: 'hist_006', invoiceId: 'inv_020', invoiceNumber: 'INV-2026-020',
    supplierName: 'Equator Flowers Ltd', buyerName: 'Nile Breweries Ltd',
    faceValue: 62_000_000, riskScore: 29, riskLevel: 'critical',
    finalDecision: 'REJECTED', decidedBy: 'Robert Ssali',
    decidedAt: todayISO(), tier: 'TIER_3',
    reason: 'Risk score below minimum threshold. Buyer has two outstanding overdue invoices with RIS.',
  },
];

// ── Stats computed from seed ──────────────────────────────────────────────────

function computeStats(items: ApprovalQueueItem[]): ApprovalStats {
  const pending = items.filter((i) => i.status === 'PENDING').length;
  const today = new Date().toDateString();
  const approvedToday = MOCK_HISTORY.filter(
    (h) => h.finalDecision === 'APPROVED' && new Date(h.decidedAt).toDateString() === today,
  ).length;
  const rejectedToday = MOCK_HISTORY.filter(
    (h) => h.finalDecision === 'REJECTED' && new Date(h.decidedAt).toDateString() === today,
  ).length;
  const pendingItems = items.filter((i) => i.status === 'PENDING');
  const avg = pendingItems.length > 0
    ? Math.round(pendingItems.reduce((s, i) => s + i.daysInQueue, 0) / pendingItems.length)
    : 0;
  return { pendingCount: pending, approvedToday, rejectedToday, avgDaysInQueue: avg };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const ALL_APPROVALS = [...MOCK_APPROVALS, ...RESOLVED_APPROVALS];

/**
 * Add an invoice to the approvals queue from outside (e.g., when pricing is accepted).
 * Called by the invoice mock handler when status transitions to 'approved'.
 */
export function addToApprovalQueue(invoice: {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  buyerName: string;
  faceValue: number;
  riskScore: number | null;
  riskLevel: string | null;
}): void {
  // Avoid duplicates
  if (ALL_APPROVALS.some((a) => a.invoiceId === invoice.id)) return;

  const entry: ApprovalQueueItem = {
    id: `apr_live_${Date.now()}`,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    supplierName: invoice.supplierName,
    buyerName: invoice.buyerName,
    faceValue: invoice.faceValue,
    riskScore: invoice.riskScore,
    riskLevel: invoice.riskLevel as ApprovalQueueItem['riskLevel'],
    submittedAt: new Date().toISOString(),
    daysInQueue: 0,
    currentTier: invoice.faceValue >= 200_000_000 ? 'TIER_3' : 'TIER_2',
    status: 'PENDING',
  };
  ALL_APPROVALS.push(entry);
}

export const approvalsHandlers = [

  // GET /api/approvals — serve mock data (passthrough causes 401 logout when JWT is mock-issued)
  http.get('/api/approvals', async ({ request }) => {
    await delay(350);
    const url   = new URL(request.url);
    const tab   = url.searchParams.get('tab') ?? 'pending';
    const search = url.searchParams.get('search') ?? '';
    const page  = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    let items = [...ALL_APPROVALS];

    if (tab === 'pending')  items = items.filter((i) => i.status === 'PENDING');
    if (tab === 'approved') items = items.filter((i) => i.status === 'APPROVED');
    if (tab === 'rejected') items = items.filter((i) => i.status === 'REJECTED');

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.supplierName.toLowerCase().includes(q) ||
          i.buyerName.toLowerCase().includes(q),
      );
    }

    const sortBy  = url.searchParams.get('sort_by')  ?? 'submitted_at';
    const sortDir = url.searchParams.get('sort_dir') ?? 'desc';

    items.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortBy === 'face_value')    { av = a.faceValue;    bv = b.faceValue; }
      if (sortBy === 'risk_score')    { av = a.riskScore ?? 0; bv = b.riskScore ?? 0; }
      if (sortBy === 'days_in_queue') { av = a.daysInQueue; bv = b.daysInQueue; }
      if (sortBy === 'supplier_name') { av = a.supplierName; bv = b.supplierName; }
      if (sortBy === 'submitted_at')  { av = a.submittedAt;  bv = b.submittedAt; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const total      = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const slice      = items.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json<PaginatedApprovals>({
      data:        slice,
      total,
      page,
      pageSize,
      totalPages,
      stats:       computeStats(ALL_APPROVALS),
    });
  }),

  // GET /api/approvals/history
  http.get('/api/approvals/history', async ({ request }) => {
    await delay(300);
    const url      = new URL(request.url);
    const decision = url.searchParams.get('decision');
    const search   = url.searchParams.get('search') ?? '';
    const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '10', 10));

    let items = [...MOCK_HISTORY];

    if (decision) {
      items = items.filter((h) => h.finalDecision === decision);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (h) =>
          h.invoiceNumber.toLowerCase().includes(q) ||
          h.supplierName.toLowerCase().includes(q) ||
          h.buyerName.toLowerCase().includes(q),
      );
    }

    const total      = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const slice      = items.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json<PaginatedApprovalHistory>({
      data: slice, total, page, pageSize, totalPages,
    });
  }),

  // GET /api/approvals/:invoiceId
  http.get('/api/approvals/:invoiceId', async ({ params }) => {
    const item = ALL_APPROVALS.find((a) => a.invoiceId === params.invoiceId);
    if (!item) return passthrough();
    await delay(300);
    return HttpResponse.json<ApprovalDetail>(buildApprovalDetail(item));
  }),

  // POST /api/approvals/:invoiceId/approve
  http.post('/api/approvals/:invoiceId/approve', async ({ params }) => {
    const idx = ALL_APPROVALS.findIndex((a) => a.invoiceId === params.invoiceId);
    if (idx === -1) return passthrough();
    await delay(450);
    ALL_APPROVALS[idx] = { ...ALL_APPROVALS[idx], status: 'APPROVED' };
    MOCK_HISTORY.push({
      id:             `hist_live_${Date.now()}`,
      invoiceId:      ALL_APPROVALS[idx].invoiceId,
      invoiceNumber:  ALL_APPROVALS[idx].invoiceNumber,
      supplierName:   ALL_APPROVALS[idx].supplierName,
      buyerName:      ALL_APPROVALS[idx].buyerName,
      faceValue:      ALL_APPROVALS[idx].faceValue,
      riskScore:      ALL_APPROVALS[idx].riskScore,
      riskLevel:      ALL_APPROVALS[idx].riskLevel,
      finalDecision:  'APPROVED',
      decidedBy:      'Current User',
      decidedAt:      todayISO(),
      tier:           ALL_APPROVALS[idx].currentTier,
      reason:         null,
    });
    // Keep invoice at 'approved' status — Finance Manager does first auth on the invoice detail page
    return HttpResponse.json<ApprovalDetail>(buildApprovalDetail(ALL_APPROVALS[idx]));
  }),

  // POST /api/approvals/:invoiceId/reject
  http.post('/api/approvals/:invoiceId/reject', async ({ params, request }) => {
    const idx  = ALL_APPROVALS.findIndex((a) => a.invoiceId === params.invoiceId);
    if (idx === -1) return passthrough();
    await delay(450);
    const body = await request.json() as { reason?: string };
    ALL_APPROVALS[idx] = { ...ALL_APPROVALS[idx], status: 'REJECTED' };
    MOCK_HISTORY.push({
      id:             `hist_live_${Date.now()}`,
      invoiceId:      ALL_APPROVALS[idx].invoiceId,
      invoiceNumber:  ALL_APPROVALS[idx].invoiceNumber,
      supplierName:   ALL_APPROVALS[idx].supplierName,
      buyerName:      ALL_APPROVALS[idx].buyerName,
      faceValue:      ALL_APPROVALS[idx].faceValue,
      riskScore:      ALL_APPROVALS[idx].riskScore,
      riskLevel:      ALL_APPROVALS[idx].riskLevel,
      finalDecision:  'REJECTED',
      decidedBy:      'Current User',
      decidedAt:      todayISO(),
      tier:           ALL_APPROVALS[idx].currentTier,
      reason:         body.reason ?? null,
    });
    // Also update the invoice status to rejected in the invoices store
    const invIdx = MOCK_INVOICES.findIndex((inv) => inv.id === params.invoiceId);
    if (invIdx !== -1) {
      MOCK_INVOICES[invIdx] = {
        ...MOCK_INVOICES[invIdx],
        status: 'rejected' as InvoiceStatus,
        updatedAt: new Date().toISOString(),
      };
    }
    return HttpResponse.json<ApprovalDetail>(buildApprovalDetail(ALL_APPROVALS[idx]));
  }),

  // POST /api/approvals/:invoiceId/request-info
  http.post('/api/approvals/:invoiceId/request-info', async ({ params }) => {
    const idx = ALL_APPROVALS.findIndex((a) => a.invoiceId === params.invoiceId);
    if (idx === -1) return passthrough();
    await delay(350);
    ALL_APPROVALS[idx] = { ...ALL_APPROVALS[idx], status: 'ESCALATED' };
    return HttpResponse.json<ApprovalDetail>(buildApprovalDetail(ALL_APPROVALS[idx]));
  }),
];
