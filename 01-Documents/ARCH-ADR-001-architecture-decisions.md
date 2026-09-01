# RIS Platform — Architecture Decision Records

**Document ID:** ARCH-ADR-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** CTO  
**Status of all ADRs:** Accepted

---

## ADR-001: Modular Monolith Rather Than Distributed Microservices

**Title:** Use a modular monolith deployed as a single process, not distributed microservices

**Status:** Accepted

**Context:**
The microservices architecture pattern is widely recommended for large-scale systems. However, RIS at launch will process 500 invoices per month with a small engineering team (1–3 developers). True distributed microservices introduce significant operational complexity: separate deployment pipelines per service, network latency between services, distributed transaction management, service discovery, inter-service authentication (mTLS), and the need for a sophisticated DevOps capability. A small team building a fintech in Uganda cannot safely operate 9 independently deployed services. At the same time, a traditional monolith with no internal structure becomes impossible to maintain as the system grows.

**Decision:**
Build RIS as a modular monolith — a single deployable Node.js process where each module (auth, onboarding, invoices, risk, pricing, approvals, payments, collections, facilities, reporting) is completely self-contained with its own routes, controllers, services, repositories, and types. Modules communicate only through clearly defined interfaces — never by importing from each other's internal files. The payment module has its own isolated section of the database schema accessible only through its service layer.

**Consequences:**

- Positive: Single deployment pipeline, simpler debugging, no network overhead between modules, easier for small team to operate.
- Positive: Modular structure means migration to true microservices is possible in future by extracting individual modules — the boundaries are already there.
- Positive: Database transactions spanning multiple modules are straightforward — no distributed transaction complexity.
- Negative: All modules scale together — cannot independently scale the risk engine without scaling everything.
- Negative: A crash in one module could affect others — mitigated by comprehensive error handling and the global error handler.
- Negative: Shared database connection pool — mitigated by per-module pool configuration.

**Alternatives Considered:**

- True microservices: Rejected due to operational complexity exceeding team capacity at this scale.
- Traditional monolith (no module boundaries): Rejected because it becomes unmaintainable and prevents future extraction to microservices.

---

## ADR-002: PostgreSQL Rather Than MongoDB for Financial Data

**Title:** Use PostgreSQL 15 as the primary database, not MongoDB or any document database

**Status:** Accepted

**Context:**
Modern Node.js applications often use MongoDB due to its native JSON support and ease of getting started. For RIS, which handles real money, the database choice has significant implications for data integrity, auditability, and regulatory compliance. The Bank of Uganda and FIA require that financial records be accurate, consistent, and auditable. Any database inconsistency — such as a payment recorded but invoice status not updated — is a regulatory and financial risk.

**Decision:**
Use PostgreSQL 15 as the exclusive database. All financial data — invoices, payments, approvals, collections, facilities, audit logs — stored in PostgreSQL with:

- ACID transactions ensuring atomicity across multi-table operations
- Foreign key constraints enforcing referential integrity
- CHECK constraints enforcing business rules at the database level (e.g. dual_auth_user_1 ≠ dual_auth_user_2)
- Database triggers enforcing immutability of audit_logs
- Row-level security policies enforcing supplier data isolation
- pgcrypto extension for database-level cryptographic operations

**Consequences:**

- Positive: ACID transactions guarantee zero partial-state data — critical for financial records.
- Positive: CHECK constraints and triggers enforce business rules independent of application code — defence in depth.
- Positive: Mature ecosystem — pg (Node.js driver), WAL replication, point-in-time recovery all production-proven.
- Positive: SQL is the universal language for financial data — all staff, auditors, and regulators understand it.
- Positive: Row-level security natively supported — supplier isolation enforced at DB level.
- Negative: Schema changes require migrations — more structured than MongoDB's flexible schema.
- Negative: Horizontal sharding more complex than MongoDB — not needed at RIS's scale.

**Alternatives Considered:**

- MongoDB: Rejected. No ACID transactions across collections in older versions. No database-level CHECK constraints. Schema flexibility is a liability for financial data — it allows invalid states to be stored.
- MySQL: Rejected. PostgreSQL's RLS, pgcrypto, and CHECK constraints more mature. PostgreSQL is the standard for financial applications in the region.
- SQLite: Rejected. Not suitable for multi-user concurrent production use.

