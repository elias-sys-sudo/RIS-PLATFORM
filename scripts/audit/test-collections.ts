/**
 * scripts/audit/test-collections.ts
 * Collections smoke-test — runs against the running backend (default port 4000).
 * Usage: ts-node --transpile-only scripts/audit/test-collections.ts [base_url]
 *
 * Tests (8 total):
 *  1. GET /collections                     → 200 + paginated list
 *  2. GET /collections/:seed_id            → 200 + detail with payment history
 *  3. POST /collections/:id/payments       → 200 (bank_transfer)
 *  4. Verify collected_amount increased    → GET detail before/after
 *  5. POST /collections/:id/payments       → 200 (bank_transfer) + balance updates
 *  6. POST /collections/:id/escalate       → 200, level increments by 1
 *  7. Verify escalation_date set           → escalation_history has recent entry
 *  8. POST escalate on collected           → 400/409/422 (business rule error)
 *
 * Seed collections used:
 *  - INV-SEED-001 (overdue, 75M, has seeded MTN payment) → tests 2, 6, 7
 *  - INV-SEED-003 (overdue, 45M, status=overdue) → tests 3, 4, 5
 *  - INV-SEED-002 (collected) → test 8
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? '4000'}`;

const CREDIT_EMAIL = 'credit1@test.ris.co.ug';
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
  if (ok) passed++;
  else failed++;
}

/** Convert escalation label string or numeric to an integer 0-3. */
function labelToNumeric(label: unknown): number {
  if (typeof label === 'number') return label;
  if (label === 'legal') return 3;
  if (label === 'formal') return 2;
  if (label === 'reminder') return 1;
  return 0;
}

/** Extract the flat detail object from the wrapped response. */
function extractDetail(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data as Record<string, unknown>) ?? {};
}

