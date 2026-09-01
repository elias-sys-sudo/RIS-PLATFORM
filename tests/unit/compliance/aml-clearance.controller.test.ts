process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks (declared before importing the router so jest hoists them correctly)
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/compliance/aml-clearance.service', () => ({
  clearInvoice: jest.fn().mockResolvedValue({
    invoice_id: '11111111-1111-1111-1111-111111111111',
    aml_cleared_at: '2026-04-30T12:00:00Z',
    aml_cleared_by: 'officer-1',
  }),
  listQueue: jest.fn().mockResolvedValue([]),
  getDetail: jest.fn().mockResolvedValue({
    invoice_id: '11111111-1111-1111-1111-111111111111',
  }),
  setNotificationQueue: jest.fn(),
}));

// Authenticate middleware injects req.user from a header for testing.
// Routes wrap this with asyncHandler so it must return a Promise.
jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: (
    req: express.Request & { user?: { userId: string; role: string; sessionId: string } },
    _res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    const role = (req.headers['x-test-role'] as string) ?? 'compliance_officer';
    req.user = { userId: 'officer-1', role, sessionId: 'sess-1' };
    next();
    return Promise.resolve();
  },
}));

// Use the real role guard so the role gate behaviour is exercised.
import { amlClearanceRouter } from '../../../src/services/compliance/aml-clearance.routes';
import * as service from '../../../src/services/compliance/aml-clearance.service';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';

const mockedService = service as jest.Mocked<typeof service>;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/admin/aml', amlClearanceRouter);
  app.use(globalErrorHandler);
  return app;
}

const VALID_INVOICE_ID = '11111111-1111-1111-1111-111111111111';
const VALID_BODY = {
  reason: 'Sanctions screening complete; no PEP hits and consistent with prior trade.',
  sanctions_check_complete: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('aml-clearance.controller (role gate)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows compliance_officer to POST /admin/aml/clear/:id', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'compliance_officer')
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockedService.clearInvoice).toHaveBeenCalledWith(
      VALID_INVOICE_ID,
      'officer-1',
      expect.objectContaining({ sanctions_check_complete: true }),
      expect.any(String),
      expect.any(String),
    );
  });

  it('rejects management with 403', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'management')
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(mockedService.clearInvoice).not.toHaveBeenCalled();
  });

  it('rejects auditor with 403', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'auditor')
      .send(VALID_BODY);

    expect(res.status).toBe(403);
  });

  it('rejects supplier with 403', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'supplier')
      .send(VALID_BODY);

    expect(res.status).toBe(403);
  });

  it('compliance_officer can list the queue', async () => {
    const app = buildApp();
    const res = await request(app).get('/admin/aml/queue').set('x-test-role', 'compliance_officer');

    expect(res.status).toBe(200);
    expect(mockedService.listQueue).toHaveBeenCalled();
  });

  it('compliance_officer can view detail', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/admin/aml/queue/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'compliance_officer');

    expect(res.status).toBe(200);
    expect(mockedService.getDetail).toHaveBeenCalledWith(
      VALID_INVOICE_ID,
      'officer-1',
      'compliance_officer',
      expect.any(String),
      expect.any(String),
    );
  });

  it('rejects compliance_officer when reason is too short', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'compliance_officer')
      .send({ reason: 'too short', sanctions_check_complete: true });

    expect(res.status).toBe(400);
    expect(mockedService.clearInvoice).not.toHaveBeenCalled();
  });

  it('rejects when sanctions_check_complete is false', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/admin/aml/clear/${VALID_INVOICE_ID}`)
      .set('x-test-role', 'compliance_officer')
      .send({
        reason: 'A reason that is sufficiently long for Joi validation.',
        sanctions_check_complete: false,
      });

    expect(res.status).toBe(400);
    expect(mockedService.clearInvoice).not.toHaveBeenCalled();
  });
});
