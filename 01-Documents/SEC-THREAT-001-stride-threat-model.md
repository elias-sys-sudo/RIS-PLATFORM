# RIS Platform — STRIDE Threat Model

**Document ID:** SEC-THREAT-001  
**Version:** 1.0  
**Date:** March 2026  
**Status:** Approved  
**Owner:** CTO / Compliance Officer  
**Methodology:** STRIDE (Microsoft Threat Modelling)

---

## Purpose

This threat model identifies the top security threats specific to an invoice discounting platform operating in Uganda. It was produced before system design to ensure architectural controls are built in from the start — not retrofitted. Every threat listed here maps to one or more security requirements in SEC-REQ-001.

---

## Threat Register

### Category 1: SPOOFING

_How might an attacker impersonate a legitimate supplier, buyer, or staff member?_

---

**THREAT-S-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-S-001 |
| **Category** | Spoofing |
| **Title** | Credential theft via phishing targeting supplier accounts |
| **Description** | An attacker sends a convincing phishing email to a supplier's registered email address mimicking the RIS portal login page. The supplier enters their username and password. The attacker captures the credentials and uses them to log in, submit fraudulent invoices, or redirect payment details to a different mobile money number. In Uganda, mobile money fraud via phishing is well-documented and this attack vector is highly plausible given that many SME suppliers may have limited cybersecurity awareness. |
| **Likelihood** | High |
| **Impact** | High |
| **Risk Rating** | Critical |
| **Architectural Mitigations Required** | (1) Enforce TOTP 2FA for all accounts — stolen password alone is insufficient. (2) Implement account lockout after 5 failed attempts (SEC-005). (3) Log LOGIN_SUCCESS with IP and user agent — alert on login from new device or country. (4) Any change to bank_account_number or mobile_money_number requires re-authentication and sends confirmation to the registered email. (5) Session tokens transmitted via httpOnly cookies only — not accessible to injected JavaScript. |
| **SEC References** | SEC-002, SEC-005, SEC-007, SEC-030 |

---

**THREAT-S-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-S-002 |
| **Category** | Spoofing |
| **Title** | JWT token forgery or theft to impersonate staff |
| **Description** | An attacker intercepts a JWT token transmitted over an insecure connection, or extracts it from browser local storage on a compromised device. Using the stolen token, they impersonate a credit_officer or finance_manager and approve invoices or authorise payments on their behalf. If the JWT secret is weak or hardcoded, an attacker could also forge tokens entirely without needing to steal them. This is particularly dangerous for finance_manager tokens which can trigger payment execution. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) JWT secret minimum 256 bits from environment variable — never hardcoded (SEC-003). (2) JWT expiry maximum 15 minutes — limits window of stolen token use. (3) All tokens transmitted over TLS 1.3 only — no downgrade permitted (SEC-020). (4) Redis session blacklist — logout immediately invalidates token even within 15-minute window (SEC-007). (5) Tokens stored in httpOnly cookies — never in localStorage. (6) finance_manager endpoints require 2FA re-verification if >60 minutes since last verification (SEC-009). |
| **SEC References** | SEC-003, SEC-007, SEC-009, SEC-020 |

---

**THREAT-S-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-S-003 |
| **Category** | Spoofing |
| **Title** | Fraudulent buyer confirmation via token enumeration |
| **Description** | The buyer confirmation flow issues a token to the buyer to confirm invoice details. An attacker — potentially a colluding supplier — attempts to enumerate or brute-force buyer confirmation tokens to confirm invoices that buyers have not actually agreed to. If tokens are short, sequential, or predictable, an attacker can systematically try all combinations. A fraudulently confirmed invoice then proceeds through risk scoring and approval, potentially resulting in RIS funding an invoice the buyer never agreed to pay. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Buyer confirmation tokens are cryptographically random UUID v4 — not sequential or enumerable. (2) Tokens are stored as SHA-256 hashes — raw token never in database. (3) Token expiry: 48 hours maximum. (4) Rate limiting on /invoices/:id/buyer-confirm endpoint: 5 attempts per token per hour. (5) Used tokens are immediately invalidated — cannot be reused. (6) Token sent only to buyer's registered email — not visible to supplier. |
| **SEC References** | SEC-006, SEC-040 |

