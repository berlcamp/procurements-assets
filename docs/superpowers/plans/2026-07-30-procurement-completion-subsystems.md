# Procurement Completion Subsystems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the entities and workflow steps the PPMP/APP review found missing — APP posting, BAC Secretariat conformity review, disbursement/payment, contracts, PMR, APP-CSE submission, and delegated signatories — so the chain from budget ceiling through to payment is complete and auditable.

**Architecture:** Every task here is additive: new tables with RLS, permissions, audit triggers, and RPCs, plus two workflow restructures that change where an existing approval sits. Nothing in this plan alters the planning-stage or lot-gating model — that is the companion plan's job.

**Tech Stack:** PostgreSQL 15 (Supabase), `procurements` schema, plpgsql RPCs + RLS, Next.js 16.2.1 App Router, React 19 Server Components, react-hook-form + Zod 4, shadcn/ui.

## Prerequisite

**Tasks 1 and 8 of this plan require the companion plan** `2026-07-30-ppmp-app-planning-refactor.md` to be complete through Phase 4:
- Task 1 (BAC Secretariat review) restructures the approval chain that Phase 1–4 stabilises.
- Task 8 (`app_item_lines`) rewrites lotting RPCs that Phase 4 (Task 11) changes.

Tasks 2–7 and 9 have **no dependency** on the companion plan and can run in parallel with it.

## Global Constraints

Identical to the companion plan. Repeated here because each task is executed by a worker who sees only this document:

- **NEVER execute migrations.** Per `CLAUDE.md`: generate SQL files in `supabase/migrations/` only. Never run `supabase db push`, `supabase migration up`, or any `DROP`/`ALTER`/`DELETE`/`TRUNCATE`/unqualified `UPDATE`. Every task ends by *asking the user* to apply the migration and paste the result.
- **Migration naming:** `supabase/migrations/YYYYMMDD_description.sql`. This plan uses the `20260901`–`20260920` range, deliberately after the companion plan's `20260801`–`20260817`.
- **Additive only.** No dropping or renaming existing columns. Superseded columns get `COMMENT ... IS 'DEPRECATED: ...'`.
- **All money is `NUMERIC(15,2)`.** Never `FLOAT`/`REAL`. Never compute currency in JavaScript.
- **All schema-qualified.** Tables live in `procurements`. Supabase client calls must use `.schema("procurements")` — omitting it silently returns empty results with no error.
- **Every RPC:** `LANGUAGE plpgsql SECURITY DEFINER SET search_path = procurements, platform, auth, public`, and must (a) enforce `division_id = procurements.get_user_division_id()`, (b) check `procurements.has_permission('code')`, (c) validate the previous status before transitioning.
- **Every new table gets:** `division_id` FK, `deleted_at`, `created_at`/`updated_at`, `created_by`, RLS enabled, a `set_updated_at` trigger, an `audit_trigger`, and a read policy scoped to `procurements.get_user_division_id()`.
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
  Never `AND (has_permission(...) OR is_super_admin())`, and never omit the super-admin branch from `WITH CHECK`. That shape is dead code for platform admins (whose `get_user_division_id()` is NULL) and blocks `INSERT` outright, since `INSERT` evaluates only `WITH CHECK`. Precedent for the correct shape: `20260405_user_roles_super_admin_access.sql:1-23`. Do not copy `20240401_fiscal_years.sql:82-94` or `20240406_budget_allocations.sql:74-98`, which still carry the old broken shape. Applies to `manage_app_postings`, `manage_cse_submissions`, `manage_contracts`, `manage_variations`, `manage_dv`, `manage_dv_items`, `manage_payments`, `manage_pmr`, and `manage_signatories`. *Read* policies are unaffected.
- **No test runner exists.** TDD is adapted: write an assertion script to `supabase/verify/<migration-name>.sql` *first*, confirm it fails, write the migration, confirm it passes. Idiom:
  ```sql
  DO $$
  BEGIN
    IF NOT (SELECT ...) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: <what was expected>';
    END IF;
  END $$;
  ```
  Silent run = pass. Any `RAISE EXCEPTION` = fail.
- **TypeScript gates (CORRECTED 2026-07-30):** `npm run build` (strict) must pass clean. `npm run lint` **cannot** be required to pass — `main` already carries 33 pre-existing lint errors and 106 warnings, so "lint must pass" was unachievable as originally written. The real gate is: **your changed files introduce no new lint errors or warnings.** Do not fix unrelated pre-existing lint noise. Never use `git stash` to establish a lint baseline — there is uncommitted user work in the tree.
- **`src/types/database.ts` is hand-maintained** — no codegen. Update it in the same task as the schema change.
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
- **Reference table shapes** (verified, use these exact column names):
  - `procurements.permissions (code, module, description, scope)` — `scope IN ('platform','division')`
  - `procurements.role_permissions (role_id, permission_id)`
  - `procurements.notifications (user_id, title, message, type, reference_type, reference_id, office_id)` — `type IN ('info','success','warning','error','approval')`
  - `procurements.approval_logs (reference_type, reference_id, step_name, step_order, action, acted_by, remarks, office_id)` — `action IN ('approved','rejected','returned','forwarded','noted')`
  - `procurements.sequence_counters` — use the existing `procurements.generate_sequence_number()` for document numbers; check its signature with `\df procurements.generate_sequence_number` before calling.
- **Commit per task**, conventional-commit prefixes matching repo history (`feat(app):`, `fix(app):`, `feat(budget):`).

---

## File Structure

| Migration | Responsibility |
|---|---|
| `20260901_app_postings.sql` | APP transparency posting record + `post_app()` |
| `20260902_secretariat_review.sql` | BAC Secretariat conformity review step; HOPE moves to document-level |
| `20260903_app_cse_submission.sql` | APP-CSE submission to DBM-PS tracking |
| `20260904_contracts.sql` | Contract entity for infrastructure/consulting |
| `20260905_disbursement_vouchers.sql` | DV + DV items, obligation liquidation |
| `20260906_payments.sql` | Payment records feeding `disbursed_amount` |
| `20260907_procurement_monitoring_reports.sql` | Semestral PMR |
| `20260908_document_signatories.sql` | OIC / delegated signing authority |
| `20260909_app_item_lines.sql` | Junction replacing `source_ppmp_lot_item_ids` |

Verify scripts mirror each filename under `supabase/verify/`.

**New TypeScript:**

| File | Change |
|---|---|
| `src/types/database.ts` | Row types for all nine subsystems |
| `src/lib/schemas/app.ts` | `postAppSchema`, `secretariatReviewSchema`, `appCseSubmissionSchema` |
| `src/lib/schemas/procurement.ts` | `contractSchema` |
| `src/lib/schemas/budget.ts` | `disbursementVoucherSchema`, `paymentSchema` |
| `src/lib/schemas/admin.ts` | `signatorySchema` |
| `src/lib/actions/app.ts` | `postApp`, `secretariatReviewApp`, `recordCseSubmission` |
| `src/lib/actions/procurement.ts` | Contract CRUD + NTP issuance |
| `src/lib/actions/budget.ts` | DV + payment actions |
| `src/lib/actions/reports.ts` | PMR generation |
| `src/app/dashboard/planning/app/[id]/posting/page.tsx` | New |
| `src/app/dashboard/budget/vouchers/page.tsx` | New |
| `src/app/dashboard/procurement/contracts/page.tsx` | New |
| `src/app/dashboard/reports/pmr/page.tsx` | New |
| `src/app/dashboard/admin/signatories/page.tsx` | New |

---

## Task 1: APP transparency posting

**Depends on:** companion plan Phase 4 (needs `app_versions.planning_stage`).

**Files:**
- Create: `supabase/migrations/20260901_app_postings.sql`
- Create: `supabase/verify/20260901_app_postings.sql`

**Interfaces:**
- Produces: table `procurements.app_postings`; function `procurements.post_app(p_app_id UUID, p_channel TEXT, p_url TEXT, p_reference TEXT) RETURNS UUID`; permission `app.post`.

**Context:** `apps.philgeps_reference` is a bare `TEXT` column (`20240601_app_tables.sql:18`) that nothing writes, and `apps.status` includes `'posted'` (`:15`) with no RPC that transitions to it. RA 12009 and its IRR require the approved APP to be posted for transparency — agency website and PhilGEPS. A single nullable text column cannot record multiple channels, dates, or who posted.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260901_app_postings.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'app_postings'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.app_postings missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'app_postings' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on app_postings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'post_app'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: post_app() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'app.post'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app.post permission not seeded';
  END IF;
END $$;

SELECT 'PASS: 20260901_app_postings' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurements.app_postings missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260901_app_postings.sql`:

```sql
-- ============================================================
-- APP transparency posting.
--
-- The approved APP must be posted (agency website, PhilGEPS, and in
-- practice the division bulletin board). apps.philgeps_reference was a
-- single nullable TEXT that nothing wrote, and status 'posted' had no
-- transition. One APP version can be posted to several channels on
-- different dates, so this is a child table, not a column.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_postings (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  app_id            UUID          NOT NULL REFERENCES procurements.apps(id),
  app_version_id    UUID          NOT NULL REFERENCES procurements.app_versions(id) ON DELETE CASCADE,

  channel           TEXT          NOT NULL
                      CHECK (channel IN ('philgeps','agency_website','bulletin_board','other')),
  reference_number  TEXT,
  url               TEXT,
  posted_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  posted_by         UUID          REFERENCES auth.users(id),
  remarks           TEXT,

  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          REFERENCES auth.users(id),

  UNIQUE (app_version_id, channel)
);

COMMENT ON TABLE procurements.app_postings IS
  'Where and when an approved APP version was published. Evidence of transparency compliance.';

CREATE INDEX idx_app_postings_division ON procurements.app_postings(division_id);
CREATE INDEX idx_app_postings_app      ON procurements.app_postings(app_id);
CREATE INDEX idx_app_postings_version  ON procurements.app_postings(app_version_id);
CREATE INDEX idx_app_postings_deleted  ON procurements.app_postings(deleted_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN procurements.apps.philgeps_reference IS
  'DEPRECATED: use procurements.app_postings with channel = ''philgeps''.';

CREATE TRIGGER trg_app_postings_updated_at
  BEFORE UPDATE ON procurements.app_postings
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_app_postings_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.app_postings
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- post_app: record a posting and advance the APP to 'posted' once
-- PhilGEPS has been covered.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.post_app(
  p_app_id    UUID,
  p_channel   TEXT,
  p_url       TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app        RECORD;
  v_version_id UUID;
  v_posting_id UUID;
BEGIN
  IF p_channel NOT IN ('philgeps','agency_website','bulletin_board','other') THEN
    RAISE EXCEPTION
      'Invalid channel %. Must be philgeps, agency_website, bulletin_board, or other.',
      p_channel;
  END IF;

  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.post') THEN
    RAISE EXCEPTION 'Insufficient permissions to post the APP';
  END IF;

  IF v_app.status NOT IN ('approved','posted') THEN
    RAISE EXCEPTION
      'Only an approved APP may be posted (current status: %).', v_app.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status = 'approved'
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No approved version found for APP %', p_app_id;
  END IF;

  INSERT INTO procurements.app_postings (
    division_id, app_id, app_version_id, channel,
    reference_number, url, posted_by, created_by
  ) VALUES (
    v_app.division_id, p_app_id, v_version_id, p_channel,
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    NULLIF(TRIM(COALESCE(p_url, '')), ''),
    auth.uid(), auth.uid()
  )
  ON CONFLICT (app_version_id, channel) DO UPDATE
    SET reference_number = EXCLUDED.reference_number,
        url              = EXCLUDED.url,
        posted_at        = NOW(),
        posted_by        = auth.uid(),
        deleted_at       = NULL,
        updated_at       = NOW()
  RETURNING id INTO v_posting_id;

  -- PhilGEPS is the statutory channel; that is what flips the status.
  IF p_channel = 'philgeps' AND v_app.status = 'approved' THEN
    UPDATE procurements.apps
       SET status     = 'posted',
           updated_at = NOW()
     WHERE id = p_app_id;
  END IF;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app', p_app_id, 'APP Posting', 8,
    'noted', auth.uid(),
    'Posted to ' || p_channel || COALESCE(' (' || p_reference || ')', '')
  );

  RETURN v_posting_id;
END;
$$;

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.post', 'planning', 'Record transparency postings of the approved APP', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_secretariat','bac_chair','division_admin')
  AND p.code IN ('app.post')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.app_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_app_postings" ON procurements.app_postings
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_app_postings" ON procurements.app_postings
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (procurements.has_permission('app.post') OR platform.is_super_admin())
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('app.post')
    AND procurements.is_division_active()
  );
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260901_app_postings`

- [ ] **Step 5: Add types, schema, and server action**

In `src/types/database.ts`:

```typescript
export interface AppPosting {
  id: string
  division_id: string
  app_id: string
  app_version_id: string
  channel: "philgeps" | "agency_website" | "bulletin_board" | "other"
  reference_number: string | null
  url: string | null
  posted_at: string
  posted_by: string | null
  remarks: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}
