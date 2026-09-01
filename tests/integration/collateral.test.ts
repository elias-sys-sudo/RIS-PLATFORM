/**
 * Integration tests — Collateral CRUD controller
 *
 * Covers: full lifecycle, access control, business rules, auth, and 404.
 */
import request from 'supertest';
import { Pool } from 'pg';
import {
  createTestApp,
  ensureAllTestSessions,
  closeTestRedis,
  TEST_USERS,
  TEST_IDS,
  authAgent,
} from './helpers';

const app = createTestApp();
const testPool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await ensureAllTestSessions();
});

afterAll(async () => {
  await closeTestRedis();
  await testPool.end();
});

// ---------------------------------------------------------------------------
// 1. CRUD lifecycle
// ---------------------------------------------------------------------------

describe('Collateral CRUD lifecycle', () => {
  let createdId: string;

  afterAll(async () => {
    // Clean up any collateral created during this suite
    if (createdId) {
      await testPool.query(`DELETE FROM collateral_documents WHERE collateral_id = $1`, [
        createdId,
      ]);
      await testPool.query(`DELETE FROM collateral WHERE id = $1`, [createdId]);
    }
  });

  it('POST /collateral — creates collateral on a valid invoice (201)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .post('/collateral')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: TEST_IDS.invoices.approved,
        type: 'bank_guarantee',
        description: 'Integration test collateral — commercial guarantee',
        estimated_value: 50000000,
        currency: 'UGX',
        documents: [],
      })
      .expect(201);

    const body = res.body as {
      data: { id: string; collateral_type: string; value: string; description: string };
    };
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeDefined();
    expect(body.data.collateral_type).toBe('bank_guarantee');
    expect(body.data.description).toBe('Integration test collateral — commercial guarantee');

    createdId = body.data.id;
  });

  it('GET /collateral/:id — retrieves the created record (200)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/collateral/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: {
        collateral: { id: string; collateral_type: string };
        documents: unknown[];
      };
    };
    expect(body.data.collateral.id).toBe(createdId);
    expect(body.data.collateral.collateral_type).toBe('bank_guarantee');
    expect(Array.isArray(body.data.documents)).toBe(true);
  });

  it('GET /collateral?invoice_id=approved — list includes the new record (200)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/collateral?invoice_id=${TEST_IDS.invoices.approved}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: { id: string }[];
      pagination: { total: number };
    };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const ids = body.data.map((c) => c.id);
    expect(ids).toContain(createdId);
  });

  it('PUT /collateral/:id — updates value and description (200)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .put(`/collateral/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        estimated_value: 75000000,
        description: 'Updated — commercial guarantee plus additional cover',
      })
      .expect(200);

    const body = res.body as {
      data: { value: string; description: string };
    };
    expect(body.data.description).toBe('Updated — commercial guarantee plus additional cover');
  });

  it('DELETE /collateral/:id — soft deletes the record (200)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    // The created collateral is on inv-approved (not funded), so delete is allowed
    await request(testApp)
      .delete(`/collateral/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Verify it no longer appears in the list
    const listRes = await request(testApp)
      .get(`/collateral?invoice_id=${TEST_IDS.invoices.approved}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listBody = listRes.body as { data: { id: string }[] };
    const ids = listBody.data.map((c) => c.id);
    expect(ids).not.toContain(createdId);
  });
});

// ---------------------------------------------------------------------------
// 2. Access control — supplier cannot access another org's collateral
// ---------------------------------------------------------------------------

describe('Collateral access control', () => {
  it('supplier cannot list collateral on inv-funded (owned by different org) — 403', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.supplier);
    await request(testApp)
      .get(`/collateral?invoice_id=${TEST_IDS.invoices.funded}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('supplier cannot GET collateral belonging to another org — 403', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.supplier);
    await request(testApp)
      .get(`/collateral/${TEST_IDS.collateral.main}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// 3. Delete funded invoice collateral — business rule
// ---------------------------------------------------------------------------

describe('Collateral business rules', () => {
  it('DELETE /collateral/:id on funded invoice collateral returns 422', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .delete(`/collateral/${TEST_IDS.collateral.main}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('COLLATERAL_DELETE_FUNDED');
  });
});

// ---------------------------------------------------------------------------
// 4. Unauthenticated request
// ---------------------------------------------------------------------------

describe('Collateral authentication', () => {
  it('unauthenticated GET /collateral returns 401', async () => {
    await request(app).get(`/collateral?invoice_id=${TEST_IDS.invoices.funded}`).expect(401);
  });

  it('unauthenticated POST /collateral returns 401', async () => {
    await request(app)
      .post('/collateral')
      .send({
        invoice_id: TEST_IDS.invoices.funded,
        type: 'bank_guarantee',
        description: 'Should not succeed',
        estimated_value: 1000000,
      })
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// 5. Non-existent collateral — 404
// ---------------------------------------------------------------------------

describe('Collateral not found', () => {
  it('GET /collateral/:id with non-existent UUID returns 404', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/collateral/00000000-0000-4000-a999-999999999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('PUT /collateral/:id with non-existent UUID returns 404', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .put('/collateral/00000000-0000-4000-a999-999999999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Does not exist' })
      .expect(404);
  });

  it('DELETE /collateral/:id with non-existent UUID returns 404', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .delete('/collateral/00000000-0000-4000-a999-999999999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
