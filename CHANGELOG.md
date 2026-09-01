# Changelog

All notable changes to the RIS Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.2.0] - 2026-04-11

### Fixed
- **Settlements:** Restored 4-step workflow — collections mock was auto-creating settlements
  as `closed`, permanently blocking the Repay Facility → Book Profit → Close sequence.
  Settlements now initiate as `pending` with bank interest seeded (~2% of advance).
- **Settlements:** `repayFacility()` and `bookProfit()` frontend API functions now send the
  required financial fields in the POST body (`facility_repayment_amount`, `accrued_interest`,
  `discount_earned`, `bank_cost_paid`) — fixes Joi 400 errors on the real backend.
- **Settlements:** `book-profit` mock handler now recalculates `netProfit` on transition.
- **Settlements:** `AmountComparison` bank cost reference fixed from `s.bankCost` (undefined)
  to `s.facilityRepayment`.
- **Pricing:** Dispute flow CI fixes — prettier formatting, audit exemption, test mocks.
- **Reporting:** Fixed blank reporting page by isolating `Suspense` per tab and removing
  conflicting `useSearchParams` usage.
- **Schema:** Migration 030 — replaced `CREATE POLICY IF NOT EXISTS` with idempotent
  `DROP POLICY IF EXISTS` / `CREATE POLICY` pattern.
- **Collections:** Corrected `risk_config` column names in migration 029.

### Changed
- **Settlements:** `useRepayFacility` and `useBookProfit` hooks now carry the financial payload
  object through to the API layer (breaking change to hook call signature — internal only).

---

## [1.1.0] - 2026-04-09

### Added
- **Pricing:** Dispute flow — buyers can raise disputes on invoices; dispute resolution tracked
  with status machine, audit trail, and credit officer notification.
- **Pricing:** Rate cap enforcement — discount rate bounded by `risk_config` configurable max.
- **Settlements:** Settlement lifecycle actions exposed in frontend — Repay Facility, Book Profit,
  Close Settlement with rich confirmation dialogs showing financial event breakdowns.
- **Settlements:** Settlement list and detail pages with TimelineStepper, AmountComparison,
  and role-based action buttons (finance_manager for repay/book, management for close).
- **Collateral:** Enforceability status field added to collateral records (migration 020).
- **Compliance:** Bank of Uganda regulatory compliance — 36 gap fixes across AML/CFT enhancements
  (migration 024), KYC enhancements (migration 025), security hardening (migration 026),
  consumer protection (migration 027).
- **Facilities:** Collections-to-facility repayment pipeline with drawdown ID linkage.
- **Design:** Full design system (`DESIGN.md`) — typography, colour palette, spacing, component
  guidelines (Plus Jakarta Sans, DM Sans, Geist Mono; forest green #1B4332 + amber #F59E0B).
- **Frontend:** Complete UI/UX overhaul — shadcn/ui components, Tailwind design tokens,
  role-based sidebar, skeleton loading states, accessibility improvements.
- **Frontend:** Chart and reporting overhaul — data storytelling, custom tooltips, sparklines,
  portfolio summary, aging analysis, profit P&L, facility utilisation charts.
- **Auth:** MSW logout fix — 401 responses no longer trigger spurious token refresh loop on
  mock-issued JWTs.

### Changed
- **Collateral:** Coverage threshold moved from hardcoded `0.5` to DB-backed `risk_config`
  key `collateral_min_coverage_ratio` (migration 028), with `0.5` as fallback.
- **Collections:** Daily penalty rate moved to `risk_config` table (migration 029).
- **Reporting:** Reporting tabs isolated per Suspense boundary to prevent blank page on
  navigation.

### Fixed
- **Shared:** Decrypt failure logging — AES-256-GCM errors now logged at WARN with entity ID
  (no PII), instead of silently returning null.
- **Shared:** Velocity check baseline corrected; 2FA seed timestamps fixed for integration tests.
- **Auth:** Login history nullable column handled; 12-character password minimum enforced.
- **Docs:** Transaction journey stages aligned with `settled` terminal status.

---

## [1.0.0] - 2026-04-09

### Added
- **Auth:** JWT authentication with refresh token rotation, role-based access (6 roles),
  timing-safe login, 2FA support (TOTP for staff roles).
- **Onboarding:** Supplier self-registration with KYC wizard, document upload, AES-256-GCM
  PII encryption, sanctions screening, eligibility gate (Module 0).
- **Invoices:** 5-step validation chain, tenor calculation, AML gate (100M UGX threshold),
  full status machine (draft → settled, 13 states).
- **Verification:** SHA-256 token-hashed buyer confirmation, 48h expiry, single-use enforcement,
  dispute raising, PII-safe queue dispatch.
- **Risk Engine:** 5-factor credit scoring (buyer credit, supplier track record, concentration,
  collateral, tenor), DB-backed configurable weights and thresholds.
- **Pricing:** BigInt arithmetic at PRECISION=1e8, discount rate calculation, advance percentage,
  per-buyer RIS margin, fee breakdown.
- **Approvals:** 4-tier approval matrix (AUTO/TIER_2/TIER_3/TIER_4),
  `FOR UPDATE NOWAIT` locking, quorum rules, 24h SLA monitoring.
- **Payments:** Dual authorisation at 3 independent layers (application + DB trigger + provider),
  MTN MoMo / Airtel Money / EFT providers, HMAC-SHA256 webhook verification, idempotency keys.
- **Collections:** Overdue tracking, BigInt penalty calculation, T-7/T-3/T+0/T+1/T+3/T+7
  reminder scheduling, SAR trigger, escalation to legal, buyer payment score adjustments.
- **Facilities:** Facility CRUD, drawdown management, daily interest accrual (RATE_PRECISION=1e9),
  80%/90% utilisation alerts, atomic repayment processing.
- **Collateral:** 6 collateral types, coverage ratio enforcement, 30/7-day expiry alerts,
  supplier ownership enforcement, full audit trail.
- **Reporting:** Role-based report access, portfolio summary, aging analysis, audit export (CSV),
  regulatory report (AML/SAR/KYC), profit P&L, facility utilisation, applications pipeline.
- **Notifications:** Circuit breaker pattern, BullMQ dispatch, idempotency set,
  exponential backoff (30s/120s/480s, 3 retries).
- **Settlements:** Profit booking lifecycle (pending → facility_repaid → profit_booked → closed),
  immutable `profit_bookings` table (DB trigger prevents UPDATE/DELETE), BullMQ worker,
  supplier notification on close.
- **Database:** 17 migrations (001–017) covering core schema, approvals, payments, facilities,
  collateral, risk config, settlements, and invoice disputes.
- **Frontend:** React 19 SPA with TanStack Query v5, shadcn/ui, React Router v6, Zod validation,
  MSW mock layer for development, role-based UI.
