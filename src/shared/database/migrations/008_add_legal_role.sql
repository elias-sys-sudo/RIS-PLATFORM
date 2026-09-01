-- Migration 008: Add 'legal' to user_role enum
-- The legal role is a read-only viewer for invoices, approvals, payments, and reporting.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'legal';
