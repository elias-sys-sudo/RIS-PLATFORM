-- Migration 021: Add 'priced' status to invoice_status enum
--
-- The workflow requires: scored -> priced -> (supplier accepts) -> approved.
-- Previously the flow skipped from scored directly to approval.
-- This adds the intermediate 'priced' status after pricing calculations complete.

ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'priced' BEFORE 'approved';
