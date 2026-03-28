# EXECUTION PLAN: DepEd Procurement, Asset & Budget Management System

**Reference:** SYSTEM_PLAN.md v1.1
**Approach:** Incremental, dependency-aware, testable at each phase
**Stack:** Next.js 16 (App Router) + Supabase (PostgreSQL, Auth, RLS, Edge Functions)

---

# 1. PHASE OVERVIEW

| Phase | Name                                            | Model    | Goal                                                                      | Why This Order                                                   |
| ----- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1     | **Project Setup & Infrastructure**              | Sonnet   | Scaffold project, Supabase connection, base UI framework                  | Everything depends on this                                       |
| 2     | **Platform Layer (Super Admin)**                | Sonnet   | Division onboarding, subscription management, shared lookups              | Tenancy must exist before any division data                      |
| 3     | **Organization & Auth Foundation**              | **Opus** | Offices, users, roles, permissions, RLS, login/logout                     | All modules need users and access control                        |
| 4     | **Budget Management**                           | Sonnet   | Fiscal years, budget allocations, adjustments, utilization                | Planning and procurement require budget to validate against      |
| 5     | **Planning Module (PPMP)**                      | **Opus** | PPMP creation, versioning, approval workflow                              | PPMP feeds into APP; must be done before APP                     |
| 6     | **Planning Module (APP)**                       | Sonnet   | APP consolidation from PPMPs, approval, versioning                        | APP must exist before procurement can reference it               |
| 7     | **Procurement Core (PR + Suppliers)**           | Sonnet   | Purchase Requests, supplier registry, budget certification                | PR is the entry point for all procurement methods                |
| 8     | **Procurement Workflows (SVP + Shopping)**      | **Opus** | Small Value Procurement and Shopping workflows end-to-end                 | Most common methods in DepEd; quickest to deliver value          |
| 9     | **Procurement Workflows (Competitive Bidding)** | **Opus** | Full competitive bidding with BAC evaluation                              | Most complex method; requires all procurement infrastructure     |
| 10    | **Procurement Workflows (Other Methods)**       | Sonnet   | Direct contracting, repeat order, emergency, negotiated, agency-to-agency | Completes RA 12009 coverage                                      |
| 11    | **Purchase Orders & Delivery**                  | Sonnet   | PO creation, delivery recording, inspection, obligation tracking          | Bridges procurement to asset management                          |
| 12    | **Asset Management (Inventory)**                | Sonnet   | Item catalog, stock-in/out, stock cards, inventory tracking               | Assets from deliveries enter inventory first                     |
| 13    | **Asset Management (Property)**                 | **Opus** | Asset registration, PAR/ICS, custodian management, depreciation           | Depends on inventory for incoming assets                         |
| 14    | **Request System**                              | Sonnet   | Supply/equipment/service requests, fulfillment routing                    | Depends on inventory (stock check) and procurement (PR creation) |
| 15    | **Notifications & Approval Inbox**              | Sonnet   | Unified approvals, in-app notifications, email alerts                     | Cross-cutting; enhances all prior modules                        |
| 16    | **Reports & Dashboards**                        | Sonnet   | All dashboards, compliance reports, exports                               | Requires data from all modules to be meaningful                  |
| 17    | **Document Generation & Compliance**            | Sonnet   | PDF generation (PR, PO, NOA, ICS, PAR), PhilGEPS prep, COA reports        | Polish phase; all data flows must be working                     |
| 18    | **Optimization, UAT & Launch Prep**             | **Opus** | Performance tuning, edge cases, UAT, bug fixes                            | Final hardening before deployment                                |

### Model Assignment Guide

| Model      | When to Use                                                                                               | Cost Profile                  |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Opus**   | Complex logic, security-critical, multi-step workflows, versioning, RLS design, compliance-sensitive code | Higher cost, highest accuracy |
| **Sonnet** | Standard CRUD, UI pages, straightforward migrations, forms, lists, components, reports                    | Balanced cost/quality         |
| **Haiku**  | Quick fixes, typos, simple renames, seed data edits, adding a single column                               | Lowest cost, fast             |

**Why these assignments:**

| Opus Phases                          | Reason                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 3 (Auth/RLS)**               | RLS is the security backbone. Misconfigured policies = data leaks between divisions. Requires careful SQL with nested policy logic, two-layer isolation, and subscription enforcement. One mistake here is catastrophic.                  |
| **Phase 5 (PPMP Versioning)**        | Immutable version snapshots, amendment cloning, version state machines, concurrent draft prevention, and budget cross-validation. The versioning pattern sets the standard reused by APP. Getting this wrong corrupts historical records. |
| **Phase 8 (SVP/Shopping)**           | First real procurement workflow. Establishes the procurement engine pattern (stage tracking, bid recording, evaluation, award) that all other methods extend. Must get the architecture right.                                            |
| **Phase 9 (Competitive Bidding)**    | Most complex single feature: 17-step workflow with BAC quorum rules, publication timelines, post-qualification, and strict RA 12009 compliance. Highest risk of compliance violations.                                                    |
| **Phase 13 (Property/Depreciation)** | Depreciation math (straight-line, residual value, monthly batch), property numbering, custody chain with PAR/ICS, and disposal workflow. Financial calculations must be exact for COA audit.                                              |
| **Phase 18 (UAT/Optimization)**      | Cross-module integration testing, RLS security audit, edge case handling, performance optimization of complex queries. Requires holistic understanding of the entire system.                                                              |

**Sonnet phases** are assigned where the work is well-defined CRUD, UI building, or follows patterns already established by an Opus phase. Sonnet excels at these — fast, accurate, and cost-effective.

**When to escalate Sonnet → Opus mid-phase:**

- You encounter unexpected RLS or permission bugs
- A trigger creates an infinite loop or race condition
- Budget/financial calculations produce rounding errors
- A workflow state machine has edge cases you didn't anticipate
- Cross-module integration breaks in non-obvious ways

---

# 2. PER PHASE DETAILS

---

## PHASE 1: Project Setup & Infrastructure

### A. Scope

- Next.js 16 project scaffold with App Router
- Supabase project creation and connection
- Base UI component library (shadcn/ui)
- Development tooling (ESLint, Prettier, TypeScript strict mode)
- Folder structure per SYSTEM_PLAN.md Section 7.1

### B. Database (Supabase)

- Create Supabase project
- Enable `platform` schema: `CREATE SCHEMA IF NOT EXISTS platform;`
- Enable `audit` schema: `CREATE SCHEMA IF NOT EXISTS audit;`
- No application tables yet

### C. Backend Logic

- Supabase client setup (`lib/supabase/client.ts`, `server.ts`, `middleware.ts`, `admin.ts`)
- Environment variables configuration (.env.local)

### D. Frontend (Next.js)

- Root layout (`app/layout.tsx`) with providers
- Landing page (`app/page.tsx`) — placeholder redirect
- Auth pages structure: `(auth)/login`, `(auth)/forgot-password`, `(auth)/reset-password`
- Two layout shells (placeholder):
  - `(platform)/layout.tsx` — Super Admin shell
  - `(dashboard)/layout.tsx` — Division user shell
- Base components: `components/ui/` — install shadcn/ui (button, input, table, dialog, select, badge, card, form, dropdown-menu, sheet, separator, skeleton, toast)
- Layout components: `components/layout/sidebar.tsx`, `topbar.tsx`, `breadcrumbs.tsx`, `page-header.tsx`

### E. User Roles Involved

- Developer only (no user-facing roles yet)

### F. Workflows Implemented

- None yet

### G. Deliverable Outcome

- Running Next.js app connected to Supabase
- Two layout shells rendering
- shadcn/ui components available
- Clean folder structure matching SYSTEM_PLAN.md

### H. Build Tasks

1. `npx create-next-app@latest procurements-assets --typescript --tailwind --eslint --app --src-dir`
2. `npx shadcn@latest init` — configure shadcn/ui
3. Install shadcn components: button, input, table, dialog, select, badge, card, form, dropdown-menu, sheet, separator, skeleton, toast, tabs, command, popover, calendar, checkbox, radio-group, switch, textarea, label, avatar, scroll-area, alert, tooltip
4. `npm install @supabase/supabase-js @supabase/ssr`
5. Create `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. Create `src/lib/supabase/client.ts` (browser client)
7. Create `src/lib/supabase/server.ts` (server component client)
8. Create `src/lib/supabase/middleware.ts` (auth middleware helper)
9. Create `src/lib/supabase/admin.ts` (service role client)
10. Create `src/middleware.ts` (Next.js middleware — auth redirect stub)
11. Create `src/app/(auth)/login/page.tsx` — placeholder
12. Create `src/app/(platform)/layout.tsx` — Super Admin shell with sidebar placeholder
13. Create `src/app/(dashboard)/layout.tsx` — Division user shell with sidebar placeholder
14. Create `src/components/layout/sidebar.tsx`, `topbar.tsx`, `breadcrumbs.tsx`, `page-header.tsx`
15. In Supabase SQL Editor: `CREATE SCHEMA IF NOT EXISTS platform; CREATE SCHEMA IF NOT EXISTS audit;`
16. Verify connection: test Supabase client can ping the database

---

## PHASE 2: Platform Layer (Super Admin)

### A. Scope

- `platform.divisions` table and management
- `platform.announcements` table
- `platform.platform_audit_logs` table
- Super Admin UI for division CRUD
- Subscription status management
- Shared lookup tables: `fund_sources`, `account_codes`

### B. Database (Supabase)

**Tables to create:**

```
platform.divisions (id, name, code, region, address, contact_number, email, logo_url, subscription_status, subscription_plan, trial_ends_at, subscription_starts_at, subscription_ends_at, max_users, max_schools, onboarded_by, onboarded_at, is_active, deleted_at, created_at, updated_at)

platform.announcements (id, title, message, type, target_divisions, is_active, published_at, expires_at, created_by, created_at, updated_at)

platform.platform_audit_logs (id, action, target_division_id, details, performed_by, created_at)

fund_sources (id, code, name, description, is_active, created_at)

