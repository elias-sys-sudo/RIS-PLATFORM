import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { PoolClient } from 'pg';

// Mock the repository before importing the service
jest.mock('../../../src/services/complaints/complaints.repository');
jest.mock('../../../src/shared/database/pool', () => ({
  pool: { connect: jest.fn() },
  beginWithRls: jest.fn(),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    audit: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import * as repo from '../../../src/services/complaints/complaints.repository';
import * as service from '../../../src/services/complaints/complaints.service';
import { ComplaintStatus } from '../../../src/services/complaints/complaints.types';
import { NotFoundError } from '../../../src/shared/errors';

const mockRepo = jest.mocked(repo);

// Build a mock PoolClient
function buildMockClient(): PoolClient {
  return {
    query: jest.fn<() => Promise<{ rows: unknown[] }>>().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  } as unknown as PoolClient;
}

const IP = '127.0.0.1';
const UA = 'test-agent';

describe('ComplaintsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fileComplaint', () => {
    it('creates a complaint with OPEN status for small amounts', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.createComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      const result = await service.fileComplaint(
        'user-1',
        {
          entity_type: 'invoice',
          subject: 'Test complaint',
          description: 'Something is wrong',
          category: 'BILLING',
          amount_involved: 1_000_000,
        },
        IP,
        UA,
      );

      expect(result.id).toBeDefined();
      expect(mockRepo.createComplaintWithClient).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          complainantId: 'user-1',
          status: ComplaintStatus.OPEN,
          escalated: false,
          priority: 'NORMAL',
        }),
      );
    });

    it('auto-escalates when amount_involved >= 5,000,000 UGX', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.createComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.fileComplaint(
        'user-1',
        {
          entity_type: 'invoice',
          subject: 'High value complaint',
          description: 'Issue with large invoice',
          category: 'PAYMENT',
          amount_involved: 5_000_000,
        },
        IP,
        UA,
      );

      expect(mockRepo.createComplaintWithClient).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          status: ComplaintStatus.ESCALATED,
          escalated: true,
          priority: 'HIGH',
        }),
      );
    });

    it('auto-escalates when amount_involved exceeds 5M threshold', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.createComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.fileComplaint(
        'user-1',
        {
          entity_type: 'invoice',
          subject: 'Very high value complaint',
          description: 'Major issue',
          category: 'PAYMENT',
          amount_involved: 10_000_000,
        },
        IP,
        UA,
      );

      expect(mockRepo.createComplaintWithClient).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          status: ComplaintStatus.ESCALATED,
          escalated: true,
        }),
      );
    });

    it('writes audit log inside the transaction', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.createComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.fileComplaint(
        'user-1',
        {
          entity_type: 'invoice',
          subject: 'Test',
          description: 'Description',
          category: 'GENERAL',
        },
        IP,
        UA,
      );

      expect(mockRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        mockClient,
        'user-1',
        'COMPLAINT_FILED',
        'complaints',
        expect.any(String),
        null,
        expect.objectContaining({ status: ComplaintStatus.OPEN }),
        IP,
        UA,
      );
    });

    it('rolls back transaction on error', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.createComplaintWithClient.mockRejectedValue(new Error('DB error'));

      await expect(
        service.fileComplaint(
          'user-1',
          {
            entity_type: 'invoice',
            subject: 'Test',
            description: 'Description',
            category: 'GENERAL',
          },
          IP,
          UA,
        ),
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getComplaint', () => {
    it('returns complaint when found', async () => {
      const mockRecord = {
        id: 'complaint-1',
        complainant_id: 'user-1',
        entity_type: 'invoice',
        entity_id: null,
        subject: 'Test',
        description: 'Desc',
        category: 'GENERAL',
        priority: 'NORMAL',
        status: 'OPEN',
        assigned_to: null,
        resolution: null,
        amount_involved: '0',
        escalated: false,
        resolved_at: null,
        resolved_by: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      mockRepo.getComplaintById.mockResolvedValue(mockRecord);

      const result = await service.getComplaint('complaint-1');
      expect(result.id).toBe('complaint-1');
    });

    it('throws NotFoundError when complaint does not exist', async () => {
      mockRepo.getComplaintById.mockResolvedValue(null);
      await expect(service.getComplaint('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('resolveComplaint', () => {
    it('resolves an open complaint', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.getComplaintById.mockResolvedValue({
        id: 'complaint-1',
        complainant_id: 'user-1',
        entity_type: 'invoice',
        entity_id: null,
        subject: 'Test',
        description: 'Desc',
        category: 'GENERAL',
        priority: 'NORMAL',
        status: 'OPEN',
        assigned_to: null,
        resolution: null,
        amount_involved: '0',
        escalated: false,
        resolved_at: null,
        resolved_by: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      mockRepo.resolveComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.resolveComplaint('complaint-1', 'Resolution text', 'officer-1', IP, UA);

      expect(mockRepo.resolveComplaintWithClient).toHaveBeenCalledWith(
        mockClient,
        'complaint-1',
        'Resolution text',
        'officer-1',
      );
    });

    it('throws BusinessRuleError when already resolved', async () => {
      mockRepo.getComplaintById.mockResolvedValue({
        id: 'complaint-1',
        complainant_id: 'user-1',
        entity_type: 'invoice',
        entity_id: null,
        subject: 'Test',
        description: 'Desc',
        category: 'GENERAL',
        priority: 'NORMAL',
        status: 'RESOLVED',
        assigned_to: null,
        resolution: 'Already done',
        amount_involved: '0',
        escalated: false,
        resolved_at: '2024-01-02T00:00:00Z',
        resolved_by: 'officer-1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      });

      await expect(
        service.resolveComplaint('complaint-1', 'New resolution', 'officer-2', IP, UA),
      ).rejects.toMatchObject({ errorCode: 'COMPLAINT_ALREADY_RESOLVED' });
    });

    it('throws NotFoundError when complaint does not exist', async () => {
      mockRepo.getComplaintById.mockResolvedValue(null);
      await expect(
        service.resolveComplaint('nonexistent', 'Resolution', 'officer-1', IP, UA),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('escalateComplaint', () => {
    it('escalates an open complaint', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.getComplaintById.mockResolvedValue({
        id: 'complaint-1',
        complainant_id: 'user-1',
        entity_type: 'invoice',
        entity_id: null,
        subject: 'Test',
        description: 'Desc',
        category: 'GENERAL',
        priority: 'NORMAL',
        status: 'OPEN',
        assigned_to: null,
        resolution: null,
        amount_involved: '0',
        escalated: false,
        resolved_at: null,
        resolved_by: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      mockRepo.escalateComplaintWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.escalateComplaint('complaint-1', 'Urgent issue', 'officer-1', IP, UA);

      expect(mockRepo.escalateComplaintWithClient).toHaveBeenCalledWith(mockClient, 'complaint-1');
    });

    it('throws BusinessRuleError when complaint is already closed', async () => {
      mockRepo.getComplaintById.mockResolvedValue({
        id: 'complaint-1',
        complainant_id: 'user-1',
        entity_type: 'invoice',
        entity_id: null,
        subject: 'Test',
        description: 'Desc',
        category: 'GENERAL',
        priority: 'NORMAL',
        status: 'CLOSED',
        assigned_to: null,
        resolution: 'Done',
        amount_involved: '0',
        escalated: false,
        resolved_at: '2024-01-02T00:00:00Z',
        resolved_by: 'officer-1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      });

      await expect(
        service.escalateComplaint('complaint-1', 'Reason', 'officer-2', IP, UA),
      ).rejects.toMatchObject({ errorCode: 'COMPLAINT_ALREADY_RESOLVED' });
    });
  });

  describe('listComplaints', () => {
    it('returns paginated results', async () => {
      mockRepo.findAllComplaints.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.listComplaints({}, { page: 1, limit: 20 });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(0);
    });
  });
});