async function run(): Promise<void> {
  console.log(`\nMMS Collections Smoke Tests → ${BASE}\n`);

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

  // ── Test 1: GET /collections — paginated list ──────────────────────────────
  const t1 = await req('GET', '/collections?page=1&page_size=50', undefined, token);
  const items = t1.body.data as Array<Record<string, unknown>> | undefined;
  const hasData =
    t1.status === 200 &&
    Array.isArray(items) &&
    items.length > 0 &&
    typeof t1.body.total === 'number';
  report(1, 'GET /collections → 200 + paginated list', hasData,
    `status=${t1.status} items=${Array.isArray(items) ? items.length : '?'} total=${String(t1.body.total ?? '?')}`);

  if (!Array.isArray(items) || items.length === 0) {
    console.error('[FATAL] No collections in list — run seed data first (npm run seed)');
    process.exitCode = 1;
    printSummary();
    return;
  }

  // ── Identify seed collections by invoice_number ────────────────────────────
  // INV-SEED-001: overdue, 75M face_value, has seeded MTN payment → detail + escalation tests
  // INV-SEED-002: collected → error test
  // INV-SEED-003: overdue, 45M face_value → payment tests
  const coll001 = items.find((c) => c.invoice_number === 'INV-SEED-001');
  const coll002 = items.find((c) => c.invoice_number === 'INV-SEED-002');
  const coll003 = items.find((c) => c.invoice_number === 'INV-SEED-003');

  // Fallbacks: use any overdue collection if named ones are not found
  const overdueItems = items.filter((c) => c.status === 'overdue');
  const detailTarget = coll001 ?? overdueItems[0];
  const paymentTarget = coll003 ?? overdueItems[1] ?? overdueItems[0];
  const escalTarget = coll001 ?? overdueItems[0];  // must be overdue, different from paymentTarget if possible
  const collectedTarget = coll002 ?? items.find((c) => c.status === 'collected');

  if (!detailTarget || !paymentTarget) {
    console.error('[FATAL] Could not identify required seed collections — check seed data');
    process.exitCode = 1;
    printSummary();
    return;
  }

  const detailId = detailTarget.id as string;
  const paymentId = paymentTarget.id as string;
  const escalId = escalTarget?.id as string | undefined;

  console.log(`[INFO] Detail target:   ${detailTarget.invoice_number as string} (id=${detailId} status=${String(detailTarget.status)})`);
  console.log(`[INFO] Payment target:  ${paymentTarget.invoice_number as string} (id=${paymentId} status=${String(paymentTarget.status)})`);
  console.log(`[INFO] Escalate target: ${escalTarget ? String(escalTarget.invoice_number) : 'none'} (id=${escalId ?? 'none'})`);
  console.log(`[INFO] Collected target: ${collectedTarget ? String(collectedTarget.invoice_number) : 'none'}\n`);

  // ── Test 2: GET /collections/:id — detail with payment history ─────────────
  const t2 = await req('GET', `/collections/${detailId}`, undefined, token);
  const det2 = extractDetail(t2.body);
  const paymentHistory = det2.payment_history as unknown[] | undefined;
  const hasPayments = Array.isArray(paymentHistory) && paymentHistory.length > 0;
  report(
    2,
    'GET /collections/:seed_id → 200 + detail with payment history',
    t2.status === 200 && hasPayments,
    `status=${t2.status} payments=${Array.isArray(paymentHistory) ? paymentHistory.length : '?'}`,
  );

  // ── Pre-test: record current collected_amount on the payment target ─────────
  const beforeDetailRes = await req('GET', `/collections/${paymentId}`, undefined, token);
  const beforeDetail = extractDetail(beforeDetailRes.body);
  const beforeCollected = Number(beforeDetail.collected_amount ?? beforeDetail.total_collected ?? 0);

  // ── Test 3: POST payment with bank_transfer ────────────────────────────────────
  const ref1 = `MOMO-AUDIT-${Date.now()}`;
  const t3 = await req(
    'POST',
    `/collections/${paymentId}/payments`,
    {
      amount: 5_000_000,
      method: 'bank_transfer',
      reference: ref1,
      paid_by: 'Audit Script Buyer',
      payment_date: new Date().toISOString().split('T')[0] as string,
      notes: 'Audit test payment 1 — bank_transfer',
    },
    token,
  );
  report(
    3,
    'POST /collections/:id/payments (bank_transfer) → 200',
    t3.status === 200 || t3.status === 201,
    `status=${t3.status}`,
  );

  // ── Test 4: Verify collected_amount increased after bank_transfer payment ────────
  const afterMomoRes = await req('GET', `/collections/${paymentId}`, undefined, token);
  const afterMomoDetail = extractDetail(afterMomoRes.body);
  const afterMomoCollected = Number(afterMomoDetail.collected_amount ?? afterMomoDetail.total_collected ?? 0);
  report(
    4,
    'collected_amount increased after bank_transfer payment',
    afterMomoCollected > beforeCollected,
    `before=${beforeCollected} after=${afterMomoCollected}`,
  );

  // ── Test 5: POST payment with bank_transfer + verify balance updates ────────
  const ref2 = `RTGS-AUDIT-${Date.now()}`;
  const t5 = await req(
    'POST',
    `/collections/${paymentId}/payments`,
    {
      amount: 3_000_000,
      method: 'bank_transfer',
      reference: ref2,
      paid_by: 'Audit Script Treasury',
      payment_date: new Date().toISOString().split('T')[0] as string,
      notes: 'Audit test payment 2 — bank_transfer',
    },
    token,
  );
  const afterBankRes = await req('GET', `/collections/${paymentId}`, undefined, token);
  const afterBankDetail = extractDetail(afterBankRes.body);
  const afterBankCollected = Number(afterBankDetail.collected_amount ?? afterBankDetail.total_collected ?? 0);
  report(
    5,
    'POST /collections/:id/payments (bank_transfer) → 200 + balance updates',
    (t5.status === 200 || t5.status === 201) && afterBankCollected > afterMomoCollected,
    `status=${t5.status} after_momo=${afterMomoCollected} after_bank=${afterBankCollected}`,
  );

  // ── Tests 6 & 7: escalation on a different (overdue) collection ────────────
  if (!escalId) {
    report(6, 'POST /collections/:id/escalate (different collection) → 200', false, 'No overdue collection found');
    report(7, 'escalation_history has recent occurred_at after escalation', false, 'skipped — no escalation target');
  } else {
    // Get current escalation level from detail
    const escalBeforeRes = await req('GET', `/collections/${escalId}`, undefined, token);
    const escalBefore = extractDetail(escalBeforeRes.body);
    let beforeLevel = labelToNumeric(escalBefore.escalation_level);

    // If at max level (3), de-escalate once to create room for the escalation test
    if (beforeLevel >= 3) {
      const deescRes = await req(
        'POST',
        `/collections/${escalId}/de-escalate`,
        { reason: 'Audit script reset — de-escalate before escalation test' },
        token,
      );
      if (deescRes.status === 200) {
        beforeLevel = 2;
        console.log(`[INFO] De-escalated ${String(escalTarget?.invoice_number)} from legal(3) → formal(2) to enable test`);
      } else {
        console.log(`[WARN] De-escalate returned ${deescRes.status} — escalation test may report unexpected result`);
      }
    }

    // ── Test 6: POST escalate → level + 1 ─────────────────────────────────────
    const t6 = await req(
      'POST',
      `/collections/${escalId}/escalate`,
      { reason: 'Audit script escalation test — buyer non-payment after reminder' },
      token,
    );

    const escalAfterRes = await req('GET', `/collections/${escalId}`, undefined, token);
    const escalAfter = extractDetail(escalAfterRes.body);
    const afterLevel = labelToNumeric(escalAfter.escalation_level);
    const expectedLevel = Math.min(beforeLevel + 1, 3);

    report(
      6,
      'POST /collections/:id/escalate (different collection) → 200, level+1',
      t6.status === 200 && afterLevel === expectedLevel,
      `status=${t6.status} before=${beforeLevel} after=${afterLevel} expected=${expectedLevel}`,
    );

    // ── Test 7: Verify escalation_history has a recent occurred_at ─────────────
    const escalHistory = escalAfter.escalation_history as Array<Record<string, unknown>> | undefined;
    const hasEscalHistory = Array.isArray(escalHistory) && escalHistory.length > 0;
    const latestEscal = hasEscalHistory ? escalHistory[escalHistory.length - 1] : null;
    const occurredAt = latestEscal?.occurred_at;

    report(
      7,
      'escalation_history has recent occurred_at after escalation',
      t6.status === 200 && hasEscalHistory && typeof occurredAt === 'string' && occurredAt.length > 0,
      `history_count=${Array.isArray(escalHistory) ? escalHistory.length : '?'} occurred_at=${String(occurredAt ?? 'null')}`,
    );
  }

  // ── Test 8: POST escalate on collected collection → error ─────────────────
  if (!collectedTarget) {
    report(8, 'POST escalate on collected collection → 400/409/422', false,
      'No collected collection found in seed data');
  } else {
    const collectedId = collectedTarget.id as string;
    const t8 = await req(
      'POST',
      `/collections/${collectedId}/escalate`,
      { reason: 'Audit script — this should be rejected' },
      token,
    );
    report(
      8,
      'POST escalate on collected collection → error 400/409/422',
      t8.status === 400 || t8.status === 409 || t8.status === 422,
      `status=${t8.status} invoice=${String(collectedTarget.invoice_number)}`,
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
