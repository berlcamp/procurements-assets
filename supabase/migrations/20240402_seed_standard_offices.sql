-- Seed: Standard DepEd Division Office structure
--
-- Creates a reusable function that Division Admins (or Super Admins) call
-- after onboarding a division to populate the standard office hierarchy.
--
-- Usage (run in Supabase SQL Editor, replacing the UUID):
--   SELECT procurements.seed_standard_offices('<division_id_uuid>');
--
-- Schools are stored in the same `offices` table with office_type = 'school'.
-- Use seed_school() for individual schools as they vary per division.
-- A bulk helper procurements.seed_school() is provided at the bottom.
--
-- Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.

-- ============================================================
-- Main: seed standard Division Office departments and sections
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.seed_standard_offices(p_division_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  -- Top-level division office IDs
  v_sds    UUID;
  v_asds   UUID;
  v_fin    UUID;
  v_admin  UUID;
  v_hrmd   UUID;
  v_clmd   UUID;
  v_sgod   UUID;
BEGIN
  -- Verify division exists
  IF NOT EXISTS (SELECT 1 FROM platform.divisions WHERE id = p_division_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Division % not found', p_division_id;
  END IF;

  -- ──────────────────────────────────────────────────────────
  -- LEVEL 1: Division Offices (office_type = 'division_office')
  -- ──────────────────────────────────────────────────────────

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Office of the Schools Division Superintendent', 'SDS', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_sds;

  -- Fetch ID if the row already existed (ON CONFLICT path)
  IF v_sds IS NULL THEN
    SELECT id INTO v_sds FROM procurements.offices WHERE division_id = p_division_id AND code = 'SDS';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Office of the Asst. Schools Division Superintendent', 'ASDS', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_asds;
  IF v_asds IS NULL THEN
    SELECT id INTO v_asds FROM procurements.offices WHERE division_id = p_division_id AND code = 'ASDS';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Finance Division', 'FIN', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_fin;
  IF v_fin IS NULL THEN
    SELECT id INTO v_fin FROM procurements.offices WHERE division_id = p_division_id AND code = 'FIN';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Administrative Division', 'ADMIN', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_admin;
  IF v_admin IS NULL THEN
    SELECT id INTO v_admin FROM procurements.offices WHERE division_id = p_division_id AND code = 'ADMIN';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Human Resource Management Division', 'HRMD', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_hrmd;
  IF v_hrmd IS NULL THEN
    SELECT id INTO v_hrmd FROM procurements.offices WHERE division_id = p_division_id AND code = 'HRMD';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'Curriculum and Learning Management Division', 'CLMD', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_clmd;
  IF v_clmd IS NULL THEN
    SELECT id INTO v_clmd FROM procurements.offices WHERE division_id = p_division_id AND code = 'CLMD';
  END IF;

  INSERT INTO procurements.offices (division_id, name, code, office_type)
  VALUES (p_division_id, 'School Governance and Operations Division', 'SGOD', 'division_office')
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_sgod;
  IF v_sgod IS NULL THEN
    SELECT id INTO v_sgod FROM procurements.offices WHERE division_id = p_division_id AND code = 'SGOD';
  END IF;

  -- ──────────────────────────────────────────────────────────
  -- LEVEL 2: Sections (office_type = 'section')
  -- ──────────────────────────────────────────────────────────

  -- Under Finance Division
  INSERT INTO procurements.offices (division_id, name, code, office_type, parent_office_id) VALUES
    (p_division_id, 'Accounting Section',   'FIN-ACCTG',  'section', v_fin),
    (p_division_id, 'Budget Section',        'FIN-BUDGET', 'section', v_fin),
    (p_division_id, 'Cashiering Section',    'FIN-CASH',   'section', v_fin)
  ON CONFLICT (division_id, code) DO NOTHING;

  -- Under Administrative Division
  INSERT INTO procurements.offices (division_id, name, code, office_type, parent_office_id) VALUES
    (p_division_id, 'Records Section',                        'ADMIN-REC',  'section', v_admin),
    (p_division_id, 'Procurement Section (BAC Secretariat)',  'ADMIN-PROC', 'section', v_admin),
    (p_division_id, 'Property and Supply Management Section', 'ADMIN-PROP', 'section', v_admin),
    (p_division_id, 'General Services Section',               'ADMIN-GS',   'section', v_admin),
    (p_division_id, 'ICT Section',                            'ADMIN-ICTS', 'section', v_admin)
  ON CONFLICT (division_id, code) DO NOTHING;

  -- Under HRMD
  INSERT INTO procurements.offices (division_id, name, code, office_type, parent_office_id) VALUES
    (p_division_id, 'HR Development Section',          'HRMD-DEV',  'section', v_hrmd),
    (p_division_id, 'HR Information and Payroll Section', 'HRMD-INFO', 'section', v_hrmd),
    (p_division_id, 'Welfare and Benefits Section',    'HRMD-WB',   'section', v_hrmd)
  ON CONFLICT (division_id, code) DO NOTHING;

  -- Under CLMD
  INSERT INTO procurements.offices (division_id, name, code, office_type, parent_office_id) VALUES
    (p_division_id, 'Learning Resource Management Section', 'CLMD-LRM', 'section', v_clmd),
    (p_division_id, 'Curriculum Implementation Division',   'CLMD-CID', 'section', v_clmd)
  ON CONFLICT (division_id, code) DO NOTHING;

  -- Under SGOD
  INSERT INTO procurements.offices (division_id, name, code, office_type, parent_office_id) VALUES
    (p_division_id, 'Social Mobilization and Networking Section',              'SGOD-SMN',  'section', v_sgod),
    (p_division_id, 'School Management Monitoring and Evaluation Section',     'SGOD-SMME', 'section', v_sgod),
    (p_division_id, 'Disaster Risk Reduction and Management Section',          'SGOD-DRRM', 'section', v_sgod),
    (p_division_id, 'Results-Based Performance Management System Section',     'SGOD-RPMS', 'section', v_sgod)
  ON CONFLICT (division_id, code) DO NOTHING;

  RAISE NOTICE 'Standard offices seeded for division %', p_division_id;
END;
$$;

-- ============================================================
-- Helper: add a single school to a division
--
-- Usage:
--   SELECT procurements.seed_school(
--     '<division_id>',
--     'Sta. Cruz Elementary School',
--     'SCES',
--     NULL    -- pass parent school ID if this is an annex
--   );
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.seed_school(
  p_division_id    UUID,
  p_name           TEXT,
  p_code           TEXT,
  p_parent_id      UUID DEFAULT NULL,
  p_address        TEXT DEFAULT NULL,
  p_contact_number TEXT DEFAULT NULL,
  p_email          TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO procurements.offices (
    division_id, name, code, office_type, parent_office_id,
    address, contact_number, email
  )
  VALUES (
    p_division_id, p_name, p_code, 'school', p_parent_id,
    p_address, p_contact_number, p_email
  )
  ON CONFLICT (division_id, code) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM procurements.offices
    WHERE division_id = p_division_id AND code = p_code;
  END IF;

  RETURN v_id;
END;
$$;