```

In `src/lib/schemas/app.ts`:

```typescript
export const postAppSchema = z.object({
  app_id: z.string().uuid(),
  channel: z.enum(["philgeps", "agency_website", "bulletin_board", "other"]),
  url: z.string().url("Enter a valid URL").nullable().optional(),
  reference_number: z.string().trim().min(1).nullable().optional(),
})

export type PostAppInput = z.infer<typeof postAppSchema>
```

In `src/lib/actions/app.ts`:

```typescript
export async function postApp(input: PostAppInput) {
  const parsed = postAppSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("post_app", {
    p_app_id: parsed.data.app_id,
    p_channel: parsed.data.channel,
    p_url: parsed.data.url ?? null,
    p_reference: parsed.data.reference_number ?? null,
  })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { error: null, data: data as string }
}
```

- [ ] **Step 6: Build the posting page**

Create `src/app/dashboard/planning/app/[id]/posting/page.tsx` as a Server Component that lists existing `app_postings` for the APP's approved version and renders a client form calling `postApp`. Follow the layout conventions in the sibling `src/app/dashboard/planning/app/` pages. Show a compliance summary: which of the four channels have a posting and which do not.

- [ ] **Step 7: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260901_app_postings.sql supabase/verify/20260901_app_postings.sql src/types/database.ts src/lib/schemas/app.ts src/lib/actions/app.ts src/app/dashboard/planning/app/
git commit -m "feat(app): record APP transparency postings and wire the posted status

Adds app_postings with one row per channel plus post_app(), which
advances the APP to 'posted' once PhilGEPS is covered. Deprecates the
unused apps.philgeps_reference column.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: BAC Secretariat conformity review; HOPE moves to document level

**Depends on:** companion plan Phases 1–4 complete.

**Files:**
- Create: `supabase/migrations/20260902_secretariat_review.sql`
- Create: `supabase/verify/20260902_secretariat_review.sql`

**Interfaces:**
- Produces: columns `app_items.secretariat_review_status`, `secretariat_reviewed_by`, `secretariat_reviewed_at`, `secretariat_remarks`; columns `app_versions.secretariat_endorsed_by`, `secretariat_endorsed_at`, `bac_resolution_number`, `bac_resolution_url`; functions `procurements.secretariat_review_app_item(p_app_item_id UUID, p_action TEXT, p_remarks TEXT)`, `procurements.endorse_app_to_hope(p_app_id UUID, p_resolution_number TEXT, p_resolution_url TEXT)`, `procurements.hope_approve_app_document(p_app_id UUID, p_notes TEXT)`; permission `app.secretariat_review`.

**Context:** `hope_review_app_item` (`20240603_app_rpc.sql:8-62`) makes the SDS approve or remark on every APP row individually, and `finalize_app` refuses while any row is `pending` (`:434`). On a real division APP that is hundreds to thousands of rows. A real SDS approves the APP *as a document*, on a BAC resolution endorsing it. The line-by-line screening for correct procurement mode, ABC reasonableness, and CSE classification is the Procurement Unit / BAC Secretariat's job, and it happens *before* the document reaches the HOPE.

This task inserts that step and demotes row-level HOPE review to an exception mechanism. `hope_review_app_item` is **kept** — the SDS can still remark on a specific row — but it is no longer the required path.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260902_secretariat_review.sql`:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_items'
       AND column_name = 'secretariat_review_status'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_items.secretariat_review_status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_versions'
       AND column_name = 'bac_resolution_number'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_versions.bac_resolution_number missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'endorse_app_to_hope'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: endorse_app_to_hope() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'hope_approve_app_document'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: hope_approve_app_document() missing';
  END IF;

  -- finalize_app must no longer require zero pending HOPE rows
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'finalize_app';

  IF v_src LIKE '%pending HOPE review%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: finalize_app still requires row-by-row HOPE review';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'app.secretariat_review'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app.secretariat_review permission not seeded';
  END IF;
END $$;

SELECT 'PASS: 20260902_secretariat_review' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_items.secretariat_review_status missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260902_secretariat_review.sql`:

```sql
-- ============================================================
-- BAC Secretariat conformity review, and HOPE approval at the
-- document level.
--
-- Old chain:  consolidate -> HOPE reviews EVERY row -> BAC lots ->
--             finalize -> HOPE approves
-- New chain:  consolidate -> Secretariat screens every row ->
--             BAC lots -> finalize -> Secretariat endorses with a BAC
--             resolution -> HOPE approves the document
--
-- Row-level HOPE remarks remain available as an exception path, they
-- are just no longer mandatory for every line.
-- ============================================================

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS secretariat_review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (secretariat_review_status IN ('pending','cleared','returned')),
  ADD COLUMN IF NOT EXISTS secretariat_reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS secretariat_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS secretariat_remarks TEXT;

COMMENT ON COLUMN procurements.app_items.secretariat_review_status IS
  'BAC Secretariat conformity screening: procurement mode, ABC reasonableness, CSE classification.';
COMMENT ON COLUMN procurements.app_items.hope_review_status IS
  'Row-level HOPE outcome. Optional exception path since 20260902 — HOPE now approves the APP as a document.';

CREATE INDEX idx_app_items_secretariat_status
  ON procurements.app_items(secretariat_review_status);

ALTER TABLE procurements.app_versions
  ADD COLUMN IF NOT EXISTS secretariat_endorsed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS secretariat_endorsed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bac_resolution_number TEXT,
  ADD COLUMN IF NOT EXISTS bac_resolution_url TEXT;

COMMENT ON COLUMN procurements.app_versions.bac_resolution_number IS
  'BAC resolution recommending APP approval. Required before HOPE document-level approval.';

-- Existing HOPE-approved rows are treated as already cleared, so this
-- migration does not create a backlog of screening work on live data.
UPDATE procurements.app_items
   SET secretariat_review_status = 'cleared',
       secretariat_reviewed_by   = hope_reviewed_by,
       secretariat_reviewed_at   = hope_reviewed_at,
       secretariat_remarks       = 'Backfill 20260902: carried over from an existing HOPE row approval.'
 WHERE hope_review_status = 'approved'
   AND secretariat_review_status = 'pending';

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.secretariat_review', 'planning',
   'Screen consolidated APP rows for conformity as BAC Secretariat', 'division'),
  ('app.endorse',            'planning',
   'Endorse the APP to the HOPE with a BAC resolution',              'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_secretariat','bac_chair','division_admin')
  AND p.code IN ('app.secretariat_review')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_chair','bac_secretariat')
  AND p.code IN ('app.endorse')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Step 1 of the new chain: Secretariat screens a row.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.secretariat_review_app_item(
  p_app_item_id UUID,
  p_action      TEXT,
  p_remarks     TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF p_action NOT IN ('clear','return') THEN
    RAISE EXCEPTION 'Invalid action %. Must be ''clear'' or ''return''.', p_action;
  END IF;

  IF p_action = 'return' AND (p_remarks IS NULL OR LENGTH(TRIM(p_remarks)) < 5) THEN
    RAISE EXCEPTION 'Remarks are required when returning an item (min 5 characters).';
  END IF;

  SELECT ai.*, a.division_id, a.status AS app_status
    INTO v_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL
     AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item % not found', p_app_item_id;
  END IF;

  IF v_item.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied to APP item %', p_app_item_id;
  END IF;

  IF NOT procurements.has_permission('app.secretariat_review') THEN
    RAISE EXCEPTION 'Insufficient permissions to screen APP items';
  END IF;

  UPDATE procurements.app_items
     SET secretariat_review_status = CASE WHEN p_action = 'clear' THEN 'cleared' ELSE 'returned' END,
         secretariat_reviewed_by   = auth.uid(),
         secretariat_reviewed_at   = NOW(),
         secretariat_remarks       = p_remarks,
         -- Clearing the Secretariat gate is what makes a row lottable.
         hope_review_status        = CASE
           WHEN p_action = 'clear' AND hope_review_status = 'pending' THEN 'approved'
           ELSE hope_review_status
         END,
         updated_at                = NOW()
   WHERE id = p_app_item_id;
END;
$$;

COMMENT ON FUNCTION procurements.secretariat_review_app_item(UUID, TEXT, TEXT) IS
  'BAC Secretariat conformity screening. Clearing a row also satisfies the legacy hope_review_status gate used by the lotting RPCs.';

CREATE OR REPLACE FUNCTION procurements.secretariat_batch_review_app_items(
  p_app_item_ids UUID[],
  p_action       TEXT,
  p_remarks      TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_id    UUID;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_id IN ARRAY p_app_item_ids LOOP
    PERFORM procurements.secretariat_review_app_item(v_id, p_action, p_remarks);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- Step 2: Secretariat endorses the finalized APP to the HOPE.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.endorse_app_to_hope(
  p_app_id            UUID,
  p_resolution_number TEXT,
  p_resolution_url    TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app        RECORD;
  v_version_id UUID;
  v_pending    INTEGER;
BEGIN
  IF p_resolution_number IS NULL OR LENGTH(TRIM(p_resolution_number)) = 0 THEN
    RAISE EXCEPTION 'A BAC resolution number is required to endorse the APP.';
  END IF;

  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.endorse') THEN
    RAISE EXCEPTION 'Insufficient permissions to endorse the APP';
  END IF;

  IF v_app.status <> 'final' THEN
    RAISE EXCEPTION
      'The APP must be finalized before endorsement (current status: %).', v_app.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status = 'final'
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No finalized version found for APP %', p_app_id;
  END IF;

  SELECT COUNT(*) INTO v_pending
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND secretariat_review_status = 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION
      'Cannot endorse: % items have not been screened by the Secretariat.', v_pending;
  END IF;

  UPDATE procurements.app_versions
     SET secretariat_endorsed_by = auth.uid(),
         secretariat_endorsed_at = NOW(),
         bac_resolution_number   = TRIM(p_resolution_number),
         bac_resolution_url      = NULLIF(TRIM(COALESCE(p_resolution_url, '')), '')
   WHERE id = v_version_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app', p_app_id, 'BAC Endorsement', 6,
    'forwarded', auth.uid(),
    'Endorsed to HOPE under BAC Resolution ' || TRIM(p_resolution_number)
  );

  -- Notify HOPE holders.
  INSERT INTO procurements.notifications (
    user_id, title, message, type, reference_type, reference_id
  )
  SELECT DISTINCT up.user_id,
         'APP endorsed for your approval',
         'The BAC has endorsed the APP under Resolution '
           || TRIM(p_resolution_number) || ' and it is ready for your approval.',
         'approval', 'app', p_app_id
    FROM procurements.user_profiles up
    JOIN procurements.user_roles ur       ON ur.user_id = up.user_id
    JOIN procurements.role_permissions rp ON rp.role_id = ur.role_id
    JOIN procurements.permissions perm    ON perm.id = rp.permission_id
   WHERE up.division_id = v_app.division_id
     AND perm.code = 'app.approve';
END;
$$;

-- ============================================================
-- Step 3: HOPE approves the document, not the rows.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.hope_approve_app_document(
  p_app_id UUID,
  p_notes  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app        RECORD;
  v_version    RECORD;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve the APP';
  END IF;

  IF v_app.status <> 'final' THEN
    RAISE EXCEPTION
      'The APP must be final before approval (current status: %).', v_app.status;
  END IF;

  SELECT * INTO v_version
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status = 'final'
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'No finalized version found for APP %', p_app_id;
  END IF;

  IF v_version.secretariat_endorsed_at IS NULL THEN
    RAISE EXCEPTION
      'The APP has not been endorsed by the BAC. Run endorse_app_to_hope() with the resolution number first.';
  END IF;

  -- Delegate the state transition to the existing, tested routine.
  PERFORM procurements.approve_app(p_app_id, p_notes);

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app', p_app_id, 'HOPE Approval', 7,
    'approved', auth.uid(),
    COALESCE(p_notes, 'Approved as a document on BAC Resolution '
      || COALESCE(v_version.bac_resolution_number, '(none)'))
  );
END;
$$;
```

Then, in the same migration, `CREATE OR REPLACE` `finalize_app` — take the latest version from the companion plan (Task 17 of that plan) and swap the HOPE-pending check for a Secretariat-pending check:

```sql
  -- Was: hope_review_status = 'pending' -> 'items still pending HOPE review'
  SELECT COUNT(*) INTO v_pending_cnt
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND secretariat_review_status = 'pending';

  IF v_pending_cnt > 0 THEN
    RAISE EXCEPTION
      'Cannot finalize APP: % items have not been screened by the BAC Secretariat.',
      v_pending_cnt;
  END IF;
```

> **Implementer note:** the lotting RPCs (`assign_items_to_lot` at `20240603_app_rpc.sql:220-223`, and the line-level variants in `20260729_app_item_line_level_lotting.sql`) gate on `hope_review_status = 'approved'`. `secretariat_review_app_item` sets that field when it clears a row, so those RPCs keep working untouched. Do not change them in this task — that coupling is deliberate and is what keeps this migration small.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260902_secretariat_review`

- [ ] **Step 5: Ask the user to walk the new chain in dev**

Paste the outcome of each:

1. `SELECT procurements.secretariat_batch_review_app_items(ARRAY[...]::UUID[], 'clear', NULL);`
2. Assign items to lots, `finalize_lot` each → composed
3. `SELECT procurements.finalize_app('<app-id>');` → succeeds without any HOPE row action
4. `SELECT procurements.hope_approve_app_document('<app-id>', 'Approved.');` → **must fail** with the endorsement message
5. `SELECT procurements.endorse_app_to_hope('<app-id>', 'BAC Res. 2027-001', NULL);`
6. Retry step 4 → succeeds

Step 4 failing then succeeding after endorsement is the point of this task.

- [ ] **Step 6: Update the workflow UI**

In `src/components/planning/app-workflow-actions.tsx`, add the two new steps to the action set: **"Endorse to HOPE"** (dialog capturing resolution number + optional URL, calls `endorseAppToHope`) shown when `app.status === "final"` and not yet endorsed; **"Approve APP"** now calls `hopeApproveAppDocument` rather than `approve_app` directly.

In `src/components/planning/app-hope-review.tsx`, relabel the bulk row action to reflect Secretariat screening and call `secretariatBatchReviewAppItems`. Keep the HOPE row-remark action available but present it as an exception, not the primary flow.

In `src/components/shared/approval-stepper.tsx`, extend the APP template with the two new steps so the stepper matches reality.

Add the corresponding server actions to `src/lib/actions/app.ts` following the established `{ error, data }` pattern.

- [ ] **Step 7: Run the TypeScript gates**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260902_secretariat_review.sql supabase/verify/20260902_secretariat_review.sql src/lib/actions/app.ts src/components/planning/ src/components/shared/approval-stepper.tsx
git commit -m "feat(app): add BAC Secretariat screening and document-level HOPE approval

Inserts the Secretariat conformity review before consolidation reaches
the HOPE, requires a BAC resolution to endorse the finalized APP, and
makes HOPE approval a single document action instead of a per-row
obligation across hundreds of lines. Row-level HOPE remarks remain as an
exception path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: APP-CSE submission tracking

**Depends on:** nothing.

**Files:**
- Create: `supabase/migrations/20260903_app_cse_submission.sql`
- Create: `supabase/verify/20260903_app_cse_submission.sql`

**Interfaces:**
- Produces: table `procurements.app_cse_submissions`; function `procurements.record_cse_submission(p_app_id UUID, p_submitted_date DATE, p_reference TEXT, p_total_amount NUMERIC, p_remarks TEXT) RETURNS UUID`; view `procurements.v_app_cse_summary`; permission `app.cse_submit`.

**Context:** `is_cse` exists on `ppmp_lots` and `app_items` (`20260516_app_cse_schedule_columns.sql:26-30`) so items can be classified, but there is no record of the APP-CSE ever being submitted to DBM-PS. DBM requires the APP-CSE for common-use supplies to be filed through the Virtual Store against an annual deadline, and non-submission blocks procurement of those items through PS-DBM.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260903_app_cse_submission.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'app_cse_submissions'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.app_cse_submissions missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'procurements' AND table_name = 'v_app_cse_summary'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: view v_app_cse_summary missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'record_cse_submission'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: record_cse_submission() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'app_cse_submissions' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on app_cse_submissions';
  END IF;
END $$;

SELECT 'PASS: 20260903_app_cse_submission' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurements.app_cse_submissions missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260903_app_cse_submission.sql`:

```sql
-- ============================================================
-- APP-CSE submission to DBM Procurement Service.
--
-- is_cse already classifies items. What was missing is the record that
-- the APP-CSE was actually filed with PS-DBM, against which deadline,
-- and for what total — which is what an auditor asks for.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_cse_submissions (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID          NOT NULL REFERENCES platform.divisions(id),
  app_id              UUID          NOT NULL REFERENCES procurements.apps(id),
  app_version_id      UUID          NOT NULL REFERENCES procurements.app_versions(id) ON DELETE CASCADE,
  fiscal_year_id      UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  submission_channel  TEXT          NOT NULL DEFAULT 'virtual_store'
                        CHECK (submission_channel IN ('virtual_store','email','physical','other')),
  reference_number    TEXT,
  submitted_date      DATE          NOT NULL,
  deadline            DATE,
  total_cse_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_cse_amount >= 0),
  item_count          INTEGER       NOT NULL DEFAULT 0 CHECK (item_count >= 0),

  status              TEXT          NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('draft','submitted','acknowledged','returned')),
  acknowledged_date   DATE,

  document_url        TEXT,
  remarks             TEXT,

  submitted_by        UUID          REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          UUID          REFERENCES auth.users(id),

  UNIQUE (app_version_id, submission_channel)
);

