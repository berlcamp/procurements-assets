# Testing Guide: Government Procurement Alignment Fixes

This guide walks through verifying the 6 fixes applied to align APP/BAC lot management with RA 9184 / RA 12009 / GPPB practices.

---

## Prerequisites

- Run `npm run dev` to start the local dev server at `localhost:3000`
- You need access to multiple roles to test the full flow:
  - **End User** / **School Head** (creates PPMPs)
  - **Section Chief** (reviews PPMPs)
  - **Budget Officer** (certifies PPMPs, adjusts APP budgets)
  - **HOPE / SDS** (approves PPMPs, reviews APP items, approves APP)
  - **BAC Chair / BAC Secretariat** (manages APP lots, creates procurement activities)

---

## Test 1: CSE/Non-CSE Categorization (Issue 2)

### Where to test
**PPMP Lot Form** at `/dashboard/planning/ppmp/[id]/edit`

### Steps

1. Navigate to **Planning > PPMP** in the sidebar
2. Create a new PPMP or edit an existing draft
3. Add a project with `project_type = "Goods"`
4. Click **Add Lot** on the project
5. **Verify**: In the lot form, after the "Pre-procurement conference required" checkbox, you should see a new checkbox:
   - **"Common-Use Supplies & Equipment (CSE)"**
   - With helper text: "Must procure from PS-DBM"
6. Check the CSE box, fill in the other required fields (mode, budget), and save
7. **Verify in PPMP table**: The lot row should show a blue **CSE** badge next to the procurement mode badge

### After PPMP Approval (auto-populates APP)

8. Submit and approve the PPMP through the full workflow (Submit > Chief Review > Budget Certify > Approve)
9. Navigate to **Planning > APP** and open the APP for this fiscal year
10. **Verify in APP items table** (`/dashboard/planning/app/[id]`): The item should display a blue **CSE** badge next to the description
11. **Verify in HOPE review** (`/dashboard/planning/app/[id]/review`): Open the item detail — CSE badge should appear next to the project type
12. **Verify in lot manager** (`/dashboard/planning/app/[id]/lots`): The "By CSE" grouping tab should be available. Click it to group items into "CSE" and "Non-CSE" categories

---

## Test 2: Unified Procurement Modes (Issue 3)

### Where to test
**PPMP Lot Form** at `/dashboard/planning/ppmp/[id]/edit`

### Steps

1. Open a PPMP in edit mode
2. Add a lot and click the **Mode of Procurement** dropdown
3. **Verify** the dropdown contains exactly these 9 options:
   - Competitive Bidding
   - Limited Source Bidding
   - Direct Contracting
   - Repeat Order
   - Shopping
   - Small Value Procurement (value: `svp`)
   - Negotiated Procurement (value: `negotiated`)
   - Agency-to-Agency
   - Emergency Purchase
4. **Verify removed**: "Two-Stage Bidding" and "By Administration" should NOT appear
5. **Verify renamed**: "Small Value Procurement" (was "Small Value"), "Negotiated Procurement" (was "Negotiated Procurement" with different value)

### Existing Data Verification

6. If you had PPMPs with old mode values (`small_value`, `negotiated_procurement`, `two_stage_bidding`, `by_administration`), navigate to their APP items
7. **Verify**: They should now display correctly with the new labels (e.g., "Small Value Procurement" instead of "small_value")

### Procurement Activity Creation

8. Navigate to **Procurement > Activities**
9. Click **New Procurement Activity**
10. Select an approved PR
11. **Verify**: The method dropdown should include "Limited Source Bidding" as an option
12. **Verify**: The PR's planned mode should auto-fill correctly without any normalization issues (the old hack that converted "small_value" to "svp" has been removed)

---

## Test 3: Required Procurement Method on APP Lots (Issue 4)

### Where to test
**APP Lot Manager** at `/dashboard/planning/app/[id]/lots`

### Steps

1. Navigate to an APP that has HOPE-approved items (items must pass HOPE review first)
2. Go to the **Lots** tab
3. Click **Create Lot**
4. Enter a lot name (3+ characters)
5. **Verify**: Try to save WITHOUT selecting a procurement method
   - You should see the error: "Procurement method is required"
6. Select a procurement method from the dropdown and save
7. **Verify**: The lot is created with the method displayed as `"[item count] · [Method Name]"`

### Method Consistency Warning

