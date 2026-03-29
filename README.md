# DepEd Procurement, Asset & Budget Management System

A web-based management platform for the Department of Education, built to comply with **RA 12009** (Government Procurement Reform Act). Streamlines the full procurement lifecycle — from annual planning through purchase orders — alongside asset inventory and budget management, all within a multi-tenant architecture for division-level isolation.

## Features

- **Platform Administration** — Division onboarding, subscription management, shared lookup data (fund sources, account codes), system announcements, and audit logs
- **Organization & Auth** — Office hierarchy, user profiles, role-based permissions, and Row-Level Security enforcing division-tenant isolation
- **Budget Management** — Fiscal year management, budget allocations, and utilization tracking
- **PPMP / APP Planning** — End-user PPMP creation with multi-step approval chain (End User → Section Chief → Budget Officer → HOPE), INDICATIVE/FINAL versioning, and auto-population into the Annual Procurement Plan
- **Procurement Workflows** — Small Value Procurement, Shopping, Competitive Bidding, and other RA 12009-mandated methods *(in progress)*
- **Asset & Inventory Management** — Stock cards, PAR/ICS, custodian tracking, and depreciation *(planned)*
- **Document Generation** — PDF exports for PR, PO, NOA, ICS, PAR, and COA-compliant reports *(planned)*

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.1 (App Router) |
| Language | TypeScript 5 |
| UI Components | shadcn/ui + Radix UI |
| Styling | Tailwind CSS v4 |
| Forms & Validation | react-hook-form + Zod v4 |
| Backend / Auth | Supabase (PostgreSQL, Auth, RLS, Edge Functions) |
| Date Handling | date-fns v4 |

## Prerequisites

- Node.js >= 18
- A [Supabase](https://supabase.com) project

## Getting Started

### Installation

```bash
git clone <repo-url>
cd procurements-assets
npm install
```

### Configuration

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Database Migrations

Apply migrations in order from `supabase/migrations/`:

```bash
# Using Supabase CLI
supabase db push
```

Migrations are prefixed by date and dependency order (e.g., `20240201_platform_divisions.sql` before `20240315_rls_policies.sql`). All tables live in the `procurements` PostgreSQL schema, not `public`.

### Running

```bash
npm run dev     # development server at http://localhost:3000
npm run build   # production build
npm run start   # production server
npm run lint    # ESLint
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/         # Login, callback routes
│   ├── dashboard/      # Per-role dashboards (admin, offices, users, etc.)
│   └── platform/       # Super-admin: divisions, lookup data, announcements, audit logs
├── components/
│   ├── ui/             # shadcn/ui primitives (button, form, select, etc.)
│   └── shared/         # App-level components (DataTable, StatusBadge, ApprovalStepper, etc.)
├── lib/
│   ├── supabase/       # Supabase client helpers (SSR + hooks)
│   ├── actions/        # Next.js Server Actions
│   ├── schemas/        # Zod validation schemas
│   └── utils.ts        # cn() utility
└── types/              # TypeScript interfaces for DB tables
supabase/
└── migrations/         # Ordered SQL migrations (procurements schema)
```

## Development Phases

This project follows an 18-phase delivery plan defined in `EXECUTION_PLAN.md`:

| Status | Phase | Description |
|---|---|---|
| ✅ | 1 | Project setup & infrastructure |
| ✅ | 2 | Platform layer (Super Admin) |
| ✅ | 3 | Organization & auth foundation |
| ✅ | 4 | Budget management |
| 🔄 | 5–6 | PPMP & APP planning modules |
| ⏳ | 7–10 | Procurement workflows |
| ⏳ | 11–18 | POs, assets, requests, reports, documents |
