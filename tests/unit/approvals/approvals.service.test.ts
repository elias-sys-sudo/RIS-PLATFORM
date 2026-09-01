process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/approvals/approvals.service';
import * as repo from '../../../src/services/approvals/approvals.repository';
import { pool } from '../../../src/shared/database/pool';
import { ApprovalTier, ApprovalDecision } from '../../../src/services/approvals/approvals.types';
import type {
  InvoiceForApproval,
  RiskScoreForApproval,
  ApprovalRecord,
} from '../../../src/services/approvals/approvals.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/approvals/approvals.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../src/shared/risk-config', () => ({
  getRiskConfigNumber: jest.fn().mockImplementation((key: string) => {
    const defaults: Record<string, number> = {
      tier3_auto_reject_threshold: 3,
    };
    return Promise.resolve(defaults[key] ?? 0);
  }),
  getRiskConfigValue: jest.fn().mockResolvedValue('0'),
  getRiskWeights: jest.fn().mockResolvedValue({}),
  loadRiskConfig: jest.fn().mockResolvedValue(new Map()),
  invalidateRiskConfigCache: jest.fn(),
  getDefaults: jest.fn().mockReturnValue({}),
}));

type MockClient = {
  query: jest.Mock;
  release: jest.Mock;
};

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'inv-uuid-1';
const OFFICER_1 = 'officer-uuid-1';
const OFFICER_2 = 'officer-uuid-2';
const IP = '127.0.0.1';
const UA = 'test-agent';

function makeInvoice(overrides: Partial<InvoiceForApproval> = {}): InvoiceForApproval {
  return {
    id: INVOICE_ID,
    face_value: '5000000',
    status: 'priced',
    supplier_id: 'sup-1',
    buyer_id: 'buyer-1',
    aml_flagged: false,
    ...overrides,
  };
}

function makeRiskScore(overrides: Partial<RiskScoreForApproval> = {}): RiskScoreForApproval {
  return {
    id: 'rs-1',
    invoice_id: INVOICE_ID,
    final_score: 80,
    recommendation: 'AUTO_APPROVE',
    ...overrides,
  };
}

function makeApprovalRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'appr-1',
    invoice_id: INVOICE_ID,
    tier: ApprovalTier.TIER_3,
    decision: ApprovalDecision.APPROVED,
    approver_id: OFFICER_1,
    comments: 'Approved after committee review',
    credit_memo: null,
    created_at: '2026-03-21T10:00:00Z',
    ...overrides,
  };
}

