-- Phase 3: Generic trigger functions

-- Generic updated_at trigger for procurements schema tables
CREATE OR REPLACE FUNCTION procurements.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at to Phase 3 tables with updated_at column
CREATE TRIGGER trg_offices_updated_at
  BEFORE UPDATE ON procurements.offices
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON procurements.user_profiles
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON procurements.roles
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_system_settings_updated_at
  BEFORE UPDATE ON procurements.system_settings
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- Generic audit trigger function
-- Records every INSERT/UPDATE/DELETE into audit.audit_logs
-- Attach to any table you want audited via:
--   CREATE TRIGGER trg_<table>_audit
--     AFTER INSERT OR UPDATE OR DELETE ON procurements.<table>
--     FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
CREATE OR REPLACE FUNCTION procurements.audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_old_data     JSONB;
  v_new_data     JSONB;
  v_changed      TEXT[];
  v_division_id  UUID;
  v_office_id    UUID;
  v_record_id    UUID;
  v_key          TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
    v_record_id := (v_old_data->>'id')::UUID;
  ELSIF TG_OP = 'INSERT' THEN
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
    v_record_id := (v_new_data->>'id')::UUID;
  ELSE -- UPDATE
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_record_id := (v_new_data->>'id')::UUID;
    -- Collect changed field names
    FOR v_key IN SELECT key FROM jsonb_each(v_new_data)
    LOOP
      IF v_new_data->v_key IS DISTINCT FROM v_old_data->v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
  END IF;

  -- Extract division_id and office_id if present in the row
  IF TG_OP = 'DELETE' THEN
    v_division_id := (v_old_data->>'division_id')::UUID;
    v_office_id   := (v_old_data->>'office_id')::UUID;
  ELSE
    v_division_id := (v_new_data->>'division_id')::UUID;
    v_office_id   := (v_new_data->>'office_id')::UUID;
  END IF;

  INSERT INTO audit.audit_logs (
    division_id, table_name, record_id, action,
    old_data, new_data, changed_fields,
    user_id, office_id
  ) VALUES (
    v_division_id,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_old_data,
    v_new_data,
    v_changed,
    auth.uid(),
    v_office_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = procurements, audit, auth, public;

-- Attach audit triggers to key Phase 3 tables
CREATE TRIGGER trg_offices_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.offices
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_user_profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.user_profiles
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_user_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.user_roles
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_system_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.system_settings
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
