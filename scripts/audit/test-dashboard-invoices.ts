/**
 * scripts/audit/test-dashboard-invoices.ts
 * Live smoke-tests for dashboard and invoice endpoints.
 * Usage: ts-node --transpile-only scripts/audit/test-dashboard-invoices.ts [base_url]
 *
 * Tests 1–5: Dashboard
 * Tests 6–10: Invoice CRUD flow
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
  } catch { /* non-JSON */ }
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

function printSummary(): void {
  const total = passed + failed;
  console.log(`\n────────────────────────────────────`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ── helpers ───────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** Login and return access token, or undefined on failure. */
async function login(email: string, password: string): Promise<string | undefined> {
  const r = await req('POST', '/auth/login', { email, password });
  return (r.body.access_token ?? r.body.token ?? r.body.accessToken) as string | undefined;
}

/** Get first active buyer id accessible to the given token. Returns undefined if none found. */
async function getFirstBuyerId(token: string): Promise<string | undefined> {
  const r = await req('GET', '/buyers', undefined, token);
  const items = isArray(r.body.data) ? r.body.data
    : isArray(r.body.buyers) ? r.body.buyers
    : isArray(r.body) ? r.body as unknown[]
    : [];
  const first = items[0];
  if (isObject(first) && typeof first.id === 'string') return first.id;
  return undefined;
}

// ── main ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`\nMMS Dashboard & Invoice Smoke Tests → ${BASE}\n`);

  // ── Login both actors ────────────────────────────────────────────────────
  const adminToken    = await login(ADMIN_EMAIL, DEFAULT_PASS);
  const supplierToken = await login(SUPPLIER_EMAIL, DEFAULT_PASS);

  if (typeof adminToken !== 'string' || adminToken.length === 0) {
    console.error('[FATAL] Admin login failed — cannot continue');
    process.exitCode = 1;
    return;
  }
  if (typeof supplierToken !== 'string' || supplierToken.length === 0) {
    console.error('[FATAL] Supplier login failed — cannot continue');
    process.exitCode = 1;
    return;
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  DASHBOARD TESTS (1–5)                                               ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ── Test 1: GET /dashboard/summary → 200 with metrics object ─────────────
  const t1 = await req('GET', '/dashboard/summary', undefined, adminToken);
  report(1, 'GET /dashboard/summary → 200 + data object',
    t1.status === 200 && isObject(t1.body.data),
    `status=${t1.status}`);

  // ── Test 2: GET /dashboard/summary?period=7d → 200 ───────────────────────
  const t2 = await req('GET', '/dashboard/summary?period=7d', undefined, adminToken);
  report(2, 'GET /dashboard/summary?period=7d → 200',
    t2.status === 200 && isObject(t2.body.data),
    `status=${t2.status}`);

  // ── Test 3: GET /dashboard/summary?period=30d → 200 ──────────────────────
  const t3 = await req('GET', '/dashboard/summary?period=30d', undefined, adminToken);
  report(3, 'GET /dashboard/summary?period=30d → 200',
    t3.status === 200 && isObject(t3.body.data),
    `status=${t3.status}`);

  // ── Test 4: supplier GET /dashboard/supplier/summary → scoped data ────────
  const t4 = await req('GET', '/dashboard/supplier/summary', undefined, supplierToken);
  report(4, 'Supplier GET /dashboard/supplier/summary → 200 scoped data',
    t4.status === 200 && isObject(t4.body.data),
    `status=${t4.status}`);

  // ── Test 5: GET /dashboard/payments → paginated array ────────────────────
  const t5 = await req('GET', '/dashboard/payments', undefined, adminToken);
  const t5Data = t5.body.data;
  report(5, 'GET /dashboard/payments → 200 paginated array',
    t5.status === 200 && isArray(t5Data),
    `status=${t5.status}`);

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  INVOICE TESTS (6–10)                                                ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ── Test 6: GET /invoices as supplier → own invoices array ───────────────
  const t6 = await req('GET', '/invoices', undefined, supplierToken);
  const t6Data = t6.body.data;
  report(6, 'GET /invoices as supplier → 200 + data array',
    t6.status === 200 && isArray(t6Data),
    `status=${t6.status}`);

  // ── Resolve a buyer ID for invoice creation ───────────────────────────────
  const buyerId = await getFirstBuyerId(supplierToken);
  if (typeof buyerId !== 'string') {
    report(7, 'POST /invoices (draft) → 201', false, 'no buyers found — cannot create invoice');
    report(8, 'GET /invoices/:id → 200 + detail', false, 'skipped');
    report(9, 'PUT /invoices/:id (update draft) → 200', false, 'skipped');
    report(10, 'POST /invoices/:id/submit → 200 + status=submitted', false, 'skipped');
    printSummary();
    return;
  }

  // ── Test 7: POST /invoices → 201 + invoiceId (draft) ─────────────────────
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const uniqueNum = `INV-AUDIT-${Date.now()}`;
  const t7 = await req('POST', '/invoices', {
    invoice_number: uniqueNum,
    buyer_id: buyerId,
    face_value: 5000000,
    due_date: dueDate,
    description: 'Audit smoke test draft invoice',
  }, supplierToken);
  const createdId = typeof t7.body.invoiceId === 'string' ? t7.body.invoiceId : undefined;
  report(7, 'POST /invoices (create draft) → 201 + invoiceId',
    t7.status === 201 && typeof createdId === 'string',
    `status=${t7.status}`);

  if (createdId === undefined) {
    report(8, 'GET /invoices/:id → 200 + detail', false, 'no invoiceId from test 7');
    report(9, 'PUT /invoices/:id (update draft) → 200', false, 'skipped');
    report(10, 'POST /invoices/:id/submit → 200 + status=submitted', false, 'skipped');
    printSummary();
    return;
  }

  // ── Test 8: GET /invoices/:id → 200 + invoice detail ─────────────────────
  const t8 = await req('GET', `/invoices/${createdId}`, undefined, supplierToken);
  const t8Detail = t8.body;
  report(8, 'GET /invoices/:id → 200 + invoice detail',
    t8.status === 200 && isObject(t8Detail) && t8Detail.id === createdId,
    `status=${t8.status} id_match=${t8Detail.id === createdId}`);

  // ── Test 9: PUT /invoices/:id → 200 + updated detail ─────────────────────
  const t9 = await req('PUT', `/invoices/${createdId}`, {
    description: 'Audit smoke test draft invoice — updated description',
  }, supplierToken);
  report(9, 'PUT /invoices/:id (update draft) → 200',
    t9.status === 200 && isObject(t9.body) && t9.body.id === createdId,
    `status=${t9.status}`);

  // ── Test 10: POST /invoices/:id/submit → 200 + status=submitted ──────────
  const t10 = await req('POST', `/invoices/${createdId}/submit`, undefined, supplierToken);
  const t10Status = isObject(t10.body) ? (t10.body.status as string | undefined) : undefined;
  report(10, 'POST /invoices/:id/submit → 200 + status=submitted',
    t10.status === 200 && t10Status === 'submitted',
    `status=${t10.status} invoice_status=${t10Status ?? 'unknown'}`);

  printSummary();
}

run().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
