SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
ALTER TABLE dashboard_snapshots ADD COLUMN IF NOT EXISTS calendar_basis TEXT NOT NULL DEFAULT 'utc';
ALTER TABLE dashboard_seller_snapshots ADD COLUMN IF NOT EXISTS calendar_basis TEXT NOT NULL DEFAULT 'utc';
ALTER TABLE dashboard_funnel_stage_snapshots ADD COLUMN IF NOT EXISTS calendar_basis TEXT NOT NULL DEFAULT 'utc';