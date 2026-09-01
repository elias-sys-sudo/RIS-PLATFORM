import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../../crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'TestPassword123!';

interface SeedUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Encrypt a PII field for seeding. Delegates to shared/crypto.ts encrypt().
 */
function encryptValue(plaintext: string): string {
  return encrypt(plaintext);
}

/**
 * Convert a UGX amount to BIGINT string.
 * UGX has no subunits — stored as raw integer.
 */
function ugxToBigint(ugx: number): string {
  return String(ugx);
}

/**
 * Seed development data.
 * - 14 users (2 per role, including legal)
 * - 2 suppliers with approved KYC and encrypted bank details
 * - 2 buyers with credit limits
 * All data is clearly fake. Passwords hashed with bcrypt 12 rounds.
 */
async function seed(): Promise<void> {
  const client = await pool.connect();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  try {
    await client.query('BEGIN');

    // =====================================================================
    // 14 USERS — 2 per role (including legal)
    // Insert-or-skip: ON CONFLICT (email) DO NOTHING
    // =====================================================================
    const userEmails = [
      { email: 'supplier1@test.ris.co.ug', role: 'supplier' },
      { email: 'supplier2@test.ris.co.ug', role: 'supplier' },
      { email: 'credit1@test.ris.co.ug', role: 'credit_officer' },
      { email: 'credit2@test.ris.co.ug', role: 'credit_officer' },
      { email: 'finance1@test.ris.co.ug', role: 'finance_manager' },
      { email: 'finance2@test.ris.co.ug', role: 'finance_manager' },
      { email: 'md1@test.ris.co.ug', role: 'management' },
      { email: 'md2@test.ris.co.ug', role: 'management' },
      { email: 'compliance1@test.ris.co.ug', role: 'compliance_officer' },
      { email: 'compliance2@test.ris.co.ug', role: 'compliance_officer' },
      { email: 'auditor1@test.ris.co.ug', role: 'auditor' },
      { email: 'auditor2@test.ris.co.ug', role: 'auditor' },
      { email: 'legal1@test.ris.co.ug', role: 'legal' },
      { email: 'legal2@test.ris.co.ug', role: 'legal' },
    ];

    for (const u of userEmails) {
      // email_verified=true so seeded dev/test users can log in without
      // going through the verify-email flow. Production users still go
      // through the real verification step in onboarding.
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, is_active, email_verified)
         VALUES ($1, $2, $3, $4::user_role, true, true)
         ON CONFLICT (email) DO NOTHING`,
        [uuidv4(), u.email, passwordHash, u.role],
      );
    }

    // Look up actual IDs from the database (handles both fresh and re-run)
    const userRows = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = ANY($1)`,
      [userEmails.map((u) => u.email)],
    );
    const userIdByEmail = new Map(userRows.rows.map((r) => [r.email, r.id]));

    const supplier1UserId = userIdByEmail.get('supplier1@test.ris.co.ug') ?? '';
    const supplier2UserId = userIdByEmail.get('supplier2@test.ris.co.ug') ?? '';
    const creditOfficerId = userIdByEmail.get('credit1@test.ris.co.ug') ?? '';

    // Build users list for logging
    const users: SeedUser[] = userEmails.map((u) => ({
      id: userIdByEmail.get(u.email) ?? '',
      email: u.email,
      role: u.role,
    }));

    // =====================================================================
    // 2 SUPPLIERS — approved KYC, encrypted bank details
    // Insert-or-skip: ON CONFLICT (registration_number) DO NOTHING
    // =====================================================================
    await client.query(
      `INSERT INTO suppliers (
        id, user_id, company_name, registration_number, tax_id,
        directors, bank_name,
        bank_account_number_encrypted, bank_account_name_encrypted,
        bank_branch, preferred_payment_method,
        mobile_money_number_encrypted,
        kyc_status, risk_tier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'approved', 'Low')
      ON CONFLICT (registration_number) DO NOTHING`,
      [
        uuidv4(),
        supplier1UserId,
        'Test Supplier Ltd',
        'UG-REG-TEST-001',
        'TIN-TEST-001',
        JSON.stringify([
          { name: 'Test Director One', id_type: 'national_id', id_number: 'TESTID001' },
        ]),
        'Stanbic Bank Uganda',
        encryptValue('9030000111222'),
        encryptValue('Test Supplier Ltd'),
        'Kampala Main Branch',
        'EFT',
        null,
      ],
    );

    await client.query(
      `INSERT INTO suppliers (
        id, user_id, company_name, registration_number, tax_id,
        directors, bank_name,
        bank_account_number_encrypted, bank_account_name_encrypted,
        bank_branch, preferred_payment_method,
        mobile_money_number_encrypted,
        kyc_status, risk_tier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'approved', 'Low')
      ON CONFLICT (registration_number) DO NOTHING`,
      [
        uuidv4(),
        supplier2UserId,
        'Test Supplies Co',
        'UG-REG-TEST-002',
        'TIN-TEST-002',
        JSON.stringify([
          { name: 'Test Director Two', id_type: 'passport', id_number: 'TESTPASS002' },
          { name: 'Test Director Three', id_type: 'national_id', id_number: 'TESTID003' },
        ]),
        'DFCU Bank Uganda',
        encryptValue('6020000333444'),
        encryptValue('Test Supplies Co'),
        'Jinja Road Branch',
        'EFT',
        null,
      ],
    );

    // =====================================================================
    // 2 BUYERS — with credit limits (stored as BIGINT UGX)
    // Insert-or-skip: ON CONFLICT (registration_number) DO NOTHING
    // =====================================================================
    await client.query(
      `INSERT INTO buyers (
        id, company_name, registration_number, credit_rating,
        approved_limit, used_limit, ris_margin_rate,
        payment_score, is_active, created_by
      ) VALUES ($1, $2, $3, 'A', $4, 0, 0.0300, 85, true, $5)
      ON CONFLICT (registration_number) DO NOTHING`,
      [
        uuidv4(),
        'Test Buyer Corporation',
        'UG-BUY-TEST-001',
        ugxToBigint(500000000),
        creditOfficerId,
      ],
    );

    await client.query(
      `INSERT INTO buyers (
        id, company_name, registration_number, credit_rating,
        approved_limit, used_limit, ris_margin_rate,
        payment_score, is_active, created_by
      ) VALUES ($1, $2, $3, 'B', $4, 0, 0.0350, 70, true, $5)
      ON CONFLICT (registration_number) DO NOTHING`,
      [uuidv4(), 'Test Industries Ltd', 'UG-BUY-TEST-002', ugxToBigint(200000000), creditOfficerId],
    );

    // =====================================================================
    // 1 BANK FACILITY — active credit line
    // Insert-or-skip: use WHERE NOT EXISTS (no natural unique constraint)
    // =====================================================================
    await client.query(
      `INSERT INTO bank_facilities (
        id, facility_name, bank_name, total_limit, drawn_amount,
        interest_rate_annual, maturity_date,
        utilisation_alert_threshold, is_active,
        available_amount, annual_rate, status
      )
      SELECT $1::uuid, $2::varchar, $3::varchar, $4::bigint, 0,
             0.1800, $5::date,
             80, true,
             $4::bigint, 0.1800, 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM bank_facilities
        WHERE facility_name = $2::varchar AND bank_name = $3::varchar
      )`,
      [
        uuidv4(),
        'Stanbic Working Capital Facility',
        'Stanbic Bank Uganda',
        ugxToBigint(2000000000),
        '2027-03-31',
      ],
    );

    // =====================================================================
    // Look up supplier and buyer IDs from DB (handles both fresh and re-run)
    // =====================================================================
    const supplierRows = await client.query<{ id: string; registration_number: string }>(
      `SELECT id, registration_number FROM suppliers WHERE registration_number IN ($1, $2)`,
      ['UG-REG-TEST-001', 'UG-REG-TEST-002'],
    );
    const supplierIdByReg = new Map(supplierRows.rows.map((r) => [r.registration_number, r.id]));
    const supplier1Id = supplierIdByReg.get('UG-REG-TEST-001') ?? '';
    const supplier2Id = supplierIdByReg.get('UG-REG-TEST-002') ?? '';

    const buyerRows = await client.query<{ id: string; registration_number: string }>(
      `SELECT id, registration_number FROM buyers WHERE registration_number IN ($1, $2)`,
      ['UG-BUY-TEST-001', 'UG-BUY-TEST-002'],
    );
    const buyerIdByReg = new Map(buyerRows.rows.map((r) => [r.registration_number, r.id]));
    const buyer1Id = buyerIdByReg.get('UG-BUY-TEST-001') ?? '';
    const buyer2Id = buyerIdByReg.get('UG-BUY-TEST-002') ?? '';

    // =====================================================================
    // 3 INVOICES — overdue/collected for collection_payments seeding
    // Insert-or-skip: ON CONFLICT (invoice_number, supplier_id) DO NOTHING
    // =====================================================================
    const invoice1Id = uuidv4();
    const invoice2Id = uuidv4();
    const invoice3Id = uuidv4();

    // Invoice 1: Partially paid, overdue (UGX 75,000,000)
    // created_at is set explicitly so funded_at - created_at and
    // collected_at - created_at compute to sensible positive day counts
    // for dashboard avg_days_to_payment aggregates.
    await client.query(
      `INSERT INTO invoices (
        id, invoice_number, supplier_id, buyer_id, face_value,
        advance_amount, discount_amount, net_payment_to_supplier,
        status, tenor_days, due_date, description,
        buyer_confirmed_at, funded_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (invoice_number, supplier_id) DO NOTHING`,
      [
        invoice1Id,
        'INV-SEED-001',
        supplier1Id,
        buyer1Id,
        ugxToBigint(75000000),
        ugxToBigint(63750000),
        ugxToBigint(11250000),
        ugxToBigint(63750000),
        'overdue',
        60,
        '2026-02-15',
        'Office supplies Q1 2026',
        '2025-12-20T10:00:00Z',
        '2025-12-22T14:00:00Z',
        '2025-12-15T08:00:00Z',
      ],
    );

    // Invoice 2: Fully collected via bank transfer (UGX 120,000,000)
    await client.query(
      `INSERT INTO invoices (
        id, invoice_number, supplier_id, buyer_id, face_value,
        advance_amount, discount_amount, net_payment_to_supplier,
        status, tenor_days, due_date, description,
        buyer_confirmed_at, funded_at, collected_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (invoice_number, supplier_id) DO NOTHING`,
      [
        invoice2Id,
        'INV-SEED-002',
        supplier1Id,
        buyer2Id,
        ugxToBigint(120000000),
        ugxToBigint(102000000),
        ugxToBigint(18000000),
        ugxToBigint(102000000),
        'collected',
        45,
        '2026-02-01',
        'IT equipment delivery batch 2',
        '2025-12-18T09:30:00Z',
        '2025-12-20T11:00:00Z',
        '2026-02-10T16:00:00Z',
        '2025-12-15T08:00:00Z',
      ],
    );

    // Invoice 3: Pending cheque clearance (UGX 45,000,000)
    await client.query(
      `INSERT INTO invoices (
        id, invoice_number, supplier_id, buyer_id, face_value,
        advance_amount, discount_amount, net_payment_to_supplier,
        status, tenor_days, due_date, description,
        buyer_confirmed_at, funded_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (invoice_number, supplier_id) DO NOTHING`,
      [
        invoice3Id,
        'INV-SEED-003',
        supplier2Id,
        buyer1Id,
        ugxToBigint(45000000),
        ugxToBigint(38250000),
        ugxToBigint(6750000),
        ugxToBigint(38250000),
        'overdue',
        30,
        '2026-03-01',
        'Cleaning supplies monthly',
        '2026-02-01T08:00:00Z',
        '2026-02-03T10:00:00Z',
        '2026-01-30T08:00:00Z',
      ],
    );

    // =====================================================================
    // Resolve actual invoice IDs from DB (ON CONFLICT may have skipped inserts
    // on re-run, so local uuidv4() variables may not match persisted IDs).
    // =====================================================================
    const seedInvRows = await client.query<{ id: string; invoice_number: string }>(
      `SELECT id, invoice_number FROM invoices
       WHERE invoice_number IN ('INV-SEED-001', 'INV-SEED-002', 'INV-SEED-003')`,
    );
    const seedInvMap = new Map(seedInvRows.rows.map((r) => [r.invoice_number, r.id]));
    const resolvedInvoice1Id = seedInvMap.get('INV-SEED-001') ?? invoice1Id;
    const resolvedInvoice2Id = seedInvMap.get('INV-SEED-002') ?? invoice2Id;
    const resolvedInvoice3Id = seedInvMap.get('INV-SEED-003') ?? invoice3Id;

    // =====================================================================
    // 3 COLLECTIONS — one per invoice, for collection_payments
    // =====================================================================
    const collection1Id = uuidv4();
    const collection2Id = uuidv4();
    const collection3Id = uuidv4();

    // Collection 1: Partially paid, overdue
    await client.query(
      `INSERT INTO collections (
        id, invoice_id, buyer_id, face_value, amount_due,
        status, days_overdue, daily_penalty_rate, penalty_amount,
        escalation_level, total_collected
      ) SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::bigint,
              'overdue', 36, 0.0010, $6::bigint,
              1, $7::numeric
      WHERE NOT EXISTS (
        SELECT 1 FROM collections WHERE invoice_id = $2::uuid
      )`,
      [
        collection1Id,
        resolvedInvoice1Id,
        buyer1Id,
        ugxToBigint(75000000),
        ugxToBigint(45000000),
        ugxToBigint(2700000),
        30000000,
      ],
    );

    // Collection 2: Fully collected
    await client.query(
      `INSERT INTO collections (
        id, invoice_id, buyer_id, face_value, amount_due,
        status, days_overdue, daily_penalty_rate, penalty_amount,
        total_collected, last_payment_at
      ) SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, 0,
              'collected', 9, 0.0010, $5::bigint,
              $6::numeric, '2026-02-10T16:00:00Z'::timestamptz
      WHERE NOT EXISTS (
        SELECT 1 FROM collections WHERE invoice_id = $2::uuid
      )`,
      [
        collection2Id,
        resolvedInvoice2Id,
        buyer2Id,
        ugxToBigint(120000000),
        ugxToBigint(1080000),
        120000000,
      ],
    );

    // Collection 3: Pending cheque clearance
    await client.query(
      `INSERT INTO collections (
        id, invoice_id, buyer_id, face_value, amount_due,
        status, days_overdue, daily_penalty_rate, penalty_amount,
        escalation_level, total_collected
      ) SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::bigint,
              'overdue', 22, 0.0010, $6::bigint,
              0, $7::numeric
      WHERE NOT EXISTS (
        SELECT 1 FROM collections WHERE invoice_id = $2::uuid
      )`,
      [
        collection3Id,
        resolvedInvoice3Id,
        buyer1Id,
        ugxToBigint(45000000),
        ugxToBigint(45000000),
        ugxToBigint(990000),
        0,
      ],
    );

    // =====================================================================
    // 3 COLLECTION PAYMENTS — realistic Uganda payment scenarios
    // =====================================================================

    // Payment 1: Partial payment via bank transfer (UGX 30,000,000 of 75M)
    await client.query(
      `INSERT INTO collection_payments (
        id, collection_id, amount, payment_method,
        payment_reference, paid_by, paid_at,
        recorded_by, notes
      ) SELECT $1::uuid, $2::uuid, 30000000, 'bank_transfer',
              'BANK-TXN-2026031501234', 'Test Buyer Corporation — Accounts Dept',
              '2026-03-15T14:30:00Z'::timestamptz,
              $3::uuid, 'Partial payment via bank transfer. Buyer confirmed remainder by end of month.'
      WHERE NOT EXISTS (
        SELECT 1 FROM collection_payments WHERE payment_reference = 'BANK-TXN-2026031501234'
      )`,
      [uuidv4(), collection1Id, creditOfficerId],
    );

    // Payment 2: Full settlement via bank transfer (UGX 120,000,000)
    await client.query(
      `INSERT INTO collection_payments (
        id, collection_id, amount, payment_method,
        payment_reference, paid_by, paid_at,
        recorded_by, notes
      ) SELECT $1::uuid, $2::uuid, 120000000, 'bank_transfer',
              'RTGS-UG-2026021000456', 'Test Industries Ltd — Treasury',
              '2026-02-10T16:00:00Z'::timestamptz,
              $3::uuid, 'Full settlement via RTGS bank transfer. Invoice fully collected.'
      WHERE NOT EXISTS (
        SELECT 1 FROM collection_payments WHERE payment_reference = 'RTGS-UG-2026021000456'
      )`,
      [uuidv4(), collection2Id, creditOfficerId],
    );

    // Payment 3: Cheque payment pending clearance (UGX 45,000,000)
    await client.query(
      `INSERT INTO collection_payments (
        id, collection_id, amount, payment_method,
        payment_reference, paid_by, paid_at,
        recorded_by, notes
      ) SELECT $1::uuid, $2::uuid, 45000000, 'cheque',
              'CHQ-DFCU-0078321', 'Test Buyer Corporation — Finance Manager',
              '2026-03-20T11:00:00Z'::timestamptz,
              $3::uuid, 'Cheque received, pending 5-day bank clearance via DFCU Bank. Follow up on 2026-03-25.'
      WHERE NOT EXISTS (
        SELECT 1 FROM collection_payments WHERE payment_reference = 'CHQ-DFCU-0078321'
      )`,
      [uuidv4(), collection3Id, creditOfficerId],
    );

    // =====================================================================
    // INV-SEED-004 — funded invoice (deterministic UUID, for audit script test 6)
    // Collateral on this invoice blocks deletion (business rule: funded = locked)
    // =====================================================================
    const FUNDED_INV_ID = '00000000-4444-4000-b000-000000000004';
    const FUNDED_COLL_ID = '00000000-4444-4000-b000-000000000010';
    const SEED_DOC_ID = '00000000-4444-4000-b000-000000000020';

    await client.query(
      `INSERT INTO invoices (
        id, invoice_number, supplier_id, buyer_id, face_value,
        advance_amount, discount_amount, net_payment_to_supplier,
        status, tenor_days, due_date, description,
        buyer_confirmed_at, funded_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (invoice_number, supplier_id) DO NOTHING`,
      [
        FUNDED_INV_ID,
        'INV-SEED-004',
        supplier1Id,
        buyer1Id,
        ugxToBigint(80_000_000),
        ugxToBigint(68_000_000),
        ugxToBigint(12_000_000),
        ugxToBigint(68_000_000),
        'funded',
        45,
        '2027-06-30',
        'Audit seed funded invoice — collateral delete must be blocked',
        '2026-01-10T09:00:00Z',
        '2026-01-12T14:00:00Z',
        '2026-01-08T08:00:00Z',
      ],
    );

    // Look up the actual invoice id in case invoice_number already existed
    const fundedInvRow = await client.query<{ id: string }>(
      `SELECT id FROM invoices WHERE invoice_number = 'INV-SEED-004' AND supplier_id = $1`,
      [supplier1Id],
    );
    const resolvedFundedInvId = fundedInvRow.rows[0]?.id ?? FUNDED_INV_ID;

    await client.query(
      `INSERT INTO collateral
         (id, invoice_id, supplier_id, collateral_type, value, description, currency)
       SELECT $1, $2, $3, 'fixed_deposit_lien', $4, $5, 'UGX'
       WHERE NOT EXISTS (SELECT 1 FROM collateral WHERE id = $1)`,
      [
        FUNDED_COLL_ID,
        resolvedFundedInvId,
        supplier1Id,
        ugxToBigint(80_000_000),
        'Audit seed collateral — delete blocked while invoice is funded',
      ],
    );

    // =====================================================================
    // Seed document — points to fixture PDF file on disk (for audit test 7)
    // Encrypted path decrypts to: src/shared/database/seeds/fixtures/test-document.pdf
    // =====================================================================
    const seedDocPath = encryptValue('src/shared/database/seeds/fixtures/test-document.pdf');

    await client.query(
      `INSERT INTO invoice_documents
         (id, invoice_id, supplier_id, document_type,
          encrypted_path, file_hash, file_size_bytes, mime_type, uploaded_by)
       SELECT $1, $2, $3, 'invoice', $4, $5, 256, 'application/pdf', $6
       WHERE NOT EXISTS (SELECT 1 FROM invoice_documents WHERE id = $1)`,
      [
        SEED_DOC_ID,
        resolvedFundedInvId,
        supplier1Id,
        seedDocPath,
        'audit-seed-document-sha256-placeholder',
        creditOfficerId,
      ],
    );

    await client.query('COMMIT');

    logMessage('Seed data inserted successfully');
    logMessage('');
    logMessage(`Default password for all test users: ${DEFAULT_PASSWORD}`);
    logMessage('');
    logMessage('Users (14):');
    for (const user of users) {
      logMessage(`  ${user.email.padEnd(35)} ${user.role}`);
    }
    logMessage('');
    logMessage('Suppliers (2):');
    logMessage('  Test Supplier Ltd    (UG-REG-TEST-001)  KYC=approved  EFT');
    logMessage('  Test Supplies Co     (UG-REG-TEST-002)  KYC=approved  EFT');
    logMessage('');
    logMessage('Buyers (2):');
    logMessage('  Test Buyer Corporation  (A-rated)  limit=UGX 500,000,000  margin=3.00%');
    logMessage('  Test Industries Ltd     (B-rated)  limit=UGX 200,000,000  margin=3.50%');
    logMessage('');
    logMessage('Bank Facilities (1):');
    logMessage(
      '  Stanbic Working Capital Facility  limit=UGX 2,000,000,000  rate=18%  maturity=2027-03-31',
    );
    logMessage('');
    logMessage('Invoices (4):');
    logMessage('  INV-SEED-001  UGX  75,000,000  overdue    (partial payment received)');
    logMessage('  INV-SEED-002  UGX 120,000,000  collected  (full bank transfer)');
    logMessage('  INV-SEED-003  UGX  45,000,000  overdue    (cheque pending clearance)');
    logMessage('  INV-SEED-004  UGX  80,000,000  funded     (audit: collateral delete locked)');
    logMessage('');
    logMessage(`Audit seed IDs (hardcoded):`);
    logMessage(`  Funded collateral: ${FUNDED_COLL_ID}`);
    logMessage(`  Seed document:     ${SEED_DOC_ID}`);
    logMessage('');
    logMessage('Collection Payments (3):');
    logMessage('  Bank transfer partial UGX 30,000,000   ref=BANK-TXN-2026031501234');
    logMessage('  Bank transfer full   UGX 120,000,000  ref=RTGS-UG-2026021000456');
    logMessage('  Cheque pending       UGX 45,000,000   ref=CHQ-DFCU-0078321');
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logMessage(`Seed failed: ${errorMessage}`);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function logMessage(message: string): void {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

seed().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  process.stderr.write(`Seed failed: ${errorMessage}\n`);
  process.exit(1);
});
