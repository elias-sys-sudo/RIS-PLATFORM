import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { PoolClient, QueryResult } from 'pg';

// Mock the pool
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = jest.fn<(...args: any[]) => Promise<QueryResult>>();
jest.mock('../../../src/shared/database/pool', () => ({
  pool: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
  query: (...args: any[]) => mockQuery(...args),
}));

import * as repo from '../../../src/services/complaints/complaints.repository';

function buildMockClient(): PoolClient {
  return {
    query: jest.fn<() => Promise<QueryResult>>().mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    }),
    release: jest.fn(),
  } as unknown as PoolClient;
}

describe('ComplaintsRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getComplaintById', () => {
    it('uses parameterised query — no string concatenation', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await repo.getComplaintById('complaint-uuid');

      const [sql, params] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).not.toContain('complaint-uuid');
      expect(params).toContain('complaint-uuid');
    });
  });

  describe('getComplaintByIdForUser', () => {
    it('enforces ownership with complainant_id in WHERE clause', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await repo.getComplaintByIdForUser('complaint-1', 'user-1');

      const [sql, params] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain('complainant_id');
      expect(sql).not.toContain('complaint-1');
      expect(sql).not.toContain('user-1');
      expect(params).toContain('complaint-1');
      expect(params).toContain('user-1');
    });

    it('returns null when no matching record', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getComplaintByIdForUser('complaint-1', 'wrong-user');
      expect(result).toBeNull();
    });
  });

  describe('createComplaintWithClient', () => {
    it('uses parameterised INSERT with all fields', async () => {
      const client = buildMockClient();

      await repo.createComplaintWithClient(client, {
        id: 'new-id',
        complainantId: 'user-1',
        entityType: 'invoice',
        entityId: 'entity-1',
        subject: 'Test subject',
        description: 'Test description',
        category: 'BILLING',
        priority: 'NORMAL',
        status: 'OPEN',
        amountInvolved: '1000000',
        escalated: false,
      });

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO complaints');
      expect(sql).not.toContain('new-id');
      expect(sql).not.toContain('user-1');
      expect(params).toContain('new-id');
      expect(params).toContain('user-1');
      expect(params).toContain('BILLING');
    });
  });

  describe('resolveComplaintWithClient', () => {
    it('uses parameterised UPDATE with resolved fields', async () => {
      const client = buildMockClient();

      await repo.resolveComplaintWithClient(client, 'complaint-1', 'Fixed it', 'officer-1');

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE complaints');
      expect(sql).toContain('RESOLVED');
      expect(sql).not.toContain('complaint-1');
      expect(sql).not.toContain('officer-1');
      expect(params).toContain('complaint-1');
      expect(params).toContain('officer-1');
      expect(params).toContain('Fixed it');
    });
  });

  describe('escalateComplaintWithClient', () => {
    it('sets escalated=true and status=ESCALATED', async () => {
      const client = buildMockClient();

      await repo.escalateComplaintWithClient(client, 'complaint-1');

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ESCALATED');
      expect(sql).toContain('escalated = true');
      expect(params).toContain('complaint-1');
    });
  });

  describe('createAuditEntryWithClient', () => {
    it('uses parameterised INSERT for audit log', async () => {
      const client = buildMockClient();

      await repo.createAuditEntryWithClient(
        client,
        'user-1',
        'COMPLAINT_FILED',
        'complaints',
        'complaint-1',
        null,
        { status: 'OPEN' },
        '127.0.0.1',
        'test-agent',
      );

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(sql).not.toContain('user-1');
      expect(sql).not.toContain('complaint-1');
      expect(params).toContain('user-1');
      expect(params).toContain('COMPLAINT_FILED');
    });

    it('serialises before state as null when not provided', async () => {
      const client = buildMockClient();

      await repo.createAuditEntryWithClient(
        client,
        null,
        'SYSTEM_ACTION',
        'complaints',
        'complaint-1',
        null,
        { status: 'OPEN' },
      );

      const [, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      // old_values param should be null, not stringified
      expect(params[4]).toBeNull();
      // ipAddress and userAgent should default to null
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });

    it('serialises before state as JSON when provided', async () => {
      const client = buildMockClient();

      await repo.createAuditEntryWithClient(
        client,
        'user-1',
        'COMPLAINT_UPDATED',
        'complaints',
        'complaint-1',
        { status: 'OPEN' },
        { status: 'IN_PROGRESS' },
        '10.0.0.1',
        'agent',
      );

      const [, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe(JSON.stringify({ status: 'OPEN' }));
      expect(params[5]).toBe(JSON.stringify({ status: 'IN_PROGRESS' }));
    });
  });

  // ── findAllComplaints ─────────────────────────────────────────
  describe('findAllComplaints', () => {
    it('returns all complaints with no filters', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '5' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'c-1' }, { id: 'c-2' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.findAllComplaints({}, { page: 1, limit: 10 });

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(2);

      // Count query has no WHERE clause
      const [countSql] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(countSql).not.toContain('WHERE');
    });

    it('applies status filter only', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '3' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'c-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.findAllComplaints({ status: 'OPEN' }, { page: 1, limit: 10 });

      expect(result.total).toBe(3);
      const [countSql, countParams] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(countSql).toContain('WHERE');
      expect(countSql).toContain('status');
      expect(countParams).toContain('OPEN');
    });

    it('applies category filter only', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '2' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      await repo.findAllComplaints({ category: 'BILLING' }, { page: 1, limit: 10 });

      const [countSql, countParams] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(countSql).toContain('category');
      expect(countParams).toContain('BILLING');
    });

    it('applies complainant_id filter only', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      await repo.findAllComplaints({ complainant_id: 'user-1' }, { page: 1, limit: 10 });

      const [countSql, countParams] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(countSql).toContain('complainant_id');
      expect(countParams).toContain('user-1');
    });

    it('applies all three filters simultaneously', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      await repo.findAllComplaints(
        { status: 'OPEN', category: 'BILLING', complainant_id: 'user-1' },
        { page: 2, limit: 5 },
      );

      const [countSql, countParams] = mockQuery.mock.calls[0] as unknown as [string, unknown[]];
      expect(countSql).toContain('status');
      expect(countSql).toContain('category');
      expect(countSql).toContain('complainant_id');
      expect(countParams).toContain('OPEN');
      expect(countParams).toContain('BILLING');
      expect(countParams).toContain('user-1');
    });

    it('calculates correct offset for page 2', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '20' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      await repo.findAllComplaints({}, { page: 2, limit: 10 });

      const [, dataParams] = mockQuery.mock.calls[1] as unknown as [string, unknown[]];
      // page 2, limit 10 => offset = (2-1)*10 = 10
      expect(dataParams).toContain(10);
      expect(dataParams).toContain(10);
    });

    it('defaults total to 0 when count row is missing', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.findAllComplaints({}, { page: 1, limit: 10 });
      expect(result.total).toBe(0);
    });
  });

  // ── updateComplaintWithClient ─────────────────────────────────
  describe('updateComplaintWithClient', () => {
    it('updates status only', async () => {
      const client = buildMockClient();

      await repo.updateComplaintWithClient(client, 'complaint-1', { status: 'IN_PROGRESS' });

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE complaints');
      expect(sql).toContain('status');
      expect(params).toContain('IN_PROGRESS');
      expect(params).toContain('complaint-1');
    });

    it('updates priority only', async () => {
      const client = buildMockClient();

      await repo.updateComplaintWithClient(client, 'complaint-1', { priority: 'HIGH' });

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('priority');
      expect(params).toContain('HIGH');
    });

    it('updates assigned_to only', async () => {
      const client = buildMockClient();

      await repo.updateComplaintWithClient(client, 'complaint-1', { assigned_to: 'officer-1' });

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('assigned_to');
      expect(params).toContain('officer-1');
    });

    it('updates all fields simultaneously', async () => {
      const client = buildMockClient();

      await repo.updateComplaintWithClient(client, 'complaint-1', {
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assigned_to: 'officer-1',
      });

      const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('status');
      expect(sql).toContain('priority');
      expect(sql).toContain('assigned_to');
      expect(params).toContain('IN_PROGRESS');
      expect(params).toContain('HIGH');
      expect(params).toContain('officer-1');
    });

    it('does nothing when no fields are provided', async () => {
      const client = buildMockClient();

      await repo.updateComplaintWithClient(client, 'complaint-1', {});

      expect(client.query).not.toHaveBeenCalled();
    });
  });

  // ── getClient ─────────────────────────────────────────────────
  describe('getClient', () => {
    it('returns a client from the pool', async () => {
      const { pool: mockPool } = jest.requireMock('../../../src/shared/database/pool') as {
        pool: { connect: jest.Mock };
      };
      const fakeClient = buildMockClient();
      mockPool.connect.mockResolvedValue(fakeClient as never);

      const client = await repo.getClient();
      expect(client).toBe(fakeClient);
    });
  });
});
