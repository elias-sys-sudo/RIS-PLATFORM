# RIS Platform — C4 Architecture Specification

**Document ID:** ARCH-C4-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** CTO  
**Tool:** Draw.io (use this specification to draw the diagrams)

---

## Level 1 — System Context Diagram

### Description

Shows RIS as a single system and all external systems it interacts with. Security boundaries shown at the perimeter.

### RIS System (Centre)

- **Name:** RIS Invoice Discounting Platform
- **Description:** Receives invoices from suppliers, confirms with buyers, scores risk, prices discount, approves, disburses payment, and tracks collection
- **Technology:** Node.js, TypeScript, PostgreSQL, Redis, React

### External Systems (draw as boxes surrounding RIS)

| System                        | Direction      | Protocol                        | Purpose                                          | Security Classification              |
| ----------------------------- | -------------- | ------------------------------- | ------------------------------------------------ | ------------------------------------ |
| MTN Mobile Money API          | RIS → MTN      | HTTPS REST                      | Supplier payout disbursement                     | Restricted (credentials in env vars) |
| Airtel Money API              | RIS → Airtel   | HTTPS REST                      | Supplier payout disbursement                     | Restricted (credentials in env vars) |
| Stanbic/DFCU Bank EFT/RTGS    | RIS → Bank     | SFTP / Secure API               | Corporate payouts and buyer payment receipt      | Restricted                           |
| SendGrid Email Gateway        | RIS → SendGrid | HTTPS REST                      | Transactional emails to suppliers, buyers, staff | Internal                             |
| Africa's Talking SMS/WhatsApp | RIS → AT       | HTTPS REST                      | SMS reminders, WhatsApp confirmations            | Internal                             |
| FIA goAML Reporting System    | RIS → FIA      | HTTPS / Secure upload           | SAR filing, CTR filing                           | Restricted (compliance only)         |
| QuickBooks Accounting         | RIS → QB       | HTTPS REST                      | Sync funded invoices and repayments to accounts  | Internal                             |
| Supplier (human)              | Supplier → RIS | HTTPS browser                   | Submit invoices, upload documents                | Public                               |
| Buyer (human)                 | Buyer → RIS    | HTTPS browser (token link)      | Confirm invoices                                 | Public                               |
| Staff (human)                 | Staff → RIS    | HTTPS browser (VPN recommended) | Review, approve, authorise                       | Internal                             |

### Draw.io Instructions (Level 1)

- Place RIS system as a large rounded rectangle in the centre
- Place all external systems as smaller rectangles around the perimeter
- Draw arrows showing direction of interaction
- Label each arrow with protocol and purpose
- Add a dashed boundary box labelled "Uganda Regulatory Boundary" around RIS and FIA systems
- Colour coding: blue=RIS, grey=external systems, red=payment providers, green=communication services

---

## Level 2 — Container Diagram

### Security Zones

Draw three nested zones from outside to inside:

**Zone 1 — DMZ (Internet-facing)**

- API Gateway with WAF
- Supplier Web Portal (React)

**Zone 2 — Internal Network (not internet-facing)**

- Staff Admin Dashboard (React, VPN-only)
- Auth Service
- Business Logic Services (all 9 microservices)
- Background Job Workers (Bull)
- Notification Service

**Zone 3 — Restricted Network (no direct internet access)**

- PostgreSQL Primary
- PostgreSQL Replica (read replica)
- Redis Primary
- Redis Standby
- Encrypted Document Storage

---

### Containers — Detailed Specification

#### 1. API Gateway with WAF

| Property                    | Value                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Zone**                    | DMZ                                                                                  |
| **Technology**              | Nginx + ModSecurity WAF / AWS API Gateway                                            |
| **Security Classification** | Public entry point                                                                   |
| **Responsibility**          | TLS termination, WAF inspection, rate limiting, request routing to internal services |
| **Inbound**                 | HTTPS from internet (port 443 only)                                                  |
| **Outbound**                | HTTP to internal services (port 3000)                                                |
| **Security Controls**       | TLS 1.3 only, HSTS, WAF rules for OWASP Top 10, DDoS protection, IP rate limiting    |

#### 2. Supplier Web Portal

