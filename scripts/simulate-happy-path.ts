/**
 * scripts/simulate-happy-path.ts
 *
 * End-to-end happy-path simulation of an invoice transaction touching every
 * party — supplier, buyer, credit officer, finance managers (×2 for dual
 * auth), management, auditor — against a running dev backend + dev DB.
 *
 * Drives the lifecycle in narrative order:
 *   submit → buyer_confirmed → scored → priced → approved →
 *   pending_first_auth → pending_second_auth → executing → funded →
 *   collecting → collected → settlement initiated → facility_repaid →
 *   profit_booked → settlement closed
 *
 * Usage: npm run simulate:happy-path  (after `npm run db:seed && npm run dev`)
 *
 * Conventions:
 *  - HTTP for user-facing actions (login, submit, confirm, approve, authorise,
 *    record-payment, settlement initiate/repay/book/close).
 *  - Direct service imports for worker-driven fallbacks (risk scoring,
 *    pricing, payment initiation, payment execution, start collection
 *    monitoring) — same fallback pattern as tests/integration/invoice-lifecycle.test.ts.
 *  - Direct DB writes for one-off setup the system normally fakes via
 *    out-of-band channels (confirmation token hash, collateral row).
 *
 * The script mirrors the canonical happy path from
 * tests/integration/invoice-lifecycle.test.ts but runs against the dev DB so
 * UAT users can log in to the same backend and inspect the resulting state.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import crypto from 'crypto';
import { Pool } from 'pg';

// =========================================================================
// Configuration
// =========================================================================

const BASE_URL = process.env.SIMULATION_BASE_URL ?? `http://localhost:${process.env.PORT ?? '4000'}`;
const PASSWORD = 'TestPassword123!';
const SUPPLIER_EMAIL = 'supplier1@test.ris.co.ug';
const CREDIT_OFFICER_EMAIL = 'credit1@test.ris.co.ug';
const FINANCE_1_EMAIL = 'finance1@test.ris.co.ug';
const FINANCE_2_EMAIL = 'finance2@test.ris.co.ug';
const MD_EMAIL = 'md1@test.ris.co.ug';
const AUDITOR_EMAIL = 'auditor1@test.ris.co.ug';

const FACE_VALUE_UGX = 5_000_000; // below 10M auto-approve threshold
const TENOR_DAYS = 30;

// Stage delay so a viewer can follow output in real time.
const STAGE_PAUSE_MS = 800;

// Polling for BullMQ workers (risk scoring, pricing).
const POLL_INTERVAL_MS = 500;
const POLL_MAX_ATTEMPTS = 10;

// =========================================================================
// DB pool (shares dev DATABASE_URL with the running backend)
// =========================================================================

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// =========================================================================
// Types
// =========================================================================

interface LoginResult {
  token: string;
  userId: string;
  email: string;
}

interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface SeedSupplier {
  id: string;
  user_id: string;
}

interface SeedBuyer {
  id: string;
  registration_number: string;
}

// =========================================================================
// HTTP helpers
// =========================================================================

async function http<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: T = {} as T;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      // non-JSON body
    }
  }
  return { status: res.status, body: parsed };
}

async function login(email: string): Promise<LoginResult> {
  const res = await http<{ accessToken?: string }>(
    'POST',
    '/auth/login',
    { email, password: PASSWORD },
  );
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`Login failed for ${email}: status=${res.status}`);
  }
  const token = res.body.accessToken;
  const payloadB64 = token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    userId: string;
  };
  return { token, userId: payload.userId, email };
}

// =========================================================================
// Display helpers
// =========================================================================

function formatUGX(amount: string | number | bigint): string {
  const n = typeof amount === 'string' ? BigInt(amount) : BigInt(amount);
  const formatted = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `UGX ${formatted}`;
}

function banner(stage: number, party: string, action: string): void {
  const stageStr = String(stage).padStart(2, '0');
  process.stdout.write(`\n──── Stage ${stageStr} · ${party} · ${action} ────\n`);
}

function step(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================================================================
// DB lookup helpers
// =========================================================================

async function getSeedSupplier(): Promise<SeedSupplier> {
  const res = await pool.query<SeedSupplier>(
    `SELECT s.id, s.user_id
     FROM suppliers s
     JOIN users u ON u.id = s.user_id
     WHERE u.email = $1`,
    [SUPPLIER_EMAIL],
  );
  if (res.rows.length === 0) {
    throw new Error('Seed supplier not found — run `npm run db:seed` first');
  }
  return res.rows[0];
}

async function getSeedBuyer(): Promise<SeedBuyer> {
  const res = await pool.query<SeedBuyer>(
    `SELECT id, registration_number FROM buyers WHERE company_name = 'Test Buyer Corporation'`,
  );
  if (res.rows.length === 0) {
    throw new Error('Seed buyer not found — run `npm run db:seed` first');
  }
  return res.rows[0];
}

async function getInvoiceStatus(invoiceId: string): Promise<string> {
  const res = await pool.query<{ status: string }>(
    `SELECT status FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return res.rows[0]?.status ?? 'unknown';
}

async function getCollectionForInvoice(invoiceId: string): Promise<{ id: string; status: string } | null> {
  const res = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM collections WHERE invoice_id = $1`,
    [invoiceId],
  );
  return res.rows[0] ?? null;
}

async function getSettlementForInvoice(invoiceId: string): Promise<{ id: string; status: string } | null> {
  const res = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM settlements WHERE invoice_id = $1`,
    [invoiceId],
  );
  return res.rows[0] ?? null;
}

async function getNetProfit(settlementId: string): Promise<string> {
  const res = await pool.query<{ net_profit: string | null }>(
    `SELECT net_profit FROM settlements WHERE id = $1`,
    [settlementId],
  );
  return res.rows[0]?.net_profit ?? '0';
}

async function getPaymentForInvoice(invoiceId: string): Promise<{
  id: string;
  status: string;
  amount: string;
} | null> {
  const res = await pool.query<{ id: string; status: string; amount: string }>(
    `SELECT id, status, amount FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [invoiceId],
  );
  return res.rows[0] ?? null;
}

async function countAuditEntries(invoiceId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM audit_logs WHERE entity_id = $1 OR record_id = $1`,
    [invoiceId],
  );
  return parseInt(res.rows[0]?.count ?? '0', 10);
}

// =========================================================================
// Stage 0 — preflight: backend reachable, seed users present, providers
// =========================================================================

async function preflight(): Promise<void> {
  banner(0, 'system', 'preflight checks');

  // 1. Backend reachable
  try {
    await http('GET', '/health');
    step(`backend reachable at ${BASE_URL}`);
  } catch (err) {
    throw new Error(
      `Backend not reachable at ${BASE_URL}. Start it with \`npm run dev\` first.`,
    );
  }

  // 2. Seed users present
  const userCheck = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM users WHERE email LIKE '%@test.ris.co.ug'`,
  );
  const userCount = parseInt(userCheck.rows[0]?.count ?? '0', 10);
  if (userCount < 14) {
    throw new Error(
      `Only ${userCount} test users found (need 14). Run \`npm run db:seed\` first.`,
    );
  }
  step(`${userCount} test users found`);

  // 3. Register payment providers in this process so executePayment resolves
  //    a provider after dual-auth completes. The running backend has its own
  //    registration; this one is for direct service.executePayment() calls.
  const { initPaymentProviders } = await import(
    '../src/services/payments/providers/registry'
  );
  initPaymentProviders(process.env);
  step('payment providers registered (mock — non-prod)');
}

// =========================================================================
// Stage 1 — Supplier submits the invoice
// =========================================================================

interface Stage1Output {
  supplierToken: string;
  supplierUserId: string;
  buyerId: string;
  invoiceId: string;
  invoiceNumber: string;
}

async function stage1_supplierSubmits(): Promise<Stage1Output> {
  banner(1, 'Supplier (Test Supplier Ltd)', 'submits invoice');

  const supplier = await login(SUPPLIER_EMAIL);
  step(`logged in as ${supplier.email}`);

  const buyer = await getSeedBuyer();
  step(`buyer resolved: Test Buyer Corporation (${buyer.id})`);

  const invoiceNumber = `SIM-${Date.now()}`;
  const dueDate = new Date(Date.now() + TENOR_DAYS * 86_400_000)
    .toISOString()
    .split('T')[0];

  const res = await http<{ invoiceId: string }>(
    'POST',
    '/invoices/submit',
    {
      invoice_number: invoiceNumber,
      buyer_id: buyer.id,
      face_value: FACE_VALUE_UGX,
      due_date: dueDate,
      description: 'Happy-path simulation invoice — supplies for Q1 logistics',
      ura_efris_ref: `EFR-SIM-${Date.now()}`,
    },
    supplier.token,
  );

  if (res.status !== 201 || !res.body.invoiceId) {
    throw new Error(`Invoice submit failed: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  const invoiceId = res.body.invoiceId;
  step(`invoice ${invoiceNumber} submitted — ${formatUGX(FACE_VALUE_UGX)} due in ${TENOR_DAYS} days`);
  step(`status → ${await getInvoiceStatus(invoiceId)}`);

  return {
    supplierToken: supplier.token,
    supplierUserId: supplier.userId,
    buyerId: buyer.id,
    invoiceId,
    invoiceNumber,
  };
}

// =========================================================================
// Stage 2 — Buyer confirms via verification token
// =========================================================================

async function stage2_buyerConfirms(invoiceId: string): Promise<void> {
  banner(2, 'Buyer (Test Buyer Corporation)', 'confirms invoice');

  // Generate the raw token + hash, persist hash on the invoice. The real
  // verification flow emails the raw token to the buyer; here we short-cut.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await pool.query(
    `UPDATE invoices
     SET confirmation_token_hash = $1, confirmation_token_expires_at = $2
     WHERE id = $3`,
    [tokenHash, expiresAt, invoiceId],
  );
  step('confirmation token issued (in real flow: sent to buyer by email)');

  const res = await http(
    'POST',
    `/verify/${rawToken}/confirm`,
    {
      invoice_is_valid: true,
      amount_is_correct: true,
      due_date_is_correct: true,
      agrees_to_pay_ris: true,
    },
  );
  if (res.status !== 200) {
    throw new Error(`Buyer confirm failed: status=${res.status}`);
  }
  step('buyer confirmed: invoice is valid, amount correct, agrees to pay MMS at maturity');
  step(`status → ${await getInvoiceStatus(invoiceId)}`);
}

// =========================================================================
// Stage 3 — Risk engine scores the invoice (5 factors)
// =========================================================================

async function stage3_riskScores(invoiceId: string): Promise<void> {
  banner(3, 'system (risk-engine)', 'computes 5-factor score');

  // Wait for the BullMQ scoring worker, fall back to direct call.
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM risk_scores WHERE invoice_id = $1`,
      [invoiceId],
    );
    if (parseInt(res.rows[0].count, 10) > 0) {
      step('risk score produced by worker');
      break;
    }
    if (i === POLL_MAX_ATTEMPTS - 1) {
      const { scoreInvoice } = await import('../src/services/risk-engine/risk-engine.service');
      await scoreInvoice(invoiceId);
      step('risk score produced by direct call (worker fallback)');
    }
    await delay(POLL_INTERVAL_MS);
  }

  const res = await pool.query<{
    buyer_credit_score: number;
    tenor_score: number;
    track_record_score: number;
    concentration_score: number;
    collateral_score: number;
    final_score: number;
  }>(
    `SELECT buyer_credit_score, tenor_score, track_record_score,
            concentration_score, collateral_score, final_score
     FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  const r = res.rows[0];
  step(
    `factors: buyer=${r.buyer_credit_score} tenor=${r.tenor_score} track=${r.track_record_score} ` +
      `conc=${r.concentration_score} collat=${r.collateral_score} → final=${r.final_score}`,
  );
}

// =========================================================================
// Stage 4 — Pricing computes advance + discount
// =========================================================================

async function stage4_priced(invoiceId: string): Promise<void> {
  banner(4, 'system (pricing)', 'computes advance + discount');

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const res = await pool.query<{ advance_amount: string | null }>(
      `SELECT advance_amount FROM risk_scores WHERE invoice_id = $1`,
      [invoiceId],
    );
    if (res.rows[0]?.advance_amount !== null && res.rows[0]?.advance_amount !== undefined) {
      step('priced by worker');
      break;
    }
    if (i === POLL_MAX_ATTEMPTS - 1) {
      const { priceInvoice } = await import('../src/services/pricing/pricing.service');
      await priceInvoice(invoiceId);
      step('priced by direct call (worker fallback)');
    }
    await delay(POLL_INTERVAL_MS);
  }

  const res = await pool.query<{
    advance_amount: string;
    discount_amount: string;
    net_payment_to_supplier: string;
  }>(
    `SELECT advance_amount, discount_amount, net_payment_to_supplier
     FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  const p = res.rows[0];
  step(`advance amount      = ${formatUGX(p.advance_amount)}`);
  step(`MMS discount        = ${formatUGX(p.discount_amount)}`);
  step(`net to supplier     = ${formatUGX(p.net_payment_to_supplier)}`);
}

// =========================================================================
// Stage 5 — Credit officer approves (auto-tier for face_value < 10M)
// =========================================================================

async function stage5_creditOfficerApproves(invoiceId: string): Promise<string> {
  banner(5, 'Credit Officer (credit1)', 'approves invoice');

  const co = await login(CREDIT_OFFICER_EMAIL);
  step(`logged in as ${co.email}`);

  const res = await http<{ decision: string; quorumReached: boolean }>(
    'POST',
    `/invoices/${invoiceId}/approve`,
    { comments: 'Auto-approve tier — face value below 10M, score qualifies.' },
    co.token,
  );
  if (res.status !== 200) {
    throw new Error(`Approve failed: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  step(`decision: ${res.body.decision}, quorum reached: ${String(res.body.quorumReached)}`);
  step(`status → ${await getInvoiceStatus(invoiceId)}`);
  return co.token;
}

// =========================================================================
// Stage 6 — Payment instruction created (initiates dual-auth flow)
// =========================================================================

async function stage6_initiatePayment(
  invoiceId: string,
  supplierUuid: string,
): Promise<string> {
  banner(6, 'system (payments)', 'creates payment, requests dual auth');

  // Insert collateral so checkCoverageRatio passes (>=50% of face value).
  await pool.query(
    `INSERT INTO collateral
       (id, supplier_id, invoice_id, collateral_type, value, description, is_active)
     SELECT gen_random_uuid(), $1, $2, 'bank_guarantee', $3, $4, true
     WHERE NOT EXISTS (SELECT 1 FROM collateral WHERE invoice_id = $2)`,
    [
      supplierUuid,
      invoiceId,
      String(Math.ceil(FACE_VALUE_UGX * 0.6)),
      'Simulation collateral — bank guarantee 60% coverage',
    ],
  );
  step('collateral attached (60% coverage — passes coverage ratio gate)');

  const { initiatePayment } = await import('../src/services/payments/payments.service');
  const payment = await initiatePayment(invoiceId);
  step(`payment ${payment.id} created — status=${payment.status}`);
  step(`amount to disburse = ${formatUGX(payment.amount)}`);
  return payment.id;
}

// =========================================================================
// Stage 7 — Dual auth (two distinct finance managers)
// =========================================================================

async function stage7_dualAuth(paymentId: string): Promise<void> {
  banner(7, 'Finance Manager A (finance1)', 'first authorisation');

  const f1 = await login(FINANCE_1_EMAIL);
  step(`logged in as ${f1.email}`);
  const r1 = await http<{ status: string }>(
    'POST',
    `/payments/${paymentId}/authorise`,
    undefined,
    f1.token,
  );
  if (r1.status !== 200) throw new Error(`First auth failed: status=${r1.status}`);
  step(`status → ${r1.body.status}`);

  await delay(STAGE_PAUSE_MS);

  banner(7, 'Finance Manager B (finance2)', 'second authorisation');
  const f2 = await login(FINANCE_2_EMAIL);
  step(`logged in as ${f2.email}`);
  if (f2.userId === f1.userId) {
    throw new Error('finance1 and finance2 resolved to same user — dual auth invariant broken');
  }
  step(`enforced: ${f1.email} ≠ ${f2.email}  (Layer 1 + DB trigger + provider)`);

  const r2 = await http<{ status: string }>(
    'POST',
    `/payments/${paymentId}/authorise`,
    undefined,
    f2.token,
  );
  if (r2.status !== 200) throw new Error(`Second auth failed: status=${r2.status}`);
  step(`status → ${r2.body.status}  (ready for provider execution)`);
}

// =========================================================================
// Stage 8 — Mock provider executes; payment funded
// =========================================================================

async function stage8_executePayment(paymentId: string, invoiceId: string): Promise<void> {
  banner(8, 'system (payments + provider)', 'executes payment');

  const { executePayment } = await import('../src/services/payments/payments.service');
  const result = await executePayment(paymentId);
  if (!result.success) {
    throw new Error(`Provider execution failed: ${result.failureReason ?? 'unknown'}`);
  }
  step(`provider returned success — txnRef=${result.transactionReference}`);
  step(`payment status → funded`);
  step(`invoice status → ${await getInvoiceStatus(invoiceId)}`);
}

// =========================================================================
// Stage 9 — Collections module starts monitoring (funded → collecting)
// =========================================================================

async function stage9_startCollection(invoiceId: string, paymentId: string): Promise<void> {
  banner(9, 'system (collections)', 'starts monitoring funded invoice');

  const { startCollectionMonitoring } = await import(
    '../src/services/collections/collections.service'
  );
  await startCollectionMonitoring(invoiceId, paymentId);
  step('collection record created (status=pending, escalation=0)');
  step(`invoice status → ${await getInvoiceStatus(invoiceId)}`);
}

// =========================================================================
// Stage 10 — Buyer pays at maturity, MMS records collection
// =========================================================================

async function stage10_buyerPays(invoiceId: string): Promise<string> {
  banner(10, 'Finance Manager (finance1)', 'records buyer payment');

  const f1 = await login(FINANCE_1_EMAIL);
  const today = new Date().toISOString().split('T')[0];

  const res = await http(
    'POST',
    `/collections/${invoiceId}/record-payment`,
    {
      amount: String(FACE_VALUE_UGX),
      paymentDate: today,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation — Treasury',
      paymentReference: `RTGS-SIM-${Date.now()}`,
      notes: 'Full settlement at maturity via RTGS bank transfer.',
    },
    f1.token,
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Record payment failed: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  step(`buyer paid ${formatUGX(FACE_VALUE_UGX)} via bank_transfer`);

  // Wait briefly for any auto-settlement queue, then fetch the collection.
  await delay(STAGE_PAUSE_MS);
  const collection = await getCollectionForInvoice(invoiceId);
  if (!collection) throw new Error('Collection row missing after record-payment');
  step(`collection status → ${collection.status}`);
  step(`invoice status → ${await getInvoiceStatus(invoiceId)}`);
  return collection.id;
}

// =========================================================================
// Stage 11 — Settlement: initiate → repay facility → book profit
// =========================================================================

async function stage11_settlement(invoiceId: string, collectionId: string): Promise<string> {
  banner(11, 'Finance Manager (finance1)', 'initiates settlement');

  const f1 = await login(FINANCE_1_EMAIL);

  // The record-payment queue may have already initiated a settlement. Use it
  // if present, otherwise initiate explicitly.
  let settlement = await getSettlementForInvoice(invoiceId);
  if (!settlement) {
    const res = await http<{ data: { id: string; status: string } }>(
      'POST',
      `/settlements/${invoiceId}/initiate`,
      {
        collection_id: collectionId,
        buyer_payment_amount: FACE_VALUE_UGX,
        penalty_income: 0,
      },
      f1.token,
    );
    if (res.status !== 201) {
      throw new Error(`Settlement initiate failed: status=${res.status} body=${JSON.stringify(res.body)}`);
    }
    settlement = { id: res.body.data.id, status: res.body.data.status };
    step(`settlement ${settlement.id} initiated by finance1 — status=${settlement.status}`);
  } else {
    step(`settlement ${settlement.id} already initiated by queue — status=${settlement.status}`);
  }

  // Repay facility — use simulated facility repayment numbers.
  const facilityRepayment = Math.ceil(FACE_VALUE_UGX * 0.85); // 85% advance
  const accruedInterest = Math.ceil(facilityRepayment * 0.18 * (TENOR_DAYS / 365)); // 18% annual

  banner(11, 'Finance Manager (finance1)', 'repays bank facility');
  const repay = await http(
    'POST',
    `/settlements/${settlement.id}/repay-facility`,
    {
      facility_repayment_amount: facilityRepayment,
      accrued_interest: accruedInterest,
    },
    f1.token,
  );
  if (repay.status !== 200) {
    throw new Error(`Repay facility failed: status=${repay.status} body=${JSON.stringify(repay.body)}`);
  }
  step(`facility repaid: principal ${formatUGX(facilityRepayment)} + interest ${formatUGX(accruedInterest)}`);

  // Book profit. discount_earned was computed at pricing; we read it back.
  const pricing = await pool.query<{ discount_amount: string }>(
    `SELECT discount_amount FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  const discountEarned = pricing.rows[0].discount_amount;
  const bankCostPaid = String(accruedInterest);

  banner(11, 'Finance Manager (finance1)', 'books profit');
  const book = await http(
    'POST',
    `/settlements/${settlement.id}/book-profit`,
    { discount_earned: parseInt(discountEarned, 10), bank_cost_paid: accruedInterest },
    f1.token,
  );
  if (book.status !== 200) {
    throw new Error(`Book profit failed: status=${book.status} body=${JSON.stringify(book.body)}`);
  }
  const netProfit = await getNetProfit(settlement.id);
  step(`discount earned    = ${formatUGX(discountEarned)}`);
  step(`bank cost paid     = ${formatUGX(bankCostPaid)}`);
  step(`net profit booked  = ${formatUGX(netProfit)}`);

  return settlement.id;
}

// =========================================================================
// Stage 12 — Management closes the settlement
// =========================================================================

async function stage12_managementCloses(settlementId: string): Promise<void> {
  banner(12, 'Management (md1)', 'closes settlement');

  const md = await login(MD_EMAIL);
  step(`logged in as ${md.email}`);

  const res = await http(
    'POST',
    `/settlements/${settlementId}/close`,
    undefined,
    md.token,
  );
  if (res.status !== 200) {
    throw new Error(`Close settlement failed: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  step('settlement → closed (transaction complete)');
}

// =========================================================================
// Stage 13 — Auditor reviews the audit trail
// =========================================================================

async function stage13_auditorReviews(invoiceId: string): Promise<number> {
  banner(13, 'Auditor (auditor1)', 'reviews audit trail');

  const auditor = await login(AUDITOR_EMAIL);
  step(`logged in as ${auditor.email}`);

  const count = await countAuditEntries(invoiceId);
  step(`${count} audit log entries written across the lifecycle`);

  // Show the actions in chronological order so the auditor can scan them.
  const actions = await pool.query<{ action: string }>(
    `SELECT action FROM audit_logs
     WHERE entity_id = $1 OR record_id = $1
     ORDER BY created_at ASC`,
    [invoiceId],
  );
  const seen = new Set<string>();
  const ordered = actions.rows.map((r) => r.action).filter((a) => {
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
  step(`distinct actions: ${ordered.join(' → ')}`);
  return count;
}

// =========================================================================
// Final summary
// =========================================================================

async function printSummary(
  startedAt: number,
  invoiceId: string,
  invoiceNumber: string,
  settlementId: string,
  auditCount: number,
): Promise<void> {
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const netProfit = await getNetProfit(settlementId);

  process.stdout.write(`\n${'═'.repeat(72)}\n`);
  process.stdout.write(`  SIMULATION COMPLETE\n`);
  process.stdout.write(`${'═'.repeat(72)}\n`);
  process.stdout.write(`  invoice         ${invoiceNumber}\n`);
  process.stdout.write(`  invoice_id      ${invoiceId}\n`);
  process.stdout.write(`  face value      ${formatUGX(FACE_VALUE_UGX)}\n`);
  process.stdout.write(`  tenor           ${TENOR_DAYS} days\n`);
  process.stdout.write(`  final status    ${await getInvoiceStatus(invoiceId)}\n`);
  process.stdout.write(`  settlement_id   ${settlementId}\n`);
  process.stdout.write(`  net profit      ${formatUGX(netProfit)}\n`);
  process.stdout.write(`  audit entries   ${auditCount}\n`);
  process.stdout.write(`  elapsed         ${elapsedSec}s\n`);
  process.stdout.write(`${'═'.repeat(72)}\n\n`);
  process.stdout.write(`Next steps for UAT:\n`);
  process.stdout.write(`  1. Open the frontend and log in as ${SUPPLIER_EMAIL}\n`);
  process.stdout.write(`     to see invoice ${invoiceNumber} in the supplier dashboard.\n`);
  process.stdout.write(`  2. Log in as ${AUDITOR_EMAIL} to inspect the audit trail.\n`);
  process.stdout.write(`  3. See docs/simulation/PARTIES-GUIDE.md for full party walkthroughs.\n\n`);
}

// =========================================================================
// Main runner
// =========================================================================

async function main(): Promise<void> {
  const startedAt = Date.now();

  process.stdout.write(`\n${'═'.repeat(72)}\n`);
  process.stdout.write(`  RIS Happy-Path Simulation\n`);
  process.stdout.write(`  backend:  ${BASE_URL}\n`);
  process.stdout.write(`  database: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@') ?? 'not set'}\n`);
  process.stdout.write(`${'═'.repeat(72)}\n`);

  await preflight();
  await delay(STAGE_PAUSE_MS);

  const supplier = await getSeedSupplier();
  const s1 = await stage1_supplierSubmits();
  await delay(STAGE_PAUSE_MS);

  await stage2_buyerConfirms(s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  await stage3_riskScores(s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  await stage4_priced(s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  await stage5_creditOfficerApproves(s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  const paymentId = await stage6_initiatePayment(s1.invoiceId, supplier.id);
  await delay(STAGE_PAUSE_MS);

  await stage7_dualAuth(paymentId);
  await delay(STAGE_PAUSE_MS);

  await stage8_executePayment(paymentId, s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  await stage9_startCollection(s1.invoiceId, paymentId);
  await delay(STAGE_PAUSE_MS);

  const collectionId = await stage10_buyerPays(s1.invoiceId);
  await delay(STAGE_PAUSE_MS);

  const settlementId = await stage11_settlement(s1.invoiceId, collectionId);
  await delay(STAGE_PAUSE_MS);

  await stage12_managementCloses(settlementId);
  await delay(STAGE_PAUSE_MS);

  const auditCount = await stage13_auditorReviews(s1.invoiceId);

  await printSummary(startedAt, s1.invoiceId, s1.invoiceNumber, settlementId, auditCount);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    process.stderr.write(`\nSimulation failed: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    await pool.end().catch(() => {
      /* ignore */
    });
    process.exit(1);
  });
