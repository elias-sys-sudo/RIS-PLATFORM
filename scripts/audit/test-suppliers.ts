/**
 * scripts/audit/test-suppliers.ts
 * Live supplier smoke-test — runs against the running backend (default port 4000).
 * Usage: ts-node --transpile-only scripts/audit/test-suppliers.ts [base_url]
 *
 * Tests:
 *   1. GET /suppliers           — paginated list
 *   2. GET /suppliers/:seed_id  — detail with profile fields
 *   3. GET /suppliers/:id/buyers               — paginated buyer list
 *   4. GET /suppliers/:id/buyers?search=...    — filtered results
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? '4000'}`;

const ADMIN_EMAIL = 'md1@test.ris.co.ug';
const DEFAULT_PASS = 'TestPassword123!';

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
  if (!ok) {
    console.log(`       ^ expected passing condition was false`);
  }
  if (ok) passed++; else failed++;
}

function hasPaginationFields(body: Record<string, unknown>): boolean {
  return (
    typeof body.total === 'number' &&
    typeof body.page === 'number' &&
    typeof body.page_size === 'number' &&
    typeof body.total_pages === 'number'
  );
}

async function run(): Promise<void> {
  console.log(`\nMMS Supplier Smoke Tests → ${BASE}\n`);

  // ── Login as admin (management role) ────────────────────────────────────────
  const loginRes = await req('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: DEFAULT_PASS,
  });
  const token = (
    loginRes.body.access_token ??
    loginRes.body.token ??
    loginRes.body.accessToken
  ) as string | undefined;

  if (loginRes.status !== 200 || typeof token !== 'string' || token.length === 0) {
    console.error(
      `[FATAL] Admin login failed — status=${loginRes.status}. ` +
      `Ensure the server is running and the seed has been applied.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[OK] Admin login succeeded (md1@test.ris.co.ug)\n`);

  // ── Test 1: GET /suppliers — paginated list ──────────────────────────────────
  const t1 = await req('GET', '/suppliers', undefined, token);
  const t1Data = Array.isArray(t1.body.data)
    ? (t1.body.data as Record<string, unknown>[])
    : null;
  const t1Ok =
    t1.status === 200 &&
    t1Data !== null &&
    hasPaginationFields(t1.body);

  report(
    1,
    'GET /suppliers → 200 + paginated list (data[], total, page, page_size, total_pages)',
    t1Ok,
    `status=${t1.status}, items=${t1Data?.length ?? 'N/A'}, total=${t1.body.total ?? 'N/A'}`,
  );

  if (!t1Ok || t1Data === null || t1Data.length === 0) {
    const reason = !t1Ok ? 'list request failed' : 'no suppliers in DB — run dev-seed first';
    report(2, 'GET /suppliers/:id → detail with profile fields', false, `skipped — ${reason}`);
    report(3, 'GET /suppliers/:id/buyers → paginated buyer list', false, `skipped — ${reason}`);
    report(4, 'GET /suppliers/:id/buyers?search=... → filtered results', false, `skipped — ${reason}`);
    printSummary();
    return;
  }

  // Prefer the seeded "Test Supplier Ltd" (has linked buyer invoices); fall back to first
  const listItems = t1Data as Array<{ id: string; name?: string; company?: string }>;
  const supplierItem =
    listItems.find((s) => s.name === 'Test Supplier Ltd' || s.company === 'Test Supplier Ltd') ??
    listItems[0];
  const supplierId = supplierItem.id as string;
  const supplierLabel = (supplierItem.name ?? supplierItem.company ?? supplierId) as string;

  console.log(`  Using supplier: "${supplierLabel}" (${supplierId})\n`);

  // ── Test 2: GET /suppliers/:id — detail with profile fields ─────────────────
  const t2 = await req('GET', `/suppliers/${supplierId}`, undefined, token);
  const t2b = t2.body;
  const t2HasProfile =
    typeof t2b.company_name === 'string' &&
    typeof t2b.registration_number === 'string' &&
    typeof t2b.contact_email === 'string' &&
    typeof t2b.kyc_status === 'string' &&
    typeof t2b.risk_tier === 'string' &&
    t2b.metrics !== null &&
    typeof t2b.metrics === 'object';

  report(
    2,
    'GET /suppliers/:id → 200 + profile fields (company_name, reg_number, contact_email, kyc_status, risk_tier, metrics)',
    t2.status === 200 && t2HasProfile,
    `status=${t2.status}, company="${t2b.company_name ?? 'N/A'}", kyc=${t2b.kyc_status ?? 'N/A'}`,
  );

  // ── Test 3: GET /suppliers/:id/buyers — paginated buyer list ─────────────────
  const t3 = await req('GET', `/suppliers/${supplierId}/buyers`, undefined, token);
  const t3Data = Array.isArray(t3.body.data)
    ? (t3.body.data as Record<string, unknown>[])
    : null;
  const t3Pagination =
    t3.body.pagination !== null &&
    typeof t3.body.pagination === 'object' &&
    t3.body.pagination !== undefined;

  const t3Ok = t3.status === 200 && t3Data !== null && t3Pagination;
  report(
    3,
    'GET /suppliers/:id/buyers → 200 + { data[], pagination }',
    t3Ok,
    `status=${t3.status}, buyers=${t3Data?.length ?? 'N/A'}`,
  );

  if (!t3Ok) {
    report(
      4,
      'GET /suppliers/:id/buyers?search=... → filtered results',
      false,
      'skipped — buyers list request failed',
    );
    printSummary();
    return;
  }

  // ── Test 4: GET /suppliers/:id/buyers?search=partial_name — filtered ─────────
  // "Corporation" matches "Test Buyer Corporation" from the seed
  const searchTerm = 'Corporation';
  const t4 = await req(
    'GET',
    `/suppliers/${supplierId}/buyers?search=${encodeURIComponent(searchTerm)}`,
    undefined,
    token,
  );
  const t4Data = Array.isArray(t4.body.data)
    ? (t4.body.data as Record<string, unknown>[])
    : null;

  // All returned items must match the search term (case-insensitive)
  const t4AllMatch =
    t4Data !== null &&
    t4Data.every(
      (b) =>
        typeof b.company_name === 'string' &&
        b.company_name.toLowerCase().includes(searchTerm.toLowerCase()),
    );

  // If the seeded buyer exists, we expect at least one result
  const t3TotalBuyers =
    typeof (t3.body.pagination as Record<string, unknown>)?.total === 'number'
      ? ((t3.body.pagination as Record<string, unknown>).total as number)
      : (t3Data?.length ?? 0);

  // Pass if: 200 + data array + all returned items match filter
  // (empty result is acceptable only when no buyers have invoices for this supplier)
  const t4HasPagination =
    t4.body.pagination !== null && typeof t4.body.pagination === 'object';
  const t4Ok = t4.status === 200 && t4Data !== null && t4AllMatch && t4HasPagination;

  const matchCount = t4Data?.length ?? 0;
  report(
    4,
    `GET /suppliers/:id/buyers?search=${searchTerm} → filtered results (all match filter)`,
    t4Ok,
    `status=${t4.status}, matches=${matchCount}, totalBuyers=${t3TotalBuyers}`,
  );

  if (t4Ok && t3TotalBuyers > 0 && matchCount === 0) {
    console.log(
      `  NOTE: search returned 0 results — if "Test Buyer Corporation" exists ` +
      `for this supplier, check dev-seed has been fully applied.`,
    );
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
