-- Migration 023: Seed configurable collateral minimum coverage ratio
-- =============================================================================
-- Moves the previously hardcoded 0.5 (50%) collateral coverage threshold
-- (collateral.service.ts checkCoverageRatio) into risk_config so it can be
-- adjusted by an admin without a code deploy. Default value preserved.

INSERT INTO risk_config (key, value, description) VALUES
  ('collateral_min_coverage_ratio', '0.5',
   'Minimum collateral coverage ratio (totalCollateral / faceValue) required for sufficiency')
ON CONFLICT (key) DO NOTHING;