COMMENT ON TABLE procurements.app_cse_submissions IS
  'Evidence that the APP-CSE was filed with DBM-PS for a given APP version.';

CREATE INDEX idx_cse_sub_division    ON procurements.app_cse_submissions(division_id);
CREATE INDEX idx_cse_sub_app         ON procurements.app_cse_submissions(app_id);
CREATE INDEX idx_cse_sub_fiscal_year ON procurements.app_cse_submissions(fiscal_year_id);
CREATE INDEX idx_cse_sub_deleted     ON procurements.app_cse_submissions(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_cse_sub_updated_at
  BEFORE UPDATE ON procurements.app_cse_submissions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_cse_sub_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.app_cse_submissions
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- What the CSE portion of each APP version actually contains.
-- ============================================================

CREATE OR REPLACE VIEW procurements.v_app_cse_summary AS
SELECT
  a.id                                          AS app_id,
  a.division_id,
  a.fiscal_year_id,
  av.id                                         AS app_version_id,
  av.version_number,
  COUNT(*) FILTER (WHERE ai.is_cse)             AS cse_item_count,
  COALESCE(SUM(ai.estimated_budget) FILTER (WHERE ai.is_cse), 0)     AS cse_total,
  COUNT(*) FILTER (WHERE NOT ai.is_cse)         AS non_cse_item_count,
  COALESCE(SUM(ai.estimated_budget) FILTER (WHERE NOT ai.is_cse), 0) AS non_cse_total,
  s.id                                          AS submission_id,
  s.submitted_date,
  s.status                                      AS submission_status
FROM procurements.apps a
JOIN procurements.app_versions av ON av.app_id = a.id
LEFT JOIN procurements.app_items ai
       ON ai.app_version_id = av.id AND ai.deleted_at IS NULL
LEFT JOIN procurements.app_cse_submissions s
       ON s.app_version_id = av.id
      AND s.submission_channel = 'virtual_store'
      AND s.deleted_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.division_id, a.fiscal_year_id, av.id, av.version_number,
         s.id, s.submitted_date, s.status;

GRANT SELECT ON procurements.v_app_cse_summary TO authenticated;

-- ============================================================
-- record_cse_submission
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.record_cse_submission(
  p_app_id         UUID,
  p_submitted_date DATE,
  p_reference      TEXT DEFAULT NULL,
  p_channel        TEXT DEFAULT 'virtual_store',
  p_deadline       DATE DEFAULT NULL,
  p_remarks        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app        RECORD;
  v_version_id UUID;
  v_total      NUMERIC(15,2);
  v_count      INTEGER;
  v_id         UUID;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.cse_submit') THEN
    RAISE EXCEPTION 'Insufficient permissions to record an APP-CSE submission';
  END IF;

  IF v_app.status NOT IN ('final','approved','posted') THEN
    RAISE EXCEPTION
      'The APP-CSE can only be submitted from a final or approved APP (current: %).',
      v_app.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status IN ('final','approved')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No final or approved version found for APP %', p_app_id;
  END IF;

  -- Compute the CSE figures rather than trusting a caller-supplied total.
  SELECT COALESCE(SUM(estimated_budget), 0), COUNT(*)
    INTO v_total, v_count
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND is_cse = true;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'This APP version has no items flagged as CSE. Classify the common-use supplies first.';
  END IF;

  INSERT INTO procurements.app_cse_submissions (
    division_id, app_id, app_version_id, fiscal_year_id,
    submission_channel, reference_number, submitted_date, deadline,
    total_cse_amount, item_count, remarks, submitted_by, created_by
  ) VALUES (
    v_app.division_id, p_app_id, v_version_id, v_app.fiscal_year_id,
    p_channel, NULLIF(TRIM(COALESCE(p_reference, '')), ''), p_submitted_date, p_deadline,
    v_total, v_count, p_remarks, auth.uid(), auth.uid()
  )
  ON CONFLICT (app_version_id, submission_channel) DO UPDATE
    SET reference_number = EXCLUDED.reference_number,
        submitted_date   = EXCLUDED.submitted_date,
        deadline         = EXCLUDED.deadline,
        total_cse_amount = EXCLUDED.total_cse_amount,
        item_count       = EXCLUDED.item_count,
        remarks          = EXCLUDED.remarks,
        status           = 'submitted',
        deleted_at       = NULL,
        updated_at       = NOW()
  RETURNING id INTO v_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app', p_app_id, 'APP-CSE Submission', 9,
    'noted', auth.uid(),
    'APP-CSE submitted via ' || p_channel || ' on ' || p_submitted_date::TEXT
      || ' — ' || v_count || ' items, total ' || v_total
  );

  RETURN v_id;
END;
$$;

-- ============================================================
-- Permissions + RLS
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.cse_submit', 'planning', 'Record APP-CSE submissions to DBM-PS', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_secretariat','supply_officer','division_admin')
  AND p.code IN ('app.cse_submit')
ON CONFLICT DO NOTHING;