---

## ADR-003: Dual Authorisation Enforced at Database Level

**Title:** Enforce dual authorisation via PostgreSQL CHECK constraint AND trigger, not application code alone

**Status:** Accepted

**Context:**
The RIS payment dual authorisation requirement (two different finance managers must authorise every payment) is the most critical business rule in the system. If this rule fails — even once — RIS could disburse funds without proper authorisation, creating a fraud risk, a regulatory breach, and a potential financial loss. Application code alone is insufficient: a bug, a race condition, a direct database manipulation by a compromised account, or a future code change that bypasses the service layer could all defeat an application-only control.

**Decision:**
Enforce dual authorisation at THREE independent layers:

1. **Application layer:** PaymentService.authorise() validates dual_auth_user_1 ≠ dual_auth_user_2 before every database write.
2. **Database layer:** PostgreSQL CHECK constraint on the payments table: `CHECK (dual_auth_user_1 IS NULL OR dual_auth_user_2 IS NULL OR dual_auth_user_1 != dual_auth_user_2)`. This fires on every INSERT and UPDATE regardless of which application wrote it.
3. **Provider layer:** MTN MoMo and Airtel APIs configured to require a dual-auth reference in every payment request — provider rejects any payment without it.

**Consequences:**

- Positive: Three independent controls — all three must fail simultaneously for dual auth to be bypassed. Practically impossible.
- Positive: Database constraint catches bugs in application code — defence in depth.
- Positive: Protects against direct database manipulation by a compromised admin account.
- Positive: Audit log records both authorisers permanently — non-repudiation guaranteed.
- Negative: More complex to test — must verify all three layers independently.
- Negative: Database constraint adds marginal overhead to payment writes — acceptable given payment volume.

**Alternatives Considered:**

- Application-only enforcement: Rejected. A single bug or code change could disable it. Insufficient for a financial control.
- Database trigger only (no application check): Rejected. Error messages from triggers are harder to present to users clearly. Application check provides better UX while DB constraint provides hard guarantees.

---

## ADR-004: Payment Module with Isolated Database Schema

**Title:** The Payment module uses an isolated PostgreSQL schema with separate database credentials

**Status:** Accepted

**Context:**
The payment module is the highest-risk component in RIS — it controls fund disbursement. A compromised database credential that grants access to all tables would allow an attacker to manipulate payment records, add false authorisations, or redirect payments. The principle of least privilege requires that only the payment module can read or write payment records, and all other modules — even if compromised — cannot access payment data directly.

**Decision:**
The Payment module's tables (payment_instructions, payment_events) are stored in a separate PostgreSQL schema named 'payments'. A dedicated database user 'mms_payment_user' is created with USAGE and CRUD privileges on the 'payments' schema only — no access to any other schema. All other application database users have NO privileges on the 'payments' schema. The Payment module's database connection string (PAYMENT_DATABASE_URL) is stored separately from the main DATABASE_URL and accessible only within the Payment module's environment.

**Consequences:**

- Positive: A compromised main application credential cannot access payment records.
- Positive: Principle of least privilege enforced at the database authentication layer.
- Positive: Payment schema can have additional security controls (additional audit triggers, stricter column-level permissions) independently.
- Positive: Clear blast radius — a breach of any other service does not expose payment data.
- Negative: Two database connection strings to manage — documented in .env.example.
- Negative: Reporting Service cannot directly query payment data — must go through Payment Service API. Adds one API call to profit report generation.

**Alternatives Considered:**

- Single schema, application-level access control: Rejected. Database-level isolation provides hard guarantees. Application-level access control alone can be bypassed by bugs or direct DB access.
- Separate database instance: Considered but rejected at this scale. Separate schema with separate credentials provides equivalent isolation with lower operational complexity.

---

## ADR-005: MTN Mobile Money as Primary Payout Rail

**Title:** MTN Mobile Money API is the primary supplier payout rail at launch

**Status:** Accepted

