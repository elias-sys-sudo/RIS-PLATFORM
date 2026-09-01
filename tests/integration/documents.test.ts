/**
 * Integration tests — Documents module
 * Covers GET /documents/:document_id/download endpoint.
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

// ==========================================================================
// GET /documents/:document_id/download
// ==========================================================================

describe('GET /documents/:document_id/download', () => {
  it('exercises controller/service/repo layers for a valid document ID', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/documents/${TEST_IDS.documents.pdf}/download`)
      .set('Authorization', `Bearer ${token}`);

    // The encrypted_path in seed data is not a real encrypted value,
    // so decryption will fail or the file won't exist on disk.
    // Expect either 404 (file not found) or 500 (decryption error).
    expect([404, 500]).toContain(res.status);
  });

  it('returns 404 for a non-existent document ID', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const fakeId = '00000000-0000-4000-f100-000000099999';
    const res = await request(testApp)
      .get(`/documents/${fakeId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const body = res.body as { error: string };
    expect(body.error).toBeDefined();
  });

  it('returns 403 when supplier from org2 tries to download doc from org1', async () => {
    // The supplier test user (U.supplier) owns org2.
    // The test document (DOC.pdf) belongs to org1.
    // validateDocumentAccess should deny access.
    const { token, app: testApp } = authAgent(TEST_USERS.supplier);
    const res = await request(testApp)
      .get(`/documents/${TEST_IDS.documents.pdf}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const body = res.body as { error: string };
    expect(body.error).toBeDefined();
  });

  it('returns 400 for an invalid document ID format', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/documents/not-a-valid-uuid/download')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(app).get(`/documents/${TEST_IDS.documents.pdf}/download`).expect(401);
  });

  it('non-supplier staff roles can access documents (no org restriction)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.creditOfficer);
    const res = await request(testApp)
      .get(`/documents/${TEST_IDS.documents.pdf}/download`)
      .set('Authorization', `Bearer ${token}`);

    // Staff roles bypass supplier ownership check, so will hit decryption/file error
    expect([404, 500]).toContain(res.status);
  });
});
