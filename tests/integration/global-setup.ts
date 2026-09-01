/**
 * Jest globalSetup — creates a fresh test database, runs all migrations, seeds data.
 * Runs ONCE before all integration tests in a separate process context.
 * Writes the DB connection info to a temp file for env-setup.ts to read.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { encrypt } from '../../src/shared/crypto';

const TEMP_FILE = path.resolve(__dirname, '.test-db-meta');

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: '.env.local' });

  // Ensure ENCRYPTION_KEY is a valid 64-hex-char string — same fallback as env-setup.ts
  // so that global-setup and test workers always encrypt/decrypt with the same key.
  if (
    process.env.ENCRYPTION_KEY === undefined ||
    process.env.ENCRYPTION_KEY === '' ||
    !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)
  ) {
    process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
  }

  // Use a dedicated port for integration tests to avoid conflicts with the dev server (port 4000)
  process.env.TEST_PORT = '4001';

  const baseUrl =
    process.env.DATABASE_URL ?? 'postgresql://mms_user:mms_password@localhost:5432/mms_platform';
  const url = new URL(baseUrl);

  const adminConnStr = `postgresql://${url.username}:${encodeURIComponent(url.password)}@${url.hostname}:${url.port}/postgres`;
  const suffix = crypto.randomBytes(4).toString('hex');
  const dbName = `mms_test_${suffix}`;

  // --- Create database ---
  const admin = new Client({ connectionString: adminConnStr });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const testConnStr = `postgresql://${url.username}:${encodeURIComponent(url.password)}@${url.hostname}:${url.port}/${dbName}`;
  const testClient = new Client({ connectionString: testConnStr });
  await testClient.connect();

  // --- Run ALL migrations in order ---
  const migrationsDir = path.resolve(__dirname, '../../src/shared/database/migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await testClient.query(sql);
  }

  // --- Seed minimal realistic data ---
  await seedTestData(testClient);

  await testClient.end();

  // --- Write meta for env-setup.ts ---
  fs.writeFileSync(TEMP_FILE, JSON.stringify({ dbName, testConnStr }));
}

// ==========================================================================
// Seed data — matches the REAL schema after all 12 migrations
// ==========================================================================

// Deterministic UUIDs for test data — based on crypto.randomUUID() format
// Using v4 UUID format: 8-4-4-4-12 hex chars
const IDS = {
  users: {
    admin: '00000000-0000-4000-a000-000000000001',
    credit: '00000000-0000-4000-a000-000000000002',
    supplier: '00000000-0000-4000-a000-000000000003',
    finance: '00000000-0000-4000-a000-000000000004',
    auditor: '00000000-0000-4000-a000-000000000005',
    compliance: '00000000-0000-4000-a000-000000000006',
    legal: '00000000-0000-4000-a000-000000000007',
  },
  suppliers: {
    org1: '00000000-0000-4000-b000-000000000001',
    org2: '00000000-0000-4000-b000-000000000002',
  },
  buyers: {
    mtn: '00000000-0000-4000-c000-000000000001',
    stanbic: '00000000-0000-4000-c000-000000000002',
    roofings: '00000000-0000-4000-c000-000000000003',
  },
  invoices: {
    draft: '00000000-0000-4000-d000-000000000001',
    approved: '00000000-0000-4000-d000-000000000002',
    funded: '00000000-0000-4000-d000-000000000003',
    overdue: '00000000-0000-4000-d000-000000000004',
    collected: '00000000-0000-4000-d000-000000000005',
  },
  collections: {
    overdue: '00000000-0000-4000-e000-000000000001',
    collected: '00000000-0000-4000-e000-000000000002',
  },
  collateral: { main: '00000000-0000-4000-f000-000000000001' },
  documents: { pdf: '00000000-0000-4000-f100-000000000001' },
  payments: { funded: '00000000-0000-4000-f200-000000000001' },
  cpayments: {
    p1: '00000000-0000-4000-f300-000000000001',
    p2: '00000000-0000-4000-f300-000000000002',
  },
  // Lifecycle-test–specific entities (supplier1@test.ris.co.ug family)
  lifecycle: {
    users: {
      supplier1: '00000000-0000-4000-a100-000000000001',
      supplier2: '00000000-0000-4000-a100-000000000002',
      credit1: '00000000-0000-4000-a100-000000000003',
      finance1: '00000000-0000-4000-a100-000000000004',
      finance2: '00000000-0000-4000-a100-000000000005',
      auditor1: '00000000-0000-4000-a100-000000000006',
    },
    supplierOrg1: '00000000-0000-4000-b100-000000000001',
    supplierOrg2: '00000000-0000-4000-b100-000000000002',
    buyer1: '00000000-0000-4000-c100-000000000001', // Test Buyer Corporation — 500M limit
    buyer2: '00000000-0000-4000-c100-000000000002', // Test Industries Ltd    — 200M limit
    facility: '00000000-0000-4000-f400-000000000001',
  },
};

async function seedTestData(client: Client): Promise<void> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 12);

  const U = IDS.users;
  const S = IDS.suppliers;
  const B = IDS.buyers;
  const I = IDS.invoices;
  const COL = IDS.collections;
  const COLL = IDS.collateral;
  const DOC = IDS.documents;
  const PAY = IDS.payments;
  const CP = IDS.cpayments;

  // --- Users ---
  await client.query(
    `INSERT INTO users (id, email, password_hash, role,
       first_name_encrypted, last_name_encrypted, phone_encrypted,
       is_active, failed_login_count, email_verified)
     VALUES
       ($1,  $2,  $3, 'management',         $4,  $5,  $6,  true, 0, true),
       ($7,  $8,  $3, 'credit_officer',      $9,  $10, $11, true, 0, true),
       ($12, $13, $3, 'supplier',            $14, $15, $16, true, 0, true),
       ($17, $18, $3, 'finance_manager',     $19, $20, $21, true, 0, true),
       ($22, $23, $3, 'auditor',             $24, $25, $26, true, 0, true),
       ($27, $28, $3, 'compliance_officer',  $29, $30, $31, true, 0, true),
       ($32, $33, $3, 'legal',               $34, $35, $36, true, 0, true)`,
    [
      U.admin,
      'admin@mmstest.ug',
      passwordHash,
      encrypt('Admin'),
      encrypt('Tester'),
      encrypt('+256700100001'),

      U.credit,
      'credit@mmstest.ug',
      encrypt('Credit'),
      encrypt('Officer'),
      encrypt('+256700100002'),

      U.supplier,
      'supplier@mmstest.ug',
      encrypt('Supplier'),
      encrypt('User'),
      encrypt('+256700100003'),

      U.finance,
      'finance@mmstest.ug',
      encrypt('Finance'),
      encrypt('Manager'),
      encrypt('+256700100004'),

      U.auditor,
      'auditor@mmstest.ug',
      encrypt('Auditor'),
      encrypt('User'),
      encrypt('+256700100005'),

      U.compliance,
      'compliance@mmstest.ug',
      encrypt('Compliance'),
      encrypt('Officer'),
      encrypt('+256700100006'),

      U.legal,
      'legal@mmstest.ug',
      encrypt('Legal'),
      encrypt('User'),
      encrypt('+256700100007'),
    ],
  );

  // --- Suppliers ---
  await client.query(
    `INSERT INTO suppliers (id, user_id, company_name, registration_number, tax_id, kyc_status)
     VALUES
       ($1, $2, $3, $4, $5, 'approved'),
       ($6, $7, $8, $9, $10, 'approved')`,
    [
      S.org1,
      U.admin,
      'Kampala Trading Ltd',
      'UG-REG-001',
      'TIN-001',
      S.org2,
      U.supplier,
      'Jinja Exports Ltd',
      'UG-REG-002',
      'TIN-002',
    ],
  );

  // --- Buyers ---
  await client.query(
    `INSERT INTO buyers (id, company_name, registration_number, credit_rating,
       approved_limit, contact_email_encrypted, contact_phone_encrypted, created_by)
     VALUES
       ($1, $2, $3, 'A', 500000000, $4, $5, $6),
       ($7, $8, $9, 'B', 300000000, $10, $11, $6),
       ($12, $13, $14, 'C', 250000000, $15, $16, $6)`,
    [
      B.mtn,
      'MTN Uganda Ltd',
      'UG-MTN-001',
      encrypt('procurement@mtn.ug'),
      encrypt('+256700200001'),
      U.admin,
      B.stanbic,
      'Stanbic Bank Uganda',
      'UG-STNB-001',
      encrypt('vendor@stanbic.ug'),
      encrypt('+256700200002'),
      B.roofings,
      'Roofings Group',
      'UG-ROOF-001',
      encrypt('accounts@roofings.ug'),
      encrypt('+256700200003'),
    ],
  );

  // --- Invoices ---
  const now = new Date();
  const future30 = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];
  const past7 = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const pastDue = new Date(now.getTime() - 10 * 86400000).toISOString().split('T')[0];

  // buyer_confirmed_at is required by CHECK constraint when status > submitted
  const confirmed = new Date(now.getTime() - 90 * 86400000).toISOString();

  for (const inv of [
    {
      id: I.draft,
      sup: S.org1,
      buy: B.mtn,
      num: 'INV-001',
      val: 50000000,
      st: 'draft',
      due: future30,
      desc: 'Office supplies',
      tenor: 30,
      bca: null,
    },
    {
      id: I.approved,
      sup: S.org1,
      buy: B.stanbic,
      num: 'INV-002',
      val: 120000000,
      st: 'approved',
      due: future30,
      desc: 'IT equipment',
      tenor: 45,
      bca: confirmed,
    },
    {
      id: I.funded,
      sup: S.org1,
      buy: B.mtn,
      num: 'INV-003',
      val: 75000000,
      st: 'funded',
      due: future30,
      desc: 'Construction mats',
      tenor: 60,
      bca: confirmed,
    },
    {
      id: I.overdue,
      sup: S.org2,
      buy: B.roofings,
      num: 'INV-004',
      val: 200000000,
      st: 'overdue',
      due: pastDue,
      desc: 'Steel beams',
      tenor: 30,
      bca: confirmed,
    },
    {
      id: I.collected,
      sup: S.org1,
      buy: B.stanbic,
      num: 'INV-005',
      val: 30000000,
      st: 'collected',
      due: past7,
      desc: 'Stationery',
      tenor: 30,
      bca: confirmed,
    },
  ]) {
    await client.query(
      `INSERT INTO invoices (id, supplier_id, buyer_id, invoice_number, face_value, status, due_date, description, tenor_days, buyer_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [inv.id, inv.sup, inv.buy, inv.num, inv.val, inv.st, inv.due, inv.desc, inv.tenor, inv.bca],
    );
  }

  // --- Collections ---
  await client.query(
    `INSERT INTO collections
       (id, invoice_id, status, days_overdue, buyer_id, face_value, total_collected, escalation_level)
     VALUES
       ($1, $3, 'overdue',   10, $5, 200000000, 50000000, 1),
       ($2, $4, 'collected',  0, $6, 30000000,  30000000, 0)`,
    [COL.overdue, COL.collected, I.overdue, I.collected, B.roofings, B.stanbic],
  );

  // --- Collection payments ---
  await client.query(
    `INSERT INTO collection_payments
       (id, collection_id, amount, payment_method, payment_reference, paid_by, recorded_by, notes)
     VALUES
       ($1, $3, 50000000, 'mtn_momo',     'MOMO-REF-001', 'MTN Uganda Ltd', $5, 'Partial payment'),
       ($2, $4, 30000000, 'bank_transfer', 'EFT-REF-001',  'Stanbic Bank',   $5, 'Full settlement')`,
    [CP.p1, CP.p2, COL.overdue, COL.collected, U.admin],
  );

  // --- Invoice documents ---
  await client.query(
    `INSERT INTO invoice_documents
       (id, invoice_id, supplier_id, document_type, encrypted_path, file_hash,
        file_size_bytes, mime_type, uploaded_by)
     VALUES ($1, $2, $3, 'invoice', $4, $5, 1024, 'application/pdf', $6)`,
    [DOC.pdf, I.funded, S.org1, 'encrypted/test-doc.pdf', 'abc123def456', U.admin],
  );

  // --- Collateral ---
  await client.query(
    `INSERT INTO collateral
       (id, invoice_id, supplier_id, collateral_type, value, description, currency)
     VALUES ($1, $2, $3, 'bank_guarantee', 100000000, 'Commercial property in Kampala', 'UGX')`,
    [COLL.main, I.funded, S.org1],
  );

  // --- Collateral-document junction ---
  await client.query(
    `INSERT INTO collateral_documents (collateral_id, document_id) VALUES ($1, $2)`,
    [COLL.main, DOC.pdf],
  );

  // --- Payments ---
  await client.query(
    `INSERT INTO payments
       (id, invoice_id, amount, provider, status, idempotency_key,
        dual_auth_user_1, dual_auth_user_2, funded_at)
     VALUES ($1, $2, 67500000, 'EFT', 'funded', $3, $4, $5, NOW())`,
    [PAY.funded, I.funded, crypto.randomUUID(), U.admin, U.finance],
  );

  // --- Audit log seed marker ---
  await client.query(
    `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, 'SEED_DATA', 'system', 'global-setup', '{}', '{}', '127.0.0.1', 'jest-integration')`,
    [U.admin],
  );

  // ==========================================================================
  // Lifecycle-test entities — required by invoice-lifecycle.test.ts
  // These use the @test.ris.co.ug email pattern matching the dev seed.
  // Kept separate so existing TEST_USERS helpers are not disturbed.
  // ==========================================================================
  const LC = IDS.lifecycle;

  // 6 users covering every role used by the lifecycle test
  await client.query(
    `INSERT INTO users (id, email, password_hash, role,
       first_name_encrypted, last_name_encrypted, phone_encrypted,
       is_active, failed_login_count, email_verified)
     VALUES
       ($1,  $2,  $3, 'supplier',        $4,  $5,  $6,  true, 0, true),
       ($7,  $8,  $3, 'supplier',        $9,  $10, $11, true, 0, true),
       ($12, $13, $3, 'credit_officer',  $14, $15, $16, true, 0, true),
       ($17, $18, $3, 'finance_manager', $19, $20, $21, true, 0, true),
       ($22, $23, $3, 'finance_manager', $24, $25, $26, true, 0, true),
       ($27, $28, $3, 'auditor',         $29, $30, $31, true, 0, true)`,
    [
      LC.users.supplier1,
      'supplier1@test.ris.co.ug',
      passwordHash,
      encrypt('Supplier'),
      encrypt('One'),
      encrypt('+256700300001'),

      LC.users.supplier2,
      'supplier2@test.ris.co.ug',
      encrypt('Supplier'),
      encrypt('Two'),
      encrypt('+256700300002'),

      LC.users.credit1,
      'credit1@test.ris.co.ug',
      encrypt('Credit'),
      encrypt('One'),
      encrypt('+256700300003'),

      LC.users.finance1,
      'finance1@test.ris.co.ug',
      encrypt('Finance'),
      encrypt('One'),
      encrypt('+256700300004'),

      LC.users.finance2,
      'finance2@test.ris.co.ug',
      encrypt('Finance'),
      encrypt('Two'),
      encrypt('+256700300005'),

      LC.users.auditor1,
      'auditor1@test.ris.co.ug',
      encrypt('Auditor'),
      encrypt('One'),
      encrypt('+256700300006'),
    ],
  );

  // Two supplier orgs — supplier1 is KYC approved; supplier2 also approved (for F9 cross-supplier test)
  await client.query(
    `INSERT INTO suppliers (id, user_id, company_name, registration_number, tax_id, kyc_status)
     VALUES
       ($1, $2, 'Jinja Exports Ltd',  'UG-REG-LC-001', 'TIN-LC-001', 'approved'),
       ($3, $4, 'Mbarara Traders Ltd','UG-REG-LC-002', 'TIN-LC-002', 'approved')`,
    [LC.supplierOrg1, LC.users.supplier1, LC.supplierOrg2, LC.users.supplier2],
  );

  // Two buyers used by lifecycle tests
  // buyer1 (Test Buyer Corporation): 500M limit — success path + most failure paths
  // buyer2 (Test Industries Ltd):    200M limit — F2 credit-limit-exceeded test
  await client.query(
    `INSERT INTO buyers (id, company_name, registration_number, credit_rating,
       approved_limit, contact_email_encrypted, contact_phone_encrypted, created_by)
     VALUES
       ($1, 'Test Buyer Corporation', 'UG-TBC-001', 'A', 500000000, $2, $3, $7),
       ($4, 'Test Industries Ltd',    'UG-TIL-001', 'B', 200000000, $5, $6, $7)`,
    [
      LC.buyer1,
      encrypt('procurement@testbuyer.ug'),
      encrypt('+256700300010'),
      LC.buyer2,
      encrypt('accounts@testindustries.ug'),
      encrypt('+256700300011'),
      U.admin,
    ],
  );

  // Active bank facility — required by Step 16 (facility drawdown check).
  // interest_rate_annual is NUMERIC(5,4): store as fraction (0.1500 = 15%).
  // Monetary columns are BIGINT — pass as strings to avoid JS number coercion.
  const maturityDate = new Date(Date.now() + 730 * 86400000).toISOString().split('T')[0]; // 2 years
  await client.query(
    `INSERT INTO bank_facilities
       (id, facility_name, bank_name, total_limit, drawn_amount,
        available_amount, interest_rate_annual, annual_rate, maturity_date, is_active, status)
     VALUES ($1, 'RIS Working Capital Facility', 'Stanbic Bank Uganda',
             $2, $3, $4, $5, $6, $7, true, 'active')`,
    [LC.facility, '5000000000', '0', '5000000000', '0.0800', '0.080000', maturityDate],
  );

  // Set last_2fa_verified_at for finance_manager users so payment auth passes 2FA re-verification
  await client.query(
    `UPDATE users SET last_2fa_verified_at = NOW() WHERE role = 'finance_manager'`,
    [],
  );
}