| Property                    | Value                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| **Zone**                    | DMZ                                                                         |
| **Technology**              | React 18, TypeScript                                                        |
| **Security Classification** | Public-facing                                                               |
| **Responsibility**          | Supplier registration, invoice submission, document upload, payment status  |
| **Inbound**                 | Browser requests from suppliers                                             |
| **Outbound**                | HTTPS API calls to API Gateway                                              |
| **Security Controls**       | CSP headers, no sensitive data in localStorage, httpOnly cookies for tokens |
| **Users**                   | Suppliers only                                                              |

#### 3. Staff Admin Dashboard

| Property                    | Value                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| **Zone**                    | Internal (VPN recommended)                                                        |
| **Technology**              | React 18, TypeScript                                                              |
| **Security Classification** | Internal — staff only                                                             |
| **Responsibility**          | KYC review, invoice approval, payment authorisation, risk score review, reporting |
| **Inbound**                 | Browser requests from staff (VPN recommended in production)                       |
| **Outbound**                | HTTPS API calls to API Gateway                                                    |
| **Security Controls**       | 2FA enforced for all staff, session timeout 60 minutes, VPN access recommended    |
| **Users**                   | credit_officer, finance_manager, management, compliance_officer, auditor          |

#### 4. Auth Service

| Property                    | Value                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Zone**                    | Internal                                                                        |
| **Technology**              | Node.js 20, TypeScript, Express                                                 |
| **Security Classification** | Internal — highest security                                                     |
| **Responsibility**          | JWT issuance, 2FA verification, session management, account lockout             |
| **Inbound**                 | HTTP from API Gateway (auth routes only)                                        |
| **Outbound**                | PostgreSQL (users table), Redis (session blacklist, rate limiting)              |
| **Security Controls**       | bcrypt 12 rounds, TOTP via speakeasy, JWT HS256 256-bit secret, Redis blacklist |
| **Database tables owned**   | users, sessions, auth_events                                                    |

#### 5. Business Logic Services (9 Microservices)

| Property                    | Value                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Zone**                    | Internal                                                                                                         |
| **Technology**              | Node.js 20, TypeScript, Express                                                                                  |
| **Security Classification** | Internal                                                                                                         |
| **Responsibility**          | All business logic: onboarding, invoices, risk, pricing, approvals, payments, collections, facilities, reporting |
| **Inbound**                 | HTTP from API Gateway (authenticated requests with validated JWT)                                                |
| **Outbound**                | PostgreSQL (own tables only), Redis (Bull queues), external APIs (payment providers, notifications)              |
| **Security Controls**       | JWT verified on every request, role guard at route and service layer, RLS at DB level                            |
| **Note**                    | Payment Service is in its own restricted sub-zone with isolated DB schema and separate credentials               |

#### 6. Background Job Workers (Bull)