---

### Category 2: TAMPERING

_How might invoice values, payment amounts, or approval decisions be altered in transit or at rest?_

---

**THREAT-T-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-T-001 |
| **Category** | Tampering |
| **Title** | Invoice value manipulation between submission and funding |
| **Description** | A malicious insider (compromised credit officer account or rogue employee) directly modifies the face_value of an invoice in the PostgreSQL database after approval but before payment execution. The payment engine then executes a payment for a larger amount than was approved. Alternatively, an attacker with database access modifies the net_payment_to_supplier value in the payments table to redirect a larger amount to a supplier's mobile money number. This threat is amplified by the fact that many Ugandan fintech incidents involve insider fraud. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Once an invoice reaches status='scored', face_value is immutable — database trigger prevents UPDATE on face_value after this status. (2) Payment amount in payments table derived at creation from risk_scores.net_payment — not editable via API. (3) All database write access goes through application layer only — no direct DB access for any staff role. (4) Database user has minimum permissions — no DELETE on invoices or payments tables. (5) Audit log records face_value and payment_amount at every status change — any discrepancy is detectable. (6) Payment execution reads amount from payments table — not from any API request parameter. |
| **SEC References** | SEC-028, SEC-029, SEC-032 |

---

**THREAT-T-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-T-002 |
| **Category** | Tampering |
| **Title** | Man-in-the-middle attack on payment provider API calls |
| **Description** | An attacker intercepts the HTTPS connection between the RIS API server and the MTN MoMo or Airtel Money API. By performing a man-in-the-middle attack — possible if TLS certificate validation is disabled or if a corporate proxy is misconfigured — the attacker modifies the payment destination mobile money number or the payment amount in the API request body before it reaches the provider. The payment is then executed to a fraudulent destination. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Rating** | Medium |
| **Architectural Mitigations Required** | (1) TLS 1.3 enforced on all outbound API calls — no version downgrade permitted (SEC-020). (2) Certificate pinning on MTN MoMo and Airtel API connections in production. (3) All payment provider requests include HMAC-SHA256 request signing — provider rejects any request where signature does not match body. (4) Payment amount and destination read from internal payments table — never from an API request parameter that could be manipulated. (5) Provider response verified against expected transaction reference before marking status='funded'. |
| **SEC References** | SEC-020, SEC-041 |

---