account_codes (id, code, name, expense_class, parent_code_id, level, is_active, created_at)
```

**Relationships:**

- `platform.divisions.onboarded_by` → `auth.users(id)`
- `account_codes.parent_code_id` → self-referential (hierarchy)

**Constraints:**

- `divisions.code` UNIQUE
- `divisions.subscription_status` CHECK IN ('pending','trial','active','suspended','expired')
- `fund_sources.code` UNIQUE
- `account_codes.code` UNIQUE

### C. Backend Logic

- RPC: `is_super_admin()` — check if current user has `is_super_admin = true`
- RPC: `onboard_division(name, code, region, admin_email, ...)` — creates division + default root office + Division Admin account
- RPC: `suspend_division(division_id, reason)` — sets subscription to 'suspended'
- RPC: `reactivate_division(division_id)` — sets subscription back to 'active'
- RLS on `platform.divisions`: only Super Admin can CRUD; Division users can SELECT own division
- Trigger: log all platform operations to `platform.platform_audit_logs`

### D. Frontend (Next.js)

**Pages:**

- `(platform)/page.tsx` — Platform dashboard (division count, subscription overview)
- `(platform)/divisions/page.tsx` — Division list with status badges
- `(platform)/divisions/new/page.tsx` — Onboard new division form
- `(platform)/divisions/[id]/page.tsx` — Division detail (subscription, stats)
- `(platform)/divisions/[id]/settings/page.tsx` — Division config
- `(platform)/lookup-data/account-codes/page.tsx` — UACS management
- `(platform)/lookup-data/fund-sources/page.tsx` — Fund source management
- `(platform)/announcements/page.tsx` — Announcement list
- `(platform)/announcements/new/page.tsx` — Create announcement
- `(platform)/audit-logs/page.tsx` — Platform audit log viewer

**Components:**

- `components/shared/data-table.tsx` — Reusable table with sort/filter/pagination
- `components/shared/status-badge.tsx` — Subscription/status indicators
- Division onboarding form component

### E. User Roles Involved

- **Super Admin** — full platform access

### F. Workflows Implemented

1. **Division Onboarding:** Super Admin fills form → Division created (pending) → Admin account invited → Division activated
2. **Subscription Management:** Super Admin changes status → System enforces access rules
3. **Lookup Data Management:** Super Admin adds/edits UACS codes and fund sources

### G. Deliverable Outcome

- Super Admin can log in and see the platform dashboard
- Can create/edit/suspend divisions
- Can manage UACS codes and fund sources
- Division records exist for all subsequent phases

### H. Build Tasks

1. Create migration: `platform.divisions` table with all columns and constraints
2. Create migration: `platform.announcements` table
3. Create migration: `platform.platform_audit_logs` table
4. Create migration: `fund_sources` table with seed data (GF, SEF, TF, MOOE)
5. Create migration: `account_codes` table with seed data (common UACS codes)
6. Create RPC function: `is_super_admin()`
7. Create RPC function: `onboard_division()`
8. Create RPC function: `suspend_division()`
9. Create RLS policies for `platform.divisions` (Super Admin manage, Division users read own)
10. Create RLS policies for `fund_sources` and `account_codes` (Super Admin manage, all authenticated read)
11. Create platform audit log trigger function
12. Build page: Platform dashboard (`(platform)/page.tsx`)
13. Build page: Division list with data-table
14. Build page: Division onboard form
15. Build page: Division detail/edit
16. Build page: UACS management (account_codes CRUD)
17. Build page: Fund sources management
18. Build page: Announcements management
19. Build page: Platform audit logs viewer
20. Build component: `data-table.tsx` (reusable)
21. Build component: `status-badge.tsx`
22. Create first Super Admin user in Supabase Auth manually
23. Test: Create a division, verify it appears in the list, change subscription status

---

## PHASE 3: Organization & Auth Foundation

### A. Scope

- Offices (division_office, school, section) with hierarchy
- User profiles extending Supabase auth
- Roles and permissions system
- User-role assignments (division + office scoped)
- Login/logout with role-based routing
- Division Admin module (user/office/role management within their division)
- Two-layer RLS (division wall + office-level)
- System settings and sequence counters
- Audit log infrastructure

### B. Database (Supabase)

**Tables to create:**

```
offices (id, division_id, name, code, office_type, parent_office_id, address, contact_number, email, is_active, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(division_id, code)
  - office_type CHECK IN ('division_office','school','section')

user_profiles (id→auth.users, division_id, employee_id, first_name, middle_name, last_name, suffix, position, department, office_id, contact_number, is_super_admin, is_active, deleted_at, created_at, updated_at)
  - UNIQUE(division_id, employee_id)

roles (id, name, display_name, description, is_system_role, scope, created_at, updated_at)
  - name UNIQUE
  - scope CHECK IN ('platform','division','office')

user_roles (id, user_id, role_id, division_id, office_id, granted_by, granted_at, revoked_at, is_active)
  - UNIQUE(user_id, role_id, division_id, office_id)

permissions (id, code, module, description, scope, created_at)
  - code UNIQUE

role_permissions (id, role_id, permission_id)
  - UNIQUE(role_id, permission_id)

audit.audit_logs (id, division_id, table_name, record_id, action, old_data, new_data, changed_fields, user_id, user_ip, user_agent, office_id, session_id, created_at)

system_settings (id, division_id, key, value, description, category, updated_by, created_at, updated_at)
  - UNIQUE(division_id, key)

sequence_counters (id, division_id, office_id, counter_type, fiscal_year, last_value, prefix)
  - UNIQUE(division_id, office_id, counter_type, fiscal_year)

notifications (id, user_id, title, message, type, reference_type, reference_id, is_read, read_at, office_id, created_at)

approval_logs (id, reference_type, reference_id, step_name, step_order, action, acted_by, acted_at, remarks, office_id, created_at)

documents (id, reference_type, reference_id, document_type, file_name, file_path, file_size, mime_type, version, uploaded_by, office_id, deleted_at, created_at)
```

**Relationships:**

- `offices.division_id` → `platform.divisions(id)`
- `offices.parent_office_id` → `offices(id)` (self-referential hierarchy)
- `user_profiles.division_id` → `platform.divisions(id)`
- `user_profiles.office_id` → `offices(id)`
- `user_roles.division_id` → `platform.divisions(id)`

### C. Backend Logic

- RPC: `get_user_division_id()` — returns current user's division_id (critical for RLS)
- RPC: `is_division_active()` — checks subscription status
- RPC: `generate_sequence_number(division_id, office_id, type, year)` — auto-number generator
- RPC: `get_user_permissions()` — returns permission codes for current user
- RPC: `has_permission(permission_code)` — boolean check
- Trigger: `audit_trigger` — generic audit logging for all critical tables
- Trigger: `update_timestamp` — auto-update `updated_at`
- RLS foundation: Division isolation policy applied to ALL tenant tables
- Subscription enforcement: suspended divisions get read-only
- Seed data: Insert all system roles (super_admin, division_admin, hope, division_chief, auditor, budget_officer, supply_officer, bac_chair, bac_member, bac_secretariat, iac_member, property_custodian, end_user, school_head, accountant)
- Seed data: Insert all permissions per SYSTEM_PLAN.md Section 4.2
- Seed data: Insert role_permissions mappings

### D. Frontend (Next.js)

**Pages:**

- `(auth)/login/page.tsx` — Full login page with Supabase Auth
- `(auth)/forgot-password/page.tsx`
- `(auth)/reset-password/page.tsx`
- `(dashboard)/admin/page.tsx` — Division Admin dashboard
- `(dashboard)/admin/offices/page.tsx` — Office/school list (tree view)
- `(dashboard)/admin/offices/[id]/page.tsx` — Office detail/edit
- `(dashboard)/admin/users/page.tsx` — User list within division
- `(dashboard)/admin/users/[id]/page.tsx` — User detail, role assignment
- `(dashboard)/admin/roles/page.tsx` — Role list and assignment view
- `(dashboard)/admin/settings/page.tsx` — Division settings
- `(dashboard)/admin/fiscal-years/page.tsx` — Fiscal year configuration
- `(dashboard)/admin/audit-logs/page.tsx` — Division audit log viewer

**Components:**

- `components/shared/office-selector.tsx` — Office dropdown respecting user scope
- `components/shared/fiscal-year-selector.tsx`

**Hooks:**

- `lib/hooks/use-auth.ts` — Auth state
- `lib/hooks/use-division.ts` — Current division context
- `lib/hooks/use-office.ts` — Current office context
- `lib/hooks/use-permissions.ts` — Permission checking
- `lib/hooks/use-is-super-admin.ts`
- `lib/hooks/use-fiscal-year.ts`

**Middleware update:**

- Route Super Admin to `/platform`, division users to `/dashboard`
- Block unauthenticated access to protected routes
- Block suspended division users from write operations

### E. User Roles Involved

- **Super Admin** (from Phase 2)
- **Division Admin** — manages offices, users, roles within their division
- All other roles created (as data) but not yet active in workflows

### F. Workflows Implemented

1. **Login Flow:** User enters credentials → Supabase Auth → Check role → Route to correct area (platform vs dashboard)
2. **User Onboarding:** Division Admin creates user → Assigns office → Assigns role(s) → User receives invite email
3. **Office Management:** Division Admin creates offices/schools → Sets hierarchy → Assigns users
4. **Role Assignment:** Division Admin selects user → Assigns role + office scope → Permissions derived from role

### G. Deliverable Outcome

- Users can log in and are routed to correct dashboard
- Division Admin can create offices, users, and assign roles
- RLS enforces division isolation (verified)
- All subsequent modules can rely on auth/permissions infrastructure
- Audit logging captures all changes

### H. Build Tasks

1. Create migration: `offices` table
2. Create migration: `user_profiles` table
3. Create migration: `roles` table with seed data (15 system roles)
4. Create migration: `permissions` table with seed data (all permission codes)
5. Create migration: `role_permissions` table with seed data (full matrix)
6. Create migration: `user_roles` table
7. Create migration: `audit.audit_logs` table
8. Create migration: `system_settings` table
9. Create migration: `sequence_counters` table
10. Create migration: `notifications` table
11. Create migration: `approval_logs` table
12. Create migration: `documents` table
13. Create RPC: `get_user_division_id()`
14. Create RPC: `is_division_active()`
15. Create RPC: `generate_sequence_number()`
16. Create RPC: `get_user_permissions()` and `has_permission()`
17. Create trigger function: `audit_trigger` (generic, applies to all tables)
18. Create trigger function: `update_timestamp`
19. Apply RLS to ALL tables: division isolation policy (Layer 1)
20. Apply RLS to ALL tables: office-level access (Layer 2)
21. Apply subscription enforcement RLS (suspended = read-only)
22. Build login page with Supabase Auth
23. Build forgot-password and reset-password pages
24. Update `middleware.ts`: auth redirect, role-based routing
25. Build hooks: `use-auth`, `use-division`, `use-office`, `use-permissions`, `use-is-super-admin`, `use-fiscal-year`
26. Build Division Admin dashboard page
27. Build offices management page (list + tree view)
28. Build office create/edit form
29. Build users management page (list within division)
30. Build user detail page with role assignment
31. Build roles list and assignment page
32. Build division settings page
33. Build fiscal years management page
34. Build division audit log viewer
35. Build `office-selector.tsx` component
36. Build `fiscal-year-selector.tsx` component
37. Generate TypeScript types: `npx supabase gen types typescript`
38. Test: Login as Division Admin → Create office → Create user → Assign role → Verify RLS isolation between two divisions
39. Update `(platform)/divisions/[id]/users/page.tsx` to show Division Admin accounts per division

---

## PHASE 4: Budget Management

### A. Scope

- Fiscal year management (per division)
- Budget allocation creation and management
- Budget adjustments with approval
- Obligation tracking infrastructure
- Budget utilization dashboard

### B. Database (Supabase)

**Tables to create:**

```
fiscal_years (id, division_id, year, is_active, start_date, end_date, status, created_at, updated_at)
  - UNIQUE(division_id, year)
  - status CHECK IN ('planning','open','closing','closed')

budget_allocations (id, division_id, fiscal_year_id, office_id, fund_source_id, account_code_id, original_amount, adjusted_amount, obligated_amount, disbursed_amount, description, status, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(fiscal_year_id, office_id, fund_source_id, account_code_id)

budget_adjustments (id, division_id, budget_allocation_id, adjustment_type, amount, justification, reference_number, approved_by, approved_at, status, office_id, deleted_at, created_at, updated_at, created_by)
  - adjustment_type CHECK IN ('realignment','augmentation','reduction','transfer_in','transfer_out')
```

**Relationships:**

- `fiscal_years.division_id` → `platform.divisions(id)`
- `budget_allocations.fiscal_year_id` → `fiscal_years(id)`
- `budget_allocations.office_id` → `offices(id)`
- `budget_allocations.fund_source_id` → `fund_sources(id)`
- `budget_allocations.account_code_id` → `account_codes(id)`

**Constraints:**

- Only one active fiscal year per division
- Amounts are NUMERIC(15,2)
- Obligated cannot exceed adjusted_amount

### C. Backend Logic

- RPC: `get_budget_summary(office_id, fiscal_year_id)` — returns allocation, obligated, disbursed, available per line item
- RPC: `check_budget_availability(budget_allocation_id, amount)` — returns boolean + available balance
- RPC: `approve_budget_adjustment(adjustment_id)` — updates adjustment status and recalculates allocation
- Trigger: On budget_adjustment approval → update `budget_allocations.adjusted_amount`
- Trigger: Enforce only one active fiscal year per division
- Validation: Budget adjustments cannot make available balance negative

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/budget/page.tsx` — Budget overview dashboard (utilization charts)
- `(dashboard)/budget/allocations/page.tsx` — Allocation list (filterable by office, fund source, expense class)
- `(dashboard)/budget/allocations/new/page.tsx` — Create allocation form
- `(dashboard)/budget/allocations/[id]/page.tsx` — Allocation detail (with obligation history)
- `(dashboard)/budget/adjustments/page.tsx` — Adjustment list
- `(dashboard)/budget/adjustments/[id]/page.tsx` — Adjustment detail/approval
- `(dashboard)/budget/obligations/page.tsx` — OBR list (placeholder — populated in Phase 11)
- `(dashboard)/budget/reports/page.tsx` — Budget utilization report

**Components:**

- `components/budget/allocation-form.tsx`
- `components/budget/budget-utilization-chart.tsx`
- `components/budget/fund-availability-badge.tsx` — Shows available balance inline
- `components/budget/adjustment-form.tsx`
- `components/shared/amount-display.tsx` — Currency formatting (Philippine Peso)
- `components/shared/approval-actions.tsx` — Approve/reject/return buttons (reusable)

**Zod schemas:**

- `lib/schemas/budget.ts` — allocation and adjustment validation

### E. User Roles Involved

- **Budget Officer** — creates allocations, certifies availability, creates adjustments
- **HOPE (SDS)** — approves adjustments
- **Division Chief** — reviews/approves adjustments
- **Division Admin** — full access
- **Auditor** — read-only

### F. Workflows Implemented

1. **Budget Allocation:** Budget Officer creates allocation per office/fund/UACS → Saved as active
2. **Budget Adjustment:** Budget Officer creates adjustment with justification → Division Chief/HOPE approves → System recalculates balances
3. **Budget Viewing:** Any authorized user can view budget utilization for their scope

### G. Deliverable Outcome

- Budget allocations created per office for the fiscal year
- Budget adjustments with approval workflow
- Real-time budget utilization visible
- Foundation ready for PPMP to validate against budget

### H. Build Tasks

1. Create migration: `fiscal_years` table (Note: may already exist from Phase 3 admin — verify and add if not)
2. Create migration: `budget_allocations` table
3. Create migration: `budget_adjustments` table
4. Apply RLS policies (division isolation + role-based access)
5. Create RPC: `get_budget_summary()`
6. Create RPC: `check_budget_availability()`
7. Create RPC: `approve_budget_adjustment()`
8. Create trigger: update `adjusted_amount` on adjustment approval
9. Create trigger: enforce single active fiscal year per division
10. Create Zod schema: `lib/schemas/budget.ts`
11. Build page: Budget overview dashboard with utilization chart
12. Build page: Allocation list with filters
13. Build page: Create allocation form
14. Build page: Allocation detail
15. Build page: Adjustment list
16. Build page: Adjustment detail with approval actions
17. Build page: Budget reports (utilization by fund source, by office)
18. Build components: allocation-form, budget-utilization-chart, fund-availability-badge, adjustment-form, amount-display, approval-actions
19. Seed test data: fiscal year 2026, sample allocations for 2 offices
20. Test: Create allocation → Create adjustment → Approve → Verify balance update

---

## PHASE 5: Planning Module (PPMP)

### A. Scope

- PPMP creation per office per fiscal year
- PPMP line items with budget linkage
- PPMP versioning (original, amendment, supplemental)
- PPMP approval workflow (Draft → Submitted → Under Review → Approved)
- PPMP amendment flow (creates new version)
- Budget validation during PPMP creation
- Version history and comparison

### B. Database (Supabase)

**Tables to create:**

```
ppmps (id, division_id, office_id, fiscal_year_id, current_version, status, submitted_at, submitted_by, reviewed_by, reviewed_at, approved_by, approved_at, review_notes, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(office_id, fiscal_year_id)
  - status CHECK IN ('draft','submitted','under_review','revision_required','approved','locked')

ppmp_versions (id, ppmp_id, version_number, version_type, amendment_justification, total_estimated_cost, snapshot_data, status, approved_by, approved_at, office_id, created_at, created_by)
  - UNIQUE(ppmp_id, version_number)
  - version_type CHECK IN ('original','amendment','supplemental')

ppmp_items (id, ppmp_version_id, ppmp_id, item_number, category, description, unit, quantity, estimated_unit_cost, estimated_total_cost, procurement_method, budget_allocation_id, schedule_q1-q4, is_cse, remarks, office_id, deleted_at, created_at, updated_at, created_by)
  - category CHECK IN ('common_use_supplies','non_common_supplies','equipment','services','infrastructure')
```

**Relationships:**

- `ppmps` → `offices`, `fiscal_years`, `platform.divisions`
- `ppmp_versions` → `ppmps`
- `ppmp_items` → `ppmp_versions`, `budget_allocations`

### C. Backend Logic

- RPC: `create_ppmp_amendment(ppmp_id, justification)` — clones current version items into new version
- RPC: `submit_ppmp(ppmp_id)` — validates completeness, changes status
- RPC: `approve_ppmp(ppmp_id)` — marks current version approved, updates parent
- RPC: `get_ppmp_version_history(ppmp_id)` — returns all versions with summary
- Trigger: On version approval → supersede previous version, update parent `current_version`
- Trigger: Block UPDATE on approved ppmp_versions
- Trigger: Populate `snapshot_data` JSONB on approval
- Validation: PPMP total per budget line must not exceed allocation
- Validation: Q1+Q2+Q3+Q4 quantities must equal total quantity
- Validation: Only one draft version at a time

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/planning/page.tsx` — Planning overview (PPMP count by status, APP status)
- `(dashboard)/planning/ppmp/page.tsx` — PPMP list (filterable by office, year, status)
- `(dashboard)/planning/ppmp/new/page.tsx` — Create PPMP form
- `(dashboard)/planning/ppmp/[id]/page.tsx` — PPMP detail (current version items, status)
- `(dashboard)/planning/ppmp/[id]/edit/page.tsx` — Edit PPMP (draft only)
- `(dashboard)/planning/ppmp/[id]/versions/page.tsx` — Version history with diff view
- `(dashboard)/planning/ppmp/import/page.tsx` — Bulk import placeholder (CSV/Excel)

**Components:**

- `components/planning/ppmp-form.tsx` — PPMP header + line items editor
- `components/planning/ppmp-item-table.tsx` — Editable line items table
- `components/planning/ppmp-version-diff.tsx` — Side-by-side version comparison
- `components/planning/budget-linkage-widget.tsx` — Shows available budget per line item in real-time
- `components/shared/workflow-tracker.tsx` — Status progress indicator (reusable)

**Zod schemas:**

- `lib/schemas/ppmp.ts`

### E. User Roles Involved

- **Supply Officer** — creates/edits PPMP, submits, initiates amendments
- **School Head** — creates/submits PPMP for their school
- **Division Chief** — reviews
- **HOPE (SDS)** — final approval
- **Division Admin** — full access
- **Auditor** — read-only

### F. Workflows Implemented

1. **PPMP Creation:** Supply Officer/School Head creates PPMP → Adds line items linked to budget → System validates budget → Submit
2. **PPMP Approval:** Submitted → Supply Officer (div) reviews → Division Chief reviews → HOPE approves → Status locked
3. **PPMP Amendment:** Supply Officer initiates amendment → System clones current version → Edit items → Submit for approval → If approved, old version superseded
4. **Budget Validation:** Real-time check during item entry — PPMP total per budget line vs. available allocation

### G. Deliverable Outcome

- Offices can create PPMPs linked to budget
- Full approval workflow functional
- Amendment versioning working
- Version history with diff viewable
- Budget validation prevents over-planning

### H. Build Tasks

1. Create migration: `ppmps` table
2. Create migration: `ppmp_versions` table
3. Create migration: `ppmp_items` table
4. Apply RLS policies
5. Create RPC: `create_ppmp_amendment()`
6. Create RPC: `submit_ppmp()`
7. Create RPC: `approve_ppmp()`
8. Create RPC: `get_ppmp_version_history()`
9. Create trigger: block UPDATE on approved versions
10. Create trigger: on approval → supersede old version, update parent
11. Create trigger: populate snapshot_data on approval
12. Create Zod schema: `lib/schemas/ppmp.ts`
13. Build page: Planning overview
14. Build page: PPMP list with filters
15. Build page: Create PPMP form with line items editor
16. Build page: PPMP detail (view mode)
17. Build page: Edit PPMP (draft only, with budget validation widget)
18. Build page: Version history with diff view
19. Build components: ppmp-form, ppmp-item-table, ppmp-version-diff, budget-linkage-widget, workflow-tracker
20. Test: Create PPMP → Add items → Submit → Approve → Initiate amendment → Approve v2 → Verify v1 is superseded

---

## PHASE 6: Planning Module (APP)

### A. Scope

- APP creation (one per division per fiscal year)
- Auto-consolidation of approved PPMPs
- APP line items linked to source PPMPs
- APP versioning (original, amendment, supplemental)
- APP approval workflow
- PhilGEPS posting tracking

### B. Database (Supabase)

**Tables to create:**

```
apps (id, division_id, office_id, fiscal_year_id, current_version, status, philgeps_reference, approved_by, approved_at, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(office_id, fiscal_year_id)
  - status CHECK IN ('consolidating','draft','submitted','reviewed','approved','posted')

app_versions (id, app_id, version_number, version_type, amendment_justification, total_estimated_cost, snapshot_data, status, approved_by, approved_at, office_id, created_at, created_by)
  - UNIQUE(app_id, version_number)

app_items (id, app_version_id, app_id, source_ppmp_item_id, item_number, category, description, unit, quantity, estimated_unit_cost, estimated_total_cost, procurement_method, budget_allocation_id, schedule_q1-q4, is_cse, source_office_id, remarks, office_id, deleted_at, created_at, updated_at, created_by)
```

**Relationships:**

- `app_items.source_ppmp_item_id` → `ppmp_items(id)` — traceability back to source PPMP

### C. Backend Logic

- RPC: `consolidate_app(division_id, fiscal_year_id)` — aggregates all approved PPMP items into APP draft
- RPC: `approve_app(app_id)` — marks approved, triggers posting readiness
- Validation: APP cannot be approved until all constituent PPMPs are approved
- Validation: APP total must reconcile with approved budget
- Trigger: same versioning triggers as PPMP

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/planning/app/page.tsx` — APP list
- `(dashboard)/planning/app/new/page.tsx` — Create/initiate APP
- `(dashboard)/planning/app/[id]/page.tsx` — APP detail
- `(dashboard)/planning/app/[id]/consolidate/page.tsx` — Consolidation view (shows all incoming PPMP items, grouping options)
- `(dashboard)/planning/app/[id]/versions/page.tsx` — Version history

**Components:**

- `components/planning/app-consolidation-view.tsx` — Shows PPMP items being consolidated, allows grouping/re-categorization

### E. User Roles Involved

- **Supply Officer (Division)** — initiates consolidation, manages APP
- **Division Chief** — reviews
- **HOPE (SDS)** — approves
- **Division Admin** — full access

### F. Workflows Implemented

1. **APP Consolidation:** Supply Officer triggers consolidation → System pulls all approved PPMP items → Creates draft APP → Supply Officer reviews/adjusts → Submit
2. **APP Approval:** Submitted → Division Chief reviews → HOPE approves → Marked for PhilGEPS posting
3. **APP Amendment:** Triggered by PPMP amendments or supplemental needs → New APP version → Approval flow

### G. Deliverable Outcome

- One-click consolidation of PPMPs into APP
- Full APP approval workflow
- APP versioning with amendment support
- Complete planning cycle from budget → PPMP → APP

### H. Build Tasks

1. Create migration: `apps` table
2. Create migration: `app_versions` table
3. Create migration: `app_items` table
4. Apply RLS policies
5. Create RPC: `consolidate_app()` — pulls approved PPMP items, creates APP items
6. Create RPC: `approve_app()`
7. Create validation: check all PPMPs approved before APP approval
8. Build page: APP list
9. Build page: Create/initiate APP
10. Build page: APP detail
11. Build page: Consolidation view with PPMP source tracking
12. Build page: APP version history
13. Build component: app-consolidation-view
14. Test: Have 3 approved PPMPs → Consolidate into APP → Verify all items present with source tracking → Approve APP

---

## PHASE 7: Procurement Core (PR + Suppliers)

### A. Scope

- Supplier registry (per division)
- Purchase Request (PR) creation linked to APP
- PR line items
- Budget certification on PR (Budget Officer)
- PR approval workflow
- OBR/ORS creation
- Auto-numbering for PR and OBR

### B. Database (Supabase)

**Tables to create:**

```
suppliers (id, division_id, name, trade_name, tin, philgeps_number, address, city, province, zip_code, contact_person, contact_number, email, website, business_type, classification[], status, blacklist_reason, blacklist_date, blacklist_until, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(division_id, tin)
  - status CHECK IN ('active','blacklisted','suspended','inactive')

purchase_requests (id, division_id, pr_number, office_id, fiscal_year_id, purpose, requested_by, requested_at, fund_source_id, budget_allocation_id, app_item_id, total_estimated_cost, status, budget_certified_by, budget_certified_at, approved_by, approved_at, cancellation_reason, cancelled_by, cancelled_at, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(division_id, pr_number)
  - status CHECK IN ('draft','submitted','budget_certified','approved','in_procurement','completed','cancelled')

pr_items (id, purchase_request_id, item_number, description, unit, quantity, estimated_unit_cost, estimated_total_cost, ppmp_item_id, remarks, office_id, deleted_at, created_at, updated_at)

obligation_requests (id, division_id, obr_number, purchase_request_id, procurement_id, budget_allocation_id, office_id, amount, status, certified_by, certified_at, obligated_at, remarks, deleted_at, created_at, updated_at, created_by)
  - UNIQUE(division_id, obr_number)
  - status CHECK IN ('pending','certified','obligated','cancelled')
```

### C. Backend Logic

- RPC: `certify_budget_availability(pr_id)` — Budget Officer certifies → Creates OBR → Debits obligated_amount
- RPC: `approve_purchase_request(pr_id)` — HOPE/authorized approves
- RPC: `check_split_contract(office_id, category, amount)` — warns if cumulative suggests splitting
- Auto-number generation for PR and OBR using `generate_sequence_number()`
- Validation: PR must reference an approved APP item
- Validation: PR amount must not exceed available budget
- Trigger: On OBR certification → update `budget_allocations.obligated_amount`

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/procurement/page.tsx` — Procurement dashboard (PR count by status, active procurements)
- `(dashboard)/procurement/purchase-requests/page.tsx` — PR list
- `(dashboard)/procurement/purchase-requests/new/page.tsx` — Create PR (linked to APP items)
- `(dashboard)/procurement/purchase-requests/[id]/page.tsx` — PR detail + approval actions
- `(dashboard)/procurement/suppliers/page.tsx` — Supplier list
- `(dashboard)/procurement/suppliers/new/page.tsx` — Add supplier
- `(dashboard)/procurement/suppliers/[id]/page.tsx` — Supplier detail + history

**Components:**

- `components/procurement/pr-form.tsx` — PR creation with APP item linking
- `components/procurement/supplier-form.tsx`

**Zod schemas:**

- `lib/schemas/procurement.ts`

### E. User Roles Involved

- **Supply Officer / BAC Secretariat / End User / School Head** — create PR
- **Budget Officer** — certifies fund availability
- **HOPE / Division Chief / School Head** — approves PR
- **Supply Officer** — manages supplier registry

### F. Workflows Implemented

1. **PR Creation:** User creates PR → Links to APP item → Adds line items → Submits
2. **Budget Certification:** Budget Officer reviews PR → Certifies fund availability → OBR created → Budget debited
3. **PR Approval:** Certified PR → HOPE/authorized approves → PR ready for procurement
4. **Supplier Management:** Supply Officer adds/edits suppliers → Tracks TIN, PhilGEPS, classification, blacklist status

### G. Deliverable Outcome

- PRs can be created linked to APP
- Budget certification working with OBR
- Supplier registry functional
- Foundation ready for all procurement method workflows

### H. Build Tasks

1. Create migration: `suppliers` table
2. Create migration: `purchase_requests` table
3. Create migration: `pr_items` table
4. Create migration: `obligation_requests` table
5. Apply RLS policies
6. Create RPC: `certify_budget_availability()`
7. Create RPC: `approve_purchase_request()`
8. Create RPC: `check_split_contract()`
9. Create trigger: OBR certification → update obligated_amount on budget_allocations
10. Implement auto-numbering: PR-{OFFICE}-{YEAR}-{SEQ}, OBR-{OFFICE}-{YEAR}-{SEQ}
11. Create Zod schema: `lib/schemas/procurement.ts`
12. Build page: Procurement dashboard
13. Build page: PR list with filters
14. Build page: Create PR form (with APP item selector + budget availability display)
15. Build page: PR detail with approval/certification actions
16. Build page: Supplier list
17. Build page: Add supplier form
18. Build page: Supplier detail
19. Build components: pr-form, supplier-form
20. Test: Create PR → Certify budget → Approve → Verify OBR created and budget debited

---

## PHASE 8: Procurement Workflows (SVP + Shopping)

### A. Scope

- Procurement activity record creation
- SVP workflow (RFQ → quotations → abstract of canvass → award)
- Shopping workflow (canvass → comparison → award)
- Procurement stage tracking
- Bid/quotation recording

### B. Database (Supabase)

**Tables to create:**

```
procurements (id, division_id, procurement_number, office_id, fiscal_year_id, purchase_request_id, procurement_method, abc_amount, current_stage, awarded_supplier_id, contract_amount, savings_amount, failure_reason, failure_count, philgeps_reference, deleted_at, created_at, updated_at, created_by)

procurement_stages (id, procurement_id, stage, status, started_at, completed_at, completed_by, notes, office_id, created_at)

bids (id, procurement_id, supplier_id, bid_amount, bid_date, is_responsive, is_eligible, is_compliant, rank, evaluation_score, status, disqualification_reason, remarks, office_id, deleted_at, created_at, updated_at)

bid_items (id, bid_id, pr_item_id, offered_unit_cost, offered_total_cost, brand_model, specifications, remarks, created_at)
```

### C. Backend Logic

- RPC: `create_procurement(pr_id, method)` — creates procurement record, sets initial stage
- RPC: `advance_procurement_stage(procurement_id, next_stage, notes)` — progresses workflow
- RPC: `award_procurement(procurement_id, supplier_id, contract_amount)` — awards to winning bidder
- Validation: SVP → minimum 3 quotations required before award
- Validation: Shopping → minimum 3 canvass sheets
- Validation: Contract amount must not exceed ABC

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/procurement/activities/page.tsx` — All procurement activities list
- `(dashboard)/procurement/activities/[id]/page.tsx` — Procurement detail with stage tracker
- `(dashboard)/procurement/activities/[id]/bids/page.tsx` — Bid/quotation management

**Components:**

- `components/procurement/procurement-stage-tracker.tsx` — Visual stage progress
- `components/procurement/bid-evaluation-table.tsx` — Side-by-side quotation comparison
- `components/procurement/abstract-of-canvass.tsx` — Abstract view

### E. User Roles Involved

- **Supply Officer / BAC Secretariat** — manages procurement activities
- **BAC Chair / BAC Members** — evaluates bids (where applicable)
- **HOPE** — approves award

### F. Workflows Implemented

1. **SVP:** Approved PR → Create procurement (method=SVP) → Send RFQ to ≥3 suppliers → Record quotations → Evaluate → Award to lowest responsive → Create PO (Phase 11)
2. **Shopping:** Approved PR → Create procurement (method=shopping) → Record ≥3 canvass → Compare → Award to lowest → Create PO (Phase 11)

### G. Deliverable Outcome

- Most common procurement methods fully functional
- Stage tracking visible
- Bid evaluation working
- **This is the MVP milestone for procurement**

### H. Build Tasks

1. Create migration: `procurements` table
2. Create migration: `procurement_stages` table
3. Create migration: `bids` table
4. Create migration: `bid_items` table
5. Apply RLS policies
6. Create RPC: `create_procurement()`
7. Create RPC: `advance_procurement_stage()`
8. Create RPC: `award_procurement()`
9. Implement SVP validation (≥3 quotations)
10. Implement Shopping validation (≥3 canvass)
11. Implement ABC ceiling check
12. Build page: Procurement activities list
13. Build page: Procurement detail with stage tracker
14. Build page: Bid/quotation management (record quotations, evaluate)
15. Build components: procurement-stage-tracker, bid-evaluation-table, abstract-of-canvass
16. Test: Full SVP flow from PR → Award
17. Test: Full Shopping flow from PR → Award

---

## PHASE 9: Procurement Workflows (Competitive Bidding)

### A. Scope

- Full competitive bidding workflow (17 steps per SYSTEM_PLAN.md)
- Pre-procurement conference
- ITB publishing (PhilGEPS tracking)
- Pre-bid conference
- Bid submission and opening
- Technical + financial evaluation
- Post-qualification
- BAC resolution
- NOA, contract, NTP

### B. Database (Supabase)

No new tables needed — uses `procurements`, `procurement_stages`, `bids`, `bid_items` from Phase 8.

Additional columns/considerations:

- More granular stages for competitive bidding in `procurement_stages`
- Track ITB publication details, pre-bid conference notes
- Post-qualification results per bidder

### C. Backend Logic

- RPC: `advance_competitive_bidding_stage()` — enforces correct stage sequence
- Validation: Pre-bid conference mandatory if ABC > 1M for goods
- Validation: Minimum publication period (7 days for ≤2M, 21 days for >50M)
- Validation: Post-qualification required for lowest calculated responsive bid
- Validation: BAC quorum requirements

### D. Frontend (Next.js)

**Pages (extend existing):**

- `(dashboard)/procurement/activities/[id]/evaluation/page.tsx` — Detailed evaluation view (technical + financial tabs)

**Components:**

- Enhanced `procurement-stage-tracker.tsx` for competitive bidding (more stages)
- Pre-bid conference notes component
- Post-qualification checklist component

### E. User Roles Involved

- **BAC Chair** — leads proceedings, signs resolutions
- **BAC Members** — evaluate bids
- **BAC Secretariat** — prepares documents, manages timeline
- **HOPE** — approves BAC resolution and award

### F. Workflows Implemented

1. **Competitive Bidding (Full):** Pre-procurement → Publish ITB → Pre-bid → Bid submission → Opening → Preliminary exam → Technical evaluation → Financial evaluation → Post-qualification → BAC resolution → HOPE approval → NOA → Contract → NTP

### G. Deliverable Outcome

- Complete competitive bidding workflow per RA 12009
- BAC evaluation fully tracked
- Publication and timeline compliance enforced

### H. Build Tasks

1. Define all competitive bidding stages in system
2. Create RPC: `advance_competitive_bidding_stage()` with stage validation
3. Implement publication period validation
4. Implement pre-bid conference rules
5. Implement post-qualification workflow
6. Build evaluation page: technical + financial tabs
7. Build BAC resolution interface
8. Build NOA/NTP generation triggers
9. Enhance stage tracker for competitive bidding
10. Test: Full 17-step competitive bidding flow end-to-end

---

## PHASE 10: Procurement Workflows (Other Methods)

### A. Scope

- Direct Contracting workflow
- Repeat Order workflow
- Emergency Procurement workflow
- Negotiated Procurement workflow
- Agency-to-Agency workflow
- Failed procurement handling

### B. Database (Supabase)

No new tables — uses existing procurement tables. Each method uses different stage sequences.

### C. Backend Logic

- RPC: per-method stage advancement with method-specific validations
- **Direct Contracting:** justification required, BAC recommendation, HOPE approval
- **Repeat Order:** must reference original contract within 6 months, ≤25% increase
- **Emergency:** immediate purchase authorized, post-facto documentation within 30 days
- **Negotiated:** requires 2 failed biddings reference, BAC negotiation records
- **Agency-to-Agency:** MOA/MOU tracking
- RPC: `handle_failed_procurement(procurement_id, reason)` — increments failure_count, enables alternative methods

### D. Frontend (Next.js)

- Extend procurement activity detail page to handle all methods
- Method-specific form sections (justification fields, reference fields)
- Failed procurement interface (declare failure, route to re-bid or alternative)

### E. User Roles Involved

- Same as Phases 8-9 depending on method

### F. Workflows Implemented

1. **Direct Contracting:** Justification → BAC recommends → HOPE approves → Contract
2. **Repeat Order:** Reference original → Price verify (≤25%) → BAC confirms → PO
3. **Emergency:** Purchase → Document post-facto → BAC reviews within 30 days
4. **Negotiated:** 2 failed biddings → BAC negotiates → HOPE approves → Contract
5. **Agency-to-Agency:** Identify agency → MOA → Execute
6. **Failed Procurement:** BAC declares failure → Re-bid or switch method

### G. Deliverable Outcome

- All RA 12009 procurement methods implemented
- Full compliance with method-specific rules and thresholds
- Failed procurement routing working

### H. Build Tasks

1. Implement Direct Contracting stage sequence and validation
2. Implement Repeat Order stage sequence (6-month reference, 25% cap)
3. Implement Emergency Procurement (post-facto documentation, 30-day BAC review)
4. Implement Negotiated Procurement (failed biddings reference)
5. Implement Agency-to-Agency (MOA tracking)
6. Create RPC: `handle_failed_procurement()`
7. Build method-specific form sections in procurement detail page
8. Build failed procurement UI (declare failure, route options)
9. Test: Each method end-to-end
10. Test: Failed bidding → Negotiated procurement transition

---

## PHASE 11: Purchase Orders & Delivery

### A. Scope

- Purchase Order (PO) creation from awarded procurement
- PO line items
- PO approval and issuance
- Delivery recording (partial and full)
- Inspection & Acceptance (IAC)
- PO status tracking
- Obligation recording on PO approval

### B. Database (Supabase)

**Tables to create:**

```
purchase_orders (id, division_id, po_number, procurement_id, supplier_id, office_id, total_amount, delivery_date, delivery_address, payment_terms, status, approved_by, approved_at, issued_at, deleted_at, created_at, updated_at, created_by)
  - status CHECK IN ('draft','approved','issued','partially_delivered','fully_delivered','completed','cancelled')

po_items (id, purchase_order_id, pr_item_id, description, unit, quantity, unit_cost, total_cost, delivered_quantity, remarks, office_id, created_at, updated_at)

deliveries (id, purchase_order_id, delivery_number, delivery_date, received_by, inspection_date, inspected_by, inspection_status, inspection_report_number, remarks, office_id, deleted_at, created_at, updated_at, created_by)
  - inspection_status CHECK IN ('pending','passed','failed','partial_acceptance')

delivery_items (id, delivery_id, po_item_id, quantity_delivered, quantity_accepted, quantity_rejected, rejection_reason, remarks, office_id, created_at, updated_at)
```

### C. Backend Logic

- RPC: `create_purchase_order(procurement_id)` — generates PO from awarded procurement
- RPC: `process_delivery(delivery_data)` — records delivery, updates PO delivered quantities
- RPC: `complete_inspection(delivery_id, results)` — IAC records inspection, updates acceptance
- Trigger: On delivery acceptance → update `po_items.delivered_quantity`
- Trigger: On full delivery → update PO status to 'fully_delivered'
- Trigger: On PO approval → record obligation via OBR
- Auto-numbering: PO-{OFFICE}-{YEAR}-{SEQ}

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/procurement/purchase-orders/page.tsx` — PO list
- `(dashboard)/procurement/purchase-orders/[id]/page.tsx` — PO detail + delivery tracking
- `(dashboard)/procurement/deliveries/page.tsx` — Delivery list
- `(dashboard)/procurement/deliveries/[id]/page.tsx` — Delivery detail + inspection form

**Components:**

- `components/procurement/po-form.tsx`
- `components/procurement/delivery-inspection-form.tsx`

### E. User Roles Involved

- **Supply Officer / BAC Secretariat** — creates PO
- **HOPE / Division Chief** — approves PO
- **IAC Members** — inspects deliveries
- **Supply Officer** — receives deliveries

### F. Workflows Implemented

1. **PO Creation:** Awarded procurement → Generate PO → Add line items → Approve → Issue to supplier
2. **Delivery:** Supplier delivers → Supply Officer receives → IAC inspects → Accept/Reject → Update PO status
3. **Partial Delivery:** Record partial → Track remaining → Subsequent deliveries until fully delivered

### G. Deliverable Outcome

- Complete procurement-to-delivery cycle
- Delivery inspection working
- PO status reflects delivery progress
- **This completes the core procurement lifecycle**

### H. Build Tasks

1. Create migration: `purchase_orders` table
2. Create migration: `po_items` table
3. Create migration: `deliveries` table
4. Create migration: `delivery_items` table
5. Apply RLS policies
6. Create RPC: `create_purchase_order()`
7. Create RPC: `process_delivery()`
8. Create RPC: `complete_inspection()`
9. Create trigger: delivery acceptance → update po_items.delivered_quantity
10. Create trigger: full delivery → update PO status
11. Implement PO auto-numbering
12. Build page: PO list
13. Build page: PO detail with delivery tracking
14. Build page: Delivery list
15. Build page: Delivery detail with inspection form
16. Build components: po-form, delivery-inspection-form
17. Test: Full flow — Award → PO → Deliver → Inspect → Accept → PO completed
18. Test: Partial delivery → Second delivery → Full completion

---

## PHASE 12: Asset Management (Inventory)

### A. Scope

- Item catalog (consumable, semi-expendable, PPE)
- Inventory stock tracking per office
- Stock-in from deliveries
- Stock-out via issuance (RIS)
- Stock cards (running balance per item)
- Stock movements ledger
- Reorder point alerts

### B. Database (Supabase)

**Tables to create:**

```
item_catalog (id, code, name, description, category, unit, account_code_id, useful_life_years, is_active, created_at, updated_at)
  - code UNIQUE
  - category CHECK IN ('consumable','semi_expendable','ppe')

inventory (id, item_catalog_id, office_id, current_quantity, reorder_point, location, last_count_date, last_count_quantity, deleted_at, created_at, updated_at)
  - UNIQUE(item_catalog_id, office_id)

stock_movements (id, inventory_id, movement_type, quantity, reference_type, reference_id, remarks, office_id, created_at, created_by)
  - movement_type CHECK IN ('stock_in','stock_out','adjustment','transfer_in','transfer_out','return')
```

### C. Backend Logic

- RPC: `stock_in_from_delivery(delivery_id)` — creates inventory entries from accepted delivery items
- RPC: `stock_out_for_issuance(inventory_id, quantity, reference)` — decrements stock
- Trigger: On stock_movement insert → update `inventory.current_quantity`
- Validation: Stock-out cannot exceed current_quantity
- Validation: Reorder point alerts when quantity drops below threshold

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/assets/page.tsx` — Asset dashboard (stock levels, alerts, counts)
- `(dashboard)/assets/inventory/page.tsx` — Stock list (all items, quantities, locations)
- `(dashboard)/assets/inventory/[id]/page.tsx` — Stock card view (movements ledger)
- `(dashboard)/assets/inventory/physical-count/page.tsx` — Physical count entry + variance
- `(dashboard)/admin/item-catalog/page.tsx` — Item catalog management

**Components:**

- `components/assets/stock-card.tsx` — Running balance display with movement history

### E. User Roles Involved

- **Supply Officer** — manages inventory, processes stock-in/out
- **Property Custodian** — views assigned items
- **Division Admin** — manages item catalog

### F. Workflows Implemented

1. **Stock-In from Delivery:** Delivery accepted → System auto-creates stock entries → Inventory updated
2. **Stock-Out (Issuance):** Request approved → Supply Officer issues via RIS → Stock debited → Movement recorded
3. **Physical Count:** Supply Officer enters count → System computes variance → Adjustments recorded

### G. Deliverable Outcome

- Inventory tracking from procurement delivery
- Stock cards with full movement history
- Reorder alerts functional
- Foundation for asset registration (Phase 13) and request fulfillment (Phase 14)

### H. Build Tasks

1. Create migration: `item_catalog` table with seed data
2. Create migration: `inventory` table
3. Create migration: `stock_movements` table
4. Apply RLS policies
5. Create RPC: `stock_in_from_delivery()`
6. Create RPC: `stock_out_for_issuance()`
7. Create trigger: stock_movement → update inventory.current_quantity
8. Implement stock validation (no negative stock)
9. Implement reorder point alert logic
10. Build page: Asset dashboard
11. Build page: Stock list
12. Build page: Stock card detail
13. Build page: Physical count with variance report
14. Build page: Item catalog management
15. Build component: stock-card
16. Create Zod schema: `lib/schemas/asset.ts`
17. Test: Delivery → Stock-in → Verify inventory → Issue → Verify decrement → Physical count → Adjustment

---

## PHASE 13: Asset Management (Property)

### A. Scope

- Asset registration from accepted deliveries (semi-expendable + PPE)
- Property tagging with auto-numbering
- QR code generation
- PAR (Property Acknowledgment Receipt) for PPE
- ICS (Inventory Custodian Slip) for semi-expendable
- Custodian management (assignment, transfer, return)
- Depreciation tracking (straight-line, monthly computation)
- Disposal workflow

### B. Database (Supabase)

**Tables to create:**

```
assets (id, division_id, property_number, item_catalog_id, office_id, description, brand_model, serial_number, acquisition_date, acquisition_cost, source_po_id, source_delivery_id, asset_type, condition_status, current_custodian_id, location, useful_life_years, residual_value, accumulated_depreciation, book_value, status, disposal_date, disposal_method, disposal_reference, deleted_at, created_at, updated_at, created_by)
  - asset_type CHECK IN ('semi_expendable','ppe')
  - condition_status CHECK IN ('serviceable','needs_repair','unserviceable','disposed')
  - status CHECK IN ('active','transferred','for_disposal','disposed','lost','donated')

asset_assignments (id, asset_id, custodian_id, office_id, document_type, document_number, assigned_date, returned_date, remarks, assigned_by, is_current, created_at, updated_at)
  - document_type CHECK IN ('par','ics')

depreciation_records (id, asset_id, period_year, period_month, depreciation_amount, accumulated_amount, book_value, office_id, created_at)
  - UNIQUE(asset_id, period_year, period_month)
```

### C. Backend Logic

- RPC: `register_asset_from_delivery(delivery_item_id, asset_details)` — creates asset record, assigns property number
- RPC: `transfer_asset(asset_id, new_custodian_id)` — transfers custody with audit trail
- RPC: `calculate_depreciation(asset_id)` — computes monthly depreciation (straight-line)
- RPC: `run_monthly_depreciation(fiscal_year, month)` — batch depreciation for all active PPE
- RPC: `initiate_disposal(asset_id, method)` — starts disposal workflow
- Property number auto-generation: `{OFFICE_CODE}-{YEAR}-{CATEGORY}-{SEQUENCE}`
- Trigger: On asset_assignment → update asset.current_custodian_id
- Trigger: On depreciation_record → update asset.accumulated_depreciation and asset.book_value

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/assets/registry/page.tsx` — All assets (PPE + semi-expendable) with filters
- `(dashboard)/assets/registry/[id]/page.tsx` — Asset detail (custody history, depreciation, condition)
- `(dashboard)/assets/assignments/page.tsx` — Current assignments list
- `(dashboard)/assets/assignments/transfer/page.tsx` — Transfer custody form
- `(dashboard)/assets/disposal/page.tsx` — Disposal management
- `(dashboard)/assets/reports/page.tsx` — RPCPPE, depreciation schedule

**Components:**

- `components/assets/asset-form.tsx`
- `components/assets/assignment-form.tsx`
- `components/assets/depreciation-schedule.tsx`
- `components/assets/qr-code-display.tsx`
- `components/assets/physical-count-form.tsx`

### E. User Roles Involved

- **Supply Officer** — registers assets, assigns custodians, processes transfers
- **Property Custodian** — views assigned assets, reports condition
- **HOPE** — approves disposals
- **End User** — views own assets

### F. Workflows Implemented

1. **Asset Registration:** Delivery accepted → Supply Officer registers asset → System assigns property number → QR code generated → PAR/ICS created → Assigned to custodian
2. **Asset Transfer:** Supply Officer initiates → Previous custodian returns → New custodian accepts → PAR/ICS updated
3. **Depreciation:** Monthly batch → System computes straight-line depreciation → Records posted → Book values updated
4. **Disposal:** Asset marked unserviceable → Condemnation → Disposal approved → Removed from active inventory

### G. Deliverable Outcome

- Complete asset lifecycle tracking
- PAR/ICS accountability
- Depreciation computed automatically
- Full traceability from procurement to disposal

### H. Build Tasks

1. Create migration: `assets` table
2. Create migration: `asset_assignments` table
3. Create migration: `depreciation_records` table
4. Apply RLS policies
5. Create RPC: `register_asset_from_delivery()`
6. Create RPC: `transfer_asset()`
7. Create RPC: `calculate_depreciation()`
8. Create RPC: `run_monthly_depreciation()`
9. Create RPC: `initiate_disposal()`
10. Implement property number auto-generation
11. Create trigger: assignment → update current_custodian_id
12. Create trigger: depreciation → update accumulated/book_value
13. Build page: Asset registry with filters
14. Build page: Asset detail (full history, depreciation, custody)
15. Build page: Assignments list
16. Build page: Transfer custody form
17. Build page: Disposal management
18. Build page: Asset reports (RPCPPE, depreciation schedule)
19. Build components: asset-form, assignment-form, depreciation-schedule, qr-code-display
20. Test: Register asset → Assign custodian → Transfer → Compute depreciation → Dispose

---

## PHASE 14: Request System

### A. Scope

- Supply request (RIS — from stock)
- Equipment request (from inventory or new procurement)
- Service request (maintenance/repair)
- Procurement request (items not in stock)
- Request approval workflow
- Stock availability check and routing
- Fulfillment from stock or routing to procurement

### B. Database (Supabase)

**Tables to create:**

```
requests (id, division_id, request_number, request_type, office_id, requested_by, purpose, urgency, status, supervisor_id, supervisor_approved_at, supervisor_remarks, processed_by, processed_at, fulfillment_type, linked_pr_id, rejection_reason, deleted_at, created_at, updated_at, created_by)
  - request_type CHECK IN ('supply','equipment','service','procurement')
  - urgency CHECK IN ('low','normal','high','emergency')
  - status CHECK IN ('draft','submitted','supervisor_approved','processing','partially_fulfilled','fulfilled','rejected','cancelled')

request_items (id, request_id, item_catalog_id, description, unit, quantity_requested, quantity_issued, item_number, inventory_id, remarks, office_id, created_at, updated_at)
```

### C. Backend Logic

- RPC: `fulfill_request_from_stock(request_id)` — issues items from inventory, creates stock movements
- RPC: `route_request_to_procurement(request_id)` — creates PR from unfulfilled request items
- Validation: Stock fulfillment cannot exceed available stock
- Validation: Items not in APP → flag for supplemental APP amendment
- Auto-routing: check stock → if available, issue; if not, route to procurement
- Auto-numbering: REQ-{OFFICE}-{YEAR}-{SEQ}

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/requests/page.tsx` — My requests / all requests (role-based)
- `(dashboard)/requests/new/page.tsx` — Create request form
- `(dashboard)/requests/[id]/page.tsx` — Request detail with fulfillment actions
- `(dashboard)/requests/approvals/page.tsx` — Pending approvals

**Components:**

- `components/requests/request-form.tsx`
- `components/requests/request-fulfillment.tsx` — Stock check + issue or route UI

**Zod schemas:**

- `lib/schemas/request.ts`

### E. User Roles Involved

- **End User** — creates requests
- **School Head** — creates/approves school-level requests
- **Immediate Supervisor** — approves requests
- **Supply Officer** — processes fulfillment

### F. Workflows Implemented

1. **Supply Request:** End User creates → Supervisor approves → Supply Officer checks stock → [In stock] → Issue via RIS → [Not in stock] → Route to procurement
2. **Equipment Request:** End User creates → Supervisor approves → Supply Officer assigns from inventory or creates PR
3. **Emergency Request:** End User marks urgent → Bypasses normal routing with justification → Logged for audit

### G. Deliverable Outcome

- End users can request supplies/equipment
- Smart routing: stock fulfillment or procurement
- Complete request lifecycle

### H. Build Tasks

1. Create migration: `requests` table
2. Create migration: `request_items` table
3. Apply RLS policies
4. Create RPC: `fulfill_request_from_stock()`
5. Create RPC: `route_request_to_procurement()`
6. Implement stock check and routing logic
7. Implement auto-numbering for requests
8. Create Zod schema: `lib/schemas/request.ts`
9. Build page: Requests list
10. Build page: Create request form
11. Build page: Request detail with fulfillment
12. Build page: Request approvals
13. Build components: request-form, request-fulfillment
14. Test: Create request → Approve → Fulfill from stock → Verify inventory decrement
15. Test: Create request → Approve → Not in stock → Verify PR created

---

## PHASE 15: Notifications & Approval Inbox

### A. Scope

- Unified approval inbox (all pending approvals across modules)
- In-app notifications (status changes, deadlines, alerts)
- Email notifications (optional, via Edge Function)
- Real-time notification badge
- Notification preferences

### B. Database (Supabase)

Uses existing `notifications` and `approval_logs` tables from Phase 3.

### C. Backend Logic

- Trigger: `notify_on_status_change` — for all workflow tables, create notification on status change
- Edge Function: `send-notification` — email notification (optional)
- RPC: `get_pending_approvals()` — returns all items awaiting current user's action across all modules
- RPC: `mark_notification_read(notification_id)`
- Supabase Realtime: subscribe to notifications table for live updates

### D. Frontend (Next.js)

**Pages:**

- `(dashboard)/approvals/page.tsx` — Unified approval inbox (PPMPs, PRs, POs, adjustments, requests all in one view)
- `(dashboard)/notifications/page.tsx` — All notifications with read/unread

**Components:**

- Notification bell in topbar with unread count (Realtime)
- Notification dropdown
- Approval card (shows item type, summary, approve/reject actions)

### E. User Roles Involved

- All roles receive notifications relevant to their permissions
- Approvers see pending items in unified inbox

### F. Workflows Implemented

1. **Unified Approvals:** User opens inbox → Sees all pending items → Can approve/reject directly → System routes to next step
2. **Notifications:** Any status change → Notification created → User sees in-app → Optionally emailed

### G. Deliverable Outcome

- Single inbox for all approvals
- Real-time notifications
- No more missed approvals

### H. Build Tasks

1. Create trigger: `notify_on_status_change` for PPMPs, PRs, POs, adjustments, requests
2. Create RPC: `get_pending_approvals()` — union query across all approval-requiring tables
3. Create RPC: `mark_notification_read()`
4. Set up Supabase Realtime subscription for notifications
5. Create Edge Function: `send-notification` (email, optional)
6. Build page: Unified approval inbox
7. Build page: Notifications list
8. Build notification bell component in topbar
9. Build approval card component (type-specific summary + actions)
10. Test: Create PR → Verify notification for Budget Officer → Certify → Verify notification for HOPE → Approve → Verify notification for requester

---

## PHASE 16: Reports & Dashboards

### A. Scope

- Platform dashboard (Super Admin)
- Executive dashboard (HOPE / Division Chief)
- Budget dashboard (Budget Officer)
- Procurement dashboard (Supply Officer / BAC)
- Asset dashboard enhancements
- Compliance dashboard (Auditor)
- All DepEd-specific reports
- Data export (Excel/PDF)

### B. Database (Supabase)

No new tables. Create views and RPCs for aggregations:

- Budget utilization views
- Procurement status summary views
- Asset inventory summary views

### C. Backend Logic

- RPC: `get_executive_dashboard(division_id)` — budget vs utilized, procurement status, APP compliance
- RPC: `get_budget_dashboard(office_id, fy_id)` — utilization by fund, obligations, projections
- RPC: `get_procurement_dashboard(office_id)` — active by method, savings, cycle time
- RPC: `get_asset_dashboard(office_id)` — counts by category, conditions, depreciation
- RPC: `get_compliance_dashboard(division_id)` — procurement compliance, document completeness
- Edge Function: `export-reports` — Excel/PDF generation
- Database views for common aggregations

### D. Frontend (Next.js)

**Pages:**

- `(platform)/analytics/page.tsx` — Super Admin cross-division stats
- `(dashboard)/page.tsx` — Role-based home dashboard (enhance existing)
- `(dashboard)/reports/page.tsx` — Report center (select report type)
- `(dashboard)/reports/procurement/page.tsx` — Procurement monitoring report
- `(dashboard)/reports/budget/page.tsx` — Budget utilization report
- `(dashboard)/reports/assets/page.tsx` — RPCPPE, inventory reports
- `(dashboard)/reports/compliance/page.tsx` — COA compliance reports

**Components:**

- Charts (install recharts or similar)
- Report filter panels
- Export buttons (Excel/PDF)

### E. User Roles Involved

- All roles see role-appropriate dashboards and reports
- **Auditor** — sees compliance dashboard and all reports
- **HOPE** — sees executive dashboard

### F. Workflows Implemented

1. **Dashboard:** User logs in → Role-detected → Relevant widgets displayed
2. **Report Generation:** User selects report type → Sets filters → Views/exports

### G. Deliverable Outcome

- Rich dashboards for all user types
- All DepEd-specific reports available
- Export capability for COA audit

### H. Build Tasks

1. Install chart library (recharts)
2. Create database views for common aggregations
3. Create RPC: `get_executive_dashboard()`
4. Create RPC: `get_budget_dashboard()`
5. Create RPC: `get_procurement_dashboard()`
6. Create RPC: `get_asset_dashboard()`
7. Create RPC: `get_compliance_dashboard()`
8. Create Edge Function: `export-reports` (Excel generation)
9. Build: Super Admin analytics page
10. Enhance: Dashboard home with role-based widgets
11. Build: Report center page
12. Build: Procurement monitoring report (with export)
13. Build: Budget utilization report (with export)
14. Build: RPCPPE and inventory reports (with export)
15. Build: Compliance reports
16. Build: Report filter panels
17. Build: Export buttons (Excel/PDF download)
18. Test: Verify each dashboard shows correct data for each role

---

## PHASE 17: Document Generation & Compliance

### A. Scope

- PDF generation for all government documents
- PR, PO, NOA, NTP, Contract, ICS, PAR, RIS, OBR/ORS, DV
- Abstract of Canvass/Bids
- BAC Resolution template
- Inspection Report
- PhilGEPS data preparation
- APP export in GPPB format
- PPMP bulk import (Excel/CSV)

### B. Database (Supabase)

Uses existing `documents` table. No new tables.

### C. Backend Logic

- Edge Function: `generate-document` — PDF generation using a templating library
- Edge Function: `import-ppmp` — parse Excel/CSV for bulk PPMP creation
- Edge Function: `philgeps-data-prep` — format data for PhilGEPS posting
- Edge Function: `export-reports` — enhance from Phase 16
- Templates per document type (PR, PO, NOA, etc.) following DepEd/COA prescribed formats

### D. Frontend (Next.js)

**Components:**

- `components/shared/document-viewer.tsx` — PDF preview in modal
- `components/shared/file-upload.tsx` — Upload attachments
- Print/download buttons on all document pages
- Import wizard for PPMP Excel upload

### E. User Roles Involved

- All roles that interact with documents

### F. Workflows Implemented

1. **Document Generation:** User views PR/PO/etc → Clicks "Generate PDF" → PDF rendered with data → Download/print
2. **PPMP Import:** Upload Excel → System parses → Preview items → Confirm → Items created
3. **PhilGEPS Prep:** Supply Officer selects procurement → Generate PhilGEPS format → Copy/download for manual posting

### G. Deliverable Outcome

- All COA-prescribed documents generated from system data
- PPMP bulk import saves time
- PhilGEPS posting preparation automated
- **System is audit-ready**

### H. Build Tasks

1. Create Edge Function: `generate-document` with template engine
2. Create PDF templates: PR, PO, NOA, NTP, ICS, PAR, RIS, OBR/ORS, Inspection Report, Abstract, BAC Resolution
3. Create Edge Function: `import-ppmp` (Excel/CSV parser)
4. Create Edge Function: `philgeps-data-prep`
5. Build component: `document-viewer.tsx`
6. Build component: `file-upload.tsx`
7. Add print/download buttons to PR detail, PO detail, procurement detail, asset detail
8. Build PPMP import wizard page
9. Build PhilGEPS data preparation page
10. Test: Generate each document type → Verify format matches DepEd/COA standards

---

## PHASE 18: Optimization, UAT & Launch Prep

### A. Scope

- Performance optimization
- Edge case handling
- Security review
- User acceptance testing
- Bug fixes
- Data migration tools (if needed)
- Deployment configuration

### B. Tasks

**Performance:**

- Query optimization (add indexes on high-traffic columns)
- RLS policy performance review (avoid N+1 queries in RLS)
- Implement pagination everywhere
- Add caching where appropriate
- Optimize Supabase Realtime subscriptions

**Edge Cases (per SYSTEM_PLAN.md Section 10):**

- Multi-year budgets / continuing appropriations
- Mid-year PPMP amendments with already-procured items
- Failed procurement → re-bid or alternative method
- Partial deliveries with multiple batches
- User transfers between offices (role cleanup)
- Division subscription expiry (read-only enforcement)
- Year-end processing (lapsing vs continuing)

**Security:**

- Verify all RLS policies (cross-division access attempts)
- Verify subscription enforcement (suspended = read-only)
- Verify no direct table access bypasses RLS
- Input sanitization review
- CSRF/XSS prevention audit

**Scheduled Jobs:**

- Edge Function: `scheduled-depreciation` — monthly depreciation batch (cron: 1st of month)
- Edge Function: `budget-alerts` — weekly utilization threshold alerts
- Edge Function: `check-subscriptions` — daily subscription expiry check
- Edge Function: `division-usage-stats` — daily usage metrics for Super Admin

**UAT:**

- Test each role's complete workflow
- Test cross-module integration (Budget → PPMP → APP → PR → Procurement → Delivery → Asset)
- Test division isolation thoroughly
- Test subscription status enforcement

### H. Build Tasks

1. Add database indexes (division_id, office_id, fiscal_year_id on all tables; status columns; created_at)
2. Review and optimize all RLS policies
3. Implement pagination on all list pages
4. Handle all edge cases from Section 10
5. Create Edge Function: `scheduled-depreciation` (cron)
6. Create Edge Function: `budget-alerts` (cron)
7. Create Edge Function: `check-subscriptions` (cron)
8. Security audit: attempt cross-division access, verify blocked
9. Security audit: verify suspended division read-only
10. Full integration test: Budget → PPMP → APP → PR → SVP → PO → Delivery → Asset → Request
11. UAT: Division Admin workflow
12. UAT: Supply Officer workflow (planning through procurement)
13. UAT: Budget Officer workflow
14. UAT: BAC workflow (competitive bidding)
15. UAT: End User workflow (requests)
16. UAT: Super Admin workflow (division management)
17. Bug fixes from UAT
18. Deployment configuration (Vercel/production Supabase)

---

# 3. PHASE DEPENDENCIES

```
Phase 1 (Setup)
  └── Phase 2 (Platform Layer) — needs project scaffold + Supabase
       └── Phase 3 (Org & Auth) — needs divisions to exist as tenant boundary
            └── Phase 4 (Budget) — needs offices + users + roles for budget management
                 └── Phase 5 (PPMP) — needs budget to validate against
                      └── Phase 6 (APP) — needs PPMPs to consolidate
                           └── Phase 7 (PR + Suppliers) — needs APP to link PRs
                                ├── Phase 8 (SVP/Shopping) — needs PR infrastructure
                                │    └── Phase 9 (Competitive Bidding) — builds on Phase 8 infra
                                │         └── Phase 10 (Other Methods) — completes procurement coverage
                                └── Phase 11 (PO & Delivery) — needs awarded procurement
                                     └── Phase 12 (Inventory) — needs deliveries for stock-in
                                          └── Phase 13 (Property/Assets) — needs inventory for asset registration
                                               └── Phase 14 (Requests) — needs inventory (stock check) + procurement (PR routing)
                                                    └── Phase 15 (Notifications) — enhances all modules
                                                         └── Phase 16 (Reports) — needs data from all modules
                                                              └── Phase 17 (Documents) — needs all data flows working
                                                                   └── Phase 18 (UAT/Launch) — final hardening
```

**What breaks if order is wrong:**

| Skip/Reorder         | Consequence                                                        |
| -------------------- | ------------------------------------------------------------------ |
| Phase 3 before 2     | No divisions → no tenant isolation → data leaks between SDOs       |
| Phase 5 before 4     | PPMP can't validate against budget → allows over-planning          |
| Phase 7 before 6     | PR can't link to APP → violates RA 12009 requirement               |
| Phase 8 before 7     | No suppliers or PR infrastructure → procurement has no entry point |
| Phase 11 before 8-10 | No awarded procurement → PO has nothing to reference               |
| Phase 12 before 11   | No deliveries → no stock-in → empty inventory                      |
| Phase 13 before 12   | No inventory foundation → asset registration has no incoming flow  |
| Phase 14 before 12   | Request fulfillment can't check stock → routing logic broken       |

---

# 4. MVP STRATEGY

### Minimum Viable Product: Phases 1-8 + Phase 11

**After completing Phases 1 through 8 plus Phase 11, the system can:**

1. Super Admin onboards divisions
2. Division Admin manages offices/users/roles
3. Budget Officer creates budget allocations
4. Supply Officer creates PPMP → Submits → Gets approved
5. Division consolidates PPMPs into APP → Gets approved
6. End User creates Purchase Request linked to APP
7. Budget Officer certifies fund availability (OBR)
8. Supply Officer runs SVP or Shopping procurement
9. PO issued → Delivery recorded → Inspection done
10. Budget correctly debited throughout

**This is a working, demo-able system** that covers the most common DepEd procurement flow (SVP/Shopping is ~80% of their procurements).

### What's missing from MVP:

- Competitive bidding and other methods (but SVP handles most cases)
- Asset management (items delivered but not tracked as assets yet)
- Request system (users request via Supply Officer directly)
- Reports/dashboards (data is in the system, reports come later)
- Document generation (manual for now)

---

# 5. RISK AREAS

| Phase         | Risk Level  | Why                                                                                                                        | Mitigation                                                                                                                       |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 3**   | HIGH        | RLS is the security backbone. A misconfigured policy means data leaks between divisions.                                   | Test isolation exhaustively. Create a test script that attempts cross-division access for every table.                           |
| **Phase 5**   | MEDIUM-HIGH | Versioning logic is complex. Incorrect version management corrupts PPMP history.                                           | Write thorough RPC tests. Never allow UPDATE on approved versions (enforce via trigger + RLS).                                   |
| **Phase 8-9** | HIGH        | Procurement workflows are the core business logic. Wrong stage transitions or validations = compliance violations.         | Map every procurement method to exact RA 12009 requirements. Have stage transition validated at DB level, not just frontend.     |
| **Phase 9**   | HIGHEST     | Competitive bidding has 17+ steps, BAC evaluation, post-qualification, and strict timelines. Most complex single workflow. | Build incrementally. Test each stage independently. Consider breaking Phase 9 into sub-phases if needed.                         |
| **Phase 11**  | MEDIUM      | Partial delivery handling with multiple batches and inspection results is tricky.                                          | Test edge cases: partial delivery, rejection, re-delivery. Ensure PO quantity tracking is atomic (triggers, not frontend math).  |
| **Phase 4**   | MEDIUM      | Budget calculations must be exact. Rounding errors or race conditions on obligated_amount = audit findings.                | Use NUMERIC(15,2) everywhere. Use database-level transactions for obligation recording. Never compute budget math in JavaScript. |

---

# 6. MCP + MIGRATION STRATEGY

### When to use Supabase MCP (via Cursor)

| Action                                     | Use MCP?      | Notes                                                                 |
| ------------------------------------------ | ------------- | --------------------------------------------------------------------- |
| Create tables                              | YES           | Use MCP to run migrations in Supabase                                 |
| Create RPC functions                       | YES           | MCP can execute SQL to create functions                               |
| Create triggers                            | YES           | MCP for trigger creation SQL                                          |
| Set up RLS policies                        | YES           | MCP for RLS SQL — but REVIEW CAREFULLY before applying                |
| Seed data (roles, permissions, UACS codes) | YES           | MCP for seed data inserts                                             |
| Modify existing tables                     | MANUAL REVIEW | Always review migration SQL before running. Check for data loss risk. |
| Drop/rename columns                        | MANUAL REVIEW | Never auto-run destructive schema changes                             |
| Production migrations                      | MANUAL ONLY   | Never use MCP for production changes                                  |

### When to manually review migrations

1. **Any ALTER TABLE** — check for data loss, constraint violations
2. **Any DROP** — never drop without backup verification
3. **RLS policy changes** — test in isolation before applying
4. **Trigger modifications** — ensure no infinite loops or performance issues
5. **Index creation on large tables** — may lock table during creation

### Tables that must be locked early (minimal changes after creation)

| Table                | Reason                                              |
| -------------------- | --------------------------------------------------- |
| `platform.divisions` | Tenant boundary — schema changes affect everything  |
| `roles`              | Seed data referenced by all modules                 |
| `permissions`        | Seed data referenced by all RLS policies            |
| `role_permissions`   | Core security matrix                                |
| `fund_sources`       | Shared lookup referenced by budget + procurement    |
| `account_codes`      | UACS codes referenced everywhere                    |
| `user_profiles`      | Auth backbone — structural changes break login flow |

**Lock strategy:** Get these tables right in Phases 2-3. After Phase 4, treat their schemas as frozen. Add new columns only via careful ALTER TABLE with defaults.

### Migration naming convention

```
YYYYMMDD_HHMMSS_description.sql

Example:
20260401_010000_create_platform_divisions.sql
20260401_020000_create_offices.sql
20260401_030000_create_user_profiles.sql
20260401_040000_create_roles_and_permissions.sql
20260405_010000_create_budget_tables.sql
```

### Migration workflow

1. Write migration SQL
2. Review SQL (check constraints, FKs, RLS)
3. Run in development Supabase via MCP
4. Test the affected module
5. If issues → write rollback migration → fix → re-run
6. Once stable → commit migration file to repo
7. For production → run migrations manually in order

---

# QUICK REFERENCE: Phase → Working Feature

| After Phase | What works                                                       |
| ----------- | ---------------------------------------------------------------- |
| 3           | Login, user management, office management, role assignment       |
| 4           | + Budget allocation and adjustment                               |
| 5           | + PPMP creation with budget validation and versioning            |
| 6           | + APP consolidation and approval                                 |
| 7           | + Purchase Requests with budget certification, supplier registry |
| **8**       | **+ SVP and Shopping procurement (MVP milestone)**               |
| 9           | + Competitive bidding                                            |
| 10          | + All RA 12009 procurement methods                               |
| **11**      | **+ PO to delivery cycle (Full procurement lifecycle MVP)**      |
| 12          | + Inventory tracking from deliveries                             |
| 13          | + Asset registration, PAR/ICS, depreciation                      |
| 14          | + Request system with smart routing                              |
| 15          | + Unified approvals and notifications                            |
| 16          | + Dashboards and reports                                         |
| 17          | + Document generation (audit-ready)                              |
| **18**      | **+ Production-ready, UAT-verified system**                      |
