# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

DepEd Procurement, Asset & Budget Management System — a multi-tenant government procurement platform compliant with RA 12009 (Government Procurement Reform Act). Built for Schools Division Offices with division-level data isolation.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build (strict TypeScript)
npm run lint       # ESLint 9 with Next.js core-web-vitals + TypeScript rules
```

No test runner is configured. No Supabase type generation script exists — types in `src/types/database.ts` are maintained manually.

## Database Safety

**NEVER execute** migration commands (`supabase db push`, `supabase migration up`, or destructive SQL like `DROP TABLE`, `ALTER TABLE`, `DELETE FROM`, `TRUNCATE`, `UPDATE` without `WHERE`). Only generate migration SQL files in `supabase/migrations/`. Always ask before any schema change.

## Architecture

### Stack
- **Next.js 16.2.1** (App Router, React 19, Server Components)
- **Supabase** (PostgreSQL, Auth via Google OAuth, RLS, Realtime)
- **shadcn/ui** (base-nova style) + Tailwind CSS v4 + Radix UI
- **react-hook-form** + **Zod 4** for form validation
- **lucide-react** icons, **sonner** toasts, **date-fns** v4

### Next.js 16 Breaking Changes
- `middleware.ts` is **deprecated** — this project uses `src/proxy.ts` with `export function proxy()` and `export const config`. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` before modifying.
- Always check `node_modules/next/dist/docs/` for current API conventions before writing code.

### Database Schemas
All application tables live in **custom PostgreSQL schemas**, not `public`:
- **`procurements`** — all division-scoped data (offices, users, roles, PPMPs, APPs, budgets)
- **`platform`** — super-admin/tenant data (divisions, announcements, platform audit logs)
- **`audit`** — change audit trail

When querying with Supabase client, always specify the schema:
```typescript
supabase.schema("procurements").from("table_name")
supabase.schema("platform").from("divisions")
```

### Supabase Clients (src/lib/supabase/)
| File | Usage | RLS |
|------|-------|-----|
| `client.ts` | Browser — singleton, lazy-initialized | Yes |
| `server.ts` | Server actions — per-request via `cookies()` | Yes |
| `admin.ts` | Service role — bypasses RLS (onboarding, admin ops) | **No** |
| `middleware.ts` | Session refresh helper for `proxy.ts` | Yes |

### RLS: Two-Layer Isolation
1. **Division isolation**: Every policy checks `division_id = procurements.get_user_division_id()`. This function reads from `user_profiles` (not `auth.users` directly — permission denied in RLS context).
2. **Permission-based access**: `procurements.has_permission('code')` checks role→permission chain.
3. **Super admin**: `platform.is_super_admin()` reads `auth.users.raw_user_meta_data->>'is_super_admin'`.
4. **Soft deletes**: Most policies include `deleted_at IS NULL`.

### Server Actions (src/lib/actions/)
All backend logic uses Next.js Server Actions (`"use server"` directive). Conventions:
- Return `{ error: string | null, data?: T }`
- Use `createClient()` from `server.ts` (respects RLS) or `createAdminClient()` for admin bypass
- Call `revalidatePath()` for cache invalidation after mutations
- Notification helpers like `notifyRoleInOffice()` send batch notifications on status changes

### Route Structure
- `/login` → Google OAuth
- `/auth/callback` → OAuth exchange, profile check, routing
- `/onboarding` → New user division setup
- `/pending-approval` → Awaiting join request approval
- `/dashboard/**` → Division users (protected, requires `user_profiles` record)
- `/platform/**` → Super admins only (`is_super_admin` metadata check)

The proxy in `src/proxy.ts` enforces: auth guards, super-admin vs division routing, profile existence checks, and pending join request redirects.

### Role Hierarchy (16 roles, 3 scopes)
- **Platform**: `super_admin`
- **Division**: `division_admin`, `hope` (SDS), `division_chief`, `auditor`
- **Office**: `section_chief`, `budget_officer`, `supply_officer`, `bac_chair`, `bac_member`, `bac_secretariat`, `iac_member`, `property_custodian`, `end_user`, `school_head`, `accountant`

Permissions use dot-notation codes (e.g., `ppmp.create`, `budget.certify`), assigned through `role_permissions` junction table, checked via `has_permission()` RPC.

### Approval Workflow Pattern
PPMP: Draft → Submitted → Chief Reviewed → Budget Certified → Approved → Locked
APP: Populating → Indicative → Under Review → BAC Finalization → Final → Approved → Posted

Each step has a dedicated server action, triggers notifications to the next role in chain, and logs to `approval_logs`. Amendments create new versions; approved versions capture JSONB snapshots.

### PPMP → APP Auto-Population
A database trigger (`trg_auto_populate_app_from_ppmp`) fires on PPMP approval:
- First approval for fiscal year → creates APP + inserts items
- Subsequent approvals → appends items
- Amendment approved + APP editable → replaces items in-place
- Amendment approved + APP final → creates supplemental APP version

### Key Component Patterns
- **DataTable** (`components/shared/data-table.tsx`): Generic typed table with search, filters, pagination, row actions
- **ApprovalStepper** (`components/shared/approval-stepper.tsx`): Pre-built workflow templates for PPMP/APP/PR
- **Review Actions**: Dialog-based approve/return with optional notes, server action dispatch, toast feedback
- **Forms**: react-hook-form + Zod schema → shadcn components, nested dialog forms for hierarchical data (Projects → Lots → Items)

### Hooks (src/lib/hooks/)
- `useAuth()` — current user + loading state
- `usePermissions()` — calls `get_user_permissions` RPC, exposes `can()`, `canAny()`, `canAll()`
- `useDivision()` — current division context via RPC
- `useProfile()` — user profile with roles
- `useOffice()` — user's office context
- `useFiscalYear()` — active fiscal year

### Validation Schemas (src/lib/schemas/)
Zod schemas with inferred types: `ppmp.ts`, `app.ts`, `budget.ts`, `admin.ts`. Pattern:
```typescript
export const schema = z.object({ ... })
export type Input = z.infer<typeof schema>
```

### Migrations (supabase/migrations/)
~48 ordered SQL files named `YYYYMMDD_description.sql`. Phases build on each other:
Platform (0201-0207) → Auth/Org (0301-0315) → Budget (0401-0410) → PPMP (0501-0510) → APP (0601-0604).
Includes triggers (updated_at, audit, auto-population), RPC functions, RLS policies, and seed data (roles, permissions, office hierarchy).

### Context Providers
- `SidebarProvider` — collapsed state persisted to localStorage, nav groups
- `ActionCountsProvider` — real-time sidebar badges via Supabase Realtime subscription on `notifications` table

### Execution Plan
See `EXECUTION_PLAN.md` for the 18-phase delivery roadmap. Phases 1–6 are complete. Phase 7 (Procurement Core) is next.
