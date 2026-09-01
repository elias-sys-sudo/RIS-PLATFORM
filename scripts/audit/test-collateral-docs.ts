/**
 * scripts/audit/test-collateral-docs.ts
 * Collateral & Documents smoke-test — runs against the running backend (default port 4000).
 * Usage: ts-node --transpile-only scripts/audit/test-collateral-docs.ts [base_url]
 *
 * Tests (8 total):
 *  Collateral:
 *  1. POST /collateral valid invoice → 201
 *  2. GET /collateral?invoice_id=X → at least 1 item containing new record
 *  3. PUT /collateral/:id new estimated_value → 200
 *  4. DELETE /collateral/:id → 200 (soft delete)
 *  5. GET /collateral?invoice_id=X → new record is gone (soft-delete verified)
 *  6. DELETE collateral on funded invoice → 400/409/422 (business rule blocked)
 *  Documents:
 *  7. GET /documents/:seed_id/download → 200 with non-JSON content-type
 *  8. GET /documents/nonexistent/download → 404
 *
 * Prerequisites (run once):
 *   npm run seed                  — populates INV-SEED-001 to INV-SEED-004, seed collateral, seed doc
 *
 * Seed IDs used (deterministic, added by dev-seed.ts):
 *   SEED_FUNDED_COLLATERAL_ID = '00000000-4444-4000-b000-000000000010'
 *   SEED_DOCUMENT_ID          = '00000000-4444-4000-b000-000000000020'
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? '4000'}`;

// Seed credentials (dev-seed.ts defaults)
const CREDIT_EMAIL = 'credit1@test.ris.co.ug';
const DEFAULT_PASS = 'TestPassword123!';

// Deterministic UUIDs written by dev-seed.ts — must match exactly
const SEED_FUNDED_COLLATERAL_ID = '00000000-4444-4000-b000-000000000010';
const SEED_DOCUMENT_ID          = '00000000-4444-4000-b000-000000000020';
// A UUID that will never exist in the database
const NONEXISTENT_UUID          = '00000000-0000-4000-0000-ffffffffffff';

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
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: Record<string, unknown> = {};
  try {
    const text = await res.text();
    parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body — leave parsed empty */
  }

  return { status: res.status, body: parsed };
}

interface DownloadResponse {
  status: number;
  contentType: string;
  bodyLength: number;
}

/** Make a GET request and return the raw response metadata (status, headers, body size). */
async function reqDownload(path: string, token?: string): Promise<DownloadResponse> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  const buffer = await res.arrayBuffer();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    bodyLength: buffer.byteLength,
  };
}

let passed = 0;
let failed = 0;

function report(n: number, label: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  const suffix = detail.length > 0 ? `  (${detail})` : '';
  console.log(`[${mark}] Test ${n}: ${label}${suffix}`);
  if (ok) passed++;
  else failed++;
}

