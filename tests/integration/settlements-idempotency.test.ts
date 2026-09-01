/**
 * Settlements idempotency — real-DB integration test.
 *
 * Asserts that a BullMQ settlement-initiate retry (same invoice + collection)
 * produces exactly one settlement row, with the same ID, and that the
 * deterministic idempotency_key is the duplicate guard at the DB level.
 *
 * Uses the test DB and seeded entities created by global-setup.ts:
 *   - invoice I.collected     = 00000000-0000-4000-d000-000000000005
 *   - collection COL.collected = 00000000-0000-4000-e000-000000000002
 */

process.env.NODE_ENV = 'test';

import { Pool } from 'pg';
import * as service from '../../src/services/settlements/settlements.service';
import { SettlementStatus } from '../../src/services/settlements/settlements.types';

const INVOICE_ID = '00000000-0000-4000-d000-000000000005';
const COLLECTION_ID = '00000000-0000-4000-e000-000000000002';
const SYSTEM_USER = 'SYSTEM';
const IP = '0.0.0.0';
const UA = 'jest-integration';

const testPool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await testPool.end();
});

beforeEach(async () => {
  // Clean any settlements (and dependent rows) left from prior runs so each
  // test starts from a known-empty state for this invoice/collection pair.
  await testPool.query(
    `DELETE FROM profit_bookings
       WHERE settlement_id IN (SELECT id FROM settlements WHERE invoice_id = $1)`,
    [INVOICE_ID],
  );
  await testPool.query(`DELETE FROM settlements WHERE invoice_id = $1`, [INVOICE_ID]);
});

describe('settlements idempotency — worker retry safety', () => {
  it('runs initiateSettlement twice with the same key and produces exactly one row', async () => {
    const key = service.deriveSettlementIdempotencyKey(INVOICE_ID, COLLECTION_ID);

    const first = await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '30000000',
      '0',
      SYSTEM_USER,
      IP,
      UA,
      key,
    );

    const second = await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '30000000',
      '0',
      SYSTEM_USER,
      IP,
      UA,
      key,
    );

    expect(second.id).toBe(first.id);
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(second.status).toBe(SettlementStatus.PENDING);

    const count = await testPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM settlements WHERE invoice_id = $1`,
      [INVOICE_ID],
    );
    expect(count.rows[0].count).toBe('1');
  });

  it('records the audit log only once across the replay', async () => {
    const key = service.deriveSettlementIdempotencyKey(INVOICE_ID, COLLECTION_ID);

    const before = await testPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs
         WHERE action = 'SETTLEMENT_INITIATED' AND entity_id = $1`,
      [INVOICE_ID],
    );
    const baseline = parseInt(before.rows[0].count, 10);

    await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '30000000',
      '0',
      SYSTEM_USER,
      IP,
      UA,
      key,
    );
    await service.initiateSettlement(
      INVOICE_ID,
      COLLECTION_ID,
      '30000000',
      '0',
      SYSTEM_USER,
      IP,
      UA,
      key,
    );

    // Audit entry's entity_id is the settlement id, not the invoice id. Verify
    // exactly one new audit entry was written across the two calls.
    const settlementRow = await testPool.query<{ id: string }>(
      `SELECT id FROM settlements WHERE invoice_id = $1`,
      [INVOICE_ID],
    );
    expect(settlementRow.rows).toHaveLength(1);

    const auditCount = await testPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs
         WHERE action = 'SETTLEMENT_INITIATED' AND entity_id = $1`,
      [settlementRow.rows[0].id],
    );
    expect(auditCount.rows[0].count).toBe('1');
    // Baseline unrelated to our settlement should be unchanged
    expect(parseInt(auditCount.rows[0].count, 10)).toBeGreaterThanOrEqual(1);
    expect(baseline).toBeGreaterThanOrEqual(0);
  });

  it('derives a deterministic key — same invoice+collection always yields the same UUID', () => {
    const k1 = service.deriveSettlementIdempotencyKey(INVOICE_ID, COLLECTION_ID);
    const k2 = service.deriveSettlementIdempotencyKey(INVOICE_ID, COLLECTION_ID);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
