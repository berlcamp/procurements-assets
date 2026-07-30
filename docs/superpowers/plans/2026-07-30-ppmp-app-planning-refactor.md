# PPMP/APP Planning Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PPMP/APP module model the real DepEd/DBM planning process — budget ceiling → indicative plan → GAA → final plan → lot release → procurement — and make approved planning documents tamper-proof.

**Architecture:** Introduce `budget_ceilings` as the missing anchor entity, then derive `planning_stage` from it instead of from workflow status. Split the overloaded "finalized" lot state into *composed* (packaging locked, gates APP finalization) and *released* (biddable, requires an approved Final APP or an explicit Early Procurement Activity authorization). Add immutability triggers keyed on parent-version status, fix APP provenance to point at immutable versions, and add division-wide planning rounds so the post-GAA revision is a tracked event rather than 40 independent discoveries.

**Tech Stack:** PostgreSQL 15 (Supabase), custom `procurements`/`platform`/`audit` schemas, plpgsql RPCs + RLS, Next.js 16.2.1 App Router, React 19 Server Components, react-hook-form + Zod 4, shadcn/ui.

## Global Constraints

- **NEVER execute migrations.** Per `CLAUDE.md`: generate SQL files in `supabase/migrations/` only. Never run `supabase db push`, `supabase migration up`, or any `DROP`/`ALTER`/`DELETE`/`TRUNCATE`/unqualified `UPDATE`. Every task ends by *asking the user* to apply the migration and paste the result.
- **Migration naming:** `supabase/migrations/YYYYMMDD_description.sql`, ordered after the last existing file (`20260729_app_item_line_level_lotting.sql`). This plan uses the `20260801`–`20260830` range.
- **Additive only.** Do not drop or rename existing columns in this plan. Superseded columns get `COMMENT ... IS 'DEPRECATED: ...'` and stop being written. A separate cleanup migration drops them after the UI has cut over for one full fiscal year.
- **All money is `NUMERIC(15,2)`.** Never `FLOAT`/`REAL`. Never compute currency in JavaScript — compute in SQL and format for display only.
- **All schema-qualified.** Tables live in `procurements`, not `public`. Supabase client calls must use `.schema("procurements")` — omitting it silently returns empty results with no error.
- **Every RPC:** `LANGUAGE plpgsql SECURITY DEFINER SET search_path = procurements, platform, auth, public`, and must (a) enforce `division_id = procurements.get_user_division_id()`, (b) check `procurements.has_permission('code')`, (c) validate the previous status before transitioning.
- **Super-admin RLS pattern (AMENDED 2026-07-30 — supersedes the inline SQL in any task below where they conflict).** Every *write* policy on a table this plan creates must put `platform.is_super_admin()` as a **top-level bypass present in both `USING` and `WITH CHECK`**:
  ```sql
  USING (
    platform.is_super_admin()
    OR (division_id = procurements.get_user_division_id()
        AND procurements.has_permission('the.code'))
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (division_id = procurements.get_user_division_id()
        AND procurements.has_permission('the.code')
        AND procurements.is_division_active())
  );
  ```
  Never `AND (has_permission(...) OR is_super_admin())`, and never omit the super-admin branch from `WITH CHECK`. That shape is dead code for platform admins (whose `get_user_division_id()` is NULL) and blocks `INSERT` outright, since `INSERT` evaluates only `WITH CHECK`. The repo already diagnosed and fixed this exact bug in `20260405_user_roles_super_admin_access.sql:1-23` — follow that migration's shape. Note `20240401_fiscal_years.sql:82-94` and `20240406_budget_allocations.sql:74-98` still carry the old broken shape; **do not copy them**, and do not retrofit them in this plan either. *Read* policies are unaffected — division-scoped reads with no permission check remain correct here.
- **No test runner exists** in this project. TDD is adapted: each task writes an **assertion script** to `supabase/verify/<migration-name>.sql` *first*, confirms it fails, then writes the migration, then confirms it passes. The idiom is:
  ```sql
  DO $$
  BEGIN
    IF NOT (SELECT ...) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: <what was expected>';
    END IF;
  END $$;
  ```
  A silent run is a pass. Any `RAISE EXCEPTION` is a fail.
- **TypeScript gates (CORRECTED 2026-07-30):** `npm run build` (strict) must pass clean. `npm run lint` **cannot** be required to pass — `main` already carries 33 pre-existing lint errors and 106 warnings, so "lint must pass" was an unachievable constraint as originally written. The real gate is: **your changed files introduce no new lint errors or warnings.** Do not fix unrelated pre-existing lint noise; it is out of scope and inflates every diff. Never use `git stash` to establish a lint baseline — there is uncommitted user work in the tree.
- **`src/types/database.ts` is maintained by hand** — no codegen exists. Every schema change must update it in the same task.
- **Permission seed idiom** (copy exactly, from `20240502_ppmp_rls.sql:23-29`):
  ```sql
  INSERT INTO procurements.role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM procurements.roles r
  CROSS JOIN procurements.permissions p
  WHERE r.name = 'role_name'
    AND p.code IN ('perm.code')
  ON CONFLICT DO NOTHING;
  ```
- **Commit per task**, conventional-commit prefixes matching repo history (`feat(app):`, `fix(app):`, `chore(scripts):`, `docs:`).

---

## Vocabulary (used consistently across all tasks)

| Term | Meaning | Where it lives |
|---|---|---|
| **ceiling stage** | `indicative` \| `nep` \| `gaa` \| `final` \| `supplemental` — the legal basis for the money | `budget_ceilings.stage` |
| **planning stage** | `indicative` \| `final` \| `supplemental` — derived from the ceiling a version was prepared against | `ppmp_versions.planning_stage`, `app_versions.planning_stage` |
| **workflow status** | `draft` → `submitted` → … → `approved` — who has signed | `*.status` (unchanged) |
| **composed** | lot packaging is locked; gates APP finalization | `app_lots.status = 'composed'` |
| **released** | lot ABC is fixed and biddable | `app_lots.status = 'released'` |
| **EPA** | Early Procurement Activity — bid/award before GAA on an indicative APP | `app_lots.is_early_procurement` |

---

## File Structure

**New migrations** (`supabase/migrations/`):

| File | Responsibility |
|---|---|
| `20260801_budget_ceilings.sql` | Ceiling entity, RLS, permissions, stage-resolution helper |
| `20260802_planning_stage_columns.sql` | `planning_stage` + `budget_ceiling_id` on both version tables, set-on-insert trigger |
| `20260803_stop_stage_writes_from_workflow.sql` | Rewrite 5 RPCs/triggers to stop writing `indicative_final` |
| `20260804_ppmp_content_immutability.sql` | Triggers + RLS predicates locking approved PPMP content |
| `20260805_app_content_immutability.sql` | Same for `app_items` / `app_versions` |
| `20260806_app_item_provenance.sql` | `source_ppmp_version_id`, partial unique on `item_number`, amendment re-map fix |
| `20260807_consolidation_visibility.sql` | Loud failures + `consolidation_status` on `ppmps` |
| `20260808_amendment_guards.sql` | Block PPMP amendment when derived APP items are in flight |
| `20260809_lot_two_gate_model.sql` | `composed`/`released` states, EPA flags, `release_app_lot()` |
| `20260810_epa_procurement_gates.sql` | Procurement/PR gates moved to lot state + contract-signing ceiling gate |
| `20260811_planning_rounds.sql` | Round tables + `open_planning_round()` |
| `20260812_version_authoritative_status.sql` | Stop resetting `ppmps.status` on amendment |
| `20260813_lot_abc_reconciliation.sql` | Derive lot ABC from line items |
| `20260814_app_total_definitions.sql` | Split `total_estimated_cost` / `total_approved_cost` |
| `20260815_obligation_adjust_on_award.sql` | Release excess obligation at contract amount |
| `20260816_secretariat_review_step.sql` | BAC Secretariat conformity review; HOPE → document-level |
| `20260817_schema_hygiene_dates.sql` | TEXT dates → `DATE` columns + backfill |
| `20260818_schema_hygiene_fund_source.sql` | `source_of_funds` TEXT → `fund_source_id` FK |
| `20260819_orphan_permission_cleanup.sql` | Remove 4 never-checked permission codes |

**New verify scripts:** `supabase/verify/<same-basename>.sql` — one per migration.

**Modified TypeScript:**

| File | Change |
|---|---|
| `src/types/database.ts` | Row types for every new table/column |
| `src/lib/schemas/budget.ts` | `budgetCeilingSchema` |
| `src/lib/schemas/app.ts` | `releaseLotSchema`, `authorizeEpaSchema`, `planningRoundSchema` |
| `src/lib/actions/budget.ts` | Ceiling CRUD server actions |
| `src/lib/actions/app.ts` | `releaseAppLot`, `authorizeEpaLot`, `secretariatReviewApp` |
| `src/lib/actions/ppmp.ts` | `openPlanningRound`, stage-aware amendment |
| `src/components/planning/ppmp-indicative-final-badge.tsx` | Read `planning_stage`, add `SUPPLEMENTAL` |
| `src/components/planning/app-lot-card.tsx` | Composed/released states, EPA badge |
| `src/components/planning/app-lot-manager.tsx` | Release action, EPA authorization dialog |
| `src/components/planning/app-workflow-actions.tsx` | Secretariat review step |
| `src/app/dashboard/budget/ceilings/page.tsx` | New — ceiling management |
| `src/app/dashboard/planning/rounds/page.tsx` | New — planning round management |

---

## Phase 0 — Foundations

### Task 1: `budget_ceilings` table

**Files:**
- Create: `supabase/migrations/20260801_budget_ceilings.sql`
- Create: `supabase/verify/20260801_budget_ceilings.sql`

**Interfaces:**
- Produces: table `procurements.budget_ceilings`; function `procurements.fiscal_year_planning_stage(p_fiscal_year_id UUID) RETURNS TEXT` returning `'indicative'`/`'final'`/`'supplemental'`; function `procurements.authoritative_ceiling_id(p_fiscal_year_id UUID) RETURNS UUID`; permission codes `budget.ceilings_manage`, `budget.ceilings_view`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260801_budget_ceilings.sql`:

```sql
-- Assertions for 20260801_budget_ceilings.sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'budget_ceilings'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.budget_ceilings does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'budget_ceilings' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS is not enabled on budget_ceilings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'fiscal_year_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: fiscal_year_planning_stage() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'budget.ceilings_manage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: budget.ceilings_manage permission not seeded';
  END IF;

  -- Only one authoritative ceiling per fiscal year + stage
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_ceilings_one_authoritative_per_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authoritative-ceiling unique index missing';
  END IF;
END $$;

SELECT 'PASS: 20260801_budget_ceilings' AS result;
```

- [ ] **Step 2: Ask the user to run the assertion script and confirm it fails**

Tell the user: *"Please run `supabase/verify/20260801_budget_ceilings.sql` against your database and paste the output. It should fail on the first assertion."*

Expected: `ERROR: ASSERTION FAILED: procurements.budget_ceilings does not exist`

Do **not** run it yourself.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260801_budget_ceilings.sql`:

```sql
-- ============================================================
-- Budget ceilings: the missing anchor for procurement planning.
--
-- A ceiling is the budget authority a plan is prepared against.
-- The real chain for a Schools Division Office is:
--   DBM National Budget Call
--     -> DepEd Central Office budget call
--       -> Regional Office indicative ceiling   (stage = 'indicative')
--         -> NEP submitted to Congress          (stage = 'nep')
--           -> GAA enacted                      (stage = 'gaa')
--             -> comprehensive release / Sub-ARO (stage = 'final')
--               -> SARO for special purposes     (stage = 'supplemental')
--
-- planning_stage on PPMP/APP versions is DERIVED from this table.
-- It must never be written from a workflow/approval action.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.budget_ceilings (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id        UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id     UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  stage              TEXT          NOT NULL
                       CHECK (stage IN ('indicative','nep','gaa','final','supplemental')),
  -- DBM two-tier budgeting: Tier 1 = ongoing programs, Tier 2 = new/expanded
  tier               TEXT
                       CHECK (tier IS NULL OR tier IN ('tier_1','tier_2')),

  issuing_authority  TEXT          NOT NULL DEFAULT 'DepEd Regional Office',
  reference_number   TEXT,
  amount             NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  issued_date        DATE,
  effective_date     DATE,

  -- Exactly one ceiling per (fiscal year, stage) is the operative one.
  is_authoritative   BOOLEAN       NOT NULL DEFAULT true,

  document_url       TEXT,
  remarks            TEXT,
  created_by         UUID          REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.budget_ceilings IS
  'Budget authority a procurement plan is prepared against. Drives planning_stage on PPMP/APP versions.';
COMMENT ON COLUMN procurements.budget_ceilings.stage IS
  'Legal basis: indicative/nep = no appropriation yet; gaa/final = enacted; supplemental = SARO or additional release.';

CREATE INDEX idx_ceilings_division     ON procurements.budget_ceilings(division_id);
CREATE INDEX idx_ceilings_fiscal_year  ON procurements.budget_ceilings(fiscal_year_id);
CREATE INDEX idx_ceilings_stage        ON procurements.budget_ceilings(stage);
CREATE INDEX idx_ceilings_deleted_at   ON procurements.budget_ceilings(deleted_at) WHERE deleted_at IS NULL;

-- One authoritative ceiling per fiscal year per stage.
CREATE UNIQUE INDEX idx_ceilings_one_authoritative_per_stage
  ON procurements.budget_ceilings (fiscal_year_id, stage)
  WHERE is_authoritative = true AND deleted_at IS NULL;

CREATE TRIGGER trg_ceilings_updated_at
  BEFORE UPDATE ON procurements.budget_ceilings
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ceilings_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.budget_ceilings
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Stage resolution helpers
-- ============================================================

-- Returns the id of the highest-precedence authoritative ceiling for a FY.
-- Precedence: final > gaa > nep > indicative. 'supplemental' is deliberately
-- excluded — a supplemental release does not change the FY's base stage.
CREATE OR REPLACE FUNCTION procurements.authoritative_ceiling_id(
  p_fiscal_year_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT id
    FROM procurements.budget_ceilings
   WHERE fiscal_year_id   = p_fiscal_year_id
     AND is_authoritative = true
     AND deleted_at       IS NULL
     AND stage IN ('indicative','nep','gaa','final')
   ORDER BY CASE stage
              WHEN 'final'      THEN 4
              WHEN 'gaa'        THEN 3
              WHEN 'nep'        THEN 2
              WHEN 'indicative' THEN 1
            END DESC
   LIMIT 1;
$$;

-- Maps a ceiling stage to a planning stage.
CREATE OR REPLACE FUNCTION procurements.ceiling_stage_to_planning_stage(
  p_ceiling_stage TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_ceiling_stage
           WHEN 'indicative'   THEN 'indicative'
           WHEN 'nep'          THEN 'indicative'
           WHEN 'gaa'          THEN 'final'
           WHEN 'final'        THEN 'final'
           WHEN 'supplemental' THEN 'supplemental'
         END;
$$;

-- The FY's current planning stage. Defaults to 'indicative' when no ceiling
-- has been recorded yet, so pre-existing data keeps working.
CREATE OR REPLACE FUNCTION procurements.fiscal_year_planning_stage(
  p_fiscal_year_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
       FROM procurements.budget_ceilings bc
      WHERE bc.id = procurements.authoritative_ceiling_id(p_fiscal_year_id)),
    'indicative'
  );
$$;

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('budget.ceilings_view',   'budget', 'View budget ceilings',                    'division'),
  ('budget.ceilings_manage', 'budget', 'Record and manage DBM/GAA budget ceilings','division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'budget_officer'
  AND p.code IN ('budget.ceilings_view','budget.ceilings_manage')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_admin'
  AND p.code IN ('budget.ceilings_view','budget.ceilings_manage')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_chief','auditor','bac_chair','bac_secretariat')
  AND p.code IN ('budget.ceilings_view')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.budget_ceilings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_ceilings" ON procurements.budget_ceilings
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_ceilings" ON procurements.budget_ceilings
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget.ceilings_manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('budget.ceilings_manage')
    AND procurements.is_division_active()
  );
```

- [ ] **Step 4: Ask the user to apply the migration and re-run the assertion script**

Tell the user: *"Please apply `supabase/migrations/20260801_budget_ceilings.sql`, then run `supabase/verify/20260801_budget_ceilings.sql` and paste the output."*

Expected: `PASS: 20260801_budget_ceilings`

If any assertion fails, fix the migration and ask again. Do not proceed to Task 2 until it passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260801_budget_ceilings.sql supabase/verify/20260801_budget_ceilings.sql
git commit -m "feat(budget): add budget_ceilings as the planning-stage anchor

