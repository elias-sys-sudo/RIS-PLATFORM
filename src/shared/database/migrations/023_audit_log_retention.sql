-- =============================================================================
-- Migration 023: Audit Log Retention & Archival
-- Creates an archive table for audit_logs and a function to move records
-- older than N years (default 7) from audit_logs to audit_logs_archive.
-- =============================================================================

-- Archive table: same schema as audit_logs plus archived_at timestamp
CREATE TABLE IF NOT EXISTS audit_logs_archive (
  id UUID PRIMARY KEY,
  user_id UUID,
  action VARCHAR(255) NOT NULL,
  table_name VARCHAR(100),
  record_id VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created_at
  ON audit_logs_archive(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_action
  ON audit_logs_archive(action);

-- =============================================================================
-- Function: archive_audit_logs(retention_years INT DEFAULT 7)
-- Moves audit_logs records older than retention_years into audit_logs_archive.
-- Temporarily disables the immutability trigger to allow DELETE.
-- Requires superuser privileges.
-- =============================================================================
CREATE OR REPLACE FUNCTION archive_audit_logs(retention_years INT DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  -- Temporarily disable immutability trigger for archival
  ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;

  -- Move old records to archive
  WITH moved AS (
    DELETE FROM audit_logs
    WHERE created_at < NOW() - (retention_years || ' years')::INTERVAL
    RETURNING *
  )
  INSERT INTO audit_logs_archive (id, user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, created_at)
  SELECT id, user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, created_at
  FROM moved;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  -- Re-enable immutability trigger
  ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;

  RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Documentation
-- =============================================================================
COMMENT ON TABLE audit_logs_archive IS 'Archived audit logs older than 7 years. Created by archive_audit_logs() function. Run periodically by DBA.';
COMMENT ON FUNCTION archive_audit_logs IS 'Archives audit_logs records older than N years to audit_logs_archive table. Requires superuser privileges to disable/enable immutability trigger. Default retention: 7 years.';
