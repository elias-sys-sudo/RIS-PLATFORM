-- Migration 044: Add idempotency_key to settlements table
-- Prevents duplicate settlement disbursement when a BullMQ job is retried
-- after the worker crashed mid-processing or lost its completion ack.
-- Mirrors the payments idempotency pattern (migration 005).

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NOT NULL DEFAULT uuid_generate_v4();

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_idempotency_key
  ON settlements (idempotency_key);