**Context:**
RIS must disburse supplier payments quickly (within 72 hours) and reliably. Uganda has two dominant mobile money networks (MTN and Airtel) and traditional bank EFT. The choice of primary payout rail affects: speed of disbursement, cost per transaction, supplier accessibility, and reliability. Most Ugandan SME suppliers have a mobile money account as their primary transactional account, often more reliably than a bank account.

**Decision:**
MTN Mobile Money API v1.0 is the primary payout rail for supplier payments at launch, with Airtel Money as the secondary option and Bank EFT as the option for large corporate suppliers. The supplier registers their preferred_payment_method at onboarding. The payment abstraction layer (IPaymentProvider) means the payment engine is agnostic to the rail — switching providers requires no code change to business logic.

**Consequences:**

- Positive: MTN MoMo has ~17 million subscribers in Uganda — highest reach among supplier base.
- Positive: Near-instant disbursement — funds arrive within seconds of API confirmation.
- Positive: Lower transaction cost than bank EFT for amounts under UGX 5,000,000.
- Positive: Suppliers can receive on mobile phone — no bank account required.
- Positive: IPaymentProvider abstraction means adding new rails (Pesalink, bank transfer) requires only a new class — zero changes to business logic.
- Negative: MTN API has documented reliability issues during peak periods.
- Negative: MTN transaction limits (daily/per-transaction) may restrict large invoice payments — EFT required above threshold.
- Negative: MTN API sandbox behaviour differs from production — requires thorough staging testing.

**Alternatives Considered:**

- Bank EFT as primary: Rejected. Slower (1–3 business days), more complex file format, not all suppliers have bank accounts. Reserved for large corporate transactions.
- Airtel as primary: Rejected. Smaller subscriber base than MTN in Uganda SME segment. Retained as equal secondary option.
- Build own payment processing: Rejected. Regulatory requirements (PSP licence) and technical complexity far exceed RIS's capacity at this stage.

---

## ADR-006: Append-Only Audit Log with Database-Level Immutability Trigger

**Title:** The audit_logs table is append-only, enforced by a PostgreSQL trigger preventing UPDATE and DELETE

**Status:** Accepted

**Context:**
RIS is a regulated financial institution. The audit log is the primary evidence record for: regulatory inspections (BoU, FIA), fraud investigations, dispute resolution, and compliance reporting. An audit log that can be modified — even by an administrator — has no evidentiary value. FIA Uganda and Bank of Uganda require that financial audit trails be tamper-evident. Additionally, RIS's AML obligations require that all AML flags and SAR activities be permanently recorded and not deletable.

**Decision:**
The audit_logs PostgreSQL table has no updated_at column. A database trigger is created at schema initialisation:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable — UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
```

This trigger fires before any UPDATE or DELETE on audit_logs, raising an exception that rolls back the entire transaction. The trigger cannot be disabled without superuser access. Application database users do not have superuser access.

**Consequences:**

- Positive: Tamper-evident audit trail — no application code, even with bugs, can modify audit records.
- Positive: Satisfies FIA Uganda, BoU, and Data Protection Act record-keeping requirements.
- Positive: Provides legal non-repudiation — audit records are admissible as evidence.
- Positive: Verified on every deployment — the scaffold verification step tests DELETE from audit_logs and expects an error.
- Positive: Protects against insider threat — even a database administrator cannot silently delete audit records (the trigger fires for all users including superuser unless explicitly bypassed with SET session_replication_role).
- Negative: No mechanism to correct a mistaken audit entry — a correction must be a new entry noting the error.
- Negative: Audit log grows indefinitely — must be partitioned or archived after the 7-year retention period.
- Negative: Cannot purge test data from audit_logs in development without superuser access — mitigated by using a separate test database.

**Alternatives Considered:**

- Application-only immutability (no updates in code): Rejected. Code can be changed, bypassed by direct DB access, or overridden by a future developer who doesn't know the rule.
- Encrypted hash chain (blockchain-style): Considered. Provides cryptographic proof of ordering. Rejected at this stage as over-engineering — PostgreSQL trigger provides sufficient immutability for regulatory purposes and is simpler to audit and verify.
- Write to separate immutable log service: Considered. Rejected due to complexity and the risk of network failure causing audit gaps. Database-level trigger guarantees atomicity — audit record is written in the same transaction as the business record.
