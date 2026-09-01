/**
 * scripts/audit/test-auth.ts
 * Live auth smoke-test — runs against the running backend (default port 4000).
 * Usage: ts-node --transpile-only scripts/audit/test-auth.ts [base_url]
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? '4000'}`;

// Seed credentials (dev-seed.ts defaults)
const ADMIN_EMAIL    = 'md1@test.ris.co.ug';
const SUPPLIER_EMAIL = 'supplier1@test.ris.co.ug';
const SUPPLIER2_EMAIL = 'supplier2@test.ris.co.ug';
const DEFAULT_PASS   = 'TestPassword123!';
const TEMP_PASS      = 'AuditTemp@2024!';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function req(
  method: Method,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: Record<string, unknown> = {};
  try {
    const text = await res.text();
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body */
  }

  return { status: res.status, body: parsed };
}

let passed = 0;
let failed = 0;

function report(n: number, label: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  (${detail})` : '';
  console.log(`[${mark}] Test ${n}: ${label}${suffix}`);
  if (ok) passed++; else failed++;
}

async function run(): Promise<void> {
  console.log(`\nMMS Auth Smoke Tests → ${BASE}\n`);

  // ── Test 1: Admin login ────────────────────────────────────────────────────
  const t1 = await req('POST', '/auth/login', { email: ADMIN_EMAIL, password: DEFAULT_PASS });
  const adminToken = (t1.body.access_token ?? t1.body.token ?? t1.body.accessToken) as string | undefined;
  report(1, 'Admin login → 200 + JWT', t1.status === 200 && typeof adminToken === 'string' && adminToken.length > 0,
    `status=${t1.status}`);

  // ── Test 2: Supplier login ─────────────────────────────────────────────────
  const t2 = await req('POST', '/auth/login', { email: SUPPLIER_EMAIL, password: DEFAULT_PASS });
  const supplierToken = (t2.body.access_token ?? t2.body.token ?? t2.body.accessToken) as string | undefined;
  report(2, 'Supplier login → 200 + JWT', t2.status === 200 && typeof supplierToken === 'string' && supplierToken.length > 0,
    `status=${t2.status}`);

  // ── Test 3: Wrong password → 401 ──────────────────────────────────────────
  const t3 = await req('POST', '/auth/login', { email: SUPPLIER_EMAIL, password: 'WrongPass99!' });
  report(3, 'Wrong password → 401', t3.status === 401, `status=${t3.status}`);

  // ── Test 4: Protected endpoint, no JWT → 401 ──────────────────────────────
  const t4 = await req('GET', '/admin/users');
  report(4, 'No JWT on protected endpoint → 401', t4.status === 401, `status=${t4.status}`);

  // ── Test 5: Admin endpoint with supplier JWT → 403 ───────────────────────
  const t5 = await req('GET', '/admin/users', undefined, supplierToken);
  report(5, 'Supplier JWT on management endpoint → 403', t5.status === 403, `status=${t5.status}`);

  // ── Test 6: Forgot password → 200 ─────────────────────────────────────────
  const t6 = await req('POST', '/auth/forgot-password', { email: SUPPLIER_EMAIL });
  report(6, 'Forgot-password → 200', t6.status === 200, `status=${t6.status}`);

  // ── Tests 7 & 8 use supplier2 so we can restore the password after ─────────

  // Login as supplier2 first
  const loginS2 = await req('POST', '/auth/login', { email: SUPPLIER2_EMAIL, password: DEFAULT_PASS });
  const s2Token = (loginS2.body.access_token ?? loginS2.body.token ?? loginS2.body.accessToken) as string | undefined;

  if (loginS2.status !== 200 || typeof s2Token !== 'string') {
    report(7, 'Change-password correct current → 200', false,
      `supplier2 login failed status=${loginS2.status}`);
    report(8, 'Change-password wrong current → 400/401', false,
      'skipped — supplier2 login failed');
    printSummary();
    return;
  }

  // ── Test 7: Change password correct current → 200 ─────────────────────────
  const t7 = await req('PUT', '/auth/change-password', {
    current_password: DEFAULT_PASS,
    new_password: TEMP_PASS,
    confirm_password: TEMP_PASS,
  }, s2Token);
  report(7, 'Change-password correct current → 200', t7.status === 200, `status=${t7.status}`);

  // ── Test 8: Change password wrong current → 400/401 ───────────────────────
  // At this point supplier2's password is TEMP_PASS; using DEFAULT_PASS is wrong.
  const t8 = await req('PUT', '/auth/change-password', {
    current_password: DEFAULT_PASS,
    new_password: 'AnotherPass@2024!',
    confirm_password: 'AnotherPass@2024!',
  }, s2Token);
  report(8, 'Change-password wrong current → 400/401',
    t8.status === 400 || t8.status === 401, `status=${t8.status}`);

  // ── Cleanup: restore supplier2 password ────────────────────────────────────
  if (t7.status === 200) {
    const loginS2New = await req('POST', '/auth/login', { email: SUPPLIER2_EMAIL, password: TEMP_PASS });
    const s2NewToken = (loginS2New.body.access_token ?? loginS2New.body.token ?? loginS2New.body.accessToken) as string | undefined;
    if (loginS2New.status === 200 && typeof s2NewToken === 'string') {
      const restore = await req('PUT', '/auth/change-password', {
        current_password: TEMP_PASS,
        new_password: DEFAULT_PASS,
        confirm_password: DEFAULT_PASS,
      }, s2NewToken);
      const ok = restore.status === 200;
      console.log(`\n[${ok ? 'OK' : 'WARN'}] Cleanup: supplier2 password restored${ok ? '' : ' — MANUAL RESTORE NEEDED'}`);
    } else {
      console.log('\n[WARN] Cleanup: could not log in with TEMP_PASS to restore — MANUAL RESTORE NEEDED');
    }
  }

  printSummary();
}

function printSummary(): void {
  const total = passed + failed;
  console.log(`\n────────────────────────────────────`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
