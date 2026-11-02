-- Least-privilege database role for the running application (API + worker).
--
-- Two roles:
--   * OWNER (the user that runs this script and the migrations, e.g. "inother"): owns the schema.
--   * inother_app: what DATABASE_URL uses at runtime. Data access only (DML). It cannot change the
--     schema (CREATE/ALTER/DROP), cannot TRUNCATE, cannot read the migrations journal, and cannot
--     UPDATE or DELETE the append-only audit log. A compromised app process therefore can't wipe
--     tables, drop the audit trail, or alter the schema.
--
-- Run as the OWNER, after migrations, once per database (re-runnable):
--   psql "$DATABASE_MIGRATION_URL" -v app_password="$APP_DB_PASSWORD" -f infra/db-roles.sql
-- Then set DATABASE_URL=postgres://inother_app:<password>@host/db and keep DATABASE_MIGRATION_URL
-- (owner) only in the migration job. The password is NEVER stored in this file.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inother_app') THEN
    CREATE ROLE inother_app LOGIN NOINHERIT;
  END IF;
END
$$;
ALTER ROLE inother_app WITH LOGIN PASSWORD :'app_password';

-- Verify (rather than set — changing these needs superuser) that the role has no dangerous powers.
DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'inother_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
    RAISE EXCEPTION 'inother_app must not be superuser / createdb / createrole / bypassrls / replication';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) THEN
    RAISE EXCEPTION 'inother_app must not be a member of other roles';
  END IF;
END
$$;

-- No implicit rights through PUBLIC on our schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO inother_app;

-- Data access on existing tables and sequences.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inother_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inother_app;

-- The audit log is append-only for the application (a trigger also blocks UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM inother_app;

-- Tables created by future migrations (run by this same owner) get the same DML grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inother_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inother_app;

-- The migrations journal belongs to the owner only.
REVOKE ALL ON SCHEMA drizzle FROM inother_app;