**THREAT-T-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-T-003 |
| **Category** | Tampering |
| **Title** | SQL injection to manipulate financial records |
| **Description** | An attacker injects malicious SQL through any unparameterised input field — invoice_number, company_name, or any search/filter parameter. A successful injection could: modify invoice amounts, approve invoices without proper credit officer review, delete audit log entries (violating immutability), or extract all supplier financial data. This threat is particularly serious because SQL injection remains the most common attack vector against financial applications in East Africa. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) ZERO string concatenation in SQL — parameterised queries exclusively throughout all repository files (CLAUDE.md Rule #2). (2) Joi input validation on every endpoint before any database call — rejects malformed inputs before they reach SQL layer. (3) ESLint rule configured to flag any string template literal containing SQL keywords. (4) OWASP ZAP SQL injection scan in CI/CD pipeline — build fails on any finding. (5) PostgreSQL user has minimum required permissions — cannot DROP tables or modify schema. |
| **SEC References** | SEC-008, SEC-013, SEC-051 |

---

### Category 3: REPUDIATION

_How might a party deny they submitted an invoice or authorised a payment?_

---

**THREAT-R-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-R-001 |
| **Category** | Repudiation |
| **Title** | Supplier denies submitting fraudulent invoice |
| **Description** | A supplier submits an invoice for goods or services that were never delivered to the buyer. When RIS attempts to collect from the buyer, the buyer disputes the invoice. The supplier then denies having submitted the invoice, claiming their account was hacked. Without non-repudiation controls, RIS cannot prove which user submitted the invoice, from what device, at what time, and with what IP address. Under the full recourse model, RIS needs to establish supplier liability to recover funds. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Every invoice submission writes to audit_logs: INVOICE_SUBMITTED with userId, IP address, user_agent, timestamp, and a SHA-256 hash of the submitted invoice data. (2) Buyer confirmation token provides independent third-party verification that the buyer agreed to the invoice terms. (3) JWT sessionId logged with every action — ties the action to a specific authenticated session. (4) Audit log is immutable — database trigger prevents any modification (SEC-028). (5) Document hashes stored on submission — proves the exact document content at time of submission. |
| **SEC References** | SEC-028, SEC-029, SEC-034 |

---

**THREAT-R-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-R-002 |
| **Category** | Repudiation |
| **Title** | Finance Manager denies authorising a payment |
| **Description** | A finance_manager authorises a fraudulent or erroneous payment and later denies doing so, claiming their account was used without their knowledge. In a legal or regulatory dispute, RIS must be able to prove beyond reasonable doubt that a specific named individual authorised a specific payment at a specific time. Without strong non-repudiation controls, RIS faces legal liability and cannot recover funds through the dual-authorisation process. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Rating** | Medium |
| **Architectural Mitigations Required** | (1) Dual authorisation records dual_auth_user_1 and dual_auth_user_2 — both user IDs permanently stored in payments table (immutable after recording). (2) Each authorisation requires valid 2FA verification at time of authorisation — proves physical possession of TOTP device. (3) PAYMENT_FIRST_AUTH and PAYMENT_SECOND_AUTH events written to audit_logs with: userId, IP, user_agent, timestamp, sessionId, and payment amount. (4) Audit log immutable — cannot be altered after the fact (SEC-028). (5) Payment authorisation emails sent to authorising user's registered address immediately — creates external paper trail. |
| **SEC References** | SEC-002, SEC-029, SEC-032, SEC-036, SEC-037 |

---

**THREAT-R-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-R-003 |
| **Category** | Repudiation |
| **Title** | Buyer denies confirming invoice via token |
| **Description** | A buyer confirms an invoice via the token-based confirmation link and later disputes the transaction, claiming they never confirmed it. Alternatively, a colluding supplier confirms on the buyer's behalf using a token obtained fraudulently. In either case, if the confirmation cannot be proven, RIS loses its legal basis for collecting from the buyer at maturity, creating a credit loss. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Buyer confirmation records: token hash, confirmation timestamp, IP address, and user_agent of the confirming party. (2) Confirmation email sent to buyer's registered address with full invoice details before token is issued — proves buyer received the information. (3) Post-confirmation email sent to buyer summarising what they confirmed — creates external evidence. (4) BUYER_CONFIRMED event written to audit_logs immediately on confirmation. (5) Notice of Assignment document generated and stored with SHA-256 hash at confirmation time — legally binding document. |
| **SEC References** | SEC-028, SEC-029 |

---

### Category 4: INFORMATION DISCLOSURE

_How might a supplier see another supplier's data, or an external party access financial records?_

---

**THREAT-I-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-I-001 |
| **Category** | Information Disclosure |
| **Title** | Horizontal data breach via IDOR (Insecure Direct Object Reference) |
| **Description** | A supplier authenticated as Supplier A manipulates the invoice_id or supplier_id parameter in API requests to access invoices, documents, or payment records belonging to Supplier B. For example: GET /invoices/550e8400-e29b-41d4-a716-446655440000 — if the API does not verify that the requesting supplier owns invoice 550e8400, Supplier A can enumerate UUIDs and access all supplier data. This is the most common data breach pattern in multi-tenant financial applications. |
| **Likelihood** | High |
| **Impact** | High |
| **Risk Rating** | Critical |
| **Architectural Mitigations Required** | (1) Every endpoint verifies resource ownership: SELECT COUNT(\*) FROM invoices WHERE id=$1 AND supplier_id=$2 — if count=0, return 403 immediately (SEC-012). (2) PostgreSQL row-level security enforces this at database level independent of application code (SEC-014). (3) UUIDs used as all resource IDs — non-sequential, non-enumerable. (4) 403 responses logged as OWNERSHIP_VIOLATION in audit_logs — triggers alert to compliance_officer (SEC-033). (5) Integration tests specifically test cross-supplier access on every endpoint. |
| **SEC References** | SEC-012, SEC-014, SEC-033 |

---

**THREAT-I-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-I-002 |
| **Category** | Information Disclosure |
| **Title** | PII exposure through application logs |
| **Description** | A developer adds a debug log statement that inadvertently writes a supplier's bank account number, director ID, or mobile money number to the application log file. Log files are often less protected than databases — they may be accessible to junior developers, stored unencrypted, or transmitted to third-party log aggregation services. A single log statement can expose PII for thousands of users. In Uganda, this would constitute a breach under the Data Protection and Privacy Act 2019. |
| **Likelihood** | High |
| **Impact** | Medium |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) ESLint rule prohibiting console.log throughout codebase — only logger.ts permitted (CLAUDE.md Rule #3). (2) logger.ts configured to strip any field matching PII patterns before writing. (3) Code review checklist includes PII-in-logs check. (4) OWASP ZAP scan checks for PII in API responses. (5) Log files stored in restricted directory — not accessible to application runtime user. (6) All log aggregation services (if used) located within Uganda or EAC jurisdiction per Data Protection Act. |
| **SEC References** | SEC-021 |

---

**THREAT-I-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-I-003 |
| **Category** | Information Disclosure |
| **Title** | Database breach exposing plaintext financial documents |
| **Description** | An attacker gains access to the RIS PostgreSQL database — through SQL injection, compromised database credentials, or a cloud misconfiguration. All supplier documents (ID cards, bank statements, incorporation certificates), bank account numbers, and mobile money numbers are exposed in plaintext. At scale, this exposes hundreds of Ugandan SMEs' most sensitive financial information. The reputational and regulatory consequences for RIS would be severe, including potential FIA sanctions and liability under the Data Protection Act. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) All PII fields encrypted with AES-256-GCM before database write (SEC-019). (2) Document files stored in encrypted form on disk — plaintext never written even temporarily (SEC-022). (3) Encryption key stored separately from database in environment variables (SEC-026). (4) Database not exposed to internet — accessible only from application servers within private network. (5) PostgreSQL connection string never logged or included in error responses. (6) Separate database users with minimum permissions for each service. |
| **SEC References** | SEC-019, SEC-022, SEC-026 |

---

### Category 5: DENIAL OF SERVICE

_What would happen if the system were overwhelmed during a payment processing window?_

---

**THREAT-D-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-D-001 |
| **Category** | Denial of Service |
| **Title** | Authentication endpoint flood causing platform lockout |
| **Description** | An attacker sends thousands of requests per second to POST /auth/login, overwhelming the authentication service. Because the login endpoint queries the database for each request (to check credentials), a sustained flood saturates the PostgreSQL connection pool, causing authentication failures for legitimate users including finance managers who need to authorise time-sensitive payments. If this occurs during the 72-hour payment SLA window, suppliers miss their payment commitment. In Uganda, this type of targeted DoS has been used against financial institutions to disrupt payment windows. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Rate limiting: 10 requests per IP per 15 minutes on all /auth/\* endpoints — returns 429 with Retry-After header (SEC-006). (2) WAF (Web Application Firewall) at API gateway level — blocks IP ranges with anomalous request rates. (3) Payment authorisation flow separated from authentication service — payment Bull jobs continue processing even if auth is degraded. (4) Circuit breaker on database connection pool — rejects new connections gracefully rather than hanging. (5) CDN/DDoS protection layer (Cloudflare or equivalent) in front of API gateway. |
| **SEC References** | SEC-006, SEC-043, SEC-048 |

---

**THREAT-D-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-D-002 |
| **Category** | Denial of Service |
| **Title** | Bull job queue exhaustion via invoice submission flood |
| **Description** | A supplier (or attacker with a supplier account) submits thousands of invoices in rapid succession, flooding the Bull job queue with buyer confirmation emails, risk scoring jobs, and notification jobs. Redis memory is exhausted, causing all Bull queues to fail — including payment execution queues for legitimate invoices already in process. Existing funded invoices cannot trigger collection reminders. The 72-hour SLA is breached for all invoices currently in the pipeline. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Rate limit invoice submission: maximum 10 invoices per supplier per hour. (2) Bull queue maximum size limits per queue — new jobs rejected when queue exceeds threshold, not silently dropped. (3) Separate Bull queues for payments vs notifications — payment queue has dedicated Redis memory allocation and is not affected by notification queue exhaustion. (4) Redis memory limits configured with maxmemory-policy=noeviction for payment queues specifically. (5) Queue depth monitoring alert when any queue exceeds 1,000 jobs. |
| **SEC References** | SEC-043, SEC-048 |

---

**THREAT-D-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-D-003 |
| **Category** | Denial of Service |
| **Title** | Large file upload exhausting server storage and memory |
| **description** | A supplier uploads document files significantly larger than the 10MB limit, or uploads hundreds of files in rapid succession, exhausting disk storage on the application server. Alternatively, a malformed multipart request causes multer to consume unbounded memory while parsing, crashing the Node.js process. With the document storage full, legitimate KYC documents cannot be uploaded, blocking new supplier onboarding and invoice submission. |
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Risk Rating** | Medium |
| **Architectural Mitigations Required** | (1) Multer configured with hard 10MB file size limit — request rejected immediately if exceeded, before file is written to disk. (2) Maximum 10 files per upload request. (3) Accepted MIME types: PDF, JPEG, PNG only — all other types rejected before processing. (4) Request body size limit: 1MB for JSON, 10MB for multipart — enforced at Express middleware level before routing. (5) Document storage on separate volume from application — storage exhaustion does not crash the Node.js process. (6) Storage usage alert at 80% capacity. |
| **SEC References** | SEC-043 |

---

### Category 6: ELEVATION OF PRIVILEGE

_How might a supplier gain credit officer access, or a credit officer gain finance manager access?_

---

**THREAT-E-001**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-E-001 |
| **Category** | Elevation of Privilege |
| **Title** | JWT role claim manipulation to gain staff privileges |
| **Description** | An attacker decodes a supplier JWT (JWTs are base64-encoded, not encrypted) and observes that the payload contains {"role": "supplier"}. They then modify the payload to {"role": "credit_officer"} and re-encode it. If the application validates the role from the JWT payload without verifying the signature, the attacker gains credit officer privileges. This allows them to approve their own invoices, view all supplier data, and modify KYC statuses. Even if the signature is verified, if the JWT secret is weak, the attacker can forge a valid token with an elevated role. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) JWT secret minimum 256 bits — brute force computationally infeasible (SEC-003). (2) JWT signature verified on every request using the server-side secret — tampered payload fails signature check. (3) Role extracted from verified JWT only — never from request headers, query parameters, or request body. (4) Role validated at two independent layers: route middleware AND service layer (SEC-017). (5) Any JWT with an invalid signature returns 401 and logs TOKEN_TAMPERING_ATTEMPT to audit_logs with IP address. |
| **SEC References** | SEC-003, SEC-013, SEC-017, SEC-030 |