async function run(): Promise<void> {
  console.log(`\nMMS Collateral & Documents Smoke Tests → ${BASE}\n`);

  // ── Login as credit_officer ────────────────────────────────────────────────
  const loginRes = await req('POST', '/auth/login', {
    email: CREDIT_EMAIL,
    password: DEFAULT_PASS,
  });
  const token = (
    loginRes.body.access_token ??
    loginRes.body.token ??
    loginRes.body.accessToken
  ) as string | undefined;

  if (loginRes.status !== 200 || typeof token !== 'string' || token.length === 0) {
    console.error(`[FATAL] credit_officer login failed (status=${loginRes.status})`);
    process.exitCode = 1;
    return;
  }
  console.log(`[INFO] Logged in as ${CREDIT_EMAIL}\n`);

  // ── Find an overdue invoice for tests 1-5 ─────────────────────────────────
  // INV-SEED-001 is overdue — safe to attach and delete collateral.
  const invoicesRes = await req('GET', '/invoices?limit=50&status=overdue', undefined, token);
  const invoiceItems = invoicesRes.body.data as Array<Record<string, unknown>> | undefined;

  if (invoicesRes.status !== 200 || !Array.isArray(invoiceItems) || invoiceItems.length === 0) {
    console.error(
      `[FATAL] Could not list overdue invoices (status=${invoicesRes.status}) ` +
      `— ensure seed data is loaded (npm run seed)`,
    );
    process.exitCode = 1;
    printSummary();
    return;
  }

  const targetInvoice = invoiceItems.find((i) => i.invoice_number === 'INV-SEED-001') ?? invoiceItems[0];
  const targetInvoiceId = targetInvoice.id as string;
  console.log(
    `[INFO] Using invoice ${String(targetInvoice.invoice_number)} ` +
    `(id=${targetInvoiceId}) for tests 1–5\n`,
  );

  // ==========================================================================
  // Test 1: POST /collateral — create on valid (overdue) invoice → 201
  // ==========================================================================
  const t1 = await req(
    'POST',
    '/collateral',
    {
      invoice_id: targetInvoiceId,
      type: 'bank_guarantee',
      description: 'Audit test collateral — commercial property in Kampala',
      estimated_value: 50_000_000,
      currency: 'UGX',
      documents: [],
    },
    token,
  );
  const createdCollateral = t1.body.data as Record<string, unknown> | undefined;
  const createdId = createdCollateral?.id as string | undefined;
  report(
    1,
    'POST /collateral valid invoice → 201',
    t1.status === 201 && typeof createdId === 'string' && createdId.length > 0,
    `status=${t1.status} id=${createdId ?? 'none'}`,
  );

  if (typeof createdId !== 'string' || createdId.length === 0) {
    console.error('[WARN] No collateral ID returned from POST — skipping tests 2–5');
    report(2, 'GET /collateral?invoice_id=X → contains new record', false, 'skipped — test 1 failed');
    report(3, 'PUT /collateral/:id new value → 200', false, 'skipped — test 1 failed');
    report(4, 'DELETE /collateral/:id → 200', false, 'skipped — test 1 failed');
    report(5, 'GET /collateral?invoice_id=X → new record is gone', false, 'skipped — test 1 failed');
  } else {
    // ==========================================================================
    // Test 2: GET /collateral?invoice_id=X — new record is visible
    // ==========================================================================
    const t2 = await req('GET', `/collateral?invoice_id=${targetInvoiceId}`, undefined, token);
    const items2 = (t2.body.data as Array<Record<string, unknown>> | undefined) ?? [];
    const newItemVisible = items2.some((item) => item.id === createdId);
    report(
      2,
      'GET /collateral?invoice_id=X → contains new record (≥1 item)',
      t2.status === 200 && newItemVisible,
      `status=${t2.status} items=${items2.length} found=${String(newItemVisible)}`,
    );

    // ==========================================================================
    // Test 3: PUT /collateral/:id — update estimated_value to 75M → 200
    // ==========================================================================
    const t3 = await req(
      'PUT',
      `/collateral/${createdId}`,
      { estimated_value: 75_000_000 },
      token,
    );
    const updatedValue = (t3.body.data as Record<string, unknown> | undefined)?.value;
    const valueMatch =
      Number(updatedValue) === 75_000_000 || String(updatedValue) === '75000000';
    report(
      3,
      'PUT /collateral/:id new value → 200',
      t3.status === 200 && valueMatch,
      `status=${t3.status} value=${String(updatedValue ?? '?')}`,
    );

    // ==========================================================================
    // Test 4: DELETE /collateral/:id — soft delete → 200
    // ==========================================================================
    const t4 = await req('DELETE', `/collateral/${createdId}`, undefined, token);
    report(
      4,
      'DELETE /collateral/:id → 200 soft delete',
      t4.status === 200,
      `status=${t4.status}`,
    );

    // ==========================================================================
    // Test 5: GET /collateral?invoice_id=X — new record is gone after soft delete
    // ==========================================================================
    const t5 = await req('GET', `/collateral?invoice_id=${targetInvoiceId}`, undefined, token);
    const items5 = (t5.body.data as Array<Record<string, unknown>> | undefined) ?? [];
    const newItemStillVisible = items5.some((item) => item.id === createdId);
    report(
      5,
      'GET /collateral?invoice_id=X → new record gone after soft delete',
      t5.status === 200 && !newItemStillVisible,
      `status=${t5.status} items=${items5.length} still_visible=${String(newItemStillVisible)}`,
    );
  }

  // ==========================================================================
  // Test 6: DELETE seed collateral on funded invoice → 400/409/422 (blocked)
  // ==========================================================================
  // The seed adds a collateral (FUNDED_COLL_ID) on INV-SEED-004 (status=funded).
  // The service throws BusinessRuleError (422) when invoice is funded.
  const t6 = await req('DELETE', `/collateral/${SEED_FUNDED_COLLATERAL_ID}`, undefined, token);
  report(
    6,
    'DELETE collateral on funded invoice → 400/409/422 (business rule)',
    t6.status === 400 || t6.status === 409 || t6.status === 422,
    `status=${t6.status} id=${SEED_FUNDED_COLLATERAL_ID}`,
  );

  // ==========================================================================
  // Test 7: GET /documents/:seed_id/download → 200 with non-JSON content-type
  // ==========================================================================
  // Seed doc points to src/shared/database/seeds/fixtures/test-document.pdf
  const t7 = await reqDownload(`/documents/${SEED_DOCUMENT_ID}/download`, token);
  const isPdf = t7.contentType.includes('application/pdf');
  report(
    7,
    'GET /documents/:seed_id/download → 200 with content-type application/pdf',
    t7.status === 200 && isPdf && t7.bodyLength > 0,
    `status=${t7.status} content-type=${t7.contentType} bytes=${t7.bodyLength}`,
  );

  // ==========================================================================
  // Test 8: GET /documents/nonexistent/download → 404
  // ==========================================================================
  const t8 = await req('GET', `/documents/${NONEXISTENT_UUID}/download`, undefined, token);
  report(
    8,
    'GET /documents/nonexistent/download → 404',
    t8.status === 404,
    `status=${t8.status}`,
  );

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