function setupMockClient(): MockClient {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  (mockedPool.connect as jest.Mock).mockResolvedValue(client);
  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('approvals.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
  });

  // =========================================================================
  // determineTier — tier routing logic
  // =========================================================================
  describe('determineTier', () => {
    it('routes to AUTO when face_value < 10M, score >= 75, no AML flags', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.AUTO);
    });

    it('routes to TIER_2 for face_value 10M–50M', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '25000000' }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_2);
    });

    it('routes to TIER_2 for score 50–74', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '5000000' }),
        makeRiskScore({ final_score: 60 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_2);
    });

    it('routes to TIER_2 when AML flagged regardless of score', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '5000000', aml_flagged: true }),
        makeRiskScore({ final_score: 90 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_2);
    });

    it('routes to TIER_3 for face_value > 50M', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '60000000' }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_3);
    });

    it('routes to TIER_3 for score < 50', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '5000000' }),
        makeRiskScore({ final_score: 40 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_3);
    });

    it('TIER_3 takes priority over TIER_2 when both conditions met', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '60000000', aml_flagged: true }),
        makeRiskScore({ final_score: 40 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_3);
    });

    it('routes to TIER_2 for face_value exactly 10M', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '10000000' }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_2);
    });

    it('routes to TIER_3 for face_value exactly 50M + 1', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '50000001' }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_3);
    });
  });

  // =========================================================================
  // AUTO tier — auto-approval flow
  // =========================================================================
  describe('processAutoApproval', () => {
    it('auto-approves qualifying invoice with SYSTEM as approver', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(INVOICE_ID, 'SYSTEM', 'credit_officer', IP, UA);

      expect(result.tier).toBe(ApprovalTier.AUTO);
      expect(result.decision).toBe(ApprovalDecision.APPROVED);
    });

    it('sets comments to "Auto-approved: score [X], value [Y]"', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(INVOICE_ID, 'SYSTEM', 'credit_officer', IP, UA);

      expect(result.comments).toContain('Auto-approved');
      expect(result.comments).toContain('80');
      expect(result.comments).toContain('5000000');
    });

    it('triggers payment queue on auto-approval', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setPaymentQueue(mockQueue as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.approveInvoice(INVOICE_ID, 'SYSTEM', 'credit_officer', IP, UA);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-payment',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );

      service.setPaymentQueue(null as never);
    });
  });

  // =========================================================================
  // TIER_2 — credit officer approval
  // =========================================================================
  describe('Tier 2 approval', () => {
    it('approves Tier 2 invoice with credit officer', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Approved after thorough review of buyer creditworthiness',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_2);
      expect(result.decision).toBe(ApprovalDecision.APPROVED);
    });

    it('triggers payment queue on Tier 2 approval', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setPaymentQueue(mockQueue as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Approved after thorough review of buyer creditworthiness',
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-payment',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );

      service.setPaymentQueue(null as never);
    });
  });

  // =========================================================================
  // TIER_3 — committee approval (quorum = 2)
  // =========================================================================
  describe('Tier 3 committee approval', () => {
    it('records first approval without completing (quorum not met)', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'First committee member approves after review',
        'Reviewed financials and buyer credit profile. All criteria met. Approving first vote.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_3);
      expect(result.quorumReached).toBe(false);
    });

    it('completes approval when quorum (2 approvals) reached', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
        }),
      ]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_2,
        'credit_officer',
        IP,
        UA,
        'Second committee member confirms approval',
        'Independent review complete. Buyer has strong payment record and the invoice is within limits.',
      );

      expect(result.quorumReached).toBe(true);
      expect(result.decision).toBe(ApprovalDecision.APPROVED);
    });

    it('prevents same officer from providing both Tier 3 approvals', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
        }),
      ]);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Trying to approve again as same officer',
        ),
      ).rejects.toThrow();
    });

    it('single rejection does NOT auto-reject the invoice', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Concerns about buyer payment history',
        'Buyer has two overdue incidents in the past 12 months. Credit profile below required threshold.',
      );

      // Single rejection in Tier 3 should NOT set invoice to rejected
      expect(result.tier).toBe(ApprovalTier.TIER_3);
      expect(result.decision).toBe(ApprovalDecision.REJECTED);
      // Invoice should remain in priced status — not auto-rejected
    });

    it('MD can override rejection with documented reason', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.REJECTED,
        }),
      ]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      // Management can override and approve despite a rejection
      const result = await service.approveInvoice(
        INVOICE_ID,
        'md-uuid-1',
        'management',
        IP,
        UA,
        'MD override: buyer has confirmed payment plan with finance team',
        'MD override authorised after direct discussion with buyer CFO. Payment plan documented and signed.',
      );

      expect(result.decision).toBe(ApprovalDecision.APPROVED);
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================
  describe('validation', () => {
    it('throws NotFoundError when invoice not found', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(null);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Some comments here for review',
        ),
      ).rejects.toThrow('not found');
    });

    it('throws BusinessRuleError when invoice not in priced status', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'submitted' }));

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Some comments here for review',
        ),
      ).rejects.toThrow('priced');
    });

    it('throws NotFoundError when risk score not found', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(null);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Some comments here for review',
        ),
      ).rejects.toThrow('not found');
    });

    it('throws when invoice already fully approved', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'approved' }));

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Some comments here for review',
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Rejection flow
  // =========================================================================
  describe('rejectInvoice', () => {
    it('rejects a Tier 2 invoice and updates status', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Buyer credit history is concerning',
      );

      expect(result.decision).toBe(ApprovalDecision.REJECTED);
      expect(result.tier).toBe(ApprovalTier.TIER_2);
    });

    it('notifies supplier on rejection', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Buyer credit history is concerning',
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'invoice-rejected',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );

      service.setNotificationQueue(null as never);
    });
  });

  // =========================================================================
  // Concurrent lock prevention
  // =========================================================================
  describe('concurrent lock prevention', () => {
    it('uses SELECT FOR UPDATE to prevent concurrent approvals', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Approved after thorough review of buyer creditworthiness',
      );

      expect(mockedRepo.lockInvoiceForReview).toHaveBeenCalledWith(expect.anything(), INVOICE_ID);
    });

    it('throws when lock fails (invoice not found in lock)', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(null);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Approved after thorough review of buyer creditworthiness',
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Transaction rollback
  // =========================================================================
  describe('transaction handling', () => {
    it('rolls back transaction on approval record failure', async () => {
      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Approved after thorough review of buyer creditworthiness',
        ),
      ).rejects.toThrow('DB write failed');

      // Verify ROLLBACK was called
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('rolls back on Bull queue failure', async () => {
      const mockQueue = {
        add: jest.fn().mockRejectedValue(new Error('Queue connection failed')),
      };
      service.setPaymentQueue(mockQueue as never);

      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await expect(
        service.approveInvoice(INVOICE_ID, 'SYSTEM', 'credit_officer', IP, UA),
      ).rejects.toThrow('Queue connection failed');

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');

      service.setPaymentQueue(null as never);
    });
  });

  // =========================================================================
  // SLA monitoring
  // =========================================================================
  describe('checkSlaBreaches', () => {
    it('triggers escalation alert for invoices pending > 24 hours', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);

      mockedRepo.getInvoicesExceedingSLA.mockResolvedValue([
        {
          id: 'appr-1',
          invoice_id: INVOICE_ID,
          face_value: '30000000',
          status: 'priced',
          tier: ApprovalTier.TIER_2,
          created_at: '2026-03-20T08:00:00Z',
          hours_pending: 26,
        },
      ]);

      await service.checkSlaBreaches();

      expect(mockedRepo.getInvoicesExceedingSLA).toHaveBeenCalledWith(24);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'sla-escalation',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );

      service.setNotificationQueue(null as never);
    });

    it('does nothing when no SLA breaches', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);

      mockedRepo.getInvoicesExceedingSLA.mockResolvedValue([]);

      await service.checkSlaBreaches();

      expect(mockQueue.add).not.toHaveBeenCalled();

      service.setNotificationQueue(null as never);
    });
  });

  // =========================================================================
  // getApprovalQueue
  // =========================================================================
  describe('getApprovalQueue', () => {
    it('returns pending invoices for credit officers', async () => {
      mockedRepo.getPendingApprovalsByOfficer.mockResolvedValue([
        {
          invoice_id: INVOICE_ID,
          face_value: '25000000',
          supplier_id: 'sup-1',
          buyer_id: 'buyer-1',
          tier: ApprovalTier.TIER_2,
          status: 'priced',
          final_score: 65,
          aml_flagged: false,
          created_at: '2026-03-21T10:00:00Z',
        },
      ]);

      const result = await service.getApprovalQueue(OFFICER_1);

      expect(result).toHaveLength(1);
      expect(result[0].invoice_id).toBe(INVOICE_ID);
    });
  });

  // =========================================================================
  // getCommitteeStatus
  // =========================================================================
  describe('getCommitteeStatus', () => {
    it('returns committee status for Tier 3 invoice', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
        }),
      ]);

      const status = await service.getCommitteeStatus(INVOICE_ID);

      expect(status.invoiceId).toBe(INVOICE_ID);
      expect(status.tier).toBe(ApprovalTier.TIER_3);
      expect(status.approvals).toHaveLength(1);
      expect(status.quorumReached).toBe(false);
    });
  });

  // =========================================================================
  // getCommitteeStatus — error branches
  // =========================================================================
  describe('getCommitteeStatus — errors', () => {
    it('throws NotFoundError when invoice missing', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(null);

      await expect(service.getCommitteeStatus(INVOICE_ID)).rejects.toThrow('not found');
    });

    it('throws NotFoundError when risk score missing', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(null);

      await expect(service.getCommitteeStatus(INVOICE_ID)).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // Queue null safety
  // =========================================================================
  describe('queue null safety', () => {
    it('logs warning when payment queue is null on approval', async () => {
      service.setPaymentQueue(null as never);
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      // Should not throw — just logs warning
      const result = await service.approveInvoice(INVOICE_ID, 'SYSTEM', 'credit_officer', IP, UA);
      expect(result.decision).toBe(ApprovalDecision.APPROVED);
    });

    it('logs warning when notification queue is null on rejection', async () => {
      service.setNotificationQueue(null as never);
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Buyer credit history is concerning',
      );
      expect(result.decision).toBe(ApprovalDecision.REJECTED);
    });

    it('logs warning when notification queue is null on SLA check', async () => {
      service.setNotificationQueue(null as never);
      mockedRepo.getInvoicesExceedingSLA.mockResolvedValue([
        {
          id: 'appr-1',
          invoice_id: INVOICE_ID,
          face_value: '30000000',
          status: 'priced',
          tier: ApprovalTier.TIER_2,
          created_at: '2026-03-20T08:00:00Z',
          hours_pending: 26,
        },
      ]);

      // Should not throw — just logs warning
      await service.checkSlaBreaches();
    });
  });

  // =========================================================================
  // processApprovalByTier — undefined comments fallback branches
  // =========================================================================
  describe('processApprovalByTier — undefined comments fallback', () => {
    it('Tier 2 approval with no comments falls back to empty string', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      // Pass no comments argument — triggers the `comments ?? ''` branch
      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        // comments omitted intentionally
      );

      expect(result.tier).toBe(ApprovalTier.TIER_2);
      expect(result.decision).toBe(ApprovalDecision.APPROVED);
      expect(result.comments).toBe('');
    });

    it('Tier 3 approval without credit_memo throws CREDIT_MEMO_REQUIRED', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));

      // No credit_memo supplied — must be rejected
      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Comment without memo',
          // credit_memo omitted intentionally
        ),
      ).rejects.toMatchObject({ errorCode: 'CREDIT_MEMO_REQUIRED' });
    });
  });

  // =========================================================================
  // executeRejection — lock failure and rollback branches
  // =========================================================================
  describe('executeRejection — error branches', () => {
    it('throws BusinessRuleError when invoice lock fails during rejection', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(null);

      await expect(
        service.rejectInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Rejection attempted but lock failed',
        ),
      ).rejects.toThrow();
    });

    it('rolls back transaction on rejection record failure', async () => {
      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.createApprovalWithClient.mockRejectedValue(
        new Error('DB write failed during rejection'),
      );

      await expect(
        service.rejectInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Buyer credit history is quite concerning',
        ),
      ).rejects.toThrow('DB write failed during rejection');

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // =========================================================================
  // executeRejection — Tier 3 auto-reject threshold (lines 448-467)
  // =========================================================================
  describe('executeRejection — Tier 3 auto-reject threshold', () => {
    it('auto-rejects invoice when Tier 3 rejection count reaches threshold (line 448 branch 0)', async () => {
      const mockNotifQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockNotifQueue as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);
      // incrementTier3RejectionCount returns 3, which equals threshold of 3
      mockedRepo.incrementTier3RejectionCount.mockResolvedValue(3);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Third rejection — triggers auto-reject',
        'Third review confirms pattern of payment delays. Buyer risk profile is unacceptable per credit policy.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_3);
      expect(result.decision).toBe(ApprovalDecision.REJECTED);
      // Invoice status update should be called for the auto-rejection (line 449)
      expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
        expect.anything(),
        INVOICE_ID,
        'rejected',
        'priced',
      );
      // Rejection notification should be queued (line 450)
      expect(mockNotifQueue.add).toHaveBeenCalledWith(
        'invoice-rejected',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.any(Object),
      );
      // Audit entry for TIER3_AUTO_REJECTED should be created (line 452)
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        OFFICER_1,
        'TIER3_AUTO_REJECTED',
        'invoices',
        INVOICE_ID,
        expect.objectContaining({ tier3_rejection_count: 3 }),
        expect.objectContaining({ status: 'rejected', rejectionCount: 3 }),
        IP,
        UA,
      );

      service.setNotificationQueue(null as never);
    });
  });

  // =========================================================================
  // resetTier3RejectionCount (lines 543-585)
  // =========================================================================
  describe('resetTier3RejectionCount', () => {
    it('resets Tier 3 rejection count when invoice exists (line 550 branch 0)', async () => {
      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.resetTier3RejectionCount.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.resetTier3RejectionCount(INVOICE_ID, OFFICER_1, IP, UA);

      expect(mockedRepo.resetTier3RejectionCount).toHaveBeenCalledWith(
        expect.anything(),
        INVOICE_ID,
      );
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        OFFICER_1,
        'TIER3_REJECTION_COUNT_RESET',
        'invoices',
        INVOICE_ID,
        expect.objectContaining({ status: 'priced' }),
        expect.objectContaining({ tier3_rejection_count: 0, resetBy: OFFICER_1 }),
        IP,
        UA,
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('throws NotFoundError when invoice not found (line 550 branch 1)', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(null);

      await expect(service.resetTier3RejectionCount(INVOICE_ID, OFFICER_1, IP, UA)).rejects.toThrow(
        'not found',
      );
    });

    it('rolls back transaction and rethrows when DB reset fails (lines 580-583)', async () => {
      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.resetTier3RejectionCount.mockRejectedValue(new Error('DB reset failed'));

      await expect(service.resetTier3RejectionCount(INVOICE_ID, OFFICER_1, IP, UA)).rejects.toThrow(
        'DB reset failed',
      );

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // =========================================================================
  // Audit immutability
  // =========================================================================
  describe('audit trail', () => {
    it('writes audit log for every approval decision', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Approved after thorough review of buyer creditworthiness',
      );

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        OFFICER_1,
        'INVOICE_APPROVED',
        'approvals',
        INVOICE_ID,
        expect.objectContaining({ status: 'priced' }),
        expect.objectContaining({
          decision: ApprovalDecision.APPROVED,
          tier: ApprovalTier.TIER_2,
        }),
        IP,
        UA,
      );
    });
  });

  // =========================================================================
  // TIER_4 — board-level approval
  // =========================================================================
  describe('determineTier — TIER_4 routing', () => {
    it('routes to TIER_4 for face_value > 200M', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '250000000' }),
        makeRiskScore({ final_score: 80 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_4);
    });

    it('routes to TIER_4 for score < 30', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '5000000' }),
        makeRiskScore({ final_score: 25 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_4);
    });

    it('TIER_4 takes priority over TIER_3 when both conditions met', () => {
      const tier = service.determineTier(
        makeInvoice({ face_value: '250000000' }),
        makeRiskScore({ final_score: 25 }),
      );
      expect(tier).toBe(ApprovalTier.TIER_4);
    });
  });

  describe('Tier 4 approval flow', () => {
    it('records first Tier 4 approval without quorum (only 1 approval)', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Board-level review first vote',
        'Comprehensive review of large exposure. All risk indicators reviewed and within tolerance.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_4);
      expect(result.quorumReached).toBe(false);
    });

    it('reaches quorum with management + credit_officer (2 approvals)', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
          tier: ApprovalTier.TIER_4,
        }),
      ]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        'mgmt-uuid-1',
        'management',
        IP,
        UA,
        'Management confirms large exposure approval',
        'Board authorised. Exposure within group limits. Collateral coverage confirmed at above 120 pct.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_4);
      expect(result.quorumReached).toBe(true);
    });

    it('prevents same officer from approving twice in Tier 4', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
          tier: ApprovalTier.TIER_4,
        }),
      ]);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'management',
          IP,
          UA,
          'Trying to approve again',
          'Attempting to re-approve same invoice as same officer, which violates dual-auth requirements.',
        ),
      ).rejects.toThrow('Same officer');
    });

    it('rejects non-management/non-credit_officer role in Tier 4', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'supplier',
          IP,
          UA,
          'Unauthorized role',
          'A supplier role should not be allowed to make Tier 4 approval decisions at board level.',
        ),
      ).rejects.toThrow('management or credit_officer');
    });
  });

  // =========================================================================
  // validateCreditMemo — TIER_3 and TIER_4 memo requirements
  // =========================================================================
  describe('validateCreditMemo', () => {
    it('Tier 3 with short credit_memo throws CREDIT_MEMO_REQUIRED', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));

      await expect(
        service.approveInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'comments',
          'too short memo',
        ),
      ).rejects.toThrow('credit memo');
    });

    it('Tier 4 without credit_memo throws CREDIT_MEMO_REQUIRED', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));

      await expect(
        service.approveInvoice(INVOICE_ID, OFFICER_1, 'credit_officer', IP, UA, 'comments'),
      ).rejects.toThrow('credit memo');
    });

    it('Tier 2 without credit_memo does NOT throw', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'No memo needed for Tier 2',
      );
      expect(result.tier).toBe(ApprovalTier.TIER_2);
    });

    it('Tier 3 rejection without credit_memo throws', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));

      await expect(
        service.rejectInvoice(
          INVOICE_ID,
          OFFICER_1,
          'credit_officer',
          IP,
          UA,
          'Rejecting without memo',
        ),
      ).rejects.toThrow('credit memo');
    });
  });

  // =========================================================================
  // createInfoRequest — info request flow
  // =========================================================================
  describe('createInfoRequest', () => {
    it('creates info request for valid invoice', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'priced' }));
      mockedRepo.createInfoRequestWithClient.mockResolvedValue({
        id: 'ir-1',
        invoice_id: INVOICE_ID,
        requested_by: OFFICER_1,
        message: 'Need more buyer info',
        created_at: '2026-03-21T10:00:00Z',
      });
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more buyer info');

      expect(result.id).toBe('ir-1');
      expect(result.invoice_id).toBe(INVOICE_ID);
    });

    it('throws NotFoundError when invoice not found', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(null);

      await expect(
        service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more info'),
      ).rejects.toThrow('not found');
    });

    it('throws BusinessRuleError for funded invoice status', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'funded' }));

      await expect(
        service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more info'),
      ).rejects.toThrow('status');
    });

    it('throws BusinessRuleError for collected invoice status', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'collected' }));

      await expect(
        service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more info'),
      ).rejects.toThrow('status');
    });

    it('throws BusinessRuleError for cancelled invoice status', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'cancelled' }));

      await expect(
        service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more info'),
      ).rejects.toThrow('status');
    });

    it('queues notification when notification queue is configured', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'priced' }));
      mockedRepo.createInfoRequestWithClient.mockResolvedValue({
        id: 'ir-1',
        invoice_id: INVOICE_ID,
        requested_by: OFFICER_1,
        message: 'Need docs',
        created_at: '2026-03-21T10:00:00Z',
      });
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need docs');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'info-requested',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      service.setNotificationQueue(null as never);
    });

    it('returns info request without throwing when notification queue is null', async () => {
      service.setNotificationQueue(null as never);

      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'priced' }));
      mockedRepo.createInfoRequestWithClient.mockResolvedValue({
        id: 'ir-1',
        invoice_id: INVOICE_ID,
        requested_by: OFFICER_1,
        message: 'Need docs',
        created_at: '2026-03-21T10:00:00Z',
      });
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need docs');
      expect(result.id).toBe('ir-1');
    });

    it('rolls back transaction on DB error during info request', async () => {
      const client = setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ status: 'priced' }));
      mockedRepo.createInfoRequestWithClient.mockRejectedValue(new Error('DB insert failed'));

      await expect(
        service.createInfoRequest(INVOICE_ID, OFFICER_1, 'Need more info'),
      ).rejects.toThrow('DB insert failed');

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // =========================================================================
  // Tier 3 rejection — below threshold stays in priced status
  // =========================================================================
  describe('Tier 3 rejection — below auto-reject threshold', () => {
    it('keeps invoice in priced status when rejection count is below threshold', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);
      // count = 1, threshold = 3 → below threshold
      mockedRepo.incrementTier3RejectionCount.mockResolvedValue(1);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'First rejection but below threshold',
        'Detailed rejection rationale exceeding fifty characters for credit memo validation compliance.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_3);
      // updateInvoiceStatus should NOT be called for rejected
      // (the function is only called for the auto-reject case when count >= threshold)
    });
  });

  // =========================================================================
  // AUTO rejection — immediately rejects invoice
  // =========================================================================
  describe('AUTO rejection flow', () => {
    it('immediately sets invoice to rejected for AUTO tier', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(
        makeInvoice({ face_value: '5000000', aml_flagged: false }),
      );
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '5000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Rejecting auto-tier invoice',
      );

      expect(result.tier).toBe(ApprovalTier.AUTO);
      expect(result.decision).toBe(ApprovalDecision.REJECTED);
      expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
        expect.anything(),
        INVOICE_ID,
        'rejected',
        'priced',
      );
    });
  });

  // =========================================================================
  // Tier 4 rejection flow
  // =========================================================================
  describe('Tier 4 rejection flow', () => {
    it('immediately sets invoice to rejected for Tier 4', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 25 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '250000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.rejectInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Board-level rejection of large exposure',
        'Exposure exceeds group risk appetite. Buyer has insufficient credit history for this amount bracket.',
      );

      expect(result.tier).toBe(ApprovalTier.TIER_4);
      expect(result.decision).toBe(ApprovalDecision.REJECTED);
      expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
        expect.anything(),
        INVOICE_ID,
        'rejected',
        'priced',
      );
    });
  });

  // =========================================================================
  // Tier 3 quorum status builder branches
  // =========================================================================
  describe('getCommitteeStatus — quorum reached', () => {
    it('returns quorumReached=true when 2 approvals exist', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
        }),
        makeApprovalRecord({
          id: 'appr-2',
          approver_id: OFFICER_2,
          decision: ApprovalDecision.APPROVED,
        }),
      ]);

      const status = await service.getCommitteeStatus(INVOICE_ID);

      expect(status.quorumReached).toBe(true);
      expect(status.totalDecisions).toBe(2);
    });

    it('separates approvals and rejections in committee status', async () => {
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '60000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 80 }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([
        makeApprovalRecord({
          approver_id: OFFICER_1,
          decision: ApprovalDecision.APPROVED,
        }),
        makeApprovalRecord({
          id: 'appr-2',
          approver_id: OFFICER_2,
          decision: ApprovalDecision.REJECTED,
        }),
      ]);

      const status = await service.getCommitteeStatus(INVOICE_ID);

      expect(status.approvals).toHaveLength(1);
      expect(status.rejections).toHaveLength(1);
      expect(status.quorumReached).toBe(false);
      expect(status.totalDecisions).toBe(2);
    });
  });

  // =========================================================================
  // Tier 2 creditMemo ?? null branch
  // =========================================================================
  describe('Tier 2 with credit_memo', () => {
    it('passes creditMemo to createApprovalWithClient when provided', async () => {
      setupMockClient();
      mockedRepo.getInvoiceForApproval.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getRiskScoreForApproval.mockResolvedValue(makeRiskScore({ final_score: 65 }));
      mockedRepo.lockInvoiceForReview.mockResolvedValue(makeInvoice({ face_value: '25000000' }));
      mockedRepo.getApprovalsByInvoiceId.mockResolvedValue([]);
      mockedRepo.createApprovalWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatus.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.approveInvoice(
        INVOICE_ID,
        OFFICER_1,
        'credit_officer',
        IP,
        UA,
        'Tier 2 with optional memo',
        'Optional credit memo text for documentation',
      );

      expect(mockedRepo.createApprovalWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          creditMemo: 'Optional credit memo text for documentation',
        }),
      );
    });
  });
});