ALTER TABLE procurements.app_cse_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_cse_submissions" ON procurements.app_cse_submissions
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_cse_submissions" ON procurements.app_cse_submissions
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (procurements.has_permission('app.cse_submit') OR platform.is_super_admin())
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('app.cse_submit')
    AND procurements.is_division_active()
  );
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260903_app_cse_submission`

- [ ] **Step 5: Add types and the server action**

In `src/types/database.ts` add an `AppCseSubmission` interface mirroring the columns above (all `NUMERIC` fields typed `string`). In `src/lib/schemas/app.ts`:

```typescript
export const appCseSubmissionSchema = z.object({
  app_id: z.string().uuid(),
  submitted_date: z.string().min(1, "Submission date is required"),
  reference_number: z.string().trim().min(1).nullable().optional(),
  submission_channel: z
    .enum(["virtual_store", "email", "physical", "other"])
    .default("virtual_store"),
  deadline: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type AppCseSubmissionInput = z.infer<typeof appCseSubmissionSchema>
```

Add `recordCseSubmission` to `src/lib/actions/app.ts` mapping each field to its `p_` parameter, following the `postApp` shape from Task 1.

- [ ] **Step 6: Surface the CSE split in the APP dashboard**

In `src/components/planning/app-status-dashboard.tsx`, read `v_app_cse_summary` and show CSE vs non-CSE totals and item counts, plus the submission status and date (or "Not submitted" with the deadline if one is set).

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903_app_cse_submission.sql supabase/verify/20260903_app_cse_submission.sql src/types/database.ts src/lib/schemas/app.ts src/lib/actions/app.ts src/components/planning/app-status-dashboard.tsx
git commit -m "feat(app): track APP-CSE submissions to DBM-PS

Adds app_cse_submissions plus record_cse_submission(), which computes the
CSE total and item count from the APP itself rather than trusting a
caller-supplied figure, and a v_app_cse_summary view for the CSE /
non-CSE split.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Contracts for infrastructure and consulting

**Depends on:** nothing.

**Files:**
- Create: `supabase/migrations/20260904_contracts.sql`
- Create: `supabase/verify/20260904_contracts.sql`

**Interfaces:**
- Produces: tables `procurements.contracts`, `procurements.contract_variations`; functions `procurements.create_contract(...)`, `procurements.issue_notice_to_proceed(p_contract_id UUID, p_ntp_date DATE)`, `procurements.approve_contract_variation(p_variation_id UUID)`; permissions `contract.manage`, `contract.approve_variation`.

**Context:** contract signing is currently only a *stage* on `procurement_activities` with document uploads (`20260426_procurement_document_uploads.sql`). That is adequate for goods, where the PO is the contract. It is not adequate for infrastructure or consulting, which need contract effectivity, NTP date, completion tracking, variation orders (with the cumulative limit that governs them), and liquidated damages.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260904_contracts.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'contracts'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.contracts missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'contract_variations'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.contract_variations missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'issue_notice_to_proceed'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: issue_notice_to_proceed() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements'
       AND c.relname IN ('contracts','contract_variations')
       AND c.relrowsecurity
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on both contract tables';
  END IF;
END $$;

SELECT 'PASS: 20260904_contracts' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurements.contracts missing`

- [ ] **Step 3: Check the variation-order ceiling before hardcoding it**

The cumulative variation-order limit is a policy figure, not something to guess. Check whether the repo already models procurement thresholds:

Run: `grep -rn "variation\|threshold\|ceiling" supabase/migrations/20260415_ngpa_thresholds_publication.sql | head -20`

If `procurement_method_ceilings` (or similar) is the established place for policy figures, store the variation limit there rather than as a literal in a CHECK constraint. Report to the user which approach you took and confirm the percentage with them — do not invent it.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260904_contracts.sql`:

```sql
-- ============================================================
-- Contracts.
--
-- For goods the PO is the contract and procurement_activities carries
-- enough. Infrastructure and consulting need effectivity dates, an NTP,
-- completion tracking, variation orders against a cumulative limit, and
-- liquidated damages.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.contracts (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id             UUID          NOT NULL REFERENCES platform.divisions(id),
  contract_number         TEXT          NOT NULL,
  procurement_id          UUID          NOT NULL REFERENCES procurements.procurement_activities(id),
  supplier_id             UUID          NOT NULL REFERENCES procurements.suppliers(id),
  office_id               UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id          UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  purchase_order_id       UUID          REFERENCES procurements.purchase_orders(id),

  contract_type           TEXT          NOT NULL
                            CHECK (contract_type IN ('goods','infrastructure','consulting_services')),

  original_amount         NUMERIC(15,2) NOT NULL CHECK (original_amount > 0),
  variation_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- Maintained by trigger from approved contract_variations.
  revised_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,

  signed_date              DATE,
  effectivity_date         DATE,
  ntp_date                 DATE,
  contract_duration_days   INTEGER      CHECK (contract_duration_days IS NULL OR contract_duration_days > 0),
  target_completion_date   DATE,
  actual_completion_date   DATE,

  liquidated_damages       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (liquidated_damages >= 0),
  retention_amount         NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (retention_amount >= 0),

  status                  TEXT          NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','signed','ntp_issued','in_progress',
                                              'completed','terminated','cancelled')),

  contract_document_url   TEXT,
  ntp_document_url        TEXT,
  remarks                 TEXT,

  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by              UUID          REFERENCES auth.users(id),

  UNIQUE (division_id, contract_number)
);

COMMENT ON TABLE procurements.contracts IS
  'Contract record for infrastructure and consulting. Goods procurement may use this or rely on the PO alone.';

