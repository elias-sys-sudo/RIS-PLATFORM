process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';
import { onboardingRouter } from '../../../src/services/onboarding/onboarding.routes';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';

// Service is mocked — we are testing the Joi validation layer, not business logic.
jest.mock('../../../src/services/onboarding/onboarding.service', () => ({
  registerSupplier: jest.fn().mockResolvedValue({
    userId: 'user-1',
    supplierId: 'supp-1',
  }),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), audit: jest.fn() },
}));

const app = express();
app.use(express.json());
app.use('/onboarding', onboardingRouter);
app.use(globalErrorHandler);

interface RegistrationOverrides {
  password?: string;
  email?: string;
}

function buildBody(overrides: RegistrationOverrides = {}): Record<string, unknown> {
  return {
    email: overrides.email ?? 'newsupplier@example.com',
    password: overrides.password ?? 'StrongP@ssw0rd!',
    company_name: 'Acme Trading Ltd',
    registration_number: 'REG-12345',
    tax_id: 'TIN-67890',
    directors: [
      {
        name: 'Director One',
        id_type: 'national_id',
        id_number: 'NID-001',
      },
    ],
    bank_name: 'Stanbic Bank',
    bank_account_number: '9030001234567',
    bank_account_name: 'Acme Trading Ltd',
    bank_branch: 'Kampala Main',
    preferred_payment_method: 'EFT',
    eligibility_session_token: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    consent_ursb_check: true,
    consent_supplier_refs: true,
    consent_litigation_check: true,
  };
}

describe('POST /onboarding/suppliers/register — password complexity validation', () => {
  it('rejects a weak password (no uppercase, no special char) with 400 + friendly message', async () => {
    const res = await request(app)
      .post('/onboarding/suppliers/register')
      .send(buildBody({ password: 'password123' }));

    expect(res.status).toBe(400);
    const body = res.body as { fields?: Array<{ field?: string; message?: string }> };
    const passwordError = body.fields?.find((d) => d.field === 'password');
    expect(passwordError?.message).toBe(
      'Password must include uppercase, lowercase, number, and special character',
    );
  });

  it('accepts a strong password matching the auth PASSWORD_REGEX', async () => {
    const res = await request(app)
      .post('/onboarding/suppliers/register')
      .send(buildBody({ password: 'StrongP@ssw0rd!' }));

    expect(res.status).toBe(201);
  });

  it('rejects a password that meets length but lacks a digit', async () => {
    const res = await request(app)
      .post('/onboarding/suppliers/register')
      .send(buildBody({ password: 'NoDigitsHere!!' }));

    expect(res.status).toBe(400);
    const body = res.body as { fields?: Array<{ field?: string; message?: string }> };
    const passwordError = body.fields?.find((d) => d.field === 'password');
    expect(passwordError?.message).toBe(
      'Password must include uppercase, lowercase, number, and special character',
    );
  });
});
