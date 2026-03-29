-- Grant schema usage and table permissions for PostgREST roles
-- Without these, .schema("platform") and .schema("procurements") calls fail with
-- "permission denied for schema"

-- Platform schema
GRANT USAGE ON SCHEMA platform TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA platform TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO anon, authenticated;

-- Procurements schema
GRANT USAGE ON SCHEMA procurements TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA procurements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA procurements TO authenticated;

-- Audit schema
GRANT USAGE ON SCHEMA audit TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA audit TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO authenticated;
GRANT INSERT ON ALL TABLES IN SCHEMA audit TO authenticated;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA procurements GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA procurements GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT ON TABLES TO authenticated;
