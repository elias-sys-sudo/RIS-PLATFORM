const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// =============================================================================
// Staff seed — RIS internal users with real @raphaintegrated.com addresses.
//
// One user per role, EXCEPT finance_manager which keeps two distinct accounts
// because the payments module's dual-authorisation enforces
// dual_auth_user_1 ≠ dual_auth_user_2 at the database trigger layer.
//
// Suppliers are NOT seeded. Real suppliers register through the live flow
// (POST /onboarding/suppliers/register) with their own verified email
// addresses. The two legacy supplier rows (supplier1/2@test.ris.co.ug) that
// exist on staging are kept as-is for in-progress UAT invoices only.
//
// All addresses below are SES-verified at first run and forwarded to the
// operator's Gmail via GoDaddy email forwarding (see deploy/email-setup-runbook.md).
// =============================================================================
async function seed() {
  const passwordHash = await bcrypt.hash('TestPassword123!', 12);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const users = [
      // single users — no dual-auth requirement on these roles
      { email: 'credit@raphaintegrated.com',     role: 'credit_officer' },
      { email: 'admin@raphaintegrated.com',      role: 'management' },
      { email: 'compliance@raphaintegrated.com', role: 'compliance_officer' },
      { email: 'auditor@raphaintegrated.com',    role: 'auditor' },
      { email: 'legal@raphaintegrated.com',      role: 'legal' },

      // two finance_managers — dual-auth (different-user rule) requires two distinct accounts
      { email: 'finance1@raphaintegrated.com',   role: 'finance_manager' },
      { email: 'finance2@raphaintegrated.com',   role: 'finance_manager' },
    ];

    for (const u of users) {
      // email_verified=true here because the seed represents staff that have
      // already been onboarded out-of-band. Suppliers go through the verify
      // flow and start as false.
      await client.query(
        "INSERT INTO users (id, email, password_hash, role, is_active, email_verified) VALUES ($1, $2, $3, $4::user_role, true, true) ON CONFLICT (email) DO NOTHING",
        [uuidv4(), u.email, passwordHash, u.role]
      );
    }

    await client.query('COMMIT');
    console.log('Seeded ' + users.length + ' staff users successfully');
    console.log('');

    const result = await client.query('SELECT email, role FROM users WHERE role <> \'supplier\' ORDER BY role, email');
    console.log('All staff users:');
    result.rows.forEach(function(r) {
      console.log('  ' + r.role.padEnd(22) + r.email);
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