---

**THREAT-E-002**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-E-002 |
| **Category** | Elevation of Privilege |
| **Title** | Mass assignment vulnerability granting self-assigned role elevation |
| **Description** | The supplier registration or profile update endpoint accepts a JSON body that is passed directly to the database query without filtering. An attacker includes {"role": "credit_officer"} or {"is_admin": true} in the request body. If the repository layer uses a spread operator or ORM mass-assignment without an explicit allow-list of fields, the role field is written to the database, granting the attacker elevated privileges on their next login. This is a common vulnerability in Node.js/Express applications. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Joi validation schema on every endpoint explicitly lists ONLY the fields that may be submitted — any additional fields are stripped before processing (CLAUDE.md Rule #8). (2) Repository INSERT and UPDATE queries use explicit column lists — never SELECT \* or spread operators. (3) Role field is never included in any user-facing update endpoint. Role changes use a dedicated admin-only endpoint with its own audit trail. (4) Integration test: submit role field in registration body — verify it is ignored. |
| **SEC References** | SEC-011, SEC-016 |

---

**THREAT-E-003**
| Field | Detail |
|-------|--------|
| **Threat ID** | THREAT-E-003 |
| **Category** | Elevation of Privilege |
| **Title** | Compromised credit officer account used to self-approve invoices |
| **Description** | An attacker compromises a credit officer account (via phishing or credential stuffing) and uses it to approve invoices submitted by a colluding supplier. The attacker exploits the fact that the same credit officer who reviews the invoice is also the one who approves it, with no separation of duties control. In Tier 2 approvals, a single credit officer can approve invoices up to UGX 50M. This allows a colluding supplier-credit officer pair to extract up to UGX 50M per invoice without any additional check. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Rating** | High |
| **Architectural Mitigations Required** | (1) Credit officer who locks an invoice for review cannot be the same credit officer who ultimately approves it — enforced at service layer. (2) Tier 3 invoices require TWO separate credit officers — one compromised account is insufficient. (3) 2FA required for all credit officer accounts — phishing password alone is insufficient. (4) Anomaly detection: flag if a credit officer approves more than 3 invoices from the same supplier in a 30-day period without a second reviewer. (5) Management receives daily summary of all approvals with approver identity — provides oversight layer. |
| **SEC References** | SEC-002, SEC-031 |

---

## Threat Summary Matrix

| Threat ID    | Category               | Title                                      | Likelihood | Impact | Risk Rating  |
| ------------ | ---------------------- | ------------------------------------------ | ---------- | ------ | ------------ |
| THREAT-S-001 | Spoofing               | Credential theft via phishing              | High       | High   | **Critical** |
| THREAT-S-002 | Spoofing               | JWT token forgery or theft                 | Medium     | High   | **High**     |
| THREAT-S-003 | Spoofing               | Buyer confirmation token enumeration       | Medium     | High   | **High**     |
| THREAT-T-001 | Tampering              | Invoice value manipulation by insider      | Medium     | High   | **High**     |
| THREAT-T-002 | Tampering              | MITM on payment provider API               | Low        | High   | **Medium**   |
| THREAT-T-003 | Tampering              | SQL injection on financial records         | Medium     | High   | **High**     |
| THREAT-R-001 | Repudiation            | Supplier denies submitting invoice         | Medium     | High   | **High**     |
| THREAT-R-002 | Repudiation            | Finance Manager denies authorising payment | Low        | High   | **Medium**   |
| THREAT-R-003 | Repudiation            | Buyer denies confirming invoice            | Medium     | High   | **High**     |
| THREAT-I-001 | Information Disclosure | IDOR cross-supplier data breach            | High       | High   | **Critical** |
| THREAT-I-002 | Information Disclosure | PII exposure via application logs          | High       | Medium | **High**     |
| THREAT-I-003 | Information Disclosure | Database breach exposing plaintext data    | Medium     | High   | **High**     |
| THREAT-D-001 | Denial of Service      | Auth endpoint flood                        | Medium     | High   | **High**     |
| THREAT-D-002 | Denial of Service      | Bull queue exhaustion                      | Medium     | High   | **High**     |
| THREAT-D-003 | Denial of Service      | Large file upload exhaustion               | Medium     | Medium | **Medium**   |
| THREAT-E-001 | Elevation of Privilege | JWT role claim manipulation                | Medium     | High   | **High**     |
| THREAT-E-002 | Elevation of Privilege | Mass assignment role elevation             | Medium     | High   | **High**     |
| THREAT-E-003 | Elevation of Privilege | Compromised credit officer self-approval   | Medium     | High   | **High**     |

---

## Critical Threats Requiring Immediate Architectural Attention

| Priority | Threat ID    | Reason                                                                           |
| -------- | ------------ | -------------------------------------------------------------------------------- |
| 1        | THREAT-I-001 | IDOR is the most exploitable — simple parameter change exposes all supplier data |
| 2        | THREAT-S-001 | Phishing is the most likely attack vector in Uganda SME context                  |
| 3        | THREAT-T-003 | SQL injection remains #1 OWASP risk and is directly exploitable                  |
| 4        | THREAT-E-001 | JWT tampering grants full privilege escalation with one modification             |
| 5        | THREAT-E-003 | Insider fraud is statistically the highest risk for Ugandan fintechs             |

---

## Sign-off

| Role               | Name | Signature | Date |
| ------------------ | ---- | --------- | ---- |
| CTO                |      |           |      |
| Compliance Officer |      |           |      |
| Managing Director  |      |           |      |