CREATE INDEX idx_contracts_division    ON procurements.contracts(division_id);
CREATE INDEX idx_contracts_procurement ON procurements.contracts(procurement_id);
CREATE INDEX idx_contracts_supplier    ON procurements.contracts(supplier_id);
CREATE INDEX idx_contracts_status      ON procurements.contracts(status);
CREATE INDEX idx_contracts_deleted     ON procurements.contracts(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- Variation orders
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.contract_variations (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID          NOT NULL REFERENCES platform.divisions(id),
  contract_id         UUID          NOT NULL REFERENCES procurements.contracts(id) ON DELETE CASCADE,
  variation_number    INTEGER       NOT NULL,

  variation_type      TEXT          NOT NULL
                        CHECK (variation_type IN ('change_order','extra_work','time_extension')),
  amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  time_extension_days INTEGER       NOT NULL DEFAULT 0 CHECK (time_extension_days >= 0),
  justification       TEXT          NOT NULL,

  status              TEXT          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by         UUID          REFERENCES auth.users(id),
  approved_at         TIMESTAMPTZ,
  rejection_reason    TEXT,

  document_url        TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          UUID          REFERENCES auth.users(id),

  UNIQUE (contract_id, variation_number)
);

CREATE INDEX idx_variations_contract ON procurements.contract_variations(contract_id);
CREATE INDEX idx_variations_status   ON procurements.contract_variations(status);

CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON procurements.contracts
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_variations_updated_at
  BEFORE UPDATE ON procurements.contract_variations
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_contracts_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.contracts
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_variations_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.contract_variations
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Keep revised_amount derived from approved variations.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_contract_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_contract_id UUID;
  v_variation   NUMERIC(15,2);
BEGIN
  v_contract_id := COALESCE(NEW.contract_id, OLD.contract_id);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_variation
    FROM procurements.contract_variations
   WHERE contract_id = v_contract_id
     AND status      = 'approved'
     AND deleted_at  IS NULL;

  UPDATE procurements.contracts
     SET variation_amount = v_variation,
         revised_amount   = original_amount + v_variation,
         updated_at       = NOW()
   WHERE id = v_contract_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_recalc_contract_amount
  AFTER INSERT OR UPDATE OF status, amount OR DELETE
  ON procurements.contract_variations
  FOR EACH ROW EXECUTE FUNCTION procurements.recalc_contract_amount();

-- Set revised_amount = original_amount on insert.
CREATE OR REPLACE FUNCTION procurements.init_contract_revised_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.revised_amount = 0 THEN
    NEW.revised_amount := NEW.original_amount;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_init_contract_revised_amount
  BEFORE INSERT ON procurements.contracts
  FOR EACH ROW EXECUTE FUNCTION procurements.init_contract_revised_amount();

-- ============================================================
-- issue_notice_to_proceed
--
-- The NTP is the point at which the supplier may start. It carries the
-- same absolute rule as contract signing: no appropriation, no NTP.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.issue_notice_to_proceed(
  p_contract_id UUID,
  p_ntp_date    DATE DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_contract RECORD;
  v_ntp      DATE;
BEGIN
  v_ntp := COALESCE(p_ntp_date, CURRENT_DATE);

  SELECT * INTO v_contract
    FROM procurements.contracts
   WHERE id          = p_contract_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % not found or access denied', p_contract_id;
  END IF;

  IF NOT procurements.has_permission('contract.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to issue a Notice to Proceed';
  END IF;

  IF v_contract.status <> 'signed' THEN
    RAISE EXCEPTION
      'A Notice to Proceed can only be issued on a signed contract (current: %).',
      v_contract.status;
  END IF;

  -- Same hard gate as contract signing in the companion plan.
  IF NOT procurements.appropriation_exists(v_contract.fiscal_year_id) THEN
    RAISE EXCEPTION
      'Cannot issue a Notice to Proceed: no GAA or release-stage budget ceiling is '
      'recorded for this fiscal year.';
  END IF;

  UPDATE procurements.contracts
     SET status                 = 'ntp_issued',
         ntp_date               = v_ntp,
         target_completion_date = CASE
           WHEN contract_duration_days IS NOT NULL
           THEN v_ntp + contract_duration_days
           ELSE target_completion_date
         END,
         updated_at             = NOW()
   WHERE id = p_contract_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks, office_id
  ) VALUES (
    'contract', p_contract_id, 'Notice to Proceed', 2,
    'approved', auth.uid(),
    'NTP issued effective ' || v_ntp::TEXT, v_contract.office_id
  );
END;
$$;

-- ============================================================
-- approve_contract_variation
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.approve_contract_variation(
  p_variation_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_var      RECORD;
  v_contract RECORD;
  v_new_cum  NUMERIC(15,2);
  v_pct      NUMERIC(6,2);
BEGIN
  SELECT * INTO v_var
    FROM procurements.contract_variations
   WHERE id          = p_variation_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variation % not found or access denied', p_variation_id;
  END IF;

  IF NOT procurements.has_permission('contract.approve_variation') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve a contract variation';
  END IF;

  IF v_var.status <> 'pending' THEN
    RAISE EXCEPTION 'Variation % is already %', p_variation_id, v_var.status;
  END IF;

  SELECT * INTO v_contract
    FROM procurements.contracts
   WHERE id = v_var.contract_id;

  -- Cumulative variation check. The percentage lives in system_settings
  -- so it can be updated without a migration when policy changes.
  v_new_cum := v_contract.variation_amount + v_var.amount;
  v_pct := ROUND(100.0 * v_new_cum / v_contract.original_amount, 2);

  IF v_pct > COALESCE(
       (SELECT value::NUMERIC FROM procurements.system_settings
         WHERE key = 'contract.max_cumulative_variation_pct'),
       10.00
     ) THEN
    RAISE EXCEPTION
      'Approving this variation would take cumulative variations to %%% of the original '
      'contract amount, above the configured limit. Record the policy basis and raise '
      'contract.max_cumulative_variation_pct in system settings if this is authorised.',
      v_pct;
  END IF;

  UPDATE procurements.contract_variations
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_variation_id;

  -- Extend the schedule when the variation grants time.
  IF v_var.time_extension_days > 0 THEN
    UPDATE procurements.contracts
       SET contract_duration_days = COALESCE(contract_duration_days, 0) + v_var.time_extension_days,
           target_completion_date = COALESCE(target_completion_date, ntp_date)
                                    + v_var.time_extension_days,
           updated_at             = NOW()
     WHERE id = v_var.contract_id;
  END IF;
END;
$$;

-- ============================================================
-- Permissions + RLS
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('contract.view',              'procurement', 'View contracts',                       'division'),
  ('contract.manage',            'procurement', 'Create contracts and issue NTPs',      'division'),
  ('contract.approve_variation', 'procurement', 'Approve contract variation orders',    'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_secretariat','bac_chair','division_admin')
  AND p.code IN ('contract.view','contract.manage')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_admin')
  AND p.code IN ('contract.approve_variation')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('auditor','accountant','division_chief','supply_officer')
  AND p.code IN ('contract.view')
ON CONFLICT DO NOTHING;

ALTER TABLE procurements.contracts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.contract_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_contracts" ON procurements.contracts
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_contracts" ON procurements.contracts
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (procurements.has_permission('contract.manage') OR platform.is_super_admin())
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('contract.manage')
    AND procurements.is_division_active()
  );

CREATE POLICY "division_read_variations" ON procurements.contract_variations
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_variations" ON procurements.contract_variations
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('contract.manage')
      OR procurements.has_permission('contract.approve_variation')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('contract.manage')
    AND procurements.is_division_active()
  );

-- Default policy figure; adjust in system settings, not in code.
INSERT INTO procurements.system_settings (key, value, description)
VALUES ('contract.max_cumulative_variation_pct', '10.00',
        'Maximum cumulative variation orders as a percentage of the original contract amount. Verify against current GPPB policy.')
ON CONFLICT (key) DO NOTHING;
```

> **Implementer note:** confirm `procurements.system_settings` has `(key, value, description)` columns and a unique constraint on `key` before relying on that final INSERT — check `20240308_system_settings.sql`. If the shape differs, adjust the INSERT and the `SELECT value::NUMERIC` lookup to match. `appropriation_exists()` comes from the companion plan Task 12; if that plan has not been applied, replace the NTP gate with a `TRUE` placeholder **and tell the user explicitly** that the NTP appropriation gate is inert until the companion plan lands.

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260904_contracts`

- [ ] **Step 6: Add types, schema, actions, and page**

Add `Contract` and `ContractVariation` row types to `src/types/database.ts`. Add `contractSchema` and `contractVariationSchema` to `src/lib/schemas/procurement.ts`. Add `createContract`, `issueNoticeToProceed`, `createContractVariation`, `approveContractVariation` to `src/lib/actions/procurement.ts`. Create `src/app/dashboard/procurement/contracts/page.tsx` using the shared `DataTable` (`src/components/shared/data-table.tsx`) with columns for contract number, supplier, type, original/revised amount, status, and target completion.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260904_contracts.sql supabase/verify/20260904_contracts.sql src/types/database.ts src/lib/schemas/procurement.ts src/lib/actions/procurement.ts src/app/dashboard/procurement/contracts/
git commit -m "feat(procurement): add contracts and variation orders

Adds contracts and contract_variations with a trigger-derived
revised_amount, issue_notice_to_proceed() carrying the same
appropriation gate as contract signing, and a cumulative variation limit
read from system_settings rather than hardcoded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Disbursement vouchers and payments

**Depends on:** nothing.

**Files:**
- Create: `supabase/migrations/20260905_disbursement_vouchers.sql`
- Create: `supabase/verify/20260905_disbursement_vouchers.sql`

**Interfaces:**
- Produces: tables `procurements.disbursement_vouchers`, `procurements.dv_items`, `procurements.payments`; functions `procurements.create_disbursement_voucher(...)`, `procurements.certify_disbursement_voucher(p_dv_id UUID, p_notes TEXT)`, `procurements.approve_disbursement_voucher(p_dv_id UUID, p_notes TEXT)`, `procurements.record_payment(p_dv_id UUID, p_amount NUMERIC, p_mode TEXT, p_reference TEXT, p_payment_date DATE) RETURNS UUID`; permissions `dv.create`, `dv.certify`, `dv.approve`, `payment.record`.

**Context:** `budget_allocations.disbursed_amount` exists with a `disbursed <= obligated` CHECK (`20240406_budget_allocations.sql:15,33`), is read by three report RPCs and two dashboards — and **is written by nothing** except seed data. Every utilization report shows ₱0 disbursed. The `accountant` role is seeded with the description "Certifies disbursements, financial reports" (`20240303_roles_seed.sql:31`) and has nothing to act on. This task closes the chain: delivery → inspection → DV → payment → `disbursed_amount`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260905_disbursement_vouchers.sql`:

```sql
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['disbursement_vouchers','dv_items','payments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'procurements' AND table_name = v_tbl
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: procurements.% missing', v_tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'procurements' AND c.relname = v_tbl AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on %', v_tbl;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'record_payment'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: record_payment() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payment_sync_disbursed'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_payment_sync_disbursed missing';
  END IF;
END $$;

SELECT 'PASS: 20260905_disbursement_vouchers' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurements.disbursement_vouchers missing`

- [ ] **Step 3: Confirm the sequence-number helper signature**

Document numbers elsewhere use a shared generator. Confirm before calling it:

Run: `grep -n -A 20 "FUNCTION procurements.generate_sequence_number" supabase/migrations/20240313_rpc_functions.sql | head -30`

Also look at `generate_obr_number` (`20260408_procurement_rpc.sql`) as the closest precedent for a finance document number, and follow its pattern exactly rather than inventing a new one.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260905_disbursement_vouchers.sql`:

```sql
-- ============================================================
-- Disbursement vouchers and payments.
--
-- This closes the last gap in the budget chain. Previously:
--   ceiling -> allotment -> allocation -> PPMP -> APP -> PR ->
--   OBR (obligated_amount debited) -> procurement -> award -> PO ->
--   delivery -> inspection -> [nothing]
--
-- disbursed_amount was read by reports but written by no code path, so
-- every utilization figure showed zero disbursement.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.disbursement_vouchers (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id            UUID          NOT NULL REFERENCES platform.divisions(id),
  dv_number              TEXT          NOT NULL,
  office_id              UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id         UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  -- What is being paid for. A DV normally follows one PO/delivery.
  purchase_order_id      UUID          REFERENCES procurements.purchase_orders(id),
  contract_id            UUID          REFERENCES procurements.contracts(id),
  delivery_id            UUID          REFERENCES procurements.deliveries(id),
  obligation_request_id  UUID          REFERENCES procurements.obligation_requests(id),
  budget_allocation_id   UUID          REFERENCES procurements.budget_allocations(id),
  supplier_id            UUID          NOT NULL REFERENCES procurements.suppliers(id),

  gross_amount           NUMERIC(15,2) NOT NULL CHECK (gross_amount > 0),
  -- Statutory deductions. Rates are policy, so amounts are entered and
  -- validated here rather than computed from a hardcoded percentage.
  tax_withheld           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_withheld >= 0),
  retention_withheld     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (retention_withheld >= 0),
  liquidated_damages     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (liquidated_damages >= 0),
  other_deductions       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  net_amount             NUMERIC(15,2) GENERATED ALWAYS AS
                           (gross_amount - tax_withheld - retention_withheld
                            - liquidated_damages - other_deductions) STORED,

  particulars            TEXT          NOT NULL,

  status                 TEXT          NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','certified','approved',
                                             'paid','partially_paid','cancelled')),

  certified_by           UUID          REFERENCES auth.users(id),
  certified_at           TIMESTAMPTZ,
  certification_notes    TEXT,
  approved_by            UUID          REFERENCES auth.users(id),
  approved_at            TIMESTAMPTZ,
  approval_notes         TEXT,
  cancellation_reason    TEXT,
  cancelled_by           UUID          REFERENCES auth.users(id),
  cancelled_at           TIMESTAMPTZ,

  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by             UUID          REFERENCES auth.users(id),

  UNIQUE (division_id, dv_number)
);

-- Deductions can never exceed the gross.
ALTER TABLE procurements.disbursement_vouchers
  ADD CONSTRAINT chk_dv_net_non_negative
  CHECK (gross_amount - tax_withheld - retention_withheld
         - liquidated_damages - other_deductions >= 0);

COMMENT ON TABLE procurements.disbursement_vouchers IS
  'Disbursement voucher: the Accountant certifies, the HOPE approves, then payments are recorded against it.';

CREATE INDEX idx_dv_division    ON procurements.disbursement_vouchers(division_id);
CREATE INDEX idx_dv_office      ON procurements.disbursement_vouchers(office_id);
CREATE INDEX idx_dv_po          ON procurements.disbursement_vouchers(purchase_order_id);
CREATE INDEX idx_dv_status      ON procurements.disbursement_vouchers(status);
CREATE INDEX idx_dv_allocation  ON procurements.disbursement_vouchers(budget_allocation_id);
CREATE INDEX idx_dv_deleted     ON procurements.disbursement_vouchers(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- DV line items
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.dv_items (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_voucher_id   UUID          NOT NULL REFERENCES procurements.disbursement_vouchers(id) ON DELETE CASCADE,
  po_item_id                UUID          REFERENCES procurements.po_items(id),
  item_number               INTEGER       NOT NULL,
  description               TEXT          NOT NULL,
  unit                      TEXT,
  quantity                  NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  unit_cost                 NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost                NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  account_code_id           UUID          REFERENCES procurements.account_codes(id),
  remarks                   TEXT,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (disbursement_voucher_id, item_number)
);

CREATE INDEX idx_dv_items_dv ON procurements.dv_items(disbursement_voucher_id);

-- ============================================================
-- Payments
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.payments (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id              UUID          NOT NULL REFERENCES platform.divisions(id),
  payment_number           TEXT          NOT NULL,
  disbursement_voucher_id  UUID          NOT NULL REFERENCES procurements.disbursement_vouchers(id),
  budget_allocation_id     UUID          REFERENCES procurements.budget_allocations(id),

  amount                   NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_mode             TEXT          NOT NULL
                             CHECK (payment_mode IN ('check','ada','lddap','cash','bank_transfer')),
  reference_number         TEXT,
  payment_date             DATE          NOT NULL,

  status                   TEXT          NOT NULL DEFAULT 'issued'
                             CHECK (status IN ('issued','cleared','cancelled')),
  cleared_date             DATE,
  cancellation_reason      TEXT,

  remarks                  TEXT,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by               UUID          REFERENCES auth.users(id),

  UNIQUE (division_id, payment_number)
);

CREATE INDEX idx_payments_division   ON procurements.payments(division_id);
CREATE INDEX idx_payments_dv         ON procurements.payments(disbursement_voucher_id);
CREATE INDEX idx_payments_allocation ON procurements.payments(budget_allocation_id);
CREATE INDEX idx_payments_status     ON procurements.payments(status);
CREATE INDEX idx_payments_deleted    ON procurements.payments(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_dv_updated_at
  BEFORE UPDATE ON procurements.disbursement_vouchers
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_dv_items_updated_at
  BEFORE UPDATE ON procurements.dv_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON procurements.payments
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_dv_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.disbursement_vouchers
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_dv_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.dv_items
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.payments
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- The point of the whole task: payments move disbursed_amount.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_payment_to_disbursed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_alloc_id UUID;
  v_delta    NUMERIC(15,2) := 0;
BEGIN
  v_alloc_id := COALESCE(NEW.budget_allocation_id, OLD.budget_allocation_id);

  IF v_alloc_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'cancelled' THEN
      v_delta := NEW.amount;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'cancelled' THEN
      v_delta := -OLD.amount;
    END IF;

  ELSE -- UPDATE
    v_delta :=
      (CASE WHEN NEW.status <> 'cancelled' THEN NEW.amount ELSE 0 END)
      - (CASE WHEN OLD.status <> 'cancelled' THEN OLD.amount ELSE 0 END);
  END IF;

  IF v_delta = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE procurements.budget_allocations
     SET disbursed_amount = GREATEST(0, disbursed_amount + v_delta),
         updated_at       = NOW()
   WHERE id = v_alloc_id
     AND deleted_at IS NULL;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION procurements.sync_payment_to_disbursed() IS
  'Maintains budget_allocations.disbursed_amount from payments. The disbursed <= obligated CHECK will reject an over-disbursement, which is the intended safety net.';

CREATE TRIGGER trg_payment_sync_disbursed
  AFTER INSERT OR UPDATE OF amount, status, budget_allocation_id OR DELETE
  ON procurements.payments
  FOR EACH ROW EXECUTE FUNCTION procurements.sync_payment_to_disbursed();

-- ============================================================
-- Keep the DV status in step with what has been paid.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_dv_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_dv_id UUID;
  v_paid  NUMERIC(15,2);
  v_net   NUMERIC(15,2);
BEGIN
  v_dv_id := COALESCE(NEW.disbursement_voucher_id, OLD.disbursement_voucher_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM procurements.payments
   WHERE disbursement_voucher_id = v_dv_id
     AND status     <> 'cancelled'
     AND deleted_at IS NULL;

  SELECT net_amount INTO v_net
    FROM procurements.disbursement_vouchers
   WHERE id = v_dv_id;

  UPDATE procurements.disbursement_vouchers
     SET status = CASE
           WHEN status = 'cancelled' THEN 'cancelled'
           WHEN v_paid >= v_net AND v_net > 0 THEN 'paid'
           WHEN v_paid > 0 THEN 'partially_paid'
           ELSE status
         END,
         updated_at = NOW()
   WHERE id = v_dv_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_sync_dv_payment_status
  AFTER INSERT OR UPDATE OF amount, status OR DELETE ON procurements.payments
  FOR EACH ROW EXECUTE FUNCTION procurements.sync_dv_payment_status();

-- ============================================================
-- Workflow RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.certify_disbursement_voucher(
  p_dv_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_dv RECORD;
BEGIN
  SELECT * INTO v_dv
    FROM procurements.disbursement_vouchers
   WHERE id          = p_dv_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disbursement voucher % not found or access denied', p_dv_id;
  END IF;

  IF NOT procurements.has_permission('dv.certify') THEN
    RAISE EXCEPTION 'Insufficient permissions to certify a disbursement voucher';
  END IF;

  IF v_dv.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft DV can be certified (current: %).', v_dv.status;
  END IF;

  -- A DV must not exceed what was obligated for it.
  IF v_dv.obligation_request_id IS NOT NULL THEN
    IF v_dv.gross_amount > (
      SELECT COALESCE(adjusted_amount, amount)
        FROM procurements.obligation_requests
       WHERE id = v_dv.obligation_request_id
    ) THEN
      RAISE EXCEPTION
        'DV gross amount exceeds the obligated amount for its OBR. '
        'A supplemental obligation must be certified first.';
    END IF;
  END IF;

  UPDATE procurements.disbursement_vouchers
     SET status              = 'certified',
         certified_by        = auth.uid(),
         certified_at        = NOW(),
         certification_notes = p_notes,
         updated_at          = NOW()
   WHERE id = p_dv_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks, office_id
  ) VALUES (
    'disbursement_voucher', p_dv_id, 'Accountant Certification', 1,
    'approved', auth.uid(), p_notes, v_dv.office_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION procurements.approve_disbursement_voucher(
  p_dv_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_dv RECORD;
BEGIN
  SELECT * INTO v_dv
    FROM procurements.disbursement_vouchers
   WHERE id          = p_dv_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disbursement voucher % not found or access denied', p_dv_id;
  END IF;

  IF NOT procurements.has_permission('dv.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve a disbursement voucher';
  END IF;

  IF v_dv.status <> 'certified' THEN
    RAISE EXCEPTION
      'A DV must be certified by the Accountant before approval (current: %).', v_dv.status;
  END IF;

  UPDATE procurements.disbursement_vouchers
     SET status         = 'approved',
         approved_by    = auth.uid(),
         approved_at    = NOW(),
         approval_notes = p_notes,
         updated_at     = NOW()
   WHERE id = p_dv_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks, office_id
  ) VALUES (
    'disbursement_voucher', p_dv_id, 'HOPE Approval', 2,
    'approved', auth.uid(), p_notes, v_dv.office_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION procurements.record_payment(
  p_dv_id        UUID,
  p_amount       NUMERIC(15,2),
  p_mode         TEXT,
  p_reference    TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_dv         RECORD;
  v_paid       NUMERIC(15,2);
  v_payment_id UUID;
  v_number     TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_dv
    FROM procurements.disbursement_vouchers
   WHERE id          = p_dv_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disbursement voucher % not found or access denied', p_dv_id;
  END IF;

  IF NOT procurements.has_permission('payment.record') THEN
    RAISE EXCEPTION 'Insufficient permissions to record a payment';
  END IF;

  IF v_dv.status NOT IN ('approved','partially_paid') THEN
    RAISE EXCEPTION
      'Payments can only be recorded against an approved DV (current: %).', v_dv.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM procurements.payments
   WHERE disbursement_voucher_id = p_dv_id
     AND status     <> 'cancelled'
     AND deleted_at IS NULL;

  IF v_paid + p_amount > v_dv.net_amount THEN
    RAISE EXCEPTION
      'Payment of % would take total payments to % against a net DV amount of %.',
      p_amount, v_paid + p_amount, v_dv.net_amount;
  END IF;

  -- Follow the existing document-number pattern; see generate_obr_number.
  v_number := 'PAY-' || TO_CHAR(NOW(), 'YYYYMM') || '-'
              || LPAD((
                   SELECT COUNT(*) + 1
                     FROM procurements.payments
                    WHERE division_id = v_dv.division_id
                 )::TEXT, 5, '0');

  INSERT INTO procurements.payments (
    division_id, payment_number, disbursement_voucher_id, budget_allocation_id,
    amount, payment_mode, reference_number, payment_date, created_by
  ) VALUES (
    v_dv.division_id, v_number, p_dv_id, v_dv.budget_allocation_id,
    p_amount, p_mode, NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(p_payment_date, CURRENT_DATE), auth.uid()
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

-- ============================================================
-- Permissions + RLS
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('dv.view',        'budget', 'View disbursement vouchers',                'division'),
  ('dv.create',      'budget', 'Prepare disbursement vouchers',             'division'),
  ('dv.certify',     'budget', 'Certify disbursement vouchers (Accountant)','division'),
  ('dv.approve',     'budget', 'Approve disbursement vouchers (HOPE)',      'division'),
  ('payment.record', 'budget', 'Record payments against approved DVs',      'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('accountant','division_admin')
  AND p.code IN ('dv.view','dv.create','dv.certify','payment.record')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_admin')
  AND p.code IN ('dv.view','dv.approve')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('budget_officer','auditor','division_chief')
  AND p.code IN ('dv.view')
ON CONFLICT DO NOTHING;

ALTER TABLE procurements.disbursement_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.dv_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.payments              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_dv" ON procurements.disbursement_vouchers
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('dv.view')
  );

CREATE POLICY "manage_dv" ON procurements.disbursement_vouchers
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('dv.create')
      OR procurements.has_permission('dv.certify')
      OR procurements.has_permission('dv.approve')
      OR platform.is_super_admin()
    )
    -- Certified and approved DVs are not directly editable.
    AND status IN ('draft','certified')
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.is_division_active()
  );

CREATE POLICY "division_read_dv_items" ON procurements.dv_items
  FOR SELECT TO authenticated
  USING (
    disbursement_voucher_id IN (
      SELECT id FROM procurements.disbursement_vouchers
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
    )
  );

CREATE POLICY "manage_dv_items" ON procurements.dv_items
  FOR ALL TO authenticated
  USING (
    disbursement_voucher_id IN (
      SELECT id FROM procurements.disbursement_vouchers
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
         AND status = 'draft'
    )
    AND procurements.has_permission('dv.create')
  );

CREATE POLICY "division_read_payments" ON procurements.payments
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('dv.view')
  );

CREATE POLICY "manage_payments" ON procurements.payments
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (procurements.has_permission('payment.record') OR platform.is_super_admin())
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('payment.record')
    AND procurements.is_division_active()
  );
```

> **Implementer note:** the payment-number generator above counts rows, which races under concurrency. Before finalising, replace it with a call to the repo's existing `procurements.generate_sequence_number()` (verified in Step 3), which uses the `sequence_counters` table with proper locking. Do not ship the counting version.

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260905_disbursement_vouchers`

- [ ] **Step 6: Ask the user to verify the chain end to end in dev**

```sql
-- After creating a DV and approving it, record a payment and confirm
-- disbursed_amount actually moved.
SELECT ba.id,
       ba.obligated_amount,
       ba.disbursed_amount
  FROM procurements.budget_allocations ba
 WHERE ba.id = '<allocation-id>';

SELECT procurements.record_payment('<dv-id>', 50000.00, 'lddap', 'LDDAP-001', CURRENT_DATE);

SELECT ba.obligated_amount, ba.disbursed_amount
  FROM procurements.budget_allocations ba
 WHERE ba.id = '<allocation-id>';
```

`disbursed_amount` must increase by exactly 50000.00. Then try recording a payment that would exceed `obligated_amount` and confirm the `chk_disbursed_lte_obligated` CHECK rejects it — that constraint has never been exercised before, so confirm it actually fires.

- [ ] **Step 7: Add types, schemas, actions, and the vouchers page**

Add `DisbursementVoucher`, `DvItem`, and `Payment` row types to `src/types/database.ts`. Add `disbursementVoucherSchema`, `dvItemSchema`, `paymentSchema` to `src/lib/schemas/budget.ts`. Add `createDisbursementVoucher`, `certifyDisbursementVoucher`, `approveDisbursementVoucher`, `recordPayment` to `src/lib/actions/budget.ts`.

Create `src/app/dashboard/budget/vouchers/page.tsx` using the shared `DataTable`, and add a "Vouchers" entry to the budget nav group in the sidebar provider.

Update `src/app/dashboard/budget/page.tsx` and `src/app/dashboard/page.tsx` — both currently compute a `disbursed` total that was always zero (`budget/page.tsx:47`, `page.tsx:52`). They need no code change to start working, but confirm the figures now render non-zero.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260905_disbursement_vouchers.sql supabase/verify/20260905_disbursement_vouchers.sql src/types/database.ts src/lib/schemas/budget.ts src/lib/actions/budget.ts src/app/dashboard/budget/
git commit -m "feat(budget): add disbursement vouchers and payments

Closes the budget chain: DV prepared, certified by the Accountant,
approved by the HOPE, then payments recorded against it. A trigger
maintains budget_allocations.disbursed_amount, which until now was read
by every utilization report but written by nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Procurement Monitoring Report (PMR)

**Depends on:** nothing. Reads better after Tasks 4 and 5, since PMR covers contract and payment status.

**Files:**
- Create: `supabase/migrations/20260906_procurement_monitoring_reports.sql`
- Create: `supabase/verify/20260906_procurement_monitoring_reports.sql`

**Interfaces:**
- Produces: table `procurements.procurement_monitoring_reports`; function `procurements.generate_pmr(p_fiscal_year_id UUID, p_period TEXT) RETURNS UUID`; view `procurements.v_pmr_lines`; permission `report.pmr_manage`.

**Context:** GPPB requires periodic procurement monitoring reporting, and no table or report exists. The PMR is essentially a per-APP-line status roll-up: what was planned, what mode was used, what stage it reached, the ABC versus contract amount, and the dates. Every input already exists in `app_items`, `procurement_activities`, `purchase_orders`, and (after Tasks 4–5) `contracts` and `payments`.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260906_procurement_monitoring_reports.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name = 'procurement_monitoring_reports'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurement_monitoring_reports missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'procurements' AND table_name = 'v_pmr_lines'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: view v_pmr_lines missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'generate_pmr'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: generate_pmr() missing';
  END IF;
END $$;

SELECT 'PASS: 20260906_procurement_monitoring_reports' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: procurement_monitoring_reports missing`

- [ ] **Step 3: Confirm the column names this view depends on**

The view joins five tables added at different times. Verify each column exists before writing it:

Run:
```bash
grep -n "purchase_request_id\|contract_amount\|procurement_number\|current_stage\|status" supabase/migrations/20260407_procurement_activity_tables.sql | head -20
```

Adjust the view's column references to match what is actually there. If `procurement_activities` has no `current_stage`, derive the stage from `procurement_stages` instead.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260906_procurement_monitoring_reports.sql`:

```sql
-- ============================================================
-- Procurement Monitoring Report.
--
-- A per-APP-line status roll-up: what was planned, the mode used, the
-- stage reached, ABC versus contract amount, and key dates. Stored as a
-- snapshot so a submitted PMR stays fixed even as the underlying
-- procurement moves on.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.procurement_monitoring_reports (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id      UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  period              TEXT          NOT NULL
                        CHECK (period IN ('1st_semester','2nd_semester',
                                          'q1','q2','q3','q4','annual')),
  period_start        DATE,
  period_end          DATE,

  -- Frozen at generation so a submitted report never shifts.
  report_data         JSONB         NOT NULL DEFAULT '[]'::JSONB,
  total_line_count    INTEGER       NOT NULL DEFAULT 0,
  total_abc           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_contract      NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_savings       NUMERIC(15,2) NOT NULL DEFAULT 0,

  status              TEXT          NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','acknowledged')),
  submitted_date      DATE,
  submitted_by        UUID          REFERENCES auth.users(id),
  reference_number    TEXT,
  document_url        TEXT,
  remarks             TEXT,

  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          UUID          REFERENCES auth.users(id),

  UNIQUE (fiscal_year_id, period)
);

COMMENT ON TABLE procurements.procurement_monitoring_reports IS
  'Periodic procurement monitoring report. report_data is a frozen snapshot taken at generation.';

CREATE INDEX idx_pmr_division    ON procurements.procurement_monitoring_reports(division_id);
CREATE INDEX idx_pmr_fiscal_year ON procurements.procurement_monitoring_reports(fiscal_year_id);
CREATE INDEX idx_pmr_deleted     ON procurements.procurement_monitoring_reports(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_pmr_updated_at
  BEFORE UPDATE ON procurements.procurement_monitoring_reports
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_pmr_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.procurement_monitoring_reports
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- The live PMR line view.
-- ============================================================

CREATE OR REPLACE VIEW procurements.v_pmr_lines AS
SELECT
  a.division_id,
  a.fiscal_year_id,
  ai.id                          AS app_item_id,
  ai.item_number,
  ai.general_description,
  ai.project_type,
  ai.procurement_mode            AS planned_mode,
  ai.is_cse,
  ai.estimated_budget            AS abc,
  al.lot_name,
  al.status                      AS lot_status,
  o.name                         AS end_user_office,
  pa.id                          AS procurement_id,
  pa.contract_amount,
  CASE
    WHEN pa.contract_amount IS NOT NULL AND pa.contract_amount > 0
    THEN ai.estimated_budget - pa.contract_amount
    ELSE 0
  END                            AS savings,
  pr.pr_number,
  po.po_number,
  po.status                      AS po_status,
  d.delivery_date,
  d.inspection_status
FROM procurements.apps a
JOIN procurements.app_versions av
     ON av.app_id = a.id AND av.status = 'approved'
JOIN procurements.app_items ai
     ON ai.app_version_id = av.id AND ai.deleted_at IS NULL
LEFT JOIN procurements.app_lots al       ON al.id = ai.lot_id AND al.deleted_at IS NULL
LEFT JOIN procurements.offices o         ON o.id = ai.source_office_id
LEFT JOIN procurements.pr_items pi       ON pi.app_item_id = ai.id AND pi.deleted_at IS NULL
LEFT JOIN procurements.purchase_requests pr
       ON pr.id = pi.purchase_request_id AND pr.deleted_at IS NULL
LEFT JOIN procurements.procurement_activities pa
       ON pa.purchase_request_id = pr.id
LEFT JOIN procurements.purchase_orders po
       ON po.procurement_id = pa.id AND po.deleted_at IS NULL
LEFT JOIN procurements.deliveries d
       ON d.purchase_order_id = po.id AND d.deleted_at IS NULL
WHERE a.deleted_at IS NULL;

GRANT SELECT ON procurements.v_pmr_lines TO authenticated;

-- ============================================================
-- generate_pmr: freeze the current picture for a period.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.generate_pmr(
  p_fiscal_year_id UUID,
  p_period         TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID;
  v_data        JSONB;
  v_count       INTEGER;
  v_abc         NUMERIC(15,2);
  v_contract    NUMERIC(15,2);
  v_savings     NUMERIC(15,2);
  v_id          UUID;
  v_start       DATE;
  v_end         DATE;
  v_year        INTEGER;
BEGIN
  v_division_id := procurements.get_user_division_id();

  IF NOT procurements.has_permission('report.pmr_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to generate a PMR';
  END IF;

  SELECT year INTO v_year
    FROM procurements.fiscal_years
   WHERE id = p_fiscal_year_id
     AND division_id = v_division_id;

  IF v_year IS NULL THEN
    RAISE EXCEPTION 'Fiscal year % not found or access denied', p_fiscal_year_id;
  END IF;

  -- Period bounds
  SELECT s, e INTO v_start, v_end
    FROM (VALUES
      ('1st_semester', MAKE_DATE(v_year,1,1),  MAKE_DATE(v_year,6,30)),
      ('2nd_semester', MAKE_DATE(v_year,7,1),  MAKE_DATE(v_year,12,31)),
      ('q1',           MAKE_DATE(v_year,1,1),  MAKE_DATE(v_year,3,31)),
      ('q2',           MAKE_DATE(v_year,4,1),  MAKE_DATE(v_year,6,30)),
      ('q3',           MAKE_DATE(v_year,7,1),  MAKE_DATE(v_year,9,30)),
      ('q4',           MAKE_DATE(v_year,10,1), MAKE_DATE(v_year,12,31)),
      ('annual',       MAKE_DATE(v_year,1,1),  MAKE_DATE(v_year,12,31))
    ) AS periods(p, s, e)
   WHERE periods.p = p_period;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Invalid period %', p_period;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(l.*)), '[]'::JSONB),
         COUNT(*),
         COALESCE(SUM(l.abc), 0),
         COALESCE(SUM(l.contract_amount), 0),
         COALESCE(SUM(l.savings), 0)
    INTO v_data, v_count, v_abc, v_contract, v_savings
    FROM procurements.v_pmr_lines l
   WHERE l.division_id    = v_division_id
     AND l.fiscal_year_id = p_fiscal_year_id;

  INSERT INTO procurements.procurement_monitoring_reports (
    division_id, fiscal_year_id, period, period_start, period_end,
    report_data, total_line_count, total_abc, total_contract, total_savings,
    created_by
  ) VALUES (
    v_division_id, p_fiscal_year_id, p_period, v_start, v_end,
    v_data, v_count, v_abc, v_contract, v_savings, auth.uid()
  )
  ON CONFLICT (fiscal_year_id, period) DO UPDATE
    SET report_data      = EXCLUDED.report_data,
        total_line_count = EXCLUDED.total_line_count,
        total_abc        = EXCLUDED.total_abc,
        total_contract   = EXCLUDED.total_contract,
        total_savings    = EXCLUDED.total_savings,
        period_start     = EXCLUDED.period_start,
        period_end       = EXCLUDED.period_end,
        updated_at       = NOW()
  WHERE procurements.procurement_monitoring_reports.status = 'draft'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION
      'A PMR for % % has already been submitted and cannot be regenerated.',
      p_period, v_year;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================
-- Permissions + RLS
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('report.pmr_manage', 'reports',
   'Generate and submit Procurement Monitoring Reports', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_secretariat','bac_chair','division_admin')
  AND p.code IN ('report.pmr_manage')
ON CONFLICT DO NOTHING;

ALTER TABLE procurements.procurement_monitoring_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_pmr" ON procurements.procurement_monitoring_reports
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_pmr" ON procurements.procurement_monitoring_reports
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (procurements.has_permission('report.pmr_manage') OR platform.is_super_admin())
    -- A submitted PMR is frozen.
    AND status = 'draft'
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('report.pmr_manage')
    AND procurements.is_division_active()
  );
```

- [ ] **Step 5: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260906_procurement_monitoring_reports`

- [ ] **Step 6: Ask the user to generate one and sanity-check the totals**

```sql
SELECT procurements.generate_pmr(
  (SELECT id FROM procurements.fiscal_years WHERE is_active = true LIMIT 1),
  '1st_semester'
);

SELECT period, total_line_count, total_abc, total_contract, total_savings
  FROM procurements.procurement_monitoring_reports
 ORDER BY created_at DESC LIMIT 1;
```

`total_abc` should match the APP's `total_approved_cost` for lines that reached procurement. If `total_savings` is negative anywhere, a contract exceeded its ABC — report that to the user, because it should have been blocked upstream.

- [ ] **Step 7: Build the PMR page**

Create `src/app/dashboard/reports/pmr/page.tsx`: period selector, generate action, a `DataTable` over `report_data`, and a CSV export. Add `generatePmr` and `submitPmr` to `src/lib/actions/reports.ts`.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260906_procurement_monitoring_reports.sql supabase/verify/20260906_procurement_monitoring_reports.sql src/lib/actions/reports.ts src/app/dashboard/reports/pmr/
git commit -m "feat(reports): add the Procurement Monitoring Report

Adds v_pmr_lines rolling up APP line to procurement, PO, and delivery
status, plus generate_pmr() which freezes the picture as a JSONB
snapshot so a submitted report stays fixed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Delegated signatories (OIC)

**Depends on:** nothing.

**Files:**
- Create: `supabase/migrations/20260907_document_signatories.sql`
- Create: `supabase/verify/20260907_document_signatories.sql`

**Interfaces:**
- Produces: table `procurements.signatory_designations`; function `procurements.effective_signatory(p_permission_code TEXT, p_as_of DATE) RETURNS UUID`; function `procurements.signing_capacity(p_user_id UUID, p_permission_code TEXT, p_as_of DATE) RETURNS TEXT`; permission `admin.signatories_manage`.

**Context:** every approval field is a single plain FK — `approved_by UUID REFERENCES auth.users(id)`. When the SDS is on leave and an OIC-SDS signs, the system records the OIC as though they were the HOPE, with nothing capturing the delegation. That is an audit trail gap: a COA reviewer asks *"under what authority did this person sign?"* and the answer is not in the data.

This task records designations and exposes the capacity, without changing any existing approval RPC. Approval routines keep writing `auth.uid()`; the capacity is resolved for display and reporting.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260907_document_signatories.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'signatory_designations'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: signatory_designations missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'signing_capacity'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: signing_capacity() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_signatory_no_overlap'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: overlap-prevention index missing';
  END IF;
END $$;

SELECT 'PASS: 20260907_document_signatories' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: signatory_designations missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260907_document_signatories.sql`:

```sql
-- ============================================================
-- Delegated signing authority.
--
-- approved_by is a bare user FK everywhere, so an OIC-SDS signing while
-- the SDS is on leave is indistinguishable from the SDS signing. This
-- records the designation so "under what authority did this person
-- sign?" has an answer in the data.
--
-- Deliberately does NOT change any approval RPC. Those keep writing
-- auth.uid(); capacity is resolved for display and reporting.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.signatory_designations (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID          NOT NULL REFERENCES platform.divisions(id),

  -- Which authority is being delegated, expressed as the permission it
  -- gates rather than a role name, so it survives role renames.
  permission_code     TEXT          NOT NULL REFERENCES procurements.permissions(code),

  designated_user_id  UUID          NOT NULL REFERENCES auth.users(id),
  capacity            TEXT          NOT NULL DEFAULT 'oic'
                        CHECK (capacity IN ('incumbent','oic','acting','authorized_representative')),

  position_title      TEXT,
  designation_order   TEXT,
  document_url        TEXT,

  effective_from      DATE          NOT NULL,
  effective_to        DATE,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),

  remarks             TEXT,
  created_by          UUID          REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.signatory_designations IS
  'Who may sign for a given authority over a date range, and in what capacity. Answers the COA question about signing authority.';

CREATE INDEX idx_signatory_division   ON procurements.signatory_designations(division_id);
CREATE INDEX idx_signatory_permission ON procurements.signatory_designations(permission_code);
CREATE INDEX idx_signatory_user       ON procurements.signatory_designations(designated_user_id);
CREATE INDEX idx_signatory_dates      ON procurements.signatory_designations(effective_from, effective_to);
CREATE INDEX idx_signatory_deleted    ON procurements.signatory_designations(deleted_at) WHERE deleted_at IS NULL;

-- Prevent two open-ended designations for the same authority.
CREATE UNIQUE INDEX idx_signatory_no_overlap
  ON procurements.signatory_designations (division_id, permission_code)
  WHERE effective_to IS NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_signatory_updated_at
  BEFORE UPDATE ON procurements.signatory_designations
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_signatory_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.signatory_designations
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Resolution helpers
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.effective_signatory(
  p_permission_code TEXT,
  p_as_of           DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT sd.designated_user_id
    FROM procurements.signatory_designations sd
   WHERE sd.division_id     = procurements.get_user_division_id()
     AND sd.permission_code = p_permission_code
     AND sd.deleted_at      IS NULL
     AND COALESCE(p_as_of, CURRENT_DATE) >= sd.effective_from
     AND (sd.effective_to IS NULL
          OR COALESCE(p_as_of, CURRENT_DATE) <= sd.effective_to)
   -- A dated designation (an OIC covering specific leave) outranks the
   -- open-ended incumbent record for that window.
   ORDER BY (sd.effective_to IS NOT NULL) DESC, sd.effective_from DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION procurements.signing_capacity(
  p_user_id         UUID,
  p_permission_code TEXT,
  p_as_of           DATE DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT sd.capacity
       FROM procurements.signatory_designations sd
      WHERE sd.designated_user_id = p_user_id
        AND sd.permission_code    = p_permission_code
        AND sd.deleted_at         IS NULL
        AND COALESCE(p_as_of, CURRENT_DATE) >= sd.effective_from
        AND (sd.effective_to IS NULL
             OR COALESCE(p_as_of, CURRENT_DATE) <= sd.effective_to)
      ORDER BY (sd.effective_to IS NOT NULL) DESC, sd.effective_from DESC
      LIMIT 1),
    'incumbent'
  );
$$;

COMMENT ON FUNCTION procurements.signing_capacity(UUID, TEXT, DATE) IS
  'Capacity a user signed in for a given authority on a given date. Defaults to incumbent when no designation is recorded.';

-- ============================================================
-- Permissions + RLS
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('admin.signatories_manage', 'admin',
   'Record OIC and delegated signing designations', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('division_admin')
  AND p.code IN ('admin.signatories_manage')
ON CONFLICT DO NOTHING;

ALTER TABLE procurements.signatory_designations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_signatories" ON procurements.signatory_designations
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_signatories" ON procurements.signatory_designations
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('admin.signatories_manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('admin.signatories_manage')
    AND procurements.is_division_active()
  );
```

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260907_document_signatories`

- [ ] **Step 5: Show capacity on approval displays**

In `src/components/planning/ppmp-approval-chain.tsx` and `src/components/shared/approval-stepper.tsx`, resolve `signing_capacity(approved_by, 'ppmp.approve', approved_at::date)` and append the capacity when it is not `incumbent` — e.g. "Juan Dela Cruz (OIC)". Do the same for the APP approval display.

Create `src/app/dashboard/admin/signatories/page.tsx` for recording designations, following the layout of `src/app/dashboard/admin/roles/page.tsx`. Add `signatorySchema` to `src/lib/schemas/admin.ts` and CRUD actions to a new `src/lib/actions/signatories.ts`.

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260907_document_signatories.sql supabase/verify/20260907_document_signatories.sql src/lib/schemas/admin.ts src/lib/actions/signatories.ts src/app/dashboard/admin/signatories/ src/components/planning/ppmp-approval-chain.tsx src/components/shared/approval-stepper.tsx
git commit -m "feat(admin): record OIC and delegated signing designations

Adds signatory_designations keyed on permission code rather than role
name, plus effective_signatory() and signing_capacity() so approval
displays can show the capacity a person signed in. Existing approval
RPCs are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Replace `source_ppmp_lot_item_ids` with a junction table

**Depends on:** companion plan Phase 4 (Task 11) complete. **Highest-risk task in either plan — do it last.**

**Files:**
- Create: `supabase/migrations/20260908_app_item_lines.sql`
- Create: `supabase/verify/20260908_app_item_lines.sql`

**Interfaces:**
- Produces: table `procurements.app_item_lines`; function `procurements.sync_app_item_lines(p_app_item_id UUID)`; rewritten `assign_lot_items_to_lot`, `unassign_lot_items`, `merge_unlotted_app_item` reading the junction instead of the array.

**Context:** `app_items.source_ppmp_lot_item_ids UUID[]` (`20260729_app_item_line_level_lotting.sql:22`) works, and the proportional apportionment is done correctly — the remainder is `estimated_budget - v_share` (`:431`, `:594`) rather than a second independent `ROUND`, so split rows sum exactly to the original. Credit where due. But an array cannot be joined or indexed without GIN plus `unnest`, and it cannot carry a per-line apportioned amount, so the money is only auditable at the group level.

**Why this is risky:** it rewrites three RPCs that manipulate budget figures across split rows. Read `20260729_app_item_line_level_lotting.sql` in full before starting. The migration below is additive — it builds the junction alongside the array and keeps both in sync — so the RPC rewrite can be validated before the array is retired in a later cleanup.

- [ ] **Step 1: Write the failing assertion script**

Create `supabase/verify/20260908_app_item_lines.sql`:

```sql
DO $$
DECLARE
  v_mismatch INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'app_item_lines'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_item_lines missing';
  END IF;

  -- Every array entry must have a junction row, and vice versa.
  SELECT COUNT(*) INTO v_mismatch
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
     AND ai.source_ppmp_lot_item_ids IS NOT NULL
     AND COALESCE(ARRAY_LENGTH(ai.source_ppmp_lot_item_ids, 1), 0) <> (
       SELECT COUNT(*) FROM procurements.app_item_lines ail
        WHERE ail.app_item_id = ai.id
     );

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % app_items disagree between the array and the junction', v_mismatch;
  END IF;

  -- Apportioned amounts must sum to the item's budget.
  SELECT COUNT(*) INTO v_mismatch
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM procurements.app_item_lines l WHERE l.app_item_id = ai.id)
     AND ai.estimated_budget <> (
       SELECT SUM(l.apportioned_amount)
         FROM procurements.app_item_lines l
        WHERE l.app_item_id = ai.id
     );

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % app_items whose line apportionment does not sum to estimated_budget',
      v_mismatch;
  END IF;
END $$;

SELECT 'PASS: 20260908_app_item_lines' AS result;
```

- [ ] **Step 2: Ask the user to run it and confirm it fails**

Expected: `ERROR: ASSERTION FAILED: app_item_lines missing`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260908_app_item_lines.sql`:

```sql
-- ============================================================
-- app_item_lines: which PPMP lines an APP item covers, and for how
-- much each.
--
-- Additive. The source_ppmp_lot_item_ids array stays and is kept in
-- sync, so the RPC rewrite can be validated before the array retires.
--
-- The apportionment rule is the one already used and already correct:
-- shares are ROUNDed, and the LAST line absorbs the residual so the sum
-- equals estimated_budget exactly. Do not round every line
-- independently.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_item_lines (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  app_item_id         UUID          NOT NULL REFERENCES procurements.app_items(id) ON DELETE CASCADE,
  ppmp_lot_item_id    UUID          NOT NULL REFERENCES procurements.ppmp_lot_items(id),

  -- Snapshot of the source line at consolidation, so the APP stays
  -- readable even if the PPMP line is later amended away.
  description         TEXT,
  unit                TEXT,
  quantity            NUMERIC(15,4),
  estimated_unit_cost NUMERIC(15,2),

  apportioned_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (apportioned_amount >= 0),

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (app_item_id, ppmp_lot_item_id)
);

COMMENT ON TABLE procurements.app_item_lines IS
  'Per-line breakdown of an APP item, with the apportioned budget share. Sums exactly to app_items.estimated_budget.';

CREATE INDEX idx_ail_app_item ON procurements.app_item_lines(app_item_id);
CREATE INDEX idx_ail_lot_item ON procurements.app_item_lines(ppmp_lot_item_id);

CREATE TRIGGER trg_ail_updated_at
  BEFORE UPDATE ON procurements.app_item_lines
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ail_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.app_item_lines
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Rebuild the junction for one APP item from its array, apportioning
-- the budget with the residual on the last line.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_app_item_lines(
  p_app_item_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item        RECORD;
  v_ids         UUID[];
  v_line_total  NUMERIC(15,2);
  v_running     NUMERIC(15,2) := 0;
  v_share       NUMERIC(15,2);
  v_rec         RECORD;
  v_last_id     UUID;
BEGIN
  SELECT * INTO v_item
    FROM procurements.app_items
   WHERE id = p_app_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  DELETE FROM procurements.app_item_lines WHERE app_item_id = p_app_item_id;

  -- NULL array means "every line of the source lot".
  IF v_item.source_ppmp_lot_item_ids IS NULL THEN
    SELECT ARRAY_AGG(id ORDER BY item_number, id)
      INTO v_ids
      FROM procurements.ppmp_lot_items
     WHERE ppmp_lot_id = v_item.source_ppmp_lot_id;
  ELSE
    v_ids := v_item.source_ppmp_lot_item_ids;
  END IF;

  IF v_ids IS NULL OR ARRAY_LENGTH(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(estimated_total_cost), 0)
    INTO v_line_total
    FROM procurements.ppmp_lot_items
   WHERE id = ANY(v_ids);

  SELECT id INTO v_last_id
    FROM procurements.ppmp_lot_items
   WHERE id = ANY(v_ids)
   ORDER BY item_number DESC, id DESC
   LIMIT 1;

  FOR v_rec IN
    SELECT * FROM procurements.ppmp_lot_items
     WHERE id = ANY(v_ids)
     ORDER BY item_number, id
  LOOP
    IF v_rec.id = v_last_id THEN
      -- Residual to the last line: guarantees an exact sum.
      v_share := v_item.estimated_budget - v_running;
    ELSIF v_line_total > 0 THEN
      v_share := ROUND(v_item.estimated_budget * v_rec.estimated_total_cost / v_line_total, 2);
    ELSE
      v_share := ROUND(v_item.estimated_budget / ARRAY_LENGTH(v_ids, 1), 2);
    END IF;

    v_running := v_running + v_share;

    INSERT INTO procurements.app_item_lines (
      app_item_id, ppmp_lot_item_id, description, unit,
      quantity, estimated_unit_cost, apportioned_amount
    ) VALUES (
      p_app_item_id, v_rec.id, v_rec.description, v_rec.unit,
      v_rec.quantity, v_rec.estimated_unit_cost, GREATEST(0, v_share)
    );
  END LOOP;
END;
$$;

-- Keep the junction in step with the array and the budget.
CREATE OR REPLACE FUNCTION procurements.trg_sync_app_item_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  PERFORM procurements.sync_app_item_lines(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_item_sync_lines
  AFTER INSERT OR UPDATE OF source_ppmp_lot_item_ids, estimated_budget, source_ppmp_lot_id
  ON procurements.app_items
  FOR EACH ROW EXECUTE FUNCTION procurements.trg_sync_app_item_lines();

-- ============================================================
-- Backfill every existing APP item.
-- ============================================================

DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM procurements.app_items WHERE deleted_at IS NULL
  LOOP
    PERFORM procurements.sync_app_item_lines(v_id);
  END LOOP;
END $$;
```

> **Implementer note:** the trigger recurses if `sync_app_item_lines` ever writes back to `app_items` — it must not. Confirm it only touches `app_item_lines`. Also note this trigger fires on `estimated_budget` changes, which `adjust_app_item_budget()` performs; that is intended, so a budget adjustment re-apportions the lines. Verify that interaction explicitly in Step 5.

- [ ] **Step 4: Ask the user to apply and re-run the assertion script**

Expected: `PASS: 20260908_app_item_lines`

- [ ] **Step 5: Ask the user to verify apportionment survives the risky paths**

For each, confirm `SUM(apportioned_amount) = estimated_budget` afterwards:

```sql
-- Helper: run after each operation below.
SELECT ai.id, ai.estimated_budget,
       SUM(l.apportioned_amount) AS line_sum,
       ai.estimated_budget - SUM(l.apportioned_amount) AS drift
  FROM procurements.app_items ai
  JOIN procurements.app_item_lines l ON l.app_item_id = ai.id
 WHERE ai.deleted_at IS NULL
 GROUP BY ai.id, ai.estimated_budget
HAVING ai.estimated_budget <> SUM(l.apportioned_amount);
```

Operations to test — the query above must return **zero rows** after every one:
1. `assign_lot_items_to_lot` with a subset (splits an item)
2. `unassign_lot_items` (merges back)
3. `adjust_app_item_budget` on a split item
4. An assign/unassign cycle repeated three times on the same item

If any drift appears, do not proceed to the RPC rewrite — fix the apportionment first.

- [ ] **Step 6: Rewrite the three lotting RPCs to read the junction**

Only after Step 5 is clean. In a follow-up migration `20260909_lotting_rpcs_use_junction.sql`, rewrite `assign_lot_items_to_lot`, `unassign_lot_items`, and `merge_unlotted_app_item` from `20260729_app_item_line_level_lotting.sql` to compute shares by summing `app_item_lines.apportioned_amount` for the selected lines rather than calling `app_item_budget_share`. Keep writing `source_ppmp_lot_item_ids` so the array stays valid for one release.

Re-run Step 5's checks after the rewrite.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260908_app_item_lines.sql supabase/verify/20260908_app_item_lines.sql
git commit -m "feat(app): add app_item_lines junction with per-line apportionment

Replaces the source_ppmp_lot_item_ids array with a joinable, indexable
junction carrying each line's apportioned budget, so the money is
auditable per line rather than per group. The residual lands on the last
line so shares sum exactly to estimated_budget. The array is retained
and kept in sync for one release.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deferred beyond this plan

**Nationwide architecture** was raised in the review and is deliberately not planned here — it is multi-tenant platform work, not procurement-module work, and it should not be attempted until both of these plans are applied and stable:

- Move `budget_ceilings` and the planning calendar to the `platform` schema so DepEd CO/RO can push one budget call to all divisions and roll results up.
- Add a `region_id` scope and read-only regional roles. Every RLS policy currently hard-scopes to `get_user_division_id()`, which is correct for isolation but leaves no legitimate path for a Regional Director to see 20 SDOs — and super-admin escalation is not that path.
- Make `procurement_mode`, `project_type`, `account_codes`, and `fund_sources` platform-managed versioned reference data. Otherwise 200+ divisions produce 200+ spellings of "Small Value Procurement" and no comparable national reporting.
- Replace the recompute-on-read `get_*_summary` RPCs with materialized per-fiscal-year snapshots.
- Drop the columns deprecated across both plans (`indicative_final` ×4, `ppmp_lots.supporting_documents`, the TEXT date and `source_of_funds` columns, `purchase_requests.app_item_id`, `apps.philgeps_reference`, `source_ppmp_lot_item_ids`) once the UI has been off them for a full fiscal year.

---

## Self-Review

**Spec coverage.** Every item from the review's "tables to add" list and the two deferred workflow findings:

| Review item | Task |
|---|---|
| `app_postings` + posting action | 1 |
| BAC Secretariat review; HOPE at document level | 2 |
| APP-CSE submission tracking | 3 |
| `contracts` (+ variations, NTP) | 4 |
| `disbursement_vouchers`, `payments`, `disbursed_amount` wired | 5 |
| `procurement_monitoring_reports` (PMR) | 6 |
| `document_signatories` (OIC) | 7 |
| `app_item_lines` junction | 8 |
| `budget_ceilings`, `planning_rounds` | companion plan Tasks 1, 14 |
| Nationwide architecture | deferred, itemised above |

**Known gaps and risks, stated rather than hidden:**
- Task 4's cumulative variation limit defaults to 10% in `system_settings`. Step 3 requires confirming the current GPPB figure with the user; the plan does not assert it as fact.
- Task 4's NTP appropriation gate calls `appropriation_exists()` from the companion plan. If that plan has not been applied, the gate must be stubbed and the user told it is inert.
- Task 5's payment-number generator as written counts rows and races. The implementer note requires replacing it with the repo's `generate_sequence_number()` before shipping — this is called out because the naive version would otherwise look shippable.
- Task 5 does not compute tax withholding from a rate. Deliberate: withholding rates are policy and vary by supplier classification and transaction type. Amounts are entered and constrained (`net_amount >= 0`) rather than derived from a hardcoded percentage.
- Task 6's `v_pmr_lines` joins five tables whose column names span many migrations. Step 3 verifies them; the view will not compile against wrong names, so failure is loud rather than silent.
- Task 8 is the highest-risk change in either plan and is sequenced last, additive, with an explicit "do not proceed" gate at Step 5.

**Type consistency check.** `net_amount` is a generated column in Task 5 and is read (never written) by `record_payment` and `sync_dv_payment_status`. `appropriation_exists(UUID)` is referenced in Task 4 with the same signature the companion plan defines. `signing_capacity(UUID, TEXT, DATE)` is used in Task 7's UI step with the argument order it is declared with. `sync_app_item_lines(UUID)` is called by both the trigger wrapper and the backfill loop in Task 8 with one argument. Permission codes introduced here (`app.post`, `app.secretariat_review`, `app.endorse`, `app.cse_submit`, `contract.view/manage/approve_variation`, `dv.view/create/certify/approve`, `payment.record`, `report.pmr_manage`, `admin.signatories_manage`) are all distinct from each other and from the companion plan's (`budget.ceilings_view/manage`, `planning.rounds_manage`, `app.release_lots`, `app.authorize_epa`, `ppmp.amend_override`).