8. Create a lot with method "Small Value Procurement"
9. Try to assign an item whose `procurement_mode` is "Competitive Bidding" to this lot
10. **Verify**: The assignment should succeed (it's a warning, not a block), but check the server logs for a NOTICE about the mode mismatch

### Inline Method Editing

11. On a draft lot, click the method name to edit it inline
12. **Verify**: The method select dropdown appears and you can change it
13. **Verify**: You cannot clear the method to empty — there is no empty option

---

## Test 4: Schedule Quarter Breakdown (Issue 6)

### Where to test
**PPMP Lot Form** at `/dashboard/planning/ppmp/[id]/edit`

### Steps

1. Edit a PPMP and add a lot (or edit an existing lot)
2. **Verify** the Schedule section now has:
   - **Quarter dropdown** (Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec)
   - **Procurement start** (MM/YYYY) — existing field
   - **Procurement end** (MM/YYYY) — existing field
   - **Delivery period** — existing field
   - **Advertisement** (MM/YYYY) — new field
   - **Bid opening** (MM/YYYY) — new field
   - **Award** (MM/YYYY) — new field
   - **Contract signing** (MM/YYYY) — new field
3. Select Q2, fill in dates, and save
4. **Verify in PPMP table**: The lot row shows a **Q2** badge

### After PPMP Approval

5. Approve the PPMP through the workflow
6. **Verify in APP items table**: The item shows a **Q2** badge next to the description
7. **Verify in HOPE review detail**: The target quarter should appear in the item detail modal

---

## Test 5: Indicative vs Final Budget Tracking (Issue 5)

### Where to test
**APP Management** at `/dashboard/planning/app/[id]`

### Steps

1. Have an APP with items that have been HOPE-reviewed and lotted
2. All lots should be finalized
3. As HOPE, click **Finalize APP**
4. **Verify**: The finalization snapshots the current `estimated_budget` into `indicative_budget` for all items (this happens in the database — verify by checking the APP items after finalization)

### Budget Adjustment (during BAC Finalization stage)

5. If the APP goes through BAC finalization (status: `bac_finalization` or `under_review`):
   - The budget officer or BAC can call the `adjust_app_item_budget` RPC to change an item's budget
   - This is currently an RPC-level feature — the inline budget edit UI will show the delta once adjustments are made

### Budget Delta Indicator

6. After a budget adjustment, navigate to the APP items table
7. **Verify**: Items with adjusted budgets show a percentage change indicator:
   - Green with percentage if budget decreased
   - Red with `+` percentage if budget increased
   - Hover tooltip shows: "Indicative: P[original amount]"

---

## Test 6: Source PPMP Project Description Grouping (Issue 1)

### Where to test
**APP Lot Manager** at `/dashboard/planning/app/[id]/lots`

### Steps

1. Create a PPMP with multiple lots under the same project (e.g., "Office Equipment Procurement" with Lot 1: IT Equipment, Lot 2: Furniture)
2. Approve the PPMP
3. Navigate to the APP lot manager
4. **Verify**: Both APP items carry the `source_ppmp_project_description` field with "Office Equipment Procurement"
5. This field enables future grouping by parent project — currently used as context data

---

## Test 7: Amendment Flow (Regression Test)

Amendments must correctly carry forward all new fields.

### Steps

1. Have an approved APP
2. Create a manual amendment (requires `app.amend` permission)
3. **Verify**: All items in the new amendment version retain:
   - `is_cse` values
   - `schedule_quarter` values
   - `source_ppmp_project_description`
   - `advertisement_date`, `bid_opening_date`, `award_date`, `contract_signing_date`
4. **Verify**: All lots in the amendment are reset to `draft` status but retain their `procurement_method`

### PPMP Amendment → APP Supplemental

5. Create a PPMP amendment on an already-approved PPMP
6. Approve the PPMP amendment
7. **Verify**: A supplemental APP version is auto-created
8. **Verify**: The new items from the PPMP amendment include all new fields
9. **Verify**: Existing items (from other PPMPs) are cloned with their new fields intact

---

## Test 8: Limited Source Bidding Execution (Issue 3 — Execution Side)

### Steps

1. Create a PR linked to an APP item with `procurement_mode = 'limited_source_bidding'`
2. Approve the PR through the workflow
3. Create a Procurement Activity with method **"Limited Source Bidding"**
4. **Verify**: The activity is created with first stage `pre_qualification`
5. Advance through stages in order:
   - `pre_qualification` → `itb_published` (requires PhilGEPS reference)
   - `itb_published` → `bid_submission` (enforces posting deadline)
   - `bid_submission` → `bid_opening`
   - `bid_opening` → `evaluation`
   - `evaluation` → `post_qualification`
   - `post_qualification` → `award_recommended`
   - `award_recommended` → `award_approved`
   - `award_approved` → `contract_signing`
   - `contract_signing` → `completed`
6. **Verify**: PhilGEPS reference is required before `itb_published`
7. **Verify**: Submission deadline is enforced before `bid_submission`

---

## Quick Checklist

| # | Feature | Where to Check | Pass? |
|---|---------|---------------|-------|
| 1 | CSE checkbox in PPMP lot form | `/dashboard/planning/ppmp/[id]/edit` | |
| 2 | CSE badge in PPMP lot table | `/dashboard/planning/ppmp/[id]` | |
| 3 | CSE badge in APP items table | `/dashboard/planning/app/[id]` | |
| 4 | CSE badge in HOPE review modal | `/dashboard/planning/app/[id]/review` | |
| 5 | "By CSE" grouping in lot manager | `/dashboard/planning/app/[id]/lots` | |
| 6 | 9 unified procurement modes in dropdown | PPMP lot form | |
| 7 | No old modes (two_stage_bidding, etc.) | PPMP lot form | |
| 8 | Required method on lot creation | `/dashboard/planning/app/[id]/lots` | |
| 9 | Method cannot be cleared on lot card | Lot card inline edit | |
| 10 | Quarter dropdown in PPMP lot form | PPMP lot form Schedule section | |
| 11 | Quarter badge in APP items table | `/dashboard/planning/app/[id]` | |
| 12 | Milestone date fields in PPMP form | PPMP lot form Schedule section | |
| 13 | Budget delta indicator | APP items table (after adjustment) | |
| 14 | Limited Source Bidding in activity creation | `/dashboard/procurement/activities` | |
| 15 | Auto-fill method from PR mode (no hack) | Procurement creation dialog | |
| 16 | Amendment clones new fields | APP amendment flow | |
| 17 | PPMP amendment → supplemental APP | PPMP amendment approval | |
