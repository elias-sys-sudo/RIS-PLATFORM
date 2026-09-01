-- Migration 029: Move daily penalty rate to risk_config (was hardcoded in collections.service.ts)
INSERT INTO risk_config (key, value, description, updated_by)
VALUES ('collections_daily_penalty_rate', '0.001', 'Daily penalty rate for overdue collections (0.1% per day)', 'system')
ON CONFLICT (key) DO NOTHING;