| Property                    | Value                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Zone**                    | Internal                                                                                                         |
| **Technology**              | Node.js 20, BullMQ, TypeScript                                                                                   |
| **Security Classification** | Internal                                                                                                         |
| **Responsibility**          | Async processing: risk scoring, pricing, buyer confirmation emails, payment execution, reminders, SLA monitoring |
| **Inbound**                 | Bull jobs from Redis queues                                                                                      |
| **Outbound**                | PostgreSQL, Redis, external APIs (MTN MoMo, Airtel, SendGrid, Africa's Talking)                                  |
| **Security Controls**       | No inbound HTTP — only processes jobs from trusted Redis queue. All external API calls use HMAC signing.         |
| **Queues**                  | invoice-processing, risk-scoring, pricing, payments, notifications, collections, sla-monitoring                  |

#### 7. Notification Service

| Property                    | Value                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| **Zone**                    | Internal                                                                      |
| **Technology**              | Node.js 20, TypeScript                                                        |
| **Security Classification** | Internal                                                                      |
| **Responsibility**          | Email (SendGrid), SMS (Africa's Talking), WhatsApp (AT) delivery              |
| **Inbound**                 | Bull jobs from notifications queue                                            |
| **Outbound**                | SendGrid API, Africa's Talking API                                            |
| **Security Controls**       | No PII in log entries, API keys in env vars, circuit breaker on all providers |

#### 8. PostgreSQL Primary

| Property                    | Value                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Zone**                    | Restricted (no internet access)                                                                                                    |
| **Technology**              | PostgreSQL 15 with pgcrypto extension                                                                                              |
| **Security Classification** | Restricted — highest                                                                                                               |
| **Responsibility**          | Primary read-write database for all services                                                                                       |
| **Inbound**                 | Connections from application services on port 5432 (private network only)                                                          |
| **Outbound**                | WAL streaming to PostgreSQL Replica                                                                                                |
| **Security Controls**       | No internet exposure, TLS connections required, minimum-privilege DB users per service, RLS policies, immutable audit_logs trigger |

#### 9. PostgreSQL Replica

| Property                    | Value                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| **Zone**                    | Restricted                                                                  |
| **Technology**              | PostgreSQL 15 streaming replica                                             |
| **Security Classification** | Restricted                                                                  |
| **Responsibility**          | Hot standby for failover, read-only queries for reporting and audit exports |
| **Inbound**                 | WAL streaming from Primary                                                  |
| **Security Controls**       | Promoted to primary automatically on primary failure within 60 seconds      |

#### 10. Redis Primary + Standby

| Property                    | Value                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **Zone**                    | Restricted                                                                              |
| **Technology**              | Redis 7 Alpine                                                                          |
| **Security Classification** | Restricted                                                                              |
| **Responsibility**          | Session blacklist, Bull job queues, rate limiting counters                              |
| **Inbound**                 | Connections from application services on port 6379 (private network only)               |
| **Security Controls**       | No internet exposure, requirepass configured, separate memory allocation per queue type |

#### 11. Encrypted Document Storage

| Property                    | Value                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Zone**                    | Restricted                                                                                                |
| **Technology**              | Encrypted filesystem volume (Linux ext4 with LUKS, or S3 with SSE-KMS)                                    |
| **Security Classification** | Restricted — highest                                                                                      |
| **Responsibility**          | AES-256-GCM encrypted document storage (KYC docs, invoice docs, Notice of Assignment)                     |
| **Inbound**                 | Encrypted file writes from Business Logic Services only                                                   |
| **Security Controls**       | All files AES-256-GCM encrypted before write, only encrypted_path stored in DB, no direct internet access |

---

## Draw.io Instructions (Level 2)

1. Draw three concentric boundary rectangles:
   - Outer (dashed red): "DMZ — Internet Facing"
   - Middle (dashed orange): "Internal Network"
   - Inner (solid red): "Restricted — No Internet Access"

2. Place containers in their zones as specified above

3. Draw the Payment Service as a smaller box within the Internal zone with an additional dashed red border labelled "Payment Isolation Zone — Separate DB credentials"

4. Draw arrows between containers with labels showing protocol and data type

5. Draw external systems (from Level 1) outside all boundaries on the right side

6. Add a key:
   - Blue boxes: React frontends
   - Green boxes: Node.js services
   - Orange cylinders: Databases
   - Red cylinders: Restricted data stores
   - Grey boxes: External systems

---

## Network Traffic Rules (for firewall configuration)

| Source                  | Destination                           | Port | Protocol        | Allowed              |
| ----------------------- | ------------------------------------- | ---- | --------------- | -------------------- |
| Internet                | API Gateway WAF                       | 443  | HTTPS           | Yes                  |
| API Gateway             | Auth Service                          | 3000 | HTTP (internal) | Yes                  |
| API Gateway             | Business Logic Services               | 3000 | HTTP (internal) | Yes                  |
| Business Logic Services | PostgreSQL Primary                    | 5432 | TCP (TLS)       | Yes                  |
| Business Logic Services | Redis                                 | 6379 | TCP             | Yes                  |
| Bull Workers            | External APIs (MTN, Airtel, SendGrid) | 443  | HTTPS           | Yes                  |
| Internet                | PostgreSQL                            | ANY  | ANY             | NO                   |
| Internet                | Redis                                 | ANY  | ANY             | NO                   |
| Internet                | Staff Dashboard (without VPN)         | ANY  | ANY             | Restricted           |
| Any service             | Payment DB schema                     | 5432 | TCP             | Payment Service only |