Records the DBM/DepEd RO indicative ceiling, NEP, GAA, and release
authority per fiscal year. Adds fiscal_year_planning_stage() so PPMP/APP
planning stage can be derived from the budget's legal basis instead of
from approval status.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Ceiling types, schema, and server actions

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/lib/schemas/budget.ts`
- Modify: `src/lib/actions/budget.ts`

**Interfaces:**
- Consumes: table `procurements.budget_ceilings` (Task 1).
- Produces: type `BudgetCeiling`; `budgetCeilingSchema` / `BudgetCeilingInput`; server actions `createBudgetCeiling(input)`, `updateBudgetCeiling(id, input)`, `listBudgetCeilings(fiscalYearId)`, `getFiscalYearPlanningStage(fiscalYearId)` — all returning `{ error: string | null, data?: T }`.

- [ ] **Step 1: Add the row type**

In `src/types/database.ts`, following the existing row-type style (all monetary values typed `string` because PostgreSQL `NUMERIC` arrives as a string over the wire):

```typescript
export interface BudgetCeiling {
  id: string
  division_id: string
  fiscal_year_id: string
  stage: "indicative" | "nep" | "gaa" | "final" | "supplemental"
  tier: "tier_1" | "tier_2" | null
  issuing_authority: string
  reference_number: string | null
  amount: string
  issued_date: string | null
  effective_date: string | null
  is_authoritative: boolean
  document_url: string | null
  remarks: string | null
  created_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type PlanningStage = "indicative" | "final" | "supplemental"
```

- [ ] **Step 2: Add the Zod schema**

In `src/lib/schemas/budget.ts`, matching the existing `z.object` + inferred-type pattern:

```typescript
export const budgetCeilingSchema = z.object({
  fiscal_year_id: z.string().uuid("Select a fiscal year"),
  stage: z.enum(["indicative", "nep", "gaa", "final", "supplemental"]),
  tier: z.enum(["tier_1", "tier_2"]).nullable().optional(),
  issuing_authority: z.string().min(2, "Issuing authority is required"),
  reference_number: z.string().trim().min(1).nullable().optional(),
  amount: z.coerce.number().nonnegative("Amount cannot be negative"),
  issued_date: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  is_authoritative: z.boolean().default(true),
  document_url: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type BudgetCeilingInput = z.infer<typeof budgetCeilingSchema>
```

- [ ] **Step 3: Add the server actions**

In `src/lib/actions/budget.ts`, following the existing `"use server"` + `createClient()` + `revalidatePath()` conventions:

```typescript
export async function createBudgetCeiling(input: BudgetCeilingInput) {
  const parsed = budgetCeilingSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { data: divisionId, error: divErr } = await supabase.rpc(
    "get_user_division_id"
  )
  if (divErr || !divisionId) {
    return { error: "Could not resolve your division." }
  }

  const { data, error } = await supabase
    .schema("procurements")
    .from("budget_ceilings")
    .insert({ ...parsed.data, division_id: divisionId })
    .select()
    .single()

  if (error) {
    // Unique violation on the authoritative index
    if (error.code === "23505") {
      return {
        error:
          "An authoritative ceiling already exists for this fiscal year and stage. Mark the existing one non-authoritative first.",
      }
    }
    return { error: error.message }
  }

  revalidatePath("/dashboard/budget/ceilings")
  return { error: null, data }
}

export async function listBudgetCeilings(fiscalYearId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("budget_ceilings")
    .select("*")
    .eq("fiscal_year_id", fiscalYearId)
    .is("deleted_at", null)
    .order("issued_date", { ascending: true })

  if (error) return { error: error.message }
  return { error: null, data: data as BudgetCeiling[] }
}

export async function getFiscalYearPlanningStage(fiscalYearId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("fiscal_year_planning_stage", {
    p_fiscal_year_id: fiscalYearId,
  })
  if (error) return { error: error.message }
  return { error: null, data: data as PlanningStage }
}
```

- [ ] **Step 4: Confirm the RPC is reachable from PostgREST**

`fiscal_year_planning_stage` lives in the `procurements` schema, so it needs a `public` wrapper to be callable via `supabase.rpc()`. Check how existing RPCs do this:

Run: `grep -n "fiscal_year\|get_user_division_id" supabase/migrations/20240403_public_rpc_wrappers.sql`

If wrappers are the established pattern, append a wrapper to a new migration `20260801a_ceiling_rpc_wrapper.sql`:

```sql
CREATE OR REPLACE FUNCTION public.fiscal_year_planning_stage(p_fiscal_year_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT procurements.fiscal_year_planning_stage(p_fiscal_year_id);
$$;

GRANT EXECUTE ON FUNCTION public.fiscal_year_planning_stage(UUID) TO authenticated;
```

Ask the user to apply it.

- [ ] **Step 5: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/database.ts src/lib/schemas/budget.ts src/lib/actions/budget.ts supabase/migrations/20260801a_ceiling_rpc_wrapper.sql
git commit -m "feat(budget): add budget ceiling types, schema, and server actions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 1 — Decouple planning stage from workflow status

This phase fixes the central modeling error: `indicative_final` is currently written by approval RPCs, which inverts the real indicative→GAA→final sequence.

### Task 3: Add `planning_stage` and `budget_ceiling_id` to both version tables

**Files:**
- Create: `supabase/migrations/20260802_planning_stage_columns.sql`
- Create: `supabase/verify/20260802_planning_stage_columns.sql`

**Interfaces:**
- Consumes: `procurements.fiscal_year_planning_stage()`, `procurements.authoritative_ceiling_id()` (Task 1).
- Produces: columns `ppmp_versions.planning_stage`, `ppmp_versions.budget_ceiling_id`, `app_versions.planning_stage`, `app_versions.budget_ceiling_id`; trigger function `procurements.set_version_planning_stage()`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260802_planning_stage_columns.sql`:

```sql
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(t || '.' || c, ', ')
    INTO v_missing
    FROM (VALUES
      ('ppmp_versions','planning_stage'),
      ('ppmp_versions','budget_ceiling_id'),
      ('app_versions','planning_stage'),
      ('app_versions','budget_ceiling_id')
    ) AS x(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'procurements'
        AND table_name = x.t
        AND column_name = x.c
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: missing columns: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_ppmp_version_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_ppmp_version_planning_stage missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_app_version_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_app_version_planning_stage missing';
  END IF;

  -- Backfill must leave no NULLs
  IF EXISTS (SELECT 1 FROM procurements.ppmp_versions WHERE planning_stage IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_versions.planning_stage has NULLs after backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM procurements.app_versions WHERE planning_stage IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_versions.planning_stage has NULLs after backfill';
  END IF;
END $$;

SELECT 'PASS: 20260802_planning_stage_columns' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: missing columns: ppmp_versions.planning_stage, ...`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260802_planning_stage_columns.sql`:

```sql
-- ============================================================
-- planning_stage: derived from the budget ceiling a version was
-- prepared against, NOT from approval status.
--
-- The old indicative_final columns are left in place but deprecated;
-- Task 4 stops writing them and the UI cuts over in Task 6.
-- ============================================================

ALTER TABLE procurements.ppmp_versions
  ADD COLUMN IF NOT EXISTS planning_stage TEXT
    CHECK (planning_stage IS NULL
           OR planning_stage IN ('indicative','final','supplemental')),
  ADD COLUMN IF NOT EXISTS budget_ceiling_id UUID
    REFERENCES procurements.budget_ceilings(id);

ALTER TABLE procurements.app_versions
  ADD COLUMN IF NOT EXISTS planning_stage TEXT
    CHECK (planning_stage IS NULL
           OR planning_stage IN ('indicative','final','supplemental')),
  ADD COLUMN IF NOT EXISTS budget_ceiling_id UUID
    REFERENCES procurements.budget_ceilings(id);

COMMENT ON COLUMN procurements.ppmp_versions.planning_stage IS
  'Derived from budget_ceiling_id at insert. Never written by an approval action.';
COMMENT ON COLUMN procurements.app_versions.planning_stage IS
  'Derived from budget_ceiling_id at insert. Never written by an approval action.';

COMMENT ON COLUMN procurements.ppmp_versions.indicative_final IS
  'DEPRECATED: was written from approval status, which inverted the real sequence. Use planning_stage.';
COMMENT ON COLUMN procurements.app_versions.indicative_final IS
  'DEPRECATED: was written from approval status. Use planning_stage.';
COMMENT ON COLUMN procurements.ppmps.indicative_final IS
  'DEPRECATED: redundant with ppmp_versions.planning_stage.';
COMMENT ON COLUMN procurements.apps.indicative_final IS
  'DEPRECATED: redundant with app_versions.planning_stage.';

CREATE INDEX idx_ppmp_versions_ceiling ON procurements.ppmp_versions(budget_ceiling_id);
CREATE INDEX idx_app_versions_ceiling  ON procurements.app_versions(budget_ceiling_id);
CREATE INDEX idx_ppmp_versions_stage   ON procurements.ppmp_versions(planning_stage);
CREATE INDEX idx_app_versions_stage    ON procurements.app_versions(planning_stage);

-- ============================================================
-- Set planning_stage on insert from the FY's authoritative ceiling.
-- Also blocks post-hoc changes: a version's stage is a historical
-- fact about the money it was planned against.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.set_version_planning_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_fiscal_year_id UUID;
  v_ceiling_id     UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- planning_stage and budget_ceiling_id are immutable once set
    IF OLD.planning_stage IS NOT NULL
       AND NEW.planning_stage IS DISTINCT FROM OLD.planning_stage THEN
      RAISE EXCEPTION
        'planning_stage is immutable (version %). It is derived from the budget ceiling, not from workflow status.',
        OLD.version_number;
    END IF;
    IF OLD.budget_ceiling_id IS NOT NULL
       AND NEW.budget_ceiling_id IS DISTINCT FROM OLD.budget_ceiling_id THEN
      RAISE EXCEPTION
        'budget_ceiling_id is immutable (version %). Create a new version instead.',
        OLD.version_number;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: resolve the fiscal year from the parent document
  IF TG_TABLE_NAME = 'ppmp_versions' THEN
    SELECT fiscal_year_id INTO v_fiscal_year_id
      FROM procurements.ppmps WHERE id = NEW.ppmp_id;
  ELSE
    SELECT fiscal_year_id INTO v_fiscal_year_id
      FROM procurements.apps WHERE id = NEW.app_id;
  END IF;

  IF NEW.budget_ceiling_id IS NULL THEN
    NEW.budget_ceiling_id := procurements.authoritative_ceiling_id(v_fiscal_year_id);
  END IF;

  IF NEW.planning_stage IS NULL THEN
    NEW.planning_stage := COALESCE(
      (SELECT procurements.ceiling_stage_to_planning_stage(stage)
         FROM procurements.budget_ceilings
        WHERE id = NEW.budget_ceiling_id),
      procurements.fiscal_year_planning_stage(v_fiscal_year_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ppmp_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

CREATE TRIGGER trg_app_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.app_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

-- ============================================================
-- AMENDED 2026-07-30 (review finding, human-adjudicated).
--
-- The original backfill below used fiscal_year_planning_stage(), which
-- returns the fiscal year's PRESENT-DAY ceiling stage and applied it to
-- every historical version. That retroactively stamped indicative-era
-- drafts 'final' in any FY that had since recorded a GAA ceiling — the
-- exact mislabeling this task exists to eliminate. The "honest default"
-- comment that justified it was wrong.
--
-- Replaced with a date-aware backfill: each version is stamped with the
-- ceiling in force when the version was created.
-- ============================================================

-- The authoritative ceiling in force at a given moment. Used only by the
-- one-time backfill. Ceilings with no issued_date are excluded — they
-- cannot be placed in time, and assuming they applied retroactively is
-- what produced the mislabeling this migration removes.
CREATE OR REPLACE FUNCTION procurements.ceiling_id_as_of(
  p_fiscal_year_id UUID,
  p_as_of          TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT id
    FROM procurements.budget_ceilings
   WHERE fiscal_year_id   = p_fiscal_year_id
     AND is_authoritative = true
     AND deleted_at       IS NULL
     AND stage IN ('indicative','nep','gaa','final')
     AND issued_date IS NOT NULL
     AND issued_date <= p_as_of::DATE
   ORDER BY CASE stage
              WHEN 'final'      THEN 4
              WHEN 'gaa'        THEN 3
              WHEN 'nep'        THEN 2
              WHEN 'indicative' THEN 1
            END DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION procurements.ceiling_id_as_of(UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- Backfill existing rows.
--
-- Each version is stamped with the ceiling in force when it was created.
-- Versions predating any dated ceiling — and versions in fiscal years
-- with no dated ceiling at all — fall back to 'indicative', the correct
-- conservative answer: no appropriation can be proven to have existed.
--
-- indicative_final is deliberately ignored. It was written from approval
-- status, so it carries no signal about which budget the plan was
-- actually prepared against.
-- ============================================================

UPDATE procurements.ppmp_versions pv
   SET budget_ceiling_id = procurements.ceiling_id_as_of(p.fiscal_year_id, pv.created_at),
       planning_stage    = COALESCE(
         (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
            FROM procurements.budget_ceilings bc
           WHERE bc.id = procurements.ceiling_id_as_of(p.fiscal_year_id, pv.created_at)),
         'indicative'
       )
  FROM procurements.ppmps p
 WHERE p.id = pv.ppmp_id
   AND pv.planning_stage IS NULL;

UPDATE procurements.app_versions av
   SET budget_ceiling_id = procurements.ceiling_id_as_of(a.fiscal_year_id, av.created_at),
       planning_stage    = COALESCE(
         (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
            FROM procurements.budget_ceilings bc
           WHERE bc.id = procurements.ceiling_id_as_of(a.fiscal_year_id, av.created_at)),
         'indicative'
       )
  FROM procurements.apps a
 WHERE a.id = av.app_id
   AND av.planning_stage IS NULL;
```

Also amended for idempotency: the four `CREATE INDEX` statements above take `IF NOT EXISTS`, and each `CREATE TRIGGER` is preceded by `DROP TRIGGER IF EXISTS <name> ON <table>;`, so a half-applied migration can be retried. The unused `v_ceiling_id` declaration in `set_version_planning_stage()` is removed.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260802_planning_stage_columns`

Note for the user: the backfill sets every existing version to the stage implied by its fiscal year's recorded ceiling. If no ceiling has been entered yet, everything backfills to `indicative`, which is the correct conservative default.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802_planning_stage_columns.sql supabase/verify/20260802_planning_stage_columns.sql
git commit -m "feat(app): derive planning_stage from budget ceiling on version insert

planning_stage and budget_ceiling_id are set once at insert and are
immutable thereafter. Deprecates indicative_final on all four planning
tables. Backfills existing versions from their fiscal year's ceiling.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Stop workflow actions from writing the stage

**Files:**
- Create: `supabase/migrations/20260803_stop_stage_writes_from_workflow.sql`
- Create: `supabase/verify/20260803_stop_stage_writes_from_workflow.sql`

**Interfaces:**
- Consumes: `planning_stage` columns and the immutability trigger from Task 3.
- Produces: rewritten `procurements.approve_ppmp()`, `procurements.sync_ppmp_on_version_approve()`, `procurements.finalize_app()`, `procurements.create_ppmp_amendment()`, `procurements.create_app_amendment()` — none of which touch `indicative_final` or `planning_stage`.

**Context for the implementer:** these five routines currently write the stage from approval state. Read them before editing:
- `supabase/migrations/20240503_ppmp_rpc.sql:268-330` (`approve_ppmp`) — line 308 sets `indicative_final = 'final'`
- `supabase/migrations/20240504_ppmp_triggers.sql:82-103` (`sync_ppmp_on_version_approve`) — line 91
- `supabase/migrations/20260519_indicative_final_budget_tracking.sql:19-122` (`finalize_app`, current version) — lines 111-119
- `supabase/migrations/20240503_ppmp_rpc.sql:407-538` (`create_ppmp_amendment`) — line 477 sets `'indicative'`
- `supabase/migrations/20260405_ppmp_app_amendment_logic.sql:215-342` (`create_app_amendment`) — line 277

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260803_stop_stage_writes_from_workflow.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
  v_fn  TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'approve_ppmp',
    'sync_ppmp_on_version_approve',
    'finalize_app',
    'create_ppmp_amendment',
    'create_app_amendment'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = v_fn
     LIMIT 1;

    IF v_src IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED: procurements.% not found', v_fn;
    END IF;

    IF v_src ~* 'indicative_final\s*=' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: % still assigns indicative_final', v_fn;
    END IF;

    IF v_src ~* 'planning_stage\s*=' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: % assigns planning_stage (must be trigger-derived only)', v_fn;
    END IF;
  END LOOP;
END $$;

SELECT 'PASS: 20260803_stop_stage_writes_from_workflow' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: approve_ppmp still assigns indicative_final`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803_stop_stage_writes_from_workflow.sql`. Each function is a full `CREATE OR REPLACE` copied from its current definition with only the stage assignments removed — do not otherwise change behaviour.

```sql
-- ============================================================
-- Remove planning-stage writes from workflow actions.
--
-- Before: approve_ppmp() set indicative_final='final', so an August
-- plan built on an indicative ceiling was labelled FINAL the moment
-- the SDS signed it; and create_ppmp_amendment() set 'indicative',
-- so the post-GAA revision was labelled INDICATIVE. Exactly inverted.
--
-- After: stage comes only from budget_ceilings via the Task 3 trigger.
-- ============================================================

-- 1. approve_ppmp: drop both indicative_final assignments
CREATE OR REPLACE FUNCTION procurements.approve_ppmp(
  p_ppmp_id UUID,
  p_notes   TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp       RECORD;
  v_version_id UUID;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF NOT procurements.has_permission('ppmp.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status <> 'budget_certified' THEN
    RAISE EXCEPTION 'PPMP must be budget_certified before approval (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  UPDATE procurements.ppmp_versions
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW()
   WHERE id = v_version_id;

  UPDATE procurements.ppmp_versions
     SET status = 'superseded'
   WHERE ppmp_id = p_ppmp_id
     AND id      <> v_version_id
     AND status  NOT IN ('approved','superseded');

  UPDATE procurements.ppmps
     SET status         = 'approved',
         approved_by    = auth.uid(),
         approved_at    = NOW(),
         approval_notes = p_notes,
         updated_at     = NOW()
   WHERE id = p_ppmp_id;

  -- AMENDED 2026-07-30: an approval_logs INSERT was originally specified here
  -- and has been REMOVED. It was scope creep — this task's mandate is to stop
  -- writing the planning stage, not to add audit logging. approve_ppmp has
  -- never written approval_logs, and adding it here would introduce an
  -- unreviewed behaviour change to an approval path mid-refactor.
  --
  -- The underlying gap is real and larger than this task: NOTHING writes
  -- approval_logs for PPMP or APP approvals today (only 'noted' remarks, via
  -- src/lib/actions/ppmp.ts:1282 and 20260405_ppmp_add_remark.sql). That is a
  -- COA traceability gap covering every approval step, and it needs one
  -- consistent design across chief_review / certify_budget / approve /
  -- return / finalize / approve_app — not a single insert smuggled in here.
  -- Tracked as a separate task; do not add it in Task 4.
END;
$$;

-- 2. sync_ppmp_on_version_approve: drop indicative_final
CREATE OR REPLACE FUNCTION procurements.sync_ppmp_on_version_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    UPDATE procurements.ppmps
       SET current_version = NEW.version_number,
           updated_at      = NOW()
     WHERE id = NEW.ppmp_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. finalize_app: drop indicative_final on both tables.
--    Lot-state gating is rewritten separately in Task 13; this version
--    keeps the existing 'finalized' check so the two tasks stay independent.
CREATE OR REPLACE FUNCTION procurements.finalize_app(
  p_app_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app         RECORD;
  v_version_id  UUID;
  v_pending_cnt INTEGER;
  v_unlotted    INTEGER;
  v_unfinal_lot INTEGER;
  v_total       NUMERIC(15,2);
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.finalize') THEN
    RAISE EXCEPTION 'Insufficient permissions to finalize APP';
  END IF;

  IF v_app.status NOT IN ('indicative','under_review','bac_finalization') THEN
    RAISE EXCEPTION 'APP cannot be finalized from status %', v_app.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No active version for APP %', p_app_id;
  END IF;

  SELECT COUNT(*) INTO v_pending_cnt
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'pending';

  IF v_pending_cnt > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % items still pending HOPE review', v_pending_cnt;
  END IF;

  SELECT COUNT(*) INTO v_unlotted
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'approved'
     AND lot_id IS NULL;

  IF v_unlotted > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % approved items are not assigned to lots', v_unlotted;
  END IF;

  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status = 'draft';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % lots are still in draft', v_unfinal_lot;
  END IF;

  UPDATE procurements.app_items
     SET indicative_budget = CASE
           WHEN indicative_budget IS NULL THEN estimated_budget
           ELSE indicative_budget
         END
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL;

  SELECT COALESCE(SUM(estimated_budget), 0) INTO v_total
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'approved';

  UPDATE procurements.app_versions
     SET status               = 'final',
         total_estimated_cost = v_total
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status     = 'final',
         updated_at = NOW()
   WHERE id = p_app_id;
END;
$$;
```

Continue the same migration with `create_ppmp_amendment` and `create_app_amendment`, copied from their current definitions with the `indicative_final` column and value removed from the `INSERT INTO ... ppmp_versions` / `app_versions` column lists, and with `apps.status` no longer being set to `'indicative'` (use `'under_review'`, which is a workflow state rather than a stage):

```sql
-- 4. create_ppmp_amendment: remove indicative_final from the INSERT.
--    SOURCE (CORRECTED 2026-07-30): copy from
--      supabase/migrations/20240505_ppmp_restructure.sql:389-517
--    NOT from 20240503_ppmp_rpc.sql, which this plan originally cited.
--    20240505 redefines the function and runs later, so it is the live
--    definition. (The two bodies differ only in three comment lines, so the
--    practical risk here was low — but use the live source on principle.)
--    Edits:
--      - INSERT column list drops `indicative_final`
--      - VALUES drops `'indicative'`

-- 5. create_app_amendment: same treatment.
--    SOURCE (CORRECTED 2026-07-30): copy from
--      supabase/migrations/20260516_app_cse_schedule_columns.sql:263 onward
--    NOT from 20260405_ppmp_app_amendment_logic.sql, which this plan
--    originally cited. This one matters: 20260516 redefines the function to
--    propagate is_cse, schedule_quarter, advertisement/bid/award/contract
--    dates, and source_ppmp_project_description through the amendment clone.
--    Copying the 20260405 body would silently DROP those columns from every
--    future APP amendment — a data-loss regression.
--    Edits:
--      - INSERT column list drops `indicative_final`
--      - VALUES drops `'indicative'`
--      - UPDATE procurements.apps SET status = 'indicative'
--          becomes  SET status = 'under_review'
```

> **Implementer note:** for items 4 and 5, open the cited source files, copy the complete current function body into this migration, then make only the listed edits. Do not retype from memory — these functions contain clone loops whose column lists must stay exact.
>
> **Verify the source before copying.** Several of these routines have been redefined more than once, and migrations apply in filename order, so the *last* file defining a function wins. Confirm with `grep -l "FUNCTION procurements.<name>(" supabase/migrations/*.sql | sort | tail -1` and copy from that file. The two corrections above were found exactly this way.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260803_stop_stage_writes_from_workflow`

- [ ] **Step 5: Manually verify the inversion is fixed**

Ask the user to run this scenario check and paste the result:

```sql
-- With only an 'indicative' ceiling recorded for the FY, an approved
-- PPMP version must still read as INDICATIVE.
SELECT pv.version_number, pv.status, pv.planning_stage
  FROM procurements.ppmp_versions pv
  JOIN procurements.ppmps p ON p.id = pv.ppmp_id
 WHERE pv.status = 'approved'
 ORDER BY pv.created_at DESC
 LIMIT 5;
```

Expected: `planning_stage = 'indicative'` for rows whose FY has no `gaa`/`final` ceiling — previously these all read `'final'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803_stop_stage_writes_from_workflow.sql supabase/verify/20260803_stop_stage_writes_from_workflow.sql
git commit -m "fix(app): stop approval actions from writing planning stage

approve_ppmp, sync_ppmp_on_version_approve, finalize_app, and both
amendment RPCs no longer assign indicative_final. Stage now comes only
from budget_ceilings, so an indicative plan stays indicative after the
SDS signs it and a post-GAA revision reads as final.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Cut the UI over to `planning_stage`

**Files:**
- Modify: `src/components/planning/ppmp-indicative-final-badge.tsx`
- Modify: `src/types/database.ts`
- Modify: `src/lib/actions/ppmp.ts`
- Modify: `src/lib/actions/app.ts`

**Interfaces:**
- Consumes: `planning_stage` on both version tables (Task 3); `PlanningStage` type (Task 2).
- Produces: `<PlanningStageBadge value={stage} />` replacing `<PpmpIndicativeFinalBadge />`.

- [ ] **Step 1: Replace the badge component**

Rewrite `src/components/planning/ppmp-indicative-final-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import type { PlanningStage } from "@/types/database"

interface PlanningStageBadgeProps {
  value: PlanningStage | null
}

const LABELS: Record<PlanningStage, string> = {
  indicative: "INDICATIVE",
  final: "FINAL",
  supplemental: "SUPPLEMENTAL",
}

const VARIANTS: Record<PlanningStage, "default" | "outline" | "secondary"> = {
  indicative: "outline",
  final: "default",
  supplemental: "secondary",
}

export function PlanningStageBadge({ value }: PlanningStageBadgeProps) {
  const stage = value ?? "indicative"
  return <Badge variant={VARIANTS[stage]}>{LABELS[stage]}</Badge>
}

/** @deprecated Use PlanningStageBadge. Kept so existing imports compile. */
export const PpmpIndicativeFinalBadge = PlanningStageBadge
```

- [ ] **Step 2: Add `planning_stage` to the version row types**

In `src/types/database.ts`, add to both the `PpmpVersion` and `AppVersion` interfaces:

```typescript
  planning_stage: "indicative" | "final" | "supplemental" | null
  budget_ceiling_id: string | null
```

- [ ] **Step 3: Select the new column everywhere versions are queried**

Run: `grep -rn "indicative_final" src/`

For every `.select(...)` string that lists `indicative_final`, add `planning_stage, budget_ceiling_id`. Leave `indicative_final` in the select for now — it is deprecated but still present, and removing it from selects is a separate cleanup.

For every *render* site that reads `indicative_final`, switch to `planning_stage`.

- [ ] **Step 4: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass. If `PpmpIndicativeFinalBadge` imports break, the deprecated alias in Step 1 covers them.

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`

Open a PPMP whose fiscal year has only an `indicative` ceiling. The badge must read **INDICATIVE** even when the PPMP is approved.

- [ ] **Step 6: Commit**

```bash
git add src/components/planning/ppmp-indicative-final-badge.tsx src/types/database.ts src/lib/actions/ppmp.ts src/lib/actions/app.ts
git commit -m "feat(app): render planning stage from planning_stage column

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 2 — Immutability of approved planning documents

`prevent_approved_ppmp_version_update` (`20240504_ppmp_triggers.sql:7-22`) protects `ppmp_versions` and nothing else. The RLS policy `end_user_manage_ppmp_lots` (`20240505_ppmp_restructure.sql:216-230`) is `FOR ALL` with no status predicate, so the PPMP author can still rewrite `estimated_budget`, `quantity`, and `estimated_unit_cost` after HOPE approval and after consolidation into the APP.

### Task 6: Lock approved PPMP content

**Files:**
- Create: `supabase/migrations/20260804_ppmp_content_immutability.sql`
- Create: `supabase/verify/20260804_ppmp_content_immutability.sql`

**Interfaces:**
- Produces: function `procurements.ppmp_version_is_editable(p_ppmp_version_id UUID) RETURNS BOOLEAN`; trigger function `procurements.prevent_locked_ppmp_content_change()`; triggers on `ppmp_projects`, `ppmp_lots`, `ppmp_lot_items`; tightened RLS policies on the same three tables.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260804_ppmp_content_immutability.sql`:

```sql
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'ppmp_version_is_editable'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_version_is_editable() missing';
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY['ppmp_projects','ppmp_lots','ppmp_lot_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'procurements'
         AND c.relname = v_tbl
         AND t.tgname = 'trg_' || v_tbl || '_immutable_when_locked'
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: immutability trigger missing on %', v_tbl;
    END IF;
  END LOOP;
END $$;

SELECT 'PASS: 20260804_ppmp_content_immutability' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: ppmp_version_is_editable() missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260804_ppmp_content_immutability.sql`:

```sql
-- ============================================================
-- Lock PPMP content once its version leaves draft.
--
-- Previously only ppmp_versions was protected. ppmp_projects,
-- ppmp_lots, and ppmp_lot_items were editable by the author at any
-- time, including after HOPE approval and after the rows had been
-- consolidated into the APP as the basis for an ABC.
--
-- COA framing: "approved procurement plan altered without amendment".
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.ppmp_version_is_editable(
  p_ppmp_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT status = 'draft'
       FROM procurements.ppmp_versions
      WHERE id = p_ppmp_version_id),
    false
  );
$$;

COMMENT ON FUNCTION procurements.ppmp_version_is_editable(UUID) IS
  'A PPMP version''s content is editable only while the version is in draft. Any later change requires an amendment.';

CREATE OR REPLACE FUNCTION procurements.prevent_locked_ppmp_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
  v_status     TEXT;
BEGIN
  -- Resolve the owning version for whichever table fired.
  IF TG_TABLE_NAME = 'ppmp_projects' THEN
    v_version_id := COALESCE(NEW.ppmp_version_id, OLD.ppmp_version_id);

  ELSIF TG_TABLE_NAME = 'ppmp_lots' THEN
    SELECT pp.ppmp_version_id INTO v_version_id
      FROM procurements.ppmp_projects pp
     WHERE pp.id = COALESCE(NEW.ppmp_project_id, OLD.ppmp_project_id);

  ELSE -- ppmp_lot_items
    SELECT pp.ppmp_version_id INTO v_version_id
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pl.id = COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id);
  END IF;

  IF v_version_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status
    FROM procurements.ppmp_versions
   WHERE id = v_version_id;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify % on a PPMP version with status "%". Create an amendment instead.',
      TG_TABLE_NAME, v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Guard UPDATE and DELETE. INSERT is allowed only into draft versions,
-- which the same check covers via NEW.
CREATE TRIGGER trg_ppmp_projects_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

CREATE TRIGGER trg_ppmp_lots_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

CREATE TRIGGER trg_ppmp_lot_items_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

-- ============================================================
-- Tighten the RLS manage policies with the same predicate, so the
-- control is visible at the policy layer and not only in triggers.
-- ============================================================

DROP POLICY IF EXISTS "end_user_manage_ppmp_projects" ON procurements.ppmp_projects;

CREATE POLICY "end_user_manage_ppmp_projects" ON procurements.ppmp_projects
  FOR ALL TO authenticated
  USING (
    (created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
    AND office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.ppmp_version_is_editable(ppmp_version_id)
  )
  WITH CHECK (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.is_division_active()
    AND procurements.ppmp_version_is_editable(ppmp_version_id)
  );

DROP POLICY IF EXISTS "end_user_manage_ppmp_lots" ON procurements.ppmp_lots;

CREATE POLICY "end_user_manage_ppmp_lots" ON procurements.ppmp_lots
  FOR ALL TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE (pp.created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
        AND pp.office_id IN (
          SELECT id FROM procurements.offices
          WHERE division_id = procurements.get_user_division_id()
        )
        AND procurements.ppmp_version_is_editable(pp.ppmp_version_id)
    )
  );

DROP POLICY IF EXISTS "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items;

CREATE POLICY "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR ALL TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE (pp.created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
        AND pp.office_id IN (
          SELECT id FROM procurements.offices
          WHERE division_id = procurements.get_user_division_id()
        )
        AND procurements.ppmp_version_is_editable(pp.ppmp_version_id)
    )
  );
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260804_ppmp_content_immutability`

- [ ] **Step 5: Ask the user to run the negative test**

This is the behaviour that matters. Ask the user to run it against a **non-production** database and paste the result:

```sql
-- Pick any lot belonging to an approved version and try to change its ABC.
DO $$
DECLARE
  v_lot_id UUID;
BEGIN
  SELECT pl.id INTO v_lot_id
    FROM procurements.ppmp_lots pl
    JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
    JOIN procurements.ppmp_versions pv ON pv.id = pp.ppmp_version_id
   WHERE pv.status = 'approved'
   LIMIT 1;

  IF v_lot_id IS NULL THEN
    RAISE NOTICE 'SKIP: no approved PPMP lot available to test against';
    RETURN;
  END IF;

  BEGIN
    UPDATE procurements.ppmp_lots
       SET estimated_budget = estimated_budget + 1
     WHERE id = v_lot_id;
    RAISE EXCEPTION 'ASSERTION FAILED: approved lot ABC was editable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'ASSERTION FAILED%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: blocked with -> %', SQLERRM;
  END;
END $$;
```

Expected: `NOTICE: PASS: blocked with -> Cannot modify ppmp_lots on a PPMP version with status "approved". Create an amendment instead.`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260804_ppmp_content_immutability.sql supabase/verify/20260804_ppmp_content_immutability.sql
git commit -m "fix(app): lock PPMP projects, lots, and items once out of draft

Adds ppmp_version_is_editable() plus BEFORE INSERT/UPDATE/DELETE
triggers on all three PPMP content tables, and repeats the predicate in
the RLS manage policies. Previously the author could rewrite an approved
lot's ABC, quantity, and unit cost after consolidation into the APP.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Lock approved APP content

**Files:**
- Create: `supabase/migrations/20260805_app_content_immutability.sql`
- Create: `supabase/verify/20260805_app_content_immutability.sql`

**Interfaces:**
- Produces: function `procurements.app_version_is_editable(p_app_version_id UUID) RETURNS BOOLEAN`; trigger functions `procurements.prevent_locked_app_item_change()` and `procurements.prevent_approved_app_version_update()`; tightened `division_admin_manage_app_items` policy.

**Context:** `app_versions` has a snapshot trigger but no equivalent of `prevent_approved_ppmp_version_update`. `division_admin_manage_app_items` is `FOR ALL` with no status predicate, so an approved APP's item budgets are directly UPDATE-able — bypassing `adjust_app_item_budget()`, which does correctly gate on `bac_finalization`/`under_review` (`20260519_indicative_final_budget_tracking.sql:169`).

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260805_app_content_immutability.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'app_version_is_editable'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_version_is_editable() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_items_immutable_when_locked'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_app_items_immutable_when_locked missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_approved_app_version_update'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_prevent_approved_app_version_update missing';
  END IF;
END $$;

SELECT 'PASS: 20260805_app_content_immutability' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_version_is_editable() missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260805_app_content_immutability.sql`:

```sql
-- ============================================================
-- Lock APP content once its version is final or approved.
--
-- Editable window for app_items: version status in
-- ('draft','under_review','bac_finalization').
-- After that, changes require an amendment version.
--
-- Two behaviours are preserved deliberately:
--   1. The lotting RPCs write lot_id / lot_item_number while the
--      version is still editable — covered by the window above.
--   2. finalize_app() writes indicative_budget and totals in the same
--      transaction that flips the version to 'final'. The trigger reads
--      the CURRENT stored status, which is still pre-final at that
--      point, so those writes pass. Do not reorder that.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.app_version_is_editable(
  p_app_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT status IN ('draft','under_review','bac_finalization')
       FROM procurements.app_versions
      WHERE id = p_app_version_id),
    false
  );
$$;

COMMENT ON FUNCTION procurements.app_version_is_editable(UUID) IS
  'APP item content is editable only while the version is draft/under_review/bac_finalization.';

CREATE OR REPLACE FUNCTION procurements.prevent_locked_app_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
    FROM procurements.app_versions
   WHERE id = COALESCE(NEW.app_version_id, OLD.app_version_id);

  IF v_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_status NOT IN ('draft','under_review','bac_finalization') THEN
    RAISE EXCEPTION
      'Cannot modify APP items on a version with status "%". Create an APP amendment instead.',
      v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_app_items_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.app_items
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_app_item_change();

-- Mirror of prevent_approved_ppmp_version_update, which had no APP twin.
-- Guards only approved -> approved, so the final -> approved transition
-- and its snapshot write still succeed.
CREATE OR REPLACE FUNCTION procurements.prevent_approved_app_version_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'Cannot modify an approved APP version (version %). Create an amendment instead.',
      OLD.version_number;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_approved_app_version_update
  BEFORE UPDATE ON procurements.app_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_approved_app_version_update();

-- ============================================================
-- Tighten the manage policy with the editable-window predicate.
-- Preserves the soft-delete visibility fix from 20260729.
-- ============================================================

DROP POLICY IF EXISTS "division_admin_manage_app_items" ON procurements.app_items;

CREATE POLICY "division_admin_manage_app_items" ON procurements.app_items
  FOR ALL TO authenticated
  USING (
    deleted_at IS NULL
    AND app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('app.manage')
      OR procurements.has_permission('app.hope_review')
      OR procurements.has_permission('app.approve')
      OR procurements.has_permission('app.bac_manage_lots')
    )
    AND procurements.app_version_is_editable(app_version_id)
  )
  WITH CHECK (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND procurements.app_version_is_editable(app_version_id)
  );
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260805_app_content_immutability`

- [ ] **Step 5: Ask the user to confirm approval still works end to end**

The APP approval path writes `snapshot_data` in a `BEFORE UPDATE` trigger on the row that flips to `approved`. Confirm the triggers coexist:

```sql
SELECT tgname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'procurements'
   AND c.relname = 'app_versions'
   AND NOT t.tgisinternal
 ORDER BY tgname;
```

Then, in the dev environment, take a test APP through `finalize_app` → `approve_app` and confirm both succeed. The guard fires only on `approved → approved`, and the approval transition is `final → approved`, so it must not block.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805_app_content_immutability.sql supabase/verify/20260805_app_content_immutability.sql
git commit -m "fix(app): lock APP items and approved APP versions

Adds app_version_is_editable() with triggers on app_items and
app_versions, and adds the editable-window predicate to the manage
policy so direct UPDATEs can no longer bypass adjust_app_item_budget().

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 3 — Provenance and consolidation integrity

### Task 8: Immutable provenance + unique item numbers

**Files:**
- Create: `supabase/migrations/20260806_app_item_provenance.sql`
- Create: `supabase/verify/20260806_app_item_provenance.sql`

**Interfaces:**
- Consumes: PPMP content immutability (Task 6).
- Produces: column `app_items.source_ppmp_version_id`; partial unique index `idx_app_items_unique_item_number`; function `procurements.remap_app_amendment_lots(p_old_version_id UUID, p_new_version_id UUID) RETURNS INTEGER`; rewritten `create_app_amendment()`.

**Context:** `create_app_amendment` re-maps cloned items to cloned lots by matching `old_ai.item_number = new_ai.item_number` (`20260405_ppmp_app_amendment_logic.sql:320-331`), while `item_number` has no unique constraint and is generated by a racy `ROW_NUMBER() + MAX()` expression (`:188-192`). Two PPMPs approved concurrently produce duplicates, which silently mis-assign lots and the budgets they carry.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260806_app_item_provenance.sql`:

```sql
DO $$
DECLARE
  v_dupes INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_items'
       AND column_name = 'source_ppmp_version_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_items.source_ppmp_version_id missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_app_items_unique_item_number'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: unique item_number index missing';
  END IF;

  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT app_version_id, item_number
      FROM procurements.app_items
     WHERE deleted_at IS NULL
     GROUP BY app_version_id, item_number
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % duplicate (app_version_id, item_number) groups remain', v_dupes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'remap_app_amendment_lots'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: remap_app_amendment_lots() missing';
  END IF;
END $$;

SELECT 'PASS: 20260806_app_item_provenance' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_items.source_ppmp_version_id missing`

- [ ] **Step 3: Ask the user whether the race has already fired**

Before adding the unique index, find out if their data is already corrupted:

```sql
SELECT app_version_id, item_number, COUNT(*) AS n
  FROM procurements.app_items
 WHERE deleted_at IS NULL
 GROUP BY app_version_id, item_number
HAVING COUNT(*) > 1
 ORDER BY n DESC;
```

If rows come back, tell the user plainly: the renumber in Step 4 will make the index buildable, but any lot assignment `create_app_amendment` made on those versions may already have moved a budget to the wrong lot and needs manual review. Do not silently renumber and move on.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260806_app_item_provenance.sql`:

```sql
-- ============================================================
-- APP item provenance and stable item numbering.
--
-- 1. source_ppmp_version_id anchors provenance to an immutable,
--    snapshotted version instead of to a mutable ppmp_lots row.
-- 2. A partial unique index makes duplicate item_numbers impossible.
-- 3. create_app_amendment re-maps lots by provenance, not by the
--    display number, so a renumber can never move money between lots.
-- ============================================================

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS source_ppmp_version_id UUID
    REFERENCES procurements.ppmp_versions(id);

COMMENT ON COLUMN procurements.app_items.source_ppmp_version_id IS
  'Immutable provenance: the approved PPMP version this APP item was consolidated from.';

CREATE INDEX idx_app_items_source_version
  ON procurements.app_items(source_ppmp_version_id);

-- Backfill via the lot -> project -> version chain.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = pp.ppmp_version_id
  FROM procurements.ppmp_projects pp
 WHERE ai.source_ppmp_project_id = pp.id
   AND ai.source_ppmp_version_id IS NULL;

-- Remaining rows have no project link: fall back to the PPMP's latest
-- approved version.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = (
     SELECT pv.id
       FROM procurements.ppmp_versions pv
      WHERE pv.ppmp_id = ai.source_ppmp_id
        AND pv.status  = 'approved'
      ORDER BY pv.version_number DESC
      LIMIT 1
   )
 WHERE ai.source_ppmp_version_id IS NULL
   AND ai.source_ppmp_id IS NOT NULL;

-- ============================================================
-- Renumber duplicates deterministically, then enforce uniqueness.
-- ============================================================

WITH renumbered AS (
  SELECT ai.id,
         ROW_NUMBER() OVER (
           PARTITION BY ai.app_version_id
           ORDER BY ai.source_ppmp_project_id,
                    ai.source_ppmp_lot_id,
                    ai.created_at,
                    ai.id
         ) AS new_number
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
)
UPDATE procurements.app_items ai
   SET item_number = r.new_number
  FROM renumbered r
 WHERE r.id = ai.id
   AND ai.item_number <> r.new_number;

CREATE UNIQUE INDEX idx_app_items_unique_item_number
  ON procurements.app_items (app_version_id, item_number)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Provenance-based lot re-mapping for amendments.
-- Replaces the item_number join at 20260405:320-331.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.remap_app_amendment_lots(
  p_old_version_id UUID,
  p_new_version_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE procurements.app_items new_ai
     SET lot_id          = new_lot.id,
         lot_item_number = old_ai.lot_item_number
    FROM procurements.app_items old_ai
    JOIN procurements.app_lots old_lot ON old_lot.id = old_ai.lot_id
    JOIN procurements.app_lots new_lot
      ON new_lot.app_version_id = p_new_version_id
     AND new_lot.lot_number     = old_lot.lot_number
   WHERE new_ai.app_version_id = p_new_version_id
     AND old_ai.app_version_id = p_old_version_id
     AND old_ai.deleted_at     IS NULL
     AND old_ai.lot_id         IS NOT NULL
     -- Provenance match, never display-number match:
     AND new_ai.source_ppmp_lot_id     IS NOT DISTINCT FROM old_ai.source_ppmp_lot_id
     AND new_ai.source_ppmp_version_id IS NOT DISTINCT FROM old_ai.source_ppmp_version_id
     AND new_ai.source_ppmp_lot_item_ids IS NOT DISTINCT FROM old_ai.source_ppmp_lot_item_ids;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION procurements.remap_app_amendment_lots(UUID, UUID) IS
  'Re-assigns cloned APP items to cloned lots by PPMP provenance. Never joins on item_number, which is a display value.';
```

Then, in the same migration, `CREATE OR REPLACE` `create_app_amendment` by copying its current body from **`20260516_app_cse_schedule_columns.sql:263` onward** (CORRECTED 2026-07-30 — *not* `20260405_ppmp_app_amendment_logic.sql`, which this plan originally cited; 20260516 redefines the function later and propagates the CSE and schedule columns, so copying the older body would drop them) and making exactly three edits:

1. add `source_ppmp_version_id` to both the INSERT column list and the SELECT list of the item-clone statement;
2. replace the whole `UPDATE procurements.app_items new_ai ... old_ai.lot_id IS NOT NULL;` block (lines 320-331) with:
   ```sql
   PERFORM procurements.remap_app_amendment_lots(v_approved_ver.id, v_new_version_id);
   ```
3. carry over the Task 4 edits (`indicative_final` removed; `apps.status` set to `'under_review'` not `'indicative'`).

> **Implementer note:** open the cited file and copy the current body verbatim. Do not retype it — it contains clone loops whose column lists must stay exact. `20260729_app_item_line_level_lotting.sql` also defines `procurements.canonical_line_subset`; if you prefer to compare normalised arrays, check its signature with `\df procurements.canonical_line_subset` first. The plain `IS NOT DISTINCT FROM` above is correct as long as the clone copies the array unchanged, which it does.

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260806_app_item_provenance`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806_app_item_provenance.sql supabase/verify/20260806_app_item_provenance.sql
git commit -m "fix(app): anchor APP item provenance and enforce unique item numbers

Adds source_ppmp_version_id so provenance points at an immutable
version, renumbers existing duplicates, and adds a partial unique index
on (app_version_id, item_number). create_app_amendment now re-maps lots
by provenance instead of display number, which could silently move
budgets between lots when item numbers collided.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Make consolidation failures visible

**Files:**
- Create: `supabase/migrations/20260807_consolidation_visibility.sql`
- Create: `supabase/verify/20260807_consolidation_visibility.sql`

**Interfaces:**
- Produces: columns `ppmps.consolidation_status`, `ppmps.consolidation_error`, `ppmps.consolidated_at`; function `procurements.record_consolidation_failure(p_ppmp_id UUID, p_reason TEXT)`; rewritten `auto_populate_app_from_ppmp()`.

**Context:** the trigger has silent `RETURN NEW` exits when no editable APP version exists (`20260405_ppmp_app_amendment_logic.sql:161-163`, plus the earlier copies at `20240604_app_triggers.sql:156-158` and `20240505_ppmp_restructure.sql:679-681`). HOPE signs the PPMP, the office believes it is in the plan, and it is not.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260807_consolidation_visibility.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'ppmps'
       AND column_name = 'consolidation_status'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.consolidation_status missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements'
     AND p.proname = 'auto_populate_app_from_ppmp';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: auto_populate_app_from_ppmp() missing';
  END IF;

  IF v_src NOT LIKE '%consolidation_status%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not record consolidation_status';
  END IF;

  IF v_src NOT LIKE '%record_consolidation_failure%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not report failures';
  END IF;
END $$;

SELECT 'PASS: 20260807_consolidation_visibility' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: ppmps.consolidation_status missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260807_consolidation_visibility.sql`:

```sql
-- ============================================================
-- Consolidation must never fail silently.
--
-- Design choice: do NOT raise from the trigger. Raising would roll back
-- the HOPE approval itself, which is worse — the approval is valid, it
-- is the consolidation that needs attention. Instead record the failure
-- on the PPMP, log it, and notify the BAC Secretariat.
-- ============================================================

ALTER TABLE procurements.ppmps
  ADD COLUMN IF NOT EXISTS consolidation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consolidation_status IN ('pending','consolidated','failed','not_applicable')),
  ADD COLUMN IF NOT EXISTS consolidation_error TEXT,
  ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ;

COMMENT ON COLUMN procurements.ppmps.consolidation_status IS
  'Whether this PPMP''s approved items reached the APP. "failed" means an approved plan is missing from the APP.';

CREATE INDEX idx_ppmps_consolidation_failed
  ON procurements.ppmps(consolidation_status)
  WHERE consolidation_status = 'failed';

-- Retroactively classify existing approved PPMPs so pre-existing gaps
-- become visible instead of staying hidden.
UPDATE procurements.ppmps p
   SET consolidation_status = 'consolidated',
       consolidated_at      = p.approved_at
 WHERE p.status = 'approved'
   AND EXISTS (
     SELECT 1 FROM procurements.app_items ai
      WHERE ai.source_ppmp_id = p.id AND ai.deleted_at IS NULL
   );

UPDATE procurements.ppmps p
   SET consolidation_status = 'failed',
       consolidation_error  = 'Backfill: approved PPMP has no APP items. Investigate and re-consolidate.'
 WHERE p.status = 'approved'
   AND NOT EXISTS (
     SELECT 1 FROM procurements.app_items ai
      WHERE ai.source_ppmp_id = p.id AND ai.deleted_at IS NULL
   );

-- ============================================================
-- Record a failure and tell the people who can fix it.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.record_consolidation_failure(
  p_ppmp_id UUID,
  p_reason  TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp RECORD;
BEGIN
  SELECT * INTO v_ppmp FROM procurements.ppmps WHERE id = p_ppmp_id;

  UPDATE procurements.ppmps
     SET consolidation_status = 'failed',
         consolidation_error  = p_reason,
         updated_at           = NOW()
   WHERE id = p_ppmp_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks, office_id
  ) VALUES (
    'ppmp', p_ppmp_id, 'APP Consolidation', 5,
    'noted', COALESCE(v_ppmp.approved_by, v_ppmp.created_by),
    'Consolidation failed: ' || p_reason, v_ppmp.office_id
  );

  INSERT INTO procurements.notifications (
    user_id, title, message, type, reference_type, reference_id, office_id
  )
  SELECT DISTINCT up.user_id,
         'PPMP not consolidated into APP',
         'An approved PPMP could not be added to the APP: ' || p_reason,
         'warning',
         'ppmp',
         p_ppmp_id,
         v_ppmp.office_id
    FROM procurements.user_profiles up
    JOIN procurements.user_roles ur       ON ur.user_id = up.user_id
    JOIN procurements.role_permissions rp ON rp.role_id = ur.role_id
    JOIN procurements.permissions perm    ON perm.id = rp.permission_id
   WHERE up.division_id = v_ppmp.division_id
     AND perm.code = 'app.bac_manage_lots';
END;
$$;
```

Then `CREATE OR REPLACE` `auto_populate_app_from_ppmp` in the same migration.

First confirm which file holds the current definition — several migrations have replaced it:

Run: `grep -ln "FUNCTION procurements.auto_populate_app_from_ppmp" supabase/migrations/*.sql | tail -1`

Copy that body, then apply two edits. Replace the bare early exit:

```sql
  IF v_app_version_id IS NULL THEN
    PERFORM procurements.record_consolidation_failure(
      NEW.id,
      'No editable APP version exists for this division and fiscal year. '
      || 'The APP is likely already final or approved — create an APP amendment, then re-approve this PPMP.'
    );
    RETURN NEW;
  END IF;
```

And add the success marker immediately before the function's final `RETURN NEW;`, after the `INSERT ... SELECT` that creates the items:

```sql
  UPDATE procurements.ppmps
     SET consolidation_status = 'consolidated',
         consolidation_error  = NULL,
         consolidated_at      = NOW()
   WHERE id = NEW.id;
```

Also add `source_ppmp_version_id` to the `INSERT INTO procurements.app_items` column list and `pp.ppmp_version_id` to the corresponding `SELECT`, so newly consolidated items carry the Task 8 provenance.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260807_consolidation_visibility`

- [ ] **Step 5: Report the backfill outcome to the user**

```sql
SELECT consolidation_status, COUNT(*)
  FROM procurements.ppmps
 WHERE status = 'approved'
 GROUP BY consolidation_status;
```

Any `failed` count is pre-existing data loss the old silent path caused. State the number plainly — these are approved plans currently missing from the APP, each needing an APP amendment to recover.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807_consolidation_visibility.sql supabase/verify/20260807_consolidation_visibility.sql
git commit -m "fix(app): surface PPMP consolidation failures instead of swallowing them

auto_populate_app_from_ppmp now records consolidation_status, writes an
approval_logs entry, and notifies app.bac_manage_lots holders when an
approved PPMP cannot reach the APP. Backfills existing approved PPMPs so
pre-existing gaps become visible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Guard PPMP amendment against in-flight procurement

**Files:**
- Create: `supabase/migrations/20260808_amendment_guards.sql`
- Create: `supabase/verify/20260808_amendment_guards.sql`
- Modify: `src/lib/actions/ppmp.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the existing schema.
- Produces: function `procurements.ppmp_has_inflight_procurement(p_ppmp_id UUID) RETURNS TABLE(app_item_id UUID, item_number INTEGER, general_description TEXT, reason TEXT)`; permission `ppmp.amend_override`; `create_ppmp_amendment(p_ppmp_id UUID, p_justification TEXT, p_force BOOLEAN DEFAULT false)`.

**Context:** amendment approval soft-deletes every `app_item` with `source_ppmp_id = NEW.id` (`20260405_ppmp_app_amendment_logic.sql:166-172`) with no check on `app_lots.status` and no check for `pr_items.app_item_id` references. Because it is a soft delete, FKs still resolve, so a live PR and an active bidding can point at an APP line that no longer exists.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260808_amendment_guards.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'ppmp_has_inflight_procurement'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_has_inflight_procurement() missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_ppmp_amendment';

  IF v_src NOT LIKE '%ppmp_has_inflight_procurement%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment does not check for in-flight procurement';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'ppmp.amend_override'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp.amend_override permission not seeded';
  END IF;

  -- The 3-arg signature must exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements'
       AND p.proname = 'create_ppmp_amendment'
       AND p.pronargs = 3
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_ppmp_amendment 3-arg signature missing';
  END IF;
END $$;

SELECT 'PASS: 20260808_amendment_guards' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: ppmp_has_inflight_procurement() missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260808_amendment_guards.sql`:

```sql
-- ============================================================
-- Block PPMP amendment when its derived APP items are in procurement.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.ppmp_has_inflight_procurement(
  p_ppmp_id UUID
)
RETURNS TABLE (
  app_item_id         UUID,
  item_number         INTEGER,
  general_description TEXT,
  reason              TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  -- Items in a lot that has moved past composition
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'In lot "' || al.lot_name || '" with status ' || al.status
    FROM procurements.app_items ai
    JOIN procurements.app_lots al ON al.id = ai.lot_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND al.deleted_at IS NULL
     AND al.status NOT IN ('draft','composed')

  UNION ALL

  -- Items referenced by a live PR line
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'Referenced by PR ' || pr.pr_number || ' (status ' || pr.status || ')'
    FROM procurements.app_items ai
    JOIN procurements.pr_items pi           ON pi.app_item_id = ai.id
    JOIN procurements.purchase_requests pr  ON pr.id = pi.purchase_request_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND pi.deleted_at IS NULL
     AND pr.deleted_at IS NULL
     AND pr.status <> 'cancelled';
$$;

COMMENT ON FUNCTION procurements.ppmp_has_inflight_procurement(UUID) IS
  'Rows returned are APP items derived from this PPMP that an amendment would orphan.';

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('ppmp.amend_override', 'planning',
   'Amend a PPMP even when derived APP items are already in procurement', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('division_admin','bac_chair')
  AND p.code IN ('ppmp.amend_override')
ON CONFLICT DO NOTHING;

-- CREATE OR REPLACE cannot add a parameter: a different argument list is
-- a new overload, and an overload with a defaulted 3rd arg is ambiguous
-- against the 2-arg version. Drop first.
DROP FUNCTION IF EXISTS procurements.create_ppmp_amendment(UUID, TEXT);
```

Then in the same migration create the 3-argument `create_ppmp_amendment`. Copy the body from **whatever Task 4 last left in place** (by this point Task 4 has already rewritten it; do not go back to an original migration). If Task 4's version is unavailable for any reason, the pre-refactor live source is `20240505_ppmp_restructure.sql:389-517` — *not* `20240503_ppmp_rpc.sql`, which this plan originally cited. Apply the Task 4 `indicative_final` removal if not already present, and insert this block immediately after the existing "amendment already in progress" check:

```sql
  IF EXISTS (SELECT 1 FROM procurements.ppmp_has_inflight_procurement(p_ppmp_id)) THEN
    IF NOT p_force THEN
      RAISE EXCEPTION
        'Cannot amend PPMP %: % of its APP items are already in procurement. '
        'Review them with SELECT * FROM procurements.ppmp_has_inflight_procurement(%L), '
        'then cancel those activities or re-run with p_force := true '
        '(requires the ppmp.amend_override permission).',
        p_ppmp_id,
        (SELECT COUNT(*) FROM procurements.ppmp_has_inflight_procurement(p_ppmp_id)),
        p_ppmp_id;
    END IF;

    IF NOT procurements.has_permission('ppmp.amend_override') THEN
      RAISE EXCEPTION
        'Forcing an amendment past in-flight procurement requires the ppmp.amend_override permission.';
    END IF;

    INSERT INTO procurements.approval_logs (
      reference_type, reference_id, step_name, step_order,
      action, acted_by, remarks, office_id
    ) VALUES (
      'ppmp', p_ppmp_id, 'Amendment Override', 6,
      'noted', auth.uid(),
      'Amendment forced past in-flight procurement. Justification: '
        || COALESCE(p_justification, '(none)'),
      v_ppmp.office_id
    );
  END IF;
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260808_amendment_guards`

- [ ] **Step 5: Ask the user to check for damage the old code already did**

At-risk PPMPs going forward:

```sql
SELECT p.id, p.office_id, COUNT(*) AS at_risk_items
  FROM procurements.ppmps p
  CROSS JOIN LATERAL procurements.ppmp_has_inflight_procurement(p.id) f
 WHERE p.deleted_at IS NULL
 GROUP BY p.id, p.office_id
 ORDER BY at_risk_items DESC;
```

Already-orphaned PRs — live PRs pointing at soft-deleted APP items:

```sql
SELECT pr.pr_number, pr.status, ai.item_number, ai.deleted_at AS app_item_deleted_at
  FROM procurements.pr_items pi
  JOIN procurements.app_items ai         ON ai.id = pi.app_item_id
  JOIN procurements.purchase_requests pr ON pr.id = pi.purchase_request_id
 WHERE ai.deleted_at IS NOT NULL
   AND pr.status <> 'cancelled'
   AND pr.deleted_at IS NULL;
```

Report any rows explicitly — each needs manual reconciliation and this plan does not fix them automatically.

- [ ] **Step 6: Thread `force` through the server action**

In `src/lib/actions/ppmp.ts`, locate the `create_ppmp_amendment` RPC call. Add an optional parameter and pass it through, surfacing the RPC's error text unchanged so the user sees the guidance:

```typescript
export async function createPpmpAmendment(
  ppmpId: string,
  justification: string,
  force = false
) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_ppmp_amendment", {
    p_ppmp_id: ppmpId,
    p_justification: justification,
    p_force: force,
  })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null, data: data as string }
}
```

- [ ] **Step 7: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260808_amendment_guards.sql supabase/verify/20260808_amendment_guards.sql src/lib/actions/ppmp.ts
git commit -m "fix(app): block PPMP amendment that would orphan live procurement

Adds ppmp_has_inflight_procurement() and makes create_ppmp_amendment
refuse when derived APP items sit in a released lot or a live PR, with a
permissioned p_force override that writes an approval_logs entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 4 — The two-gate lot model

**The problem this phase solves.** One word — "finalized" — currently carries two jobs, and the current ordering is the reverse of real practice:

```
current code:   lots finalized  ->  APP final  ->  APP approved
real rule:      APP final+approved  ->  lots released for bidding
```

Both statements become true once the two jobs are separated:

- **composed** — which items sit in which lot. Must happen *before* the APP is final, because the GPPB APP form has to show packaging, mode, and schedule per line. This is what `finalize_app()` actually needs.
- **released** — ABC fixed, biddable, a procurement activity may be created. Only *after* the Final APP is approved — or under an explicitly flagged Early Procurement Activity.

| Gate | Requirement | Exception |
|---|---|---|
| composed → released | APP version `planning_stage = 'final'` **and** `status = 'approved'` | EPA-flagged lot |
| contract signing / NTP | fiscal year's ceiling stage is `gaa` or `final` | **none — absolute** |

### Task 11: Split lot status into composed and released

**Files:**
- Create: `supabase/migrations/20260809_lot_two_gate_model.sql`
- Create: `supabase/verify/20260809_lot_two_gate_model.sql`

**Interfaces:**
- Consumes: `planning_stage` on `app_versions` (Task 3).
- Produces: `app_lots.status` accepting `('draft','composed','released','in_procurement')`; columns `app_lots.is_early_procurement`, `epa_authorized_by`, `epa_authorized_at`, `epa_justification`, `released_by`, `released_at`; functions `procurements.release_app_lot(p_lot_id UUID)`, `procurements.release_all_app_lots(p_app_id UUID) RETURNS INTEGER`, `procurements.authorize_epa_lot(p_lot_id UUID, p_justification TEXT)`; permissions `app.release_lots`, `app.authorize_epa`; rewritten `finalize_lot()` and `finalize_app()`.

**Naming note for later tasks:** `finalize_lot()` keeps its name and now performs `draft → composed`. `finalized_by`/`finalized_at` are reused as the composition timestamps — do not add `composed_by`/`composed_at`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260809_lot_two_gate_model.sql`:

```sql
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'procurements'
     AND t.relname = 'app_lots'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%status%';

  IF v_def IS NULL OR v_def NOT LIKE '%released%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: app_lots.status CHECK does not allow ''released'' (got: %)',
      COALESCE(v_def, 'no constraint');
  END IF;

  IF v_def NOT LIKE '%composed%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_lots.status CHECK does not allow ''composed''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_lots'
       AND column_name = 'is_early_procurement'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_lots.is_early_procurement missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'release_app_lot'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: release_app_lot() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'authorize_epa_lot'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authorize_epa_lot() missing';
  END IF;

  -- No lot may still carry the retired 'finalized' value
  IF EXISTS (SELECT 1 FROM procurements.app_lots WHERE status = 'finalized') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: lots still carry the retired status ''finalized''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'app.release_lots'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app.release_lots permission not seeded';
  END IF;
END $$;

SELECT 'PASS: 20260809_lot_two_gate_model' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_lots.status CHECK does not allow 'released' (got: CHECK ((status = ANY (ARRAY['draft'::text, 'finalized'::text, 'in_procurement'::text]))))`

- [ ] **Step 3: Ask the user for the current lot-status distribution**

The migration remaps `finalized → composed` or `finalized → released` depending on whether the APP is already approved. Confirm the shape of the data first:

```sql
SELECT al.status,
       av.status AS version_status,
       av.planning_stage,
       COUNT(*)
  FROM procurements.app_lots al
  JOIN procurements.app_versions av ON av.id = al.app_version_id
 WHERE al.deleted_at IS NULL
 GROUP BY al.status, av.status, av.planning_stage
 ORDER BY 1, 2;
```

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260809_lot_two_gate_model.sql`:

```sql
-- ============================================================
-- Two-gate lot model.
--
-- 'finalized' conflated two decisions:
--   composed  - packaging locked; required BEFORE the APP can be final
--   released  - ABC fixed and biddable; allowed only AFTER the Final
--               APP is approved, or under a flagged EPA
--
-- The old ordering (lots finalized -> APP final) contradicted the rule
-- that lotting is only settled once the Final APP exists. Splitting the
-- states makes both true at once.
-- ============================================================

ALTER TABLE procurements.app_lots
  ADD COLUMN IF NOT EXISTS is_early_procurement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS epa_authorized_by  UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS epa_authorized_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS epa_justification  TEXT,
  ADD COLUMN IF NOT EXISTS released_by        UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS released_at        TIMESTAMPTZ;

COMMENT ON COLUMN procurements.app_lots.is_early_procurement IS
  'Early Procurement Activity: this lot may be bid and awarded on an indicative APP. Contract signing still requires an enacted appropriation.';
COMMENT ON COLUMN procurements.app_lots.finalized_by IS
  'Who locked lot composition (draft -> composed). Retained name; semantics are composition, not release.';
COMMENT ON COLUMN procurements.app_lots.released_by IS
  'Who released the lot for bidding (composed -> released).';

-- Remap existing rows BEFORE swapping the constraint.
-- A lot under an already-approved APP was effectively released.
UPDATE procurements.app_lots al
   SET status      = 'released',
       released_by = al.finalized_by,
       released_at = al.finalized_at
  FROM procurements.app_versions av
 WHERE av.id = al.app_version_id
   AND al.status = 'finalized'
   AND av.status = 'approved';

-- Everything else that was 'finalized' is composition-locked only.
UPDATE procurements.app_lots
   SET status = 'composed'
 WHERE status = 'finalized';

ALTER TABLE procurements.app_lots
  DROP CONSTRAINT IF EXISTS app_lots_status_check;

ALTER TABLE procurements.app_lots
  ADD CONSTRAINT app_lots_status_check
  CHECK (status IN ('draft','composed','released','in_procurement'));

CREATE INDEX idx_app_lots_status ON procurements.app_lots(status);
CREATE INDEX idx_app_lots_epa
  ON procurements.app_lots(is_early_procurement)
  WHERE is_early_procurement = true;

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.release_lots',  'planning',
   'Release composed lots for bidding once the Final APP is approved', 'division'),
  ('app.authorize_epa', 'planning',
   'Authorize Early Procurement Activity on an indicative APP lot',    'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_chair','bac_secretariat','division_admin')
  AND p.code IN ('app.release_lots')
ON CONFLICT DO NOTHING;

-- EPA is a HOPE-level decision: it commits the division to bidding
-- against money that does not legally exist yet.
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_admin')
  AND p.code IN ('app.authorize_epa')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Gate 1a: compose (draft -> composed). Formerly finalize_lot.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.finalize_lot(
  p_lot_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot      RECORD;
  v_item_cnt INTEGER;
BEGIN
  SELECT al.*, a.division_id
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.bac_finalize_lot') THEN
    RAISE EXCEPTION 'Insufficient permissions to compose lots';
  END IF;

  IF v_lot.status <> 'draft' THEN
    RAISE EXCEPTION
      'Only draft lots can be composed (lot % is %). Composition is already locked.',
      p_lot_id, v_lot.status;
  END IF;

  SELECT COUNT(*) INTO v_item_cnt
    FROM procurements.app_items
   WHERE lot_id = p_lot_id
     AND deleted_at IS NULL;

  IF v_item_cnt = 0 THEN
    RAISE EXCEPTION 'Cannot compose an empty lot. Assign at least one item.';
  END IF;

  IF v_lot.procurement_method IS NULL OR LENGTH(TRIM(v_lot.procurement_method)) = 0 THEN
    RAISE EXCEPTION
      'Lot % needs a procurement method before composition can be locked.', p_lot_id;
  END IF;

  UPDATE procurements.app_lots
     SET status       = 'composed',
         finalized_by = auth.uid(),
         finalized_at = NOW(),
         updated_at   = NOW()
   WHERE id = p_lot_id;
END;
$$;

COMMENT ON FUNCTION procurements.finalize_lot(UUID) IS
  'Gate 1a: locks lot composition (draft -> composed). Required before finalize_app(). Does NOT make the lot biddable.';

-- ============================================================
-- Gate 1b: authorize EPA on an indicative APP lot.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.authorize_epa_lot(
  p_lot_id        UUID,
  p_justification TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot   RECORD;
  v_ver   RECORD;
BEGIN
  IF p_justification IS NULL OR LENGTH(TRIM(p_justification)) < 20 THEN
    RAISE EXCEPTION
      'An EPA authorization needs a written justification of at least 20 characters.';
  END IF;

  SELECT al.*, a.division_id, a.status AS app_status
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.authorize_epa') THEN
    RAISE EXCEPTION
      'Authorizing Early Procurement Activity requires the app.authorize_epa permission (HOPE).';
  END IF;

  SELECT * INTO v_ver
    FROM procurements.app_versions
   WHERE id = v_lot.app_version_id;

  -- EPA only makes sense on an APP that is approved but not yet final.
  IF v_ver.status <> 'approved' THEN
    RAISE EXCEPTION
      'EPA can only be authorized on an approved APP version (current: %).', v_ver.status;
  END IF;

  IF v_ver.planning_stage <> 'indicative' THEN
    RAISE EXCEPTION
      'EPA is only for indicative APPs. This version is %, so release the lot normally.',
      v_ver.planning_stage;
  END IF;

  IF v_lot.status <> 'composed' THEN
    RAISE EXCEPTION
      'Lot must be composed before EPA authorization (current: %).', v_lot.status;
  END IF;

  UPDATE procurements.app_lots
     SET is_early_procurement = true,
         epa_authorized_by    = auth.uid(),
         epa_authorized_at    = NOW(),
         epa_justification    = p_justification,
         updated_at           = NOW()
   WHERE id = p_lot_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app_lot', p_lot_id, 'EPA Authorization', 1,
    'approved', auth.uid(),
    'Early Procurement Activity authorized on an indicative APP. '
      || 'Contract signing remains blocked until the appropriation exists. '
      || 'Justification: ' || p_justification
  );
END;
$$;

-- ============================================================
-- Gate 1c: release (composed -> released).
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.release_app_lot(
  p_lot_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot RECORD;
  v_ver RECORD;
BEGIN
  SELECT al.*, a.division_id
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.release_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to release lots for bidding';
  END IF;

  IF v_lot.status = 'released' THEN
    RAISE EXCEPTION 'Lot % is already released', p_lot_id;
  END IF;

  IF v_lot.status <> 'composed' THEN
    RAISE EXCEPTION
      'Only composed lots can be released (lot % is %).', p_lot_id, v_lot.status;
  END IF;

  SELECT * INTO v_ver
    FROM procurements.app_versions
   WHERE id = v_lot.app_version_id;

  -- The rule: a lot becomes biddable only on an approved Final APP,
  -- unless it carries an explicit EPA authorization.
  IF NOT (v_ver.planning_stage IN ('final','supplemental')
          AND v_ver.status = 'approved') THEN
    IF NOT v_lot.is_early_procurement THEN
      RAISE EXCEPTION
        'Lot % cannot be released: its APP version is % / %. '
        'Lots become biddable only on an approved Final APP. '
        'For pre-GAA procurement, authorize EPA on this lot first '
        '(authorize_epa_lot), which keeps contract signing blocked until '
        'the appropriation exists.',
        p_lot_id, v_ver.planning_stage, v_ver.status;
    END IF;

    IF v_lot.epa_authorized_by IS NULL THEN
      RAISE EXCEPTION
        'Lot % is flagged for EPA but has no recorded authorization. '
        'Run authorize_epa_lot() first.', p_lot_id;
    END IF;
  END IF;

  UPDATE procurements.app_lots
     SET status      = 'released',
         released_by = auth.uid(),
         released_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_lot_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app_lot', p_lot_id, 'Lot Release', 2,
    'approved', auth.uid(),
    CASE WHEN v_lot.is_early_procurement
         THEN 'Released under Early Procurement Activity.'
         ELSE 'Released against approved Final APP.' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION procurements.release_all_app_lots(
  p_app_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot_id UUID;
  v_count  INTEGER := 0;
BEGIN
  FOR v_lot_id IN
    SELECT al.id
      FROM procurements.app_lots al
      JOIN procurements.app_versions av ON av.id = al.app_version_id
     WHERE al.app_id = p_app_id
       AND al.deleted_at IS NULL
       AND al.status = 'composed'
       AND av.status = 'approved'
     ORDER BY al.lot_number
  LOOP
    PERFORM procurements.release_app_lot(v_lot_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
```

Then, in the same migration, `CREATE OR REPLACE` `finalize_app` one more time — take the Task 4 version and change only the lot check so it requires *composition*, not release:

```sql
  -- Replace the draft-lot check with an explicit composition check.
  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status = 'draft';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION
      'Cannot finalize APP: % lots are still in draft. Lock their composition first (finalize_lot).',
      v_unfinal_lot;
  END IF;
```

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260809_lot_two_gate_model`

- [ ] **Step 6: Ask the user to run the gate behaviour test**

Against a **non-production** database:

```sql
-- Releasing a composed lot under an indicative APP must be refused
-- unless EPA is authorized.
DO $$
DECLARE
  v_lot_id UUID;
BEGIN
  SELECT al.id INTO v_lot_id
    FROM procurements.app_lots al
    JOIN procurements.app_versions av ON av.id = al.app_version_id
   WHERE al.status = 'composed'
     AND av.planning_stage = 'indicative'
     AND al.is_early_procurement = false
     AND al.deleted_at IS NULL
   LIMIT 1;

  IF v_lot_id IS NULL THEN
    RAISE NOTICE 'SKIP: no composed indicative non-EPA lot to test against';
    RETURN;
  END IF;

  BEGIN
    PERFORM procurements.release_app_lot(v_lot_id);
    RAISE EXCEPTION 'ASSERTION FAILED: indicative lot was released without EPA';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'ASSERTION FAILED%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: blocked with -> %', SQLERRM;
  END;
END $$;
```

Expected: a `NOTICE` beginning `PASS: blocked with -> Lot ... cannot be released: its APP version is indicative / ...`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260809_lot_two_gate_model.sql supabase/verify/20260809_lot_two_gate_model.sql
git commit -m "feat(app): split lot finalization into composed and released

finalize_lot now locks composition (draft -> composed), which is what
finalize_app requires. New release_app_lot enforces the real rule: a lot
becomes biddable only on an approved Final APP, or under an explicitly
authorized Early Procurement Activity. Existing 'finalized' lots are
remapped based on whether their APP was already approved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Move procurement gates onto lot state and add the contract-signing ceiling gate

**Files:**
- Create: `supabase/migrations/20260810_epa_procurement_gates.sql`
- Create: `supabase/verify/20260810_epa_procurement_gates.sql`

**Interfaces:**
- Consumes: `release_app_lot`, `is_early_procurement` (Task 11); `fiscal_year_planning_stage` (Task 1).
- Produces: function `procurements.appropriation_exists(p_fiscal_year_id UUID) RETURNS BOOLEAN`; rewritten `create_purchase_request()` and `add_pr_item()` gates; a contract-signing stage gate in `advance_procurement_stage()`.

**Context:** three gates currently compound to make EPA impossible — `create_purchase_request` requires `apps.status IN ('approved','posted')` (`20260412_pr_bundling_step2_rpc.sql:99`), `add_pr_item` requires the same (`:287`), and `approve_app` requires `status = 'final'` (`20240603_app_rpc.sql:514`). The fix is to gate on the *lot* being released — which Task 11 already conditions correctly — and to put the absolute gate where the law puts it: contract signing.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260810_epa_procurement_gates.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'appropriation_exists'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: appropriation_exists() missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_purchase_request';

  IF v_src NOT LIKE '%released%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_purchase_request does not gate on lot release';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'advance_procurement_stage';

  IF v_src NOT LIKE '%appropriation_exists%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: advance_procurement_stage has no contract-signing appropriation gate';
  END IF;
END $$;

SELECT 'PASS: 20260810_epa_procurement_gates' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: appropriation_exists() missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810_epa_procurement_gates.sql`:

```sql
-- ============================================================
-- Relocate the procurement gate from "APP is final+approved" to
-- "the lot is released", and add the absolute appropriation gate at
-- contract signing.
--
-- Under RA 12009 (and GPPB Circular 06-2019 before it) a procuring
-- entity may run procurement up to award before the GAA takes effect,
-- on the basis of the indicative APP. What it may NOT do is sign the
-- contract or issue the NTP. DepEd mandates EPA to avoid the year-end
-- rush, so the previous all-or-nothing gate blocked required practice.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.appropriation_exists(
  p_fiscal_year_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM procurements.budget_ceilings
     WHERE fiscal_year_id   = p_fiscal_year_id
       AND is_authoritative = true
       AND deleted_at       IS NULL
       AND stage IN ('gaa','final')
  );
$$;

COMMENT ON FUNCTION procurements.appropriation_exists(UUID) IS
  'True once a GAA or release-stage ceiling is recorded for the fiscal year. Hard gate for contract signing.';
```

Then `CREATE OR REPLACE` `create_purchase_request` in the same migration. Copy the body from `20260412_pr_bundling_step2_rpc.sql` and replace the APP-status check at `:99-102` with a lot-release check:

```sql
    -- Was: IF v_app_item.app_status NOT IN ('approved','posted') THEN ...
    -- Now: the item's lot must be released. release_app_lot() already
    -- guarantees either an approved Final APP or an authorized EPA.
    IF v_app_item.lot_id IS NULL THEN
      RAISE EXCEPTION
        'Line % references an APP item that is not assigned to a lot yet.', v_idx;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM procurements.app_lots
       WHERE id = v_app_item.lot_id
         AND deleted_at IS NULL
         AND status IN ('released','in_procurement')
    ) THEN
      RAISE EXCEPTION
        'Line % references an APP item whose lot has not been released for procurement. '
        'The BAC must release the lot first (an approved Final APP, or an authorized EPA).',
        v_idx;
    END IF;
```

The `SELECT ... INTO v_app_item` at `:84-95` must add `ai.lot_id` to its select list if it is not already present. Apply the identical change to `add_pr_item` at `:280-289`.

Finally, add the contract-signing gate. Confirm the current definition location:

Run: `grep -ln "FUNCTION procurements.advance_procurement_stage" supabase/migrations/*.sql | tail -1`

Copy that body and insert this check where the target stage is `contract_signing` (the function already branches on stage name — see the performance-security check at `20260422_competitive_bidding_stages.sql:350` for the existing pattern to sit beside):

```sql
    -- Absolute gate: no contract may be signed against money that does
    -- not legally exist, EPA or not.
    IF NOT procurements.appropriation_exists(v_proc.fiscal_year_id) THEN
      RAISE EXCEPTION
        'Cannot advance to contract signing: no GAA or release-stage budget ceiling '
        'is recorded for this fiscal year. Early Procurement Activity permits bidding '
        'and award before the appropriation exists, but never contract signing. '
        'Record the GAA ceiling first.';
    END IF;
```

> **Implementer note:** confirm `procurement_activities` exposes `fiscal_year_id` directly. If it does not, resolve it via the linked PR: `SELECT fiscal_year_id FROM procurements.purchase_requests WHERE id = v_proc.purchase_request_id`.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260810_epa_procurement_gates`

- [ ] **Step 5: Ask the user to confirm the EPA path works end to end in dev**

Walk one lot through, pasting the outcome of each call:

1. `SELECT procurements.finalize_lot('<lot-id>');` → lot becomes `composed`
2. `SELECT procurements.approve_app('<app-id>');` on an indicative APP
3. `SELECT procurements.authorize_epa_lot('<lot-id>', 'DepEd EPA for FY2027 to avoid year-end rush; award conditional on GAA.');`
4. `SELECT procurements.release_app_lot('<lot-id>');` → succeeds
5. Create a PR against an item in that lot → succeeds
6. Advance the procurement to `contract_signing` → **must fail** with the appropriation message
7. Insert a `gaa` ceiling for the FY, retry step 6 → succeeds

Step 6 failing then succeeding is the whole point of this task. If step 6 succeeds before the ceiling is recorded, the gate is not wired — fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260810_epa_procurement_gates.sql supabase/verify/20260810_epa_procurement_gates.sql
git commit -m "feat(procurement): gate PRs on lot release and block pre-GAA contracts

PR creation now requires the APP item's lot to be released rather than
the whole APP to be final+approved, which unblocks Early Procurement
Activity. Adds appropriation_exists() and an absolute gate at the
contract_signing stage so EPA can bid and award but never sign.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Lot composition, release, and EPA in the UI

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/lib/schemas/app.ts`
- Modify: `src/lib/actions/app.ts`
- Modify: `src/components/planning/app-lot-card.tsx`
- Modify: `src/components/planning/app-lot-manager.tsx`

**Interfaces:**
- Consumes: `release_app_lot`, `release_all_app_lots`, `authorize_epa_lot` (Task 11).
- Produces: server actions `releaseAppLot(lotId)`, `releaseAllAppLots(appId)`, `authorizeEpaLot(lotId, justification)`; `LOT_STATUS_LABELS` map exported from `app-lot-card.tsx`.

- [ ] **Step 1: Update the lot row type**

In `src/types/database.ts`, change `AppLot.status` and add the new columns:

```typescript
  status: "draft" | "composed" | "released" | "in_procurement"
  is_early_procurement: boolean
  epa_authorized_by: string | null
  epa_authorized_at: string | null
  epa_justification: string | null
  released_by: string | null
  released_at: string | null
```

- [ ] **Step 2: Add the Zod schemas**

In `src/lib/schemas/app.ts`:

```typescript
export const releaseLotSchema = z.object({
  lot_id: z.string().uuid(),
})
export type ReleaseLotInput = z.infer<typeof releaseLotSchema>

export const authorizeEpaSchema = z.object({
  lot_id: z.string().uuid(),
  justification: z
    .string()
    .trim()
    .min(20, "Provide at least 20 characters explaining why EPA is warranted"),
})
export type AuthorizeEpaInput = z.infer<typeof authorizeEpaSchema>
```

- [ ] **Step 3: Add the server actions**

In `src/lib/actions/app.ts`, following the existing RPC-wrapper pattern in that file:

```typescript
export async function releaseAppLot(lotId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc("release_app_lot", { p_lot_id: lotId })
  if (error) return { error: error.message }
  revalidatePath("/dashboard/planning/app")
  return { error: null }
}

export async function releaseAllAppLots(appId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("release_all_app_lots", {
    p_app_id: appId,
  })
  if (error) return { error: error.message }
  revalidatePath("/dashboard/planning/app")
  return { error: null, data: data as number }
}

export async function authorizeEpaLot(input: AuthorizeEpaInput) {
  const parsed = authorizeEpaSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.rpc("authorize_epa_lot", {
    p_lot_id: parsed.data.lot_id,
    p_justification: parsed.data.justification,
  })
  if (error) return { error: error.message }
  revalidatePath("/dashboard/planning/app")
  return { error: null }
}
```

- [ ] **Step 4: Render the four lot states**

In `src/components/planning/app-lot-card.tsx`, export and use a label map so the vocabulary is consistent everywhere:

```tsx
export const LOT_STATUS_LABELS: Record<AppLot["status"], string> = {
  draft: "Draft",
  composed: "Composed",
  released: "Released for Bidding",
  in_procurement: "In Procurement",
}

export const LOT_STATUS_VARIANTS: Record<
  AppLot["status"],
  "outline" | "secondary" | "default"
> = {
  draft: "outline",
  composed: "secondary",
  released: "default",
  in_procurement: "default",
}
```

Replace every occurrence of the string `"finalized"` in this file with `"composed"`. Add an EPA indicator next to the status badge when `lot.is_early_procurement` is true, with the justification in a tooltip:

```tsx
{lot.is_early_procurement && (
  <Badge variant="outline" title={lot.epa_justification ?? undefined}>
    EPA
  </Badge>
)}
```

- [ ] **Step 5: Wire the actions into the manager**

In `src/components/planning/app-lot-manager.tsx`:
- the existing "Finalize Lot" button keeps calling `finalize_lot` but is relabelled **"Lock Composition"** and is shown only when `status === "draft"`;
- add a **"Release for Bidding"** button shown only when `status === "composed"`, calling `releaseAppLot`;
- add an **"Authorize EPA"** dialog (a `Textarea` bound to `justification`, min 20 chars, submit calls `authorizeEpaLot`), shown when `status === "composed"` and the APP version's `planning_stage === "indicative"` and `!lot.is_early_procurement`;
- surface RPC errors verbatim via `toast.error(result.error)` — the messages are written to be actionable and must not be replaced with a generic string.

- [ ] **Step 6: Find every remaining reference to the retired value**

Run: `grep -rn '"finalized"' src/ | grep -v node_modules`

Every hit is either a lot status (change to `"composed"`) or an unrelated domain (PR/PO/procurement statuses use their own vocabularies — leave those alone). Check each one individually; do not blanket-replace.

- [ ] **Step 7: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass. The `AppLot["status"]` union change will surface every stale comparison as a type error — that is the intended safety net.

- [ ] **Step 8: Verify in the running app**

Run: `npm run dev`

On an APP with lots: confirm a draft lot offers only "Lock Composition"; a composed lot on an indicative APP offers "Authorize EPA" and shows a blocking error if "Release for Bidding" is attempted first; a composed lot on an approved final APP releases cleanly.

- [ ] **Step 9: Commit**

```bash
git add src/types/database.ts src/lib/schemas/app.ts src/lib/actions/app.ts src/components/planning/app-lot-card.tsx src/components/planning/app-lot-manager.tsx
git commit -m "feat(app): surface composed/released lot states and EPA authorization

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 5 — Planning rounds (the post-GAA revision campaign)

Step 6 of the real process — *"offices revise PPMPs"* — is a division-wide event with a deadline and a compliance list. Today each of 40 offices would have to independently realise it should file an amendment. Nothing triggers it, nothing tracks it.

### Task 14: Planning round tables and bulk revision opening

**Files:**
- Create: `supabase/migrations/20260811_planning_rounds.sql`
- Create: `supabase/verify/20260811_planning_rounds.sql`

**Interfaces:**
- Consumes: `budget_ceilings` (Task 1); `create_ppmp_amendment(UUID, TEXT, BOOLEAN)` (Task 10).
- Produces: tables `procurements.planning_rounds`, `procurements.planning_round_offices`; function `procurements.open_planning_round(p_fiscal_year_id UUID, p_budget_ceiling_id UUID, p_deadline DATE, p_instructions TEXT) RETURNS UUID`; function `procurements.close_planning_round(p_round_id UUID)`; permission `planning.rounds_manage`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260811_planning_rounds.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'planning_rounds'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.planning_rounds missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'planning_round_offices'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.planning_round_offices missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements'
       AND c.relname IN ('planning_rounds','planning_round_offices')
       AND c.relrowsecurity
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on both planning round tables';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'open_planning_round'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: open_planning_round() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'planning.rounds_manage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: planning.rounds_manage permission not seeded';
  END IF;

  -- Only one open round per fiscal year
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_planning_rounds_one_open_per_fy'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: one-open-round-per-FY index missing';
  END IF;
END $$;

SELECT 'PASS: 20260811_planning_rounds' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurements.planning_rounds missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811_planning_rounds.sql`:

```sql
-- ============================================================
-- Planning rounds.
--
-- When the GAA lands and the ceiling changes, EVERY office must revise
-- its PPMP. That is one division decision with a deadline, not 40
-- independent discoveries. A round:
--   * records which ceiling triggered it
--   * opens a stage-tagged amendment version on every approved PPMP
--   * tracks per-office compliance so the SDS can see who has not filed
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.planning_rounds (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id        UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id     UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  budget_ceiling_id  UUID          NOT NULL REFERENCES procurements.budget_ceilings(id),

  -- Denormalised from the ceiling for display and reporting.
  planning_stage     TEXT          NOT NULL
                       CHECK (planning_stage IN ('indicative','final','supplemental')),

  instructions       TEXT,
  deadline           DATE,

  status             TEXT          NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','closed','cancelled')),

  opened_by          UUID          REFERENCES auth.users(id),
  opened_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_by          UUID          REFERENCES auth.users(id),
  closed_at          TIMESTAMPTZ,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.planning_rounds IS
  'A division-wide instruction for all offices to revise their PPMPs against a new budget ceiling.';

CREATE INDEX idx_planning_rounds_division    ON procurements.planning_rounds(division_id);
CREATE INDEX idx_planning_rounds_fiscal_year ON procurements.planning_rounds(fiscal_year_id);
CREATE INDEX idx_planning_rounds_deleted_at  ON procurements.planning_rounds(deleted_at) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_planning_rounds_one_open_per_fy
  ON procurements.planning_rounds (fiscal_year_id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ============================================================
-- Per-office compliance tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.planning_round_offices (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_round_id  UUID          NOT NULL REFERENCES procurements.planning_rounds(id) ON DELETE CASCADE,
  office_id          UUID          NOT NULL REFERENCES procurements.offices(id),
  ppmp_id            UUID          NOT NULL REFERENCES procurements.ppmps(id),
  ppmp_version_id    UUID          REFERENCES procurements.ppmp_versions(id),

  status             TEXT          NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','submitted','approved','skipped')),
  skip_reason        TEXT,
  completed_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (planning_round_id, ppmp_id)
);

CREATE INDEX idx_pro_round   ON procurements.planning_round_offices(planning_round_id);
CREATE INDEX idx_pro_office  ON procurements.planning_round_offices(office_id);
CREATE INDEX idx_pro_ppmp    ON procurements.planning_round_offices(ppmp_id);
CREATE INDEX idx_pro_status  ON procurements.planning_round_offices(status);

CREATE TRIGGER trg_planning_rounds_updated_at
  BEFORE UPDATE ON procurements.planning_rounds
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_pro_updated_at
  BEFORE UPDATE ON procurements.planning_round_offices
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_planning_rounds_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.planning_rounds
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_pro_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.planning_round_offices
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('planning.rounds_manage', 'planning',
   'Open and close division-wide PPMP revision rounds', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('division_admin','budget_officer','hope')
  AND p.code IN ('planning.rounds_manage')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.planning_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.planning_round_offices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_planning_rounds" ON procurements.planning_rounds
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_planning_rounds" ON procurements.planning_rounds
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('planning.rounds_manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('planning.rounds_manage')
    AND procurements.is_division_active()
  );

CREATE POLICY "division_read_planning_round_offices" ON procurements.planning_round_offices
  FOR SELECT TO authenticated
  USING (
    planning_round_id IN (
      SELECT id FROM procurements.planning_rounds
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
    )
  );

CREATE POLICY "manage_planning_round_offices" ON procurements.planning_round_offices
  FOR ALL TO authenticated
  USING (
    planning_round_id IN (
      SELECT id FROM procurements.planning_rounds
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('planning.rounds_manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    planning_round_id IN (
      SELECT id FROM procurements.planning_rounds
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
    )
  );

-- ============================================================
-- open_planning_round: the campaign action.
--
-- Creates the round, then opens an amendment on every approved PPMP in
-- the fiscal year. PPMPs with in-flight procurement are recorded as
-- 'skipped' with a reason rather than aborting the whole round — the
-- division still needs the other 39 offices to revise.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.open_planning_round(
  p_fiscal_year_id    UUID,
  p_budget_ceiling_id UUID,
  p_deadline          DATE    DEFAULT NULL,
  p_instructions      TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id     UUID;
  v_ceiling         RECORD;
  v_planning_stage  TEXT;
  v_round_id        UUID;
  v_ppmp            RECORD;
  v_new_version_id  UUID;
  v_skip_reason     TEXT;
BEGIN
  v_division_id := procurements.get_user_division_id();

  IF NOT procurements.has_permission('planning.rounds_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to open a planning round';
  END IF;

  SELECT * INTO v_ceiling
    FROM procurements.budget_ceilings
   WHERE id          = p_budget_ceiling_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget ceiling % not found or access denied', p_budget_ceiling_id;
  END IF;

  IF v_ceiling.fiscal_year_id <> p_fiscal_year_id THEN
    RAISE EXCEPTION
      'Ceiling % belongs to a different fiscal year than the one requested',
      p_budget_ceiling_id;
  END IF;

  v_planning_stage := procurements.ceiling_stage_to_planning_stage(v_ceiling.stage);

  INSERT INTO procurements.planning_rounds (
    division_id, fiscal_year_id, budget_ceiling_id, planning_stage,
    instructions, deadline, opened_by
  ) VALUES (
    v_division_id, p_fiscal_year_id, p_budget_ceiling_id, v_planning_stage,
    p_instructions, p_deadline, auth.uid()
  )
  RETURNING id INTO v_round_id;

  -- Open an amendment on every approved PPMP in this fiscal year.
  FOR v_ppmp IN
    SELECT p.*
      FROM procurements.ppmps p
     WHERE p.division_id    = v_division_id
       AND p.fiscal_year_id = p_fiscal_year_id
       AND p.deleted_at     IS NULL
       AND p.status IN ('approved','locked')
     ORDER BY p.office_id
  LOOP
    v_skip_reason := NULL;
    v_new_version_id := NULL;

    -- Do not fight in-flight procurement; record and move on.
    IF EXISTS (SELECT 1 FROM procurements.ppmp_has_inflight_procurement(v_ppmp.id)) THEN
      v_skip_reason := 'Has APP items already in procurement; revise manually with an override.';
    ELSE
      BEGIN
        v_new_version_id := procurements.create_ppmp_amendment(
          v_ppmp.id,
          'Revision for ' || UPPER(v_planning_stage) || ' ceiling'
            || COALESCE(' (' || v_ceiling.reference_number || ')', '')
            || COALESCE('. ' || p_instructions, ''),
          false
        );
      EXCEPTION WHEN OTHERS THEN
        v_skip_reason := 'Amendment could not be opened: ' || SQLERRM;
      END;
    END IF;

    INSERT INTO procurements.planning_round_offices (
      planning_round_id, office_id, ppmp_id, ppmp_version_id, status, skip_reason
    ) VALUES (
      v_round_id, v_ppmp.office_id, v_ppmp.id, v_new_version_id,
      CASE WHEN v_skip_reason IS NULL THEN 'in_progress' ELSE 'skipped' END,
      v_skip_reason
    );

    -- Tell the office.
    INSERT INTO procurements.notifications (
      user_id, title, message, type, reference_type, reference_id, office_id
    )
    SELECT DISTINCT up.user_id,
           'Revise your PPMP: ' || UPPER(v_planning_stage) || ' ceiling issued',
           COALESCE(p_instructions,
                    'A new budget ceiling has been recorded. Revise your PPMP to match.')
             || COALESCE(' Deadline: ' || p_deadline::TEXT, ''),
           'approval',
           'ppmp',
           v_ppmp.id,
           v_ppmp.office_id
      FROM procurements.user_profiles up
     WHERE up.division_id = v_division_id
       AND up.office_id   = v_ppmp.office_id;
  END LOOP;

  RETURN v_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION procurements.close_planning_round(
  p_round_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_round RECORD;
BEGIN
  SELECT * INTO v_round
    FROM procurements.planning_rounds
   WHERE id          = p_round_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planning round % not found or access denied', p_round_id;
  END IF;

  IF NOT procurements.has_permission('planning.rounds_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to close a planning round';
  END IF;

  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'Round % is already %', p_round_id, v_round.status;
  END IF;

  UPDATE procurements.planning_rounds
     SET status     = 'closed',
         closed_by  = auth.uid(),
         closed_at  = NOW(),
         updated_at = NOW()
   WHERE id = p_round_id;
END;
$$;

-- ============================================================
-- Keep per-office status in step with the PPMP's own progress.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_planning_round_office_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE procurements.planning_round_offices pro
     SET status = CASE
           WHEN NEW.status = 'approved'  THEN 'approved'
           WHEN NEW.status = 'submitted' THEN 'submitted'
           ELSE pro.status
         END,
         completed_at = CASE WHEN NEW.status = 'approved' THEN NOW() ELSE pro.completed_at END,
         updated_at   = NOW()
    FROM procurements.planning_rounds pr
   WHERE pro.planning_round_id = pr.id
     AND pro.ppmp_id           = NEW.id
     AND pr.status             = 'open'
     AND pro.status NOT IN ('approved','skipped');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_planning_round_office_status
  AFTER UPDATE OF status ON procurements.ppmps
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION procurements.sync_planning_round_office_status();
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260811_planning_rounds`

- [ ] **Step 5: Ask the user to dry-run a round in dev**

```sql
-- 1. Record a GAA ceiling lower than the indicative one
INSERT INTO procurements.budget_ceilings (
  division_id, fiscal_year_id, stage, issuing_authority,
  reference_number, amount, issued_date
)
SELECT division_id, id, 'gaa', 'DepEd Regional Office',
       'GAA FY2027', 44000000.00, CURRENT_DATE
  FROM procurements.fiscal_years
 WHERE is_active = true
 LIMIT 1;

-- 2. Open the round
SELECT procurements.open_planning_round(
  (SELECT id FROM procurements.fiscal_years WHERE is_active = true LIMIT 1),
  (SELECT id FROM procurements.budget_ceilings WHERE stage = 'gaa' ORDER BY created_at DESC LIMIT 1),
  CURRENT_DATE + 21,
  'GAA FY2027 reduced the division ceiling to 44M. Revise your PPMP accordingly.'
);

-- 3. Inspect compliance
SELECT o.name AS office, pro.status, pro.skip_reason
  FROM procurements.planning_round_offices pro
  JOIN procurements.offices o ON o.id = pro.office_id
 ORDER BY pro.status, o.name;
```

Confirm: new PPMP versions exist with `planning_stage = 'final'` (proving Task 3's derivation works from the GAA ceiling), and every office has a row.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811_planning_rounds.sql supabase/verify/20260811_planning_rounds.sql
git commit -m "feat(planning): add planning rounds for division-wide PPMP revision

open_planning_round records the triggering ceiling, opens a stage-tagged
amendment on every approved PPMP, notifies each office, and tracks
per-office compliance. PPMPs with in-flight procurement are recorded as
skipped with a reason instead of aborting the round.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Make the version authoritative for PPMP status

**Files:**
- Create: `supabase/migrations/20260812_version_authoritative_status.sql`
- Create: `supabase/verify/20260812_version_authoritative_status.sql`

**Interfaces:**
- Produces: view `procurements.v_ppmp_current_state`; rewritten `create_ppmp_amendment` that no longer resets `ppmps.status` to `'draft'`; column `ppmps.has_open_amendment`.

**Context:** `create_ppmp_amendment` sets `ppmps.status = 'draft'` (`20240503_ppmp_rpc.sql:531`). During a revision window that erases the fact that an approved version exists and is still operative — which matters now, because Phase 4 lets procurement run against that approved indicative version. Every list view would show the PPMP as unapproved.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260812_version_authoritative_status.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'procurements' AND table_name = 'v_ppmp_current_state'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: view v_ppmp_current_state missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'ppmps'
       AND column_name = 'has_open_amendment'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.has_open_amendment missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_ppmp_amendment';

  IF v_src ~* 'status\s*=\s*''draft''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment still resets ppmps.status to draft';
  END IF;
END $$;

SELECT 'PASS: 20260812_version_authoritative_status' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: view v_ppmp_current_state missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260812_version_authoritative_status.sql`:

```sql
-- ============================================================
-- The version is authoritative; the parent is a summary.
--
-- Resetting ppmps.status to 'draft' when an amendment opens destroyed
-- the fact that an approved version exists and remains operative. With
-- Phase 4 in place, procurement can legitimately run against that
-- approved version while the next one is being drafted.
-- ============================================================

ALTER TABLE procurements.ppmps
  ADD COLUMN IF NOT EXISTS has_open_amendment BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN procurements.ppmps.has_open_amendment IS
  'True while a draft amendment version exists. The parent status keeps reflecting the last approved version.';

-- Backfill: any PPMP with a draft version alongside an approved one.
UPDATE procurements.ppmps p
   SET has_open_amendment = true
 WHERE EXISTS (
   SELECT 1 FROM procurements.ppmp_versions pv
    WHERE pv.ppmp_id = p.id AND pv.status = 'draft'
 )
 AND EXISTS (
   SELECT 1 FROM procurements.ppmp_versions pv
    WHERE pv.ppmp_id = p.id AND pv.status = 'approved'
 );

-- Repair parents that were wrongly knocked back to draft: if an
-- approved version exists, the parent should read 'approved'.
UPDATE procurements.ppmps p
   SET status = 'approved'
 WHERE p.status = 'draft'
   AND p.has_open_amendment = true
   AND EXISTS (
     SELECT 1 FROM procurements.ppmp_versions pv
      WHERE pv.ppmp_id = p.id AND pv.status = 'approved'
   );

-- ============================================================
-- Single place to read a PPMP's real state.
-- ============================================================

CREATE OR REPLACE VIEW procurements.v_ppmp_current_state AS
SELECT
  p.id                        AS ppmp_id,
  p.division_id,
  p.office_id,
  p.fiscal_year_id,
  p.status                    AS document_status,
  p.consolidation_status,
  p.has_open_amendment,

  -- The operative approved version
  av.id                       AS approved_version_id,
  av.version_number           AS approved_version_number,
  av.planning_stage           AS approved_planning_stage,
  av.total_estimated_budget   AS approved_total,
  av.approved_at,

  -- The in-progress version, if any
  dv.id                       AS draft_version_id,
  dv.version_number           AS draft_version_number,
  dv.planning_stage           AS draft_planning_stage,
  dv.total_estimated_budget   AS draft_total
FROM procurements.ppmps p
LEFT JOIN LATERAL (
  SELECT * FROM procurements.ppmp_versions
   WHERE ppmp_id = p.id AND status = 'approved'
   ORDER BY version_number DESC
   LIMIT 1
) av ON true
LEFT JOIN LATERAL (
  SELECT * FROM procurements.ppmp_versions
   WHERE ppmp_id = p.id AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1
) dv ON true
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW procurements.v_ppmp_current_state IS
  'Authoritative read model: the operative approved version and any in-progress version, side by side.';

GRANT SELECT ON procurements.v_ppmp_current_state TO authenticated;

-- ============================================================
-- Keep has_open_amendment accurate.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_ppmp_open_amendment_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp_id UUID;
BEGIN
  v_ppmp_id := COALESCE(NEW.ppmp_id, OLD.ppmp_id);

  UPDATE procurements.ppmps p
     SET has_open_amendment = EXISTS (
           SELECT 1 FROM procurements.ppmp_versions pv
            WHERE pv.ppmp_id = v_ppmp_id
              AND pv.status NOT IN ('approved','superseded')
         ),
         updated_at = NOW()
   WHERE p.id = v_ppmp_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_sync_ppmp_open_amendment_flag
  AFTER INSERT OR UPDATE OF status OR DELETE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.sync_ppmp_open_amendment_flag();
```

Then `CREATE OR REPLACE` the 3-argument `create_ppmp_amendment` from Task 10 with one final edit — replace the closing parent update:

```sql
  -- Was:
  --   UPDATE procurements.ppmps
  --      SET current_version = v_next_version, status = 'draft', updated_at = NOW()
  --    WHERE id = p_ppmp_id;
  --
  -- Now: advance the version pointer but keep the document's approved
  -- status, because the approved version remains operative.
  UPDATE procurements.ppmps
     SET current_version    = v_next_version,
         has_open_amendment = true,
         updated_at         = NOW()
   WHERE id = p_ppmp_id;
```

> **Implementer note:** `submit_ppmp` requires `ppmps.status = 'draft'` (`20240503_ppmp_rpc.sql:40-42`). With the parent no longer flipped to draft, submitting an amendment would now fail. Change that check to accept a document whose parent is `approved`/`locked` when `has_open_amendment` is true, and to validate the *version* status is `draft` instead:
> ```sql
>   IF v_ppmp.status NOT IN ('draft','revision_required')
>      AND NOT v_ppmp.has_open_amendment THEN
>     RAISE EXCEPTION 'Only draft PPMPs or open amendments can be submitted (current status: %)', v_ppmp.status;
>   END IF;
> ```
> and after resolving `v_version_id`, add:
> ```sql
>   IF (SELECT status FROM procurements.ppmp_versions WHERE id = v_version_id) <> 'draft' THEN
>     RAISE EXCEPTION 'The current PPMP version is not in draft and cannot be submitted.';
>   END IF;
> ```
> Include the full rewritten `submit_ppmp` in this migration. Also re-check `20260606_ppmp_submit_allow_revision_required.sql`, which already amended this function — start from that version, not the original.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260812_version_authoritative_status`

- [ ] **Step 5: Ask the user to walk an amendment through end to end in dev**

Create an amendment on an approved PPMP, then confirm:

```sql
SELECT ppmp_id, document_status, has_open_amendment,
       approved_version_number, approved_planning_stage,
       draft_version_number, draft_planning_stage
  FROM procurements.v_ppmp_current_state
 WHERE has_open_amendment = true;
```

Expected: `document_status = 'approved'` while `draft_version_number` is populated. Then submit and approve the amendment and confirm it advances normally.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260812_version_authoritative_status.sql supabase/verify/20260812_version_authoritative_status.sql
git commit -m "fix(app): keep the approved PPMP operative while an amendment is open

create_ppmp_amendment no longer resets ppmps.status to draft, which had
erased the fact that an approved version exists and is still the basis
for procurement. Adds has_open_amendment, the v_ppmp_current_state read
model, and updates submit_ppmp to validate the version rather than the
parent document.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 6 — Financial correctness

### Task 16: Reconcile lot ABC to its line items

**Files:**
- Create: `supabase/migrations/20260813_lot_abc_reconciliation.sql`
- Create: `supabase/verify/20260813_lot_abc_reconciliation.sql`

**Interfaces:**
- Produces: column `ppmp_lots.abc_is_manual`, `ppmp_lots.abc_manual_justification`; trigger function `procurements.recalc_ppmp_lot_abc()`; a submit-time reconciliation check in `submit_ppmp`.

**Context:** `ppmp_lots.estimated_budget` is user-entered while `ppmp_lot_items.estimated_total_cost` is `GENERATED ALWAYS AS (quantity * estimated_unit_cost)` (`20240501_ppmps.sql:156`). Nothing ties them together — `submit_ppmp` only checks `estimated_budget > 0` (`20240503_ppmp_rpc.sql:87`). So the ABC that flows into the APP, becomes the bid ceiling, and gates PR totals can diverge from the computation that is supposed to support it. An ABC unsupported by its own detail is a COA finding.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260813_lot_abc_reconciliation.sql`:

```sql
DO $$
DECLARE
  v_drift INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'ppmp_lots'
       AND column_name = 'abc_is_manual'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_lots.abc_is_manual missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_recalc_ppmp_lot_abc'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_recalc_ppmp_lot_abc missing';
  END IF;

  -- No auto-maintained lot may drift from the sum of its lines.
  SELECT COUNT(*) INTO v_drift
    FROM procurements.ppmp_lots pl
   WHERE pl.abc_is_manual = false
     AND pl.estimated_budget <> COALESCE((
       SELECT SUM(pli.estimated_total_cost)
         FROM procurements.ppmp_lot_items pli
        WHERE pli.ppmp_lot_id = pl.id
     ), 0);

  IF v_drift > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % auto-maintained lots still drift from their line totals', v_drift;
  END IF;
END $$;

SELECT 'PASS: 20260813_lot_abc_reconciliation' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: ppmp_lots.abc_is_manual missing`

- [ ] **Step 3: Ask the user how much drift already exists**

This number tells them how much their current APP totals are unsupported by their own detail:

```sql
SELECT COUNT(*) AS drifting_lots,
       SUM(ABS(pl.estimated_budget - COALESCE(s.line_total, 0))) AS total_absolute_drift
  FROM procurements.ppmp_lots pl
  LEFT JOIN LATERAL (
    SELECT SUM(estimated_total_cost) AS line_total
      FROM procurements.ppmp_lot_items
     WHERE ppmp_lot_id = pl.id
  ) s ON true
 WHERE pl.estimated_budget <> COALESCE(s.line_total, 0);
```

Report the figures plainly. If `total_absolute_drift` is material, the backfill in Step 4 will change APP totals — the user needs to know that before applying.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260813_lot_abc_reconciliation.sql`:

```sql
-- ============================================================
-- Lot ABC must equal the sum of its line items.
--
-- Default behaviour: derived. The lot's estimated_budget is maintained
-- by trigger from ppmp_lot_items, so it can never drift.
--
-- Escape hatch: abc_is_manual = true with a written justification, for
-- the genuine cases (a lump-sum infrastructure ABC from a programme of
-- works, where the line items are indicative quantities only).
-- ============================================================

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS abc_is_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abc_manual_justification TEXT;

COMMENT ON COLUMN procurements.ppmp_lots.abc_is_manual IS
  'When false (default) estimated_budget is derived from the line items. When true it is entered manually and needs abc_manual_justification.';

ALTER TABLE procurements.ppmp_lots
  ADD CONSTRAINT chk_manual_abc_has_justification
  CHECK (
    abc_is_manual = false
    OR (abc_manual_justification IS NOT NULL
        AND LENGTH(TRIM(abc_manual_justification)) >= 10)
  );

-- ============================================================
-- Maintain the ABC from the line items.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_ppmp_lot_abc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot_id UUID;
  v_total  NUMERIC(15,2);
BEGIN
  v_lot_id := COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id);

  SELECT COALESCE(SUM(estimated_total_cost), 0)
    INTO v_total
    FROM procurements.ppmp_lot_items
   WHERE ppmp_lot_id = v_lot_id;

  UPDATE procurements.ppmp_lots
     SET estimated_budget = v_total,
         updated_at       = NOW()
   WHERE id = v_lot_id
     AND abc_is_manual = false;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Fires after the immutability trigger from Task 6 has already allowed
-- the change, so it can only ever run on an editable draft version.
CREATE TRIGGER trg_recalc_ppmp_lot_abc
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.recalc_ppmp_lot_abc();

-- ============================================================
-- Backfill: bring every auto-maintained lot in line.
--
-- Lots whose current ABC exceeds their line total are flagged manual
-- with an audit note rather than silently reduced, because reducing an
-- ABC that an approved APP already published would change a bid ceiling.
-- ============================================================

UPDATE procurements.ppmp_lots pl
   SET abc_is_manual = true,
       abc_manual_justification =
         'Backfill 20260813: pre-existing ABC of ' || pl.estimated_budget
         || ' did not match line total of ' || COALESCE(s.line_total, 0)
         || '. Flagged manual to preserve the published figure. Review and reconcile.'
  FROM (
    SELECT pl2.id, SUM(pli.estimated_total_cost) AS line_total
      FROM procurements.ppmp_lots pl2
      JOIN procurements.ppmp_lot_items pli ON pli.ppmp_lot_id = pl2.id
      JOIN procurements.ppmp_projects pp   ON pp.id = pl2.ppmp_project_id
      JOIN procurements.ppmp_versions pv   ON pv.id = pp.ppmp_version_id
     WHERE pv.status IN ('approved','superseded')
     GROUP BY pl2.id
  ) s
 WHERE s.id = pl.id
   AND pl.estimated_budget <> COALESCE(s.line_total, 0)
   AND pl.abc_is_manual = false;

-- Everything still auto-maintained gets recomputed.
UPDATE procurements.ppmp_lots pl
   SET estimated_budget = COALESCE((
         SELECT SUM(pli.estimated_total_cost)
           FROM procurements.ppmp_lot_items pli
          WHERE pli.ppmp_lot_id = pl.id
       ), 0),
       updated_at = NOW()
 WHERE pl.abc_is_manual = false
   AND pl.estimated_budget <> COALESCE((
         SELECT SUM(pli.estimated_total_cost)
           FROM procurements.ppmp_lot_items pli
          WHERE pli.ppmp_lot_id = pl.id
       ), 0);
```

Then `CREATE OR REPLACE` `submit_ppmp` in the same migration — start from the Task 15 version and add a reconciliation check after the existing `estimated_budget <= 0` check at `:81-90`:

```sql
  -- A manually-entered ABC must be justified; a derived one must reconcile.
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND pl.abc_is_manual   = false
       AND pl.estimated_budget <> COALESCE((
             SELECT SUM(pli.estimated_total_cost)
               FROM procurements.ppmp_lot_items pli
              WHERE pli.ppmp_lot_id = pl.id
           ), 0)
  ) THEN
    RAISE EXCEPTION
      'One or more lots have an ABC that does not match the sum of their line items. '
      'Either correct the line items or mark the ABC manual with a justification.';
  END IF;
```

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260813_lot_abc_reconciliation`

- [ ] **Step 6: Report how many lots were flagged manual**

```sql
SELECT COUNT(*) AS flagged_manual
  FROM procurements.ppmp_lots
 WHERE abc_manual_justification LIKE 'Backfill 20260813%';
```

Each flagged lot is a pre-existing ABC that its own line items do not support. Tell the user the count and that these need reconciliation — the migration preserved the published figure rather than silently changing a bid ceiling.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260813_lot_abc_reconciliation.sql supabase/verify/20260813_lot_abc_reconciliation.sql
git commit -m "fix(app): derive lot ABC from line items with a justified manual override

ppmp_lots.estimated_budget is now trigger-maintained from
ppmp_lot_items, and submit_ppmp refuses a PPMP whose derived ABCs do not
reconcile. Pre-existing mismatches on approved versions are flagged
abc_is_manual with an audit note rather than silently changing a
published bid ceiling.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Give the two APP totals distinct names

**Files:**
- Create: `supabase/migrations/20260814_app_total_definitions.sql`
- Create: `supabase/verify/20260814_app_total_definitions.sql`

**Interfaces:**
- Produces: column `app_versions.total_approved_cost`; rewritten `recalc_app_version_total()` and `finalize_app()` with explicit, separate definitions.

**Context:** `recalc_app_version_total` sums all non-deleted items (`20240604_app_triggers.sql:59`) while `finalize_app` sums only `hope_review_status = 'approved'` (`20240603_app_rpc.sql:462`). Two different meanings share one column, so pre-finalization users see a total that silently includes remarked rows.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260814_app_total_definitions.sql`:

```sql
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_versions'
       AND column_name = 'total_approved_cost'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_versions.total_approved_cost missing';
  END IF;

  -- total_estimated_cost = every non-deleted item
  SELECT COUNT(*) INTO v_bad
    FROM procurements.app_versions av
   WHERE av.total_estimated_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
   ), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % versions have a stale total_estimated_cost', v_bad;
  END IF;

  -- total_approved_cost = HOPE-approved items only
  SELECT COUNT(*) INTO v_bad
    FROM procurements.app_versions av
   WHERE av.total_approved_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id
        AND ai.deleted_at IS NULL
        AND ai.hope_review_status = 'approved'
   ), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % versions have a stale total_approved_cost', v_bad;
  END IF;
END $$;

SELECT 'PASS: 20260814_app_total_definitions' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_versions.total_approved_cost missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260814_app_total_definitions.sql`:

```sql
-- ============================================================
-- Two totals, two names.
--
--   total_estimated_cost = every non-deleted item (what was submitted)
--   total_approved_cost  = HOPE-approved items only (the real plan)
--
-- Previously both meanings shared total_estimated_cost depending on
-- which routine wrote last.
-- ============================================================

ALTER TABLE procurements.app_versions
  ADD COLUMN IF NOT EXISTS total_approved_cost NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN procurements.app_versions.total_estimated_cost IS
  'Sum of ALL non-deleted APP items, regardless of HOPE review outcome. What offices asked for.';
COMMENT ON COLUMN procurements.app_versions.total_approved_cost IS
  'Sum of HOPE-approved APP items only. The figure that goes on the APP document.';

CREATE OR REPLACE FUNCTION procurements.recalc_app_version_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
BEGIN
  v_version_id := COALESCE(NEW.app_version_id, OLD.app_version_id);

  UPDATE procurements.app_versions av
     SET total_estimated_cost = COALESCE((
           SELECT SUM(ai.estimated_budget)
             FROM procurements.app_items ai
            WHERE ai.app_version_id = v_version_id
              AND ai.deleted_at IS NULL
         ), 0),
         total_approved_cost = COALESCE((
           SELECT SUM(ai.estimated_budget)
             FROM procurements.app_items ai
            WHERE ai.app_version_id = v_version_id
              AND ai.deleted_at IS NULL
              AND ai.hope_review_status = 'approved'
         ), 0)
   WHERE av.id = v_version_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Also recompute when a review outcome changes, not only on item writes.
CREATE OR REPLACE FUNCTION procurements.recalc_app_totals_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  UPDATE procurements.app_versions av
     SET total_approved_cost = COALESCE((
           SELECT SUM(ai.estimated_budget)
             FROM procurements.app_items ai
            WHERE ai.app_version_id = NEW.app_version_id
              AND ai.deleted_at IS NULL
              AND ai.hope_review_status = 'approved'
         ), 0)
   WHERE av.id = NEW.app_version_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recalc_app_totals_on_review
  AFTER UPDATE OF hope_review_status ON procurements.app_items
  FOR EACH ROW
  WHEN (OLD.hope_review_status IS DISTINCT FROM NEW.hope_review_status)
  EXECUTE FUNCTION procurements.recalc_app_totals_on_review();

-- Backfill both columns for every existing version.
UPDATE procurements.app_versions av
   SET total_estimated_cost = COALESCE((
         SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
          WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
       ), 0),
       total_approved_cost = COALESCE((
         SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
          WHERE ai.app_version_id = av.id
            AND ai.deleted_at IS NULL
            AND ai.hope_review_status = 'approved'
       ), 0);
```

Then `CREATE OR REPLACE` `finalize_app` one last time — start from the Task 11 version and change its total write to set both columns explicitly:

```sql
  UPDATE procurements.app_versions
     SET status = 'final'
   WHERE id = v_version_id;
  -- Totals are maintained by trigger; finalize_app no longer computes them.
```

Delete the local `v_total` variable and its `SELECT ... INTO` from the function.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260814_app_total_definitions`

- [ ] **Step 5: Update the UI to show both figures**

Run: `grep -rn "total_estimated_cost" src/`

In `src/components/planning/app-status-dashboard.tsx` and `src/types/database.ts`, add `total_approved_cost` and label the two clearly — "Submitted" vs "Approved". Wherever a single APP total is shown as *the* plan figure, use `total_approved_cost`.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260814_app_total_definitions.sql supabase/verify/20260814_app_total_definitions.sql src/types/database.ts src/components/planning/app-status-dashboard.tsx
git commit -m "fix(app): separate submitted and approved APP totals

total_estimated_cost now always means all items; the new
total_approved_cost means HOPE-approved items only. Both are
trigger-maintained, including on review-status changes, so finalize_app
no longer needs to compute a total with a third definition.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Release excess obligation at the contract amount

**Files:**
- Create: `supabase/migrations/20260815_obligation_adjust_on_award.sql`
- Create: `supabase/verify/20260815_obligation_adjust_on_award.sql`

**Interfaces:**
- Produces: column `obligation_requests.adjusted_amount`, `obligation_requests.adjustment_reason`; function `procurements.adjust_obligation_to_contract(p_procurement_id UUID) RETURNS NUMERIC`; a trigger on `procurement_activities` firing when the contract amount is set.

**Context:** obligation is correctly debited at OBR certification (`20260409_procurement_triggers.sql:39-46`) — that part matches practice and needs no change. What is missing: when the winning bid comes in below ABC, nothing releases the difference. `obligated_amount` stays at the PR estimate forever, overstating obligations and understating the balance available for the rest of the year. Real budget officers issue an adjusted ORS.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260815_obligation_adjust_on_award.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'obligation_requests'
       AND column_name = 'adjusted_amount'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: obligation_requests.adjusted_amount missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'adjust_obligation_to_contract'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: adjust_obligation_to_contract() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_adjust_obligation_on_award'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_adjust_obligation_on_award missing';
  END IF;
END $$;

SELECT 'PASS: 20260815_obligation_adjust_on_award' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: obligation_requests.adjusted_amount missing`

- [ ] **Step 3: Confirm the contract-amount column name**

The award path stores a contract amount on `procurement_activities`. Confirm the exact column before writing the trigger:

Run: `grep -n "contract_amount\|awarded_amount" supabase/migrations/20260420_bid_evaluations_quorum.sql supabase/migrations/20260428_other_procurement_methods.sql | head -20`

Use whichever column the award RPCs actually write. The SQL below assumes `contract_amount`; substitute if it differs.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260815_obligation_adjust_on_award.sql`:

```sql
-- ============================================================
-- Release the unused portion of an obligation once the contract
-- amount is known.
--
-- Obligating at OBR certification is correct: that is what
-- "certification of availability of funds" means. But a bid that lands
-- below ABC leaves the difference obligated forever, which understates
-- the balance available for the rest of the fiscal year.
-- ============================================================

ALTER TABLE procurements.obligation_requests
  ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ;

COMMENT ON COLUMN procurements.obligation_requests.adjusted_amount IS
  'Obligation restated to the actual contract amount. NULL means never adjusted; amount still applies.';

CREATE OR REPLACE FUNCTION procurements.adjust_obligation_to_contract(
  p_procurement_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc            RECORD;
  v_obr             RECORD;
  v_effective_prior NUMERIC(15,2);
  v_delta           NUMERIC(15,2);
BEGIN
  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id = p_procurement_id;

  IF NOT FOUND OR v_proc.contract_amount IS NULL OR v_proc.contract_amount <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_obr
    FROM procurements.obligation_requests
   WHERE purchase_request_id = v_proc.purchase_request_id
     AND status IN ('certified','obligated')
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND OR v_obr.budget_allocation_id IS NULL THEN
    RETURN 0;
  END IF;

  -- What is currently sitting against the allocation for this OBR.
  v_effective_prior := COALESCE(v_obr.adjusted_amount, v_obr.amount);
  v_delta := v_proc.contract_amount - v_effective_prior;

  IF v_delta = 0 THEN
    RETURN 0;
  END IF;

  -- Never silently increase an obligation past what was certified:
  -- an award above ABC should already have been blocked upstream.
  IF v_delta > 0 THEN
    RAISE EXCEPTION
      'Contract amount (%) exceeds the certified obligation (%) for OBR %. '
      'A supplemental obligation must be certified by the Budget Officer first.',
      v_proc.contract_amount, v_effective_prior, v_obr.obr_number;
  END IF;

  UPDATE procurements.budget_allocations
     SET obligated_amount = GREATEST(0, obligated_amount + v_delta),
         updated_at       = NOW()
   WHERE id = v_obr.budget_allocation_id
     AND deleted_at IS NULL;

  UPDATE procurements.obligation_requests
     SET adjusted_amount   = v_proc.contract_amount,
         adjustment_reason = 'Restated to awarded contract amount. Released '
                             || ABS(v_delta)::TEXT || ' back to the allocation.',
         adjusted_at       = NOW(),
         updated_at        = NOW()
   WHERE id = v_obr.id;

  RETURN ABS(v_delta);
END;
$$;

COMMENT ON FUNCTION procurements.adjust_obligation_to_contract(UUID) IS
  'Restates the obligation to the awarded contract amount and releases the difference. Refuses to increase an obligation.';

CREATE OR REPLACE FUNCTION procurements.trg_adjust_obligation_on_award()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.contract_amount IS NOT NULL
     AND NEW.contract_amount > 0
     AND (OLD.contract_amount IS NULL
          OR OLD.contract_amount <> NEW.contract_amount) THEN
    PERFORM procurements.adjust_obligation_to_contract(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_adjust_obligation_on_award
  AFTER UPDATE OF contract_amount ON procurements.procurement_activities
  FOR EACH ROW
  EXECUTE FUNCTION procurements.trg_adjust_obligation_on_award();
```

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260815_obligation_adjust_on_award`

- [ ] **Step 6: Ask the user to quantify the historic over-obligation**

```sql
SELECT COUNT(*) AS awards_below_abc,
       SUM(obr.amount - pa.contract_amount) AS unreleased_obligation
  FROM procurements.procurement_activities pa
  JOIN procurements.obligation_requests obr
    ON obr.purchase_request_id = pa.purchase_request_id
 WHERE pa.contract_amount IS NOT NULL
   AND pa.contract_amount < obr.amount
   AND obr.adjusted_amount IS NULL
   AND obr.deleted_at IS NULL;
```

Report `unreleased_obligation` to the user — that is budget currently shown as committed that is actually free. Offer a one-off backfill script only if they ask; do not run a mass `UPDATE` on budget figures unprompted.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260815_obligation_adjust_on_award.sql supabase/verify/20260815_obligation_adjust_on_award.sql
git commit -m "feat(budget): release excess obligation when the contract amount is set

Adds adjust_obligation_to_contract() plus a trigger on
procurement_activities.contract_amount, so a bid below ABC returns the
difference to the allocation instead of leaving it obligated for the
rest of the fiscal year. Refuses to increase an obligation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 7 — Schema hygiene

### Task 19: Convert TEXT schedule fields to DATE

**Files:**
- Create: `supabase/migrations/20260816_schema_hygiene_dates.sql`
- Create: `supabase/verify/20260816_schema_hygiene_dates.sql`

**Interfaces:**
- Produces: `DATE` columns on `ppmp_lots` and `app_items` — `procurement_start_date`, `procurement_end_date`, `advertisement_date_d`, `bid_opening_date_d`, `award_date_d`, `contract_signing_date_d`; function `procurements.parse_mm_yyyy(p_text TEXT) RETURNS DATE`.

**Context:** every schedule field is `TEXT` holding `MM/YYYY` (`20240501_ppmps.sql:119-123`, `20260516_app_cse_schedule_columns.sql:34-48`). No date arithmetic, no slippage detection, no validation that the schedule falls inside the fiscal year — which blocks the APP schedule analysis DBM and GPPB expect. Convert before national scale, not after.

**Naming note:** the four `*_date` columns already exist as TEXT, so the new DATE columns take a `_d` suffix. A later cleanup migration drops the TEXT originals and renames.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260816_schema_hygiene_dates.sql`:

```sql
DO $$
DECLARE
  v_missing TEXT;
  v_unparsed INTEGER;
BEGIN
  SELECT string_agg(t || '.' || c, ', ')
    INTO v_missing
    FROM (VALUES
      ('ppmp_lots','procurement_start_date'),
      ('ppmp_lots','procurement_end_date'),
      ('app_items','procurement_start_date'),
      ('app_items','procurement_end_date')
    ) AS x(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'procurements'
        AND table_name = x.t
        AND column_name = x.c
        AND data_type = 'date'
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: missing DATE columns: %', v_missing;
  END IF;

  -- Every parseable MM/YYYY must have been converted.
  SELECT COUNT(*) INTO v_unparsed
    FROM procurements.ppmp_lots
   WHERE procurement_start ~ '^\d{1,2}/\d{4}$'
     AND procurement_start_date IS NULL;

  IF v_unparsed > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % ppmp_lots rows have a parseable procurement_start that did not convert',
      v_unparsed;
  END IF;
END $$;

SELECT 'PASS: 20260816_schema_hygiene_dates' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: missing DATE columns: ppmp_lots.procurement_start_date, ...`

- [ ] **Step 3: Ask the user what formats are actually in the data**

Do not assume `MM/YYYY` — find out:

```sql
SELECT procurement_start, COUNT(*)
  FROM procurements.ppmp_lots
 WHERE procurement_start IS NOT NULL
   AND procurement_start <> ''
 GROUP BY procurement_start
 ORDER BY COUNT(*) DESC
 LIMIT 30;
```

If formats other than `MM/YYYY` appear (e.g. `Jan 2027`, `Q1 2027`, `1st Quarter`), extend `parse_mm_yyyy` to handle them before applying, and report which rows will be left NULL.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260816_schema_hygiene_dates.sql`:

```sql
-- ============================================================
-- Schedule fields as real dates.
--
-- MM/YYYY strings cannot support: schedule-vs-actual slippage
-- reporting, validation that activity falls inside the fiscal year, or
-- the quarterly APP schedule roll-ups DBM and GPPB expect.
--
-- Additive: TEXT originals stay, marked deprecated. A later cleanup
-- migration drops them once every read path uses the DATE columns.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.parse_mm_yyyy(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;

  v_clean := TRIM(p_text);
  IF v_clean = '' THEN RETURN NULL; END IF;

  -- MM/YYYY or M/YYYY -> first day of that month
  IF v_clean ~ '^\d{1,2}/\d{4}$' THEN
    RETURN TO_DATE(LPAD(SPLIT_PART(v_clean, '/', 1), 2, '0')
                   || '/01/' || SPLIT_PART(v_clean, '/', 2), 'MM/DD/YYYY');
  END IF;

  -- YYYY-MM-DD
  IF v_clean ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN v_clean::DATE;
  END IF;

  -- MM/DD/YYYY
  IF v_clean ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    RETURN TO_DATE(v_clean, 'FMMM/FMDD/YYYY');
  END IF;

  -- Unrecognised: leave NULL rather than guess.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION procurements.parse_mm_yyyy(TEXT) IS
  'Best-effort conversion of legacy schedule strings to DATE. Returns NULL rather than guessing.';

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS procurement_start_date   DATE,
  ADD COLUMN IF NOT EXISTS procurement_end_date     DATE,
  ADD COLUMN IF NOT EXISTS advertisement_date_d     DATE,
  ADD COLUMN IF NOT EXISTS bid_opening_date_d       DATE,
  ADD COLUMN IF NOT EXISTS award_date_d             DATE,
  ADD COLUMN IF NOT EXISTS contract_signing_date_d  DATE;

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS procurement_start_date   DATE,
  ADD COLUMN IF NOT EXISTS procurement_end_date     DATE,
  ADD COLUMN IF NOT EXISTS advertisement_date_d     DATE,
  ADD COLUMN IF NOT EXISTS bid_opening_date_d       DATE,
  ADD COLUMN IF NOT EXISTS award_date_d             DATE,
  ADD COLUMN IF NOT EXISTS contract_signing_date_d  DATE;

COMMENT ON COLUMN procurements.ppmp_lots.procurement_start IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_start_date.';
COMMENT ON COLUMN procurements.ppmp_lots.procurement_end IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_end_date.';
COMMENT ON COLUMN procurements.app_items.procurement_start IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_start_date.';
COMMENT ON COLUMN procurements.app_items.procurement_end IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_end_date.';

-- Backfill. The immutability triggers from Tasks 6 and 7 would block
-- these writes on locked versions, so disable them for this migration
-- only. Re-enable immediately after — do not leave this open.
ALTER TABLE procurements.ppmp_lots DISABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_app_items_immutable_when_locked;

UPDATE procurements.ppmp_lots
   SET procurement_start_date  = procurements.parse_mm_yyyy(procurement_start),
       procurement_end_date    = procurements.parse_mm_yyyy(procurement_end),
       advertisement_date_d    = procurements.parse_mm_yyyy(advertisement_date),
       bid_opening_date_d      = procurements.parse_mm_yyyy(bid_opening_date),
       award_date_d            = procurements.parse_mm_yyyy(award_date),
       contract_signing_date_d = procurements.parse_mm_yyyy(contract_signing_date);

UPDATE procurements.app_items
   SET procurement_start_date  = procurements.parse_mm_yyyy(procurement_start),
       procurement_end_date    = procurements.parse_mm_yyyy(procurement_end),
       advertisement_date_d    = procurements.parse_mm_yyyy(advertisement_date),
       bid_opening_date_d      = procurements.parse_mm_yyyy(bid_opening_date),
       award_date_d            = procurements.parse_mm_yyyy(award_date),
       contract_signing_date_d = procurements.parse_mm_yyyy(contract_signing_date);

ALTER TABLE procurements.ppmp_lots ENABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items ENABLE TRIGGER trg_app_items_immutable_when_locked;

CREATE INDEX idx_ppmp_lots_proc_start ON procurements.ppmp_lots(procurement_start_date);
CREATE INDEX idx_app_items_proc_start ON procurements.app_items(procurement_start_date);
```

> **Implementer note:** `ALTER TABLE ... DISABLE TRIGGER` requires table ownership. If the migration runs as a role that lacks it, the statement fails. Confirm with the user which role applies migrations; if it is not the table owner, instead add a session flag the trigger functions honour (`current_setting('procurements.migration_mode', true) = 'on'`) and set it with `SET LOCAL` — that requires editing the Task 6 and 7 trigger functions to check it, so decide before writing this migration.

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260816_schema_hygiene_dates`

- [ ] **Step 6: Report unconverted rows**

```sql
SELECT 'ppmp_lots' AS tbl, procurement_start AS raw_value, COUNT(*)
  FROM procurements.ppmp_lots
 WHERE procurement_start IS NOT NULL AND procurement_start <> ''
   AND procurement_start_date IS NULL
 GROUP BY procurement_start
UNION ALL
SELECT 'app_items', procurement_start, COUNT(*)
  FROM procurements.app_items
 WHERE procurement_start IS NOT NULL AND procurement_start <> ''
   AND procurement_start_date IS NULL
 GROUP BY procurement_start
 ORDER BY 3 DESC;
```

Report every distinct unparsed value to the user. These need either a parser extension or manual entry — do not leave them silently NULL without saying so.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260816_schema_hygiene_dates.sql supabase/verify/20260816_schema_hygiene_dates.sql
git commit -m "feat(app): add DATE schedule columns alongside the legacy TEXT fields

Adds parse_mm_yyyy() and real DATE columns on ppmp_lots and app_items,
backfilled from the MM/YYYY strings, so schedule slippage and quarterly
APP roll-ups become computable. TEXT originals kept and deprecated.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: Replace free-text fund source with an FK, and remove orphan permissions

**Files:**
- Create: `supabase/migrations/20260817_schema_hygiene_fund_source.sql`
- Create: `supabase/verify/20260817_schema_hygiene_fund_source.sql`

**Interfaces:**
- Produces: columns `ppmp_lots.fund_source_id`, `app_items.fund_source_id` (both FK to `procurements.fund_sources`); removal of the four never-checked permission codes.

**Context:** `source_of_funds TEXT` sits on `ppmp_lots` and `app_items` alongside a `budget_allocation_id` FK and a real `fund_sources` table — free text where an FK exists, so fund-source reporting is impossible. Separately, `20240304_permissions_seed.sql:33-37` seeds four codes (`ppmp.review_chief`, `ppmp.certify`, `app.review_rows`, `app.finalize_lots`) that no code path ever checks; the codes actually enforced are the ones seeded later in `20240502_ppmp_rls.sql:11-15` and `20240602_app_rls.sql:10-11`. The orphans appear assignable in the roles UI and do nothing, which is a live source of admin confusion.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260817_schema_hygiene_fund_source.sql`:

```sql
DO $$
DECLARE
  v_orphans INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'ppmp_lots'
       AND column_name = 'fund_source_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_lots.fund_source_id missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_items'
       AND column_name = 'fund_source_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_items.fund_source_id missing';
  END IF;

  SELECT COUNT(*) INTO v_orphans
    FROM procurements.permissions
   WHERE code IN ('ppmp.review_chief','ppmp.certify','app.review_rows','app.finalize_lots');

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % orphan permission codes still present', v_orphans;
  END IF;
END $$;

SELECT 'PASS: 20260817_schema_hygiene_fund_source' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: ppmp_lots.fund_source_id missing`

- [ ] **Step 3: Confirm the orphan codes really are unused**

Before deleting anything, verify independently:

Run: `for c in ppmp.review_chief ppmp.certify app.review_rows app.finalize_lots; do echo "$c: $(grep -rn "has_permission('$c')" supabase/migrations/ src/ 2>/dev/null | wc -l)"; done`

Every count must be `0`. If any is non-zero, remove that code from the deletion list and report it.

Also check whether any role currently has them assigned, because deletion cascades:

```sql
SELECT r.name AS role, p.code
  FROM procurements.role_permissions rp
  JOIN procurements.roles r       ON r.id = rp.role_id
  JOIN procurements.permissions p ON p.id = rp.permission_id
 WHERE p.code IN ('ppmp.review_chief','ppmp.certify','app.review_rows','app.finalize_lots')
 ORDER BY r.name;
```

These assignments grant nothing today, so removing them changes no behaviour — but state that explicitly to the user rather than implying it.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260817_schema_hygiene_fund_source.sql`:

```sql
-- ============================================================
-- Fund source as an FK, and orphan permission cleanup.
-- ============================================================

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS fund_source_id UUID
    REFERENCES procurements.fund_sources(id);

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS fund_source_id UUID
    REFERENCES procurements.fund_sources(id);

COMMENT ON COLUMN procurements.ppmp_lots.source_of_funds IS
  'DEPRECATED: free text. Use fund_source_id.';
COMMENT ON COLUMN procurements.app_items.source_of_funds IS
  'DEPRECATED: free text. Use fund_source_id.';

CREATE INDEX idx_ppmp_lots_fund_source ON procurements.ppmp_lots(fund_source_id);
CREATE INDEX idx_app_items_fund_source ON procurements.app_items(fund_source_id);

-- Backfill 1 (most reliable): via the linked budget allocation.
ALTER TABLE procurements.ppmp_lots DISABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_app_items_immutable_when_locked;

UPDATE procurements.ppmp_lots pl
   SET fund_source_id = ba.fund_source_id
  FROM procurements.budget_allocations ba
 WHERE ba.id = pl.budget_allocation_id
   AND pl.fund_source_id IS NULL;

UPDATE procurements.app_items ai
   SET fund_source_id = ba.fund_source_id
  FROM procurements.budget_allocations ba
 WHERE ba.id = ai.budget_allocation_id
   AND ai.fund_source_id IS NULL;

-- Backfill 2 (best effort): exact case-insensitive name or code match.
UPDATE procurements.ppmp_lots pl
   SET fund_source_id = fs.id
  FROM procurements.fund_sources fs
 WHERE pl.fund_source_id IS NULL
   AND pl.source_of_funds IS NOT NULL
   AND (LOWER(TRIM(pl.source_of_funds)) = LOWER(TRIM(fs.name))
        OR LOWER(TRIM(pl.source_of_funds)) = LOWER(TRIM(fs.code)));

UPDATE procurements.app_items ai
   SET fund_source_id = fs.id
  FROM procurements.fund_sources fs
 WHERE ai.fund_source_id IS NULL
   AND ai.source_of_funds IS NOT NULL
   AND (LOWER(TRIM(ai.source_of_funds)) = LOWER(TRIM(fs.name))
        OR LOWER(TRIM(ai.source_of_funds)) = LOWER(TRIM(fs.code)));

ALTER TABLE procurements.ppmp_lots ENABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items ENABLE TRIGGER trg_app_items_immutable_when_locked;

-- ============================================================
-- Remove the four permission codes nothing checks.
--
-- Enforced equivalents, seeded later, are:
--   ppmp.review_chief  -> ppmp.chief_review    (20240502_ppmp_rls.sql:11)
--   ppmp.certify       -> ppmp.certify_budget  (20240502_ppmp_rls.sql:12)
--   app.review_rows    -> app.hope_review      (20240602_app_rls.sql:10)
--   app.finalize_lots  -> app.bac_manage_lots  (20240602_app_rls.sql:11)
--
-- role_permissions rows cascade on delete. They grant nothing today.
-- ============================================================

DELETE FROM procurements.permissions
 WHERE code IN ('ppmp.review_chief','ppmp.certify','app.review_rows','app.finalize_lots');
```

> **Implementer note:** confirm `fund_sources` actually has both `name` and `code` columns before relying on the second backfill. Run `\d procurements.fund_sources` — if there is no `code`, drop that half of the predicate. Also confirm `budget_allocations.fund_source_id` exists (it does, per `20240406_budget_allocations.sql:10`).

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260817_schema_hygiene_fund_source`

- [ ] **Step 6: Report unmatched fund-source strings**

```sql
SELECT source_of_funds, COUNT(*)
  FROM procurements.ppmp_lots
 WHERE fund_source_id IS NULL
   AND source_of_funds IS NOT NULL
   AND TRIM(source_of_funds) <> ''
 GROUP BY source_of_funds
 ORDER BY COUNT(*) DESC;
```

Each distinct value is either a `fund_sources` row that needs creating or a typo needing correction. List them for the user.

- [ ] **Step 7: Point the forms at the FK**

In `src/components/planning/ppmp-item-form.tsx` (and the lot form within `ppmp-form.tsx`), replace the free-text "Source of Funds" input with a `Select` populated from `fund_sources`, writing `fund_source_id`. Keep writing `source_of_funds` with the selected name for one release so existing reports keep rendering.

Update `src/lib/schemas/ppmp.ts` to add `fund_source_id: z.string().uuid()` and mark `source_of_funds` optional.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260817_schema_hygiene_fund_source.sql supabase/verify/20260817_schema_hygiene_fund_source.sql src/lib/schemas/ppmp.ts src/components/planning/ppmp-item-form.tsx src/components/planning/ppmp-form.tsx
git commit -m "feat(app): add fund_source_id FK and drop orphan permission codes

Replaces free-text source_of_funds with an FK to fund_sources on
ppmp_lots and app_items, backfilled via budget_allocations and name
matching. Removes ppmp.review_chief, ppmp.certify, app.review_rows, and
app.finalize_lots, which no code path checked but which appeared
assignable in the roles UI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deferred to a separate plan

These were identified in the same review but are **new subsystems**, not corrections to the planning module. Bundling them here would make this plan unshippable. Each needs its own plan document:

| Subsystem | Why separate | Blocking dependency |
|---|---|---|
| **BAC Secretariat conformity review** + HOPE document-level approval | Restructures the APP approval chain and its UI; touches `hope_review_app_item`, `finalize_app`, and `app-workflow-actions.tsx` | Wants Phase 1–4 settled first |
| **APP postings** (`app_postings`, `post_app()`) | `apps.philgeps_reference` is a bare TEXT nothing writes and status `'posted'` has no RPC; transparency compliance | None |
| **Disbursement vouchers / payments** | Closes budget→payment; `disbursed_amount` is currently written by nothing, so every utilization report shows ₱0 | None |
| **Contracts entity** | PO is adequate for goods but not infrastructure (variation orders, liquidated damages, NTP→completion) | None |
| **Procurement Monitoring Report (PMR)** | Semestral GPPB submission; no table or report exists | None |
| **APP-CSE submission tracking** | `is_cse` exists but there is no DBM-PS submission record or deadline | None |
| **`document_signatories`** | OIC-SDS signing when the SDS is on leave is unrepresentable; `approved_by` is one plain FK | None |
| **`app_item_lines` junction** | Would replace `source_ppmp_lot_item_ids UUID[]`; highest-risk change in the review because it rewrites the Task-11-adjacent lotting RPCs | Must come after Phase 4 |
| **Nationwide architecture** (platform-level reference data, `region_id` scope, materialized reporting snapshots) | Multi-tenant architecture work, not planning-module work | Everything above |

---

## Self-Review

**Spec coverage.** Mapping each review finding to a task:

| Finding | Task |
|---|---|
| F1 `indicative_final` derived from approval status | 3, 4, 5 |
| F2 DBM ceiling absent | 1, 2 |
| F3 EPA impossible | 11, 12, 13 |
| F4 approved PPMP content editable | 6 |
| F4b approved APP content editable | 7 |
| F5 `source_ppmp_lot_id` points at mutable row | 8 |
| F6 amendment orphans in-flight procurement | 10 |
| F7 approved PPMPs silently miss the APP | 9 |
| F8 `item_number` not unique / racy | 8 |
| F9 lot ABC not reconciled to lines | 16 |
| F10 two definitions of APP total | 17 |
| F11 obligations never adjusted to contract | 18 |
| F12 payment chain incomplete | **deferred** — listed above |
| Q2 HOPE row-level review unworkable | **deferred** — listed above |
| Q5 TEXT dates | 19 |
| Q5 `source_of_funds` free text | 20 |
| Q5 duplicated status/stage columns | 3 (deprecation), 15 (view) |
| Lot ordering contradiction | 11 |
| Orphan permission codes | 20 |

**Known gaps in this plan, stated rather than hidden:**
- `ppmps.indicative_final` and `apps.indicative_final` are deprecated but not dropped. Deliberate — CLAUDE.md forbids destructive changes, and dropping needs a full FY of UI cutover. A cleanup migration belongs in a later plan.
- Task 19's trigger-disable approach needs the migration role to own the tables. The implementer note flags the alternative; this must be resolved with the user *before* writing that migration, not during.
- The `contract_amount` column name in Task 18 is unverified against the award RPCs. Step 3 of that task verifies it first.
- No task backfills historic over-obligation (Task 18 Step 6 only reports it). Mass updates to budget figures need explicit user authorization.

**Type consistency check.** `PlanningStage` (Task 2) is used in Tasks 3 and 5. `AppLot["status"]` union (Task 13) matches the CHECK constraint in Task 11 exactly: `draft | composed | released | in_procurement`. `finalize_lot` keeps its name throughout (Tasks 11, 12, 13) and always means `draft → composed`. `release_app_lot` / `release_all_app_lots` / `authorize_epa_lot` names are consistent between Tasks 11, 12, and 13. `create_ppmp_amendment` is 3-arg from Task 10 onward and is re-replaced in Tasks 15 and referenced in 14 with three arguments.

