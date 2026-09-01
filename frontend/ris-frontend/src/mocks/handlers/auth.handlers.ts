import { http, HttpResponse, delay } from 'msw';
import type { RefreshResponse } from '../../types/auth.types';

// ── Fake user store ──────────────────────────────────────────────────────────
// Values are snake_case because the Axios response interceptor converts them
// to camelCase before the frontend reads them.

export const USERS: Record<string, { password: string; user: Record<string, unknown> }> = {
  'admin@ris.ug': {
    password: 'Admin@1234',
    user: {
      id: 'usr_001',
      email: 'admin@ris.ug',
      name: 'Admin User',
      role: 'finance_manager',
    },
  },
  'supplier@ris.ug': {
    password: 'Supplier@1234',
    user: {
      id: 'usr_002',
      email: 'supplier@ris.ug',
      name: 'Kampala Traders Ltd',
      role: 'supplier',
      kyc_status: 'approved',
    },
  },
  'newsupplier@ris.ug': {
    password: 'NewSupplier@1234',
    user: {
      id: 'usr_008',
      email: 'newsupplier@ris.ug',
      name: 'Jinja Fresh Produce',
      role: 'supplier',
      kyc_status: 'pending',
    },
  },
  'officer@ris.ug': {
    password: 'Officer@1234',
    user: {
      id: 'usr_003',
      email: 'officer@ris.ug',
      name: 'Credit Officer',
      role: 'credit_officer',
    },
  },
  'finance2@ris.ug': {
    password: 'Finance2@1234',
    user: {
      id: 'usr_004',
      email: 'finance2@ris.ug',
      name: 'Grace Nakamya',
      role: 'finance_manager',
    },
  },
  'management@ris.ug': {
    password: 'Management@1234',
    user: {
      id: 'usr_005',
      email: 'management@ris.ug',
      name: 'David Mukasa',
      role: 'management',
    },
  },
  'compliance@ris.ug': {
    password: 'Compliance@1234',
    user: {
      id: 'usr_006',
      email: 'compliance@ris.ug',
      name: 'Agnes Nambi',
      role: 'compliance_officer',
    },
  },
  'auditor@ris.ug': {
    password: 'Auditor@1234',
    user: {
      id: 'usr_007',
      email: 'auditor@ris.ug',
      name: 'Robert Kizza',
      role: 'auditor',
    },
  },
  'legal@ris.ug': {
    password: 'Legal@1234',
    user: {
      id: 'usr_009',
      email: 'legal@ris.ug',
      name: 'Patricia Acen',
      role: 'legal',
    },
  },
};

const refreshTokenStore: Record<string, string> = {};

function makeTokens(userId: string) {
  const accessToken  = `mock-access-${userId}-${Date.now()}`;
  const refreshToken = `mock-refresh-${userId}-${Date.now()}`;
  refreshTokenStore[refreshToken] = userId;
  return { accessToken, refreshToken };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export const authHandlers = [

  // POST /api/auth/login
  http.post('/api/auth/login', async ({ request }) => {
    await delay(400);
    const body = await request.json() as { email?: string; password?: string };
    const record = USERS[body.email ?? ''];

    if (!record || record.password !== body.password) {
      return HttpResponse.json(
        { message: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    const tokens = makeTokens(record.user.id as string);
    return HttpResponse.json({
      user: record.user,
      ...tokens,
    });
  }),

  // POST /api/auth/logout
  http.post('/api/auth/logout', async ({ request }) => {
    await delay(150);
    const auth = request.headers.get('Authorization') ?? '';
    // Invalidate the refresh token associated with this session
    const rt = Object.keys(refreshTokenStore).find((k) =>
      refreshTokenStore[k] === auth.replace('Bearer ', ''),
    );
    if (rt) delete refreshTokenStore[rt];
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /api/auth/refresh
  http.post('/api/auth/refresh', async ({ request }) => {
    await delay(300);
    const body = await request.json() as { refreshToken?: string };
    const rt   = body.refreshToken ?? '';
    const userId = refreshTokenStore[rt];

    if (!userId) {
      return HttpResponse.json(
        { message: 'Refresh token is invalid or expired.' },
        { status: 401 },
      );
    }

    // Rotate the token
    delete refreshTokenStore[rt];
    const tokens = makeTokens(userId);
    return HttpResponse.json<RefreshResponse>(tokens);
  }),

  // POST /api/auth/forgot-password
  http.post('/api/auth/forgot-password', async () => {
    await delay(600);
    // Always 200 — never reveal whether the email exists
    return new HttpResponse(null, { status: 200 });
  }),

  // POST /api/auth/reset-password
  http.post('/api/auth/reset-password', async ({ request }) => {
    await delay(400);
    const body = await request.json() as { token?: string; password?: string };

    if (!body.token || body.token === 'invalid') {
      return HttpResponse.json(
        { message: 'Reset token is invalid or has expired.' },
        { status: 400 },
      );
    }
    return new HttpResponse(null, { status: 200 });
  }),

  // POST /api/auth/change-password
  http.post('/api/auth/change-password', async ({ request }) => {
    await delay(400);
    const body = await request.json() as {
      currentPassword?: string;
      newPassword?: string;
    };

    // Simulate wrong-current-password for demo purposes
    if (body.currentPassword === 'wrong') {
      return HttpResponse.json(
        { message: 'Current password is incorrect.' },
        { status: 400 },
      );
    }
    return new HttpResponse(null, { status: 200 });
  }),

];
