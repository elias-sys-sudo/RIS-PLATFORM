/**
 * scripts/audit/test-admin.ts
 * Admin + Settings smoke-test — runs against the running backend (default port 4000).
 * Usage: ts-node --transpile-only scripts/audit/test-admin.ts [base_url]
 *
 * Tests:
 *  1. GET /admin/users as admin            → array response
 *  2. POST /admin/users as admin           → 201 + new user id
 *  3. PATCH /admin/users/:userId as admin  → 200 role update
 *  4. GET /admin/users as supplier         → 403
 *  5. GET /admin/risk-config as admin      → list
 *  6. PUT /admin/risk-config/:key as admin → 200 updated value
 *  7. GET /admin/risk-config as supplier   → 403
 *  8. GET /settings/profile as admin       → user data
 *  9. PUT /settings/profile name change    → 200
 * 10. GET/PUT /settings/notifications      → success or 404 gracefully handled
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? '4000'}`;

const ADMIN_EMAIL    = 'md1@test.ris.co.ug';
const SUPPLIER_EMAIL = 'supplier1@test.ris.co.ug';
const DEFAULT_PASS   = 'TestPassword123!';

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

function extractToken(body: Record<string, unknown>): string | undefined {
  return (body.access_token ?? body.accessToken ?? body.token) as string | undefined;
}

async function run(): Promise<void> {
  console.log(`\nMMS Admin & Settings Smoke Tests → ${BASE}\n`);

  // ── Login setup ─────────────────────────────────────────────────────────────
  const adminLogin = await req('POST', '/auth/login', { email: ADMIN_EMAIL, password: DEFAULT_PASS });
  const adminToken = extractToken(adminLogin.body);
  if (adminLogin.status !== 200 || !adminToken) {
    console.error(`FATAL: Admin login failed (status=${adminLogin.status}). Cannot proceed.`);
    process.exitCode = 1;
    return;
  }
  console.log('[OK] Admin logged in\n');

  const supplierLogin = await req('POST', '/auth/login', { email: SUPPLIER_EMAIL, password: DEFAULT_PASS });
  const supplierToken = extractToken(supplierLogin.body);
  if (supplierLogin.status !== 200 || !supplierToken) {
    console.error(`FATAL: Supplier login failed (status=${supplierLogin.status}). Cannot proceed.`);
    process.exitCode = 1;
    return;
  }
  console.log('[OK] Supplier logged in\n');

  // ── Test 1: GET /admin/users as admin → array ────────────────────────────────
  const t1 = await req('GET', '/admin/users', undefined, adminToken);
  const usersData = t1.body.data as unknown[] | undefined;
  const isArray = Array.isArray(usersData);
  report(
    1,
    'GET /admin/users as admin → array',
    t1.status === 200 && isArray,
    `status=${t1.status} data_is_array=${isArray}`,
  );

  // ── Test 2: POST /admin/users as admin → 201 ────────────────────────────────
  const uniqueEmail = `audit-test-${Date.now()}@test.ris.co.ug`;
  const t2 = await req(
    'POST',
    '/admin/users',
    { name: 'Audit Test User', email: uniqueEmail, role: 'auditor' },
    adminToken,
  );
  const createdUserId = (
    (t2.body.user as Record<string, unknown> | undefined)?.id ??
    t2.body.id
  ) as string | undefined;
  report(
    2,
    'POST /admin/users as admin → 201',
    t2.status === 201 && typeof createdUserId === 'string',
    `status=${t2.status} user_id=${createdUserId ?? 'none'}`,
  );

  // ── Test 3: PATCH /admin/users/:userId → 200 role update ────────────────────
  // Use the newly created user if available; otherwise pick first user from list
  let targetUserId = createdUserId;
  if (!targetUserId && isArray && (usersData as Record<string, unknown>[]).length > 0) {
    targetUserId = (usersData as Record<string, unknown>[])[0].id as string | undefined;
  }

  if (targetUserId) {
    const t3 = await req(
      'PATCH',
      `/admin/users/${targetUserId}`,
      { role: 'compliance_officer' },
      adminToken,
    );
    report(
      3,
      'PATCH /admin/users/:userId → 200 role updated',
      t3.status === 200,
      `status=${t3.status} userId=${targetUserId}`,
    );
  } else {
    report(3, 'PATCH /admin/users/:userId → 200 role updated', false, 'no target userId available');
  }

  // ── Test 4: GET /admin/users as supplier → 403 ──────────────────────────────
  const t4 = await req('GET', '/admin/users', undefined, supplierToken);
  report(
    4,
    'GET /admin/users as supplier → 403',
    t4.status === 403,
    `status=${t4.status}`,
  );

  // ── Test 5: GET /admin/risk-config as admin → list ───────────────────────────
  const t5 = await req('GET', '/admin/risk-config', undefined, adminToken);
  const riskList = t5.body.data as unknown[] | undefined;
  const riskIsArray = Array.isArray(riskList);
  // Some implementations return the array directly rather than wrapped in .data
  const riskBodyIsArray = Array.isArray(t5.body);
  const riskOk = t5.status === 200 && (riskIsArray || riskBodyIsArray);
  const firstKey = riskIsArray
    ? ((riskList as Record<string, unknown>[])[0]?.key as string | undefined)
    : riskBodyIsArray
      ? ((t5.body as unknown as Record<string, unknown>[])[0]?.key as string | undefined)
      : undefined;
  report(
    5,
    'GET /admin/risk-config as admin → list',
    riskOk,
    `status=${t5.status} first_key=${firstKey ?? 'none'}`,
  );

  // ── Test 6: PUT /admin/risk-config/:key → 200 ───────────────────────────────
  const configKey = firstKey ?? 'weight_buyer_credit';
  const t6 = await req(
    'PUT',
    `/admin/risk-config/${configKey}`,
    { value: 0.30 },
    adminToken,
  );
  report(
    6,
    `PUT /admin/risk-config/${configKey} → 200`,
    t6.status === 200,
    `status=${t6.status}`,
  );

  // ── Test 7: GET /admin/risk-config as supplier → 403 ────────────────────────
  const t7 = await req('GET', '/admin/risk-config', undefined, supplierToken);
  report(
    7,
    'GET /admin/risk-config as supplier → 403',
    t7.status === 403,
    `status=${t7.status}`,
  );

  // ── Test 8: GET /settings/profile as admin → user data ──────────────────────
  const t8 = await req('GET', '/settings/profile', undefined, adminToken);
  const hasEmail = typeof (t8.body.email ?? (t8.body.user as Record<string, unknown> | undefined)?.email) === 'string';
  report(
    8,
    'GET /settings/profile → user data with email',
    t8.status === 200 && hasEmail,
    `status=${t8.status} has_email=${hasEmail}`,
  );

  // ── Test 9: PUT /settings/profile name change → 200 ─────────────────────────
  const t9 = await req(
    'PUT',
    '/settings/profile',
    { name: 'MMS Director' },
    adminToken,
  );
  report(
    9,
    'PUT /settings/profile name change → 200',
    t9.status === 200,
    `status=${t9.status}`,
  );

  // ── Test 10: GET/PUT /settings/notifications → success or 404 gracefully ────
  const t10Get = await req('GET', '/settings/notifications', undefined, adminToken);
  const getOk = t10Get.status === 200 || t10Get.status === 404;

  let putOk = true;
  let putStatus = 'skipped';
  if (t10Get.status === 200) {
    const t10Put = await req(
      'PUT',
      '/settings/notifications',
      { email_invoices: true, sms_payments: false },
      adminToken,
    );
    putOk = t10Put.status === 200 || t10Put.status === 204 || t10Put.status === 404;
    putStatus = String(t10Put.status);
  }

  report(
    10,
    'GET/PUT /settings/notifications → success or 404 handled',
    getOk && putOk,
    `GET=${t10Get.status} PUT=${putStatus}`,
  );

  // ── Cleanup: restore admin profile name ────────────────────────────────────
  if (t9.status === 200) {
    const restore = await req('PUT', '/settings/profile', { name: 'MMS Director 1' }, adminToken);
    const ok = restore.status === 200;
    console.log(`\n[${ok ? 'OK' : 'WARN'}] Cleanup: admin profile name restored${ok ? '' : ' — MANUAL RESTORE NEEDED'}`);
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
