# DepEd Procurement, Asset, and Budget Management System

## Complete System Design & Plan

**Version:** 1.1 (Multi-Division / SaaS-Ready)
**Date:** 2026-03-28
**Compliance:** Republic Act No. 12009 (New Government Procurement Act), COA Regulations, DepEd Orders
**Classification:** System Architecture Document

---

# 1. SYSTEM OVERVIEW

## 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SUPER ADMIN LAYER (Platform)                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │
│  │  Division Mgmt │  │ Subscription  │  │  Platform     │           │
│  │  (Onboarding)  │  │  & Billing    │  │  Analytics    │           │
│  └───────────────┘  └───────────────┘  └───────────────┘           │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────────┐
│                 DIVISION TENANT LAYER (Per SDO)                      │
│                                                                      │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│   │ Planning  │ │  Budget  │ │Procure-  │ │  Asset   │              │
│   │  Module   │ │  Module  │ │  ment    │ │  Module  │              │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
│   ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐           │
│   │ Request  │ │ Reports  │ │ Division Admin / Settings │           │
│   │  System  │ │Dashboard │ │                          │           │
│   └──────────┘ └──────────┘ └──────────────────────────┘           │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS / WebSocket
┌─────────────────────────────┴───────────────────────────────────────┐
│                         SUPABASE LAYER                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                     │
│  │   Auth     │  │  Realtime  │  │  Storage   │                     │
│  │ (GoTrue)   │  │(Websocket) │  │  (S3-like) │                     │
│  └────────────┘  └────────────┘  └────────────┘                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                     │
│  │  PostgREST │  │    RPC     │  │   Edge     │                     │
│  │   (API)    │  │ Functions  │  │ Functions  │                     │
│  └────────────┘  └────────────┘  └────────────┘                     │
│  ┌──────────────────────────────────────────────────┐                │
│  │             PostgreSQL Database                    │                │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐  │                │
│  │  │ RLS  │ │Trig- │ │Views │ │Func- │ │Div.   │  │                │
│  │  │Polic.│ │gers  │ │      │ │tions │ │Isolat.│  │                │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘  │                │
│  └──────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────┘
```

## 1.2 Core Modules and Interactions

| Module             | Primary Function                                    | Interacts With          |
| ------------------ | --------------------------------------------------- | ----------------------- |
| **Planning**       | PPMP/APP creation, versioning, approval             | Budget, Procurement     |
| **Budget**         | Allocation, obligation tracking, balances           | Planning, Procurement   |
| **Procurement**    | End-to-end procurement workflows                    | Budget, Asset, Planning |
| **Asset**          | Inventory, tagging, depreciation, custody           | Procurement, Request    |
| **Request**        | Item/asset requests from offices                    | Asset, Procurement      |
| **Division Admin** | Users, roles, offices within a division             | All modules (scoped)    |
| **Platform Admin** | Division onboarding, subscriptions, platform config | Cross-division          |
| **Reports**        | Dashboards, compliance reports, exports             | All modules             |

## 1.3 Multi-Division / Multi-Tenant Architecture

The system uses a **shared database, shared schema** multi-tenant model with **two-level tenant isolation**:

### Tenant Hierarchy

```
Platform (Super Admin)
 └── Division (SDO) ← PRIMARY TENANT BOUNDARY
      ├── Division Office (offices within SDO)
      └── Schools (child offices under the Division)
```

### Key Design Decisions

| Concept                | Implementation                                                               |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Primary tenant**     | `division_id` — each Schools Division Office is a completely isolated tenant |
| **Sub-tenant**         | `office_id` — schools and sections within a division                         |
| **Data isolation**     | Division A **cannot** see Division B's data under any circumstance           |
| **Shared resources**   | Only platform-level lookup tables (UACS codes, fund sources) are shared      |
| **Subscription model** | Each division subscribes independently; Super Admin manages onboarding       |
| **Scalability**        | New divisions added without schema changes — just insert a row + configure   |

### How It Works

- A `divisions` table is the top-level tenant entity
- Every data row carries **both** `division_id` AND `office_id`
- `division_id` is the **hard boundary** — RLS enforces absolute isolation between divisions
- `office_id` provides finer-grained access within a division
- **Super Admin** operates across all divisions (platform management only, not operational data)
- **Division Admin** manages everything within their own division
- Users can only belong to one division (enforced by `user_profiles.division_id`)

## 1.4 SaaS / Subscription Model

```
┌──────────────────────────────────────────────────────────────┐
│                    PLATFORM (Super Admin)                      │
│                                                                │
│  Manages:                                                      │
│  ├── Division onboarding & offboarding                        │
│  ├── Subscription status (active, trial, suspended, expired)  │
│  ├── Feature flags per division (optional future)             │
│  ├── Platform-wide lookup data (UACS, fund sources)           │
│  ├── Cross-division analytics & health monitoring             │
│  └── System announcements & maintenance                       │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │SDO Cebu  │  │SDO Davao │  │SDO Manila│  │SDO Iloilo│     │
│  │(active)  │  │(active)  │  │(trial)   │  │(pending) │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└──────────────────────────────────────────────────────────────┘
```

**Onboarding a new Division:**

1. Super Admin creates the division record
2. System creates default offices (Division Office as root)
3. Super Admin creates the Division Admin account
4. Division Admin configures their offices, schools, users, and roles
5. Division begins using the system independently

**Subscription States:**
| State | Effect |
|-------|--------|
| `pending` | Division created but not yet active; no user access |
| `trial` | Full access for trial period; countdown visible |
| `active` | Full operational access |
| `suspended` | Read-only access; no new transactions; data preserved |
| `expired` | Login blocked; data preserved for reactivation |

## 1.5 RA 12009 Compliance Considerations

| RA 12009 Requirement                                      | System Implementation                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Approved Annual Procurement Plan (APP) before procurement | APP module with approval workflow; procurement blocked without approved APP |
| BAC oversight for competitive bidding                     | BAC role with mandatory evaluation steps in workflow                        |
| Alternative methods of procurement (SVP, Direct, etc.)    | Separate workflow per method with method-specific validations               |
| Transparency and public disclosure                        | Document generation, bid posting, award notices                             |
| PhilGEPS posting requirements                             | Integration-ready fields; manual posting with tracking                      |
| Procurement monitoring and reporting                      | Real-time dashboards, COA-ready reports                                     |
| Emergency procurement provisions                          | Expedited workflow with post-facto documentation                            |
| Supplier blacklisting                                     | Supplier management with status tracking                                    |
| Split-contract prevention                                 | Automated threshold warnings and year-to-date tracking per item category    |

---

# 2. CORE MODULES (DETAILED)

## A. PLANNING MODULE (PPMP / APP)

### A.1 PPMP (Project Procurement Management Plan)

**Purpose:** Each office/school creates a PPMP listing all items/services needed for the fiscal year.

**Key Features:**

- Create PPMP per office per fiscal year
- Line items with: description, quantity, unit, estimated unit cost, total cost, mode of procurement, schedule/quarter
- Item categorization (common-use supplies, non-common supplies, equipment, services)
- Link items to budget line items (MOOE, Capital Outlay, etc.)
- PPMP versioning (see Section 8)
- Bulk import from previous year's PPMP
- Excel/CSV import capability

**Status Workflow:**

```
Draft → Submitted → Under Review → Revision Required → Approved → Locked
                                        ↑                    │
                                        └────────────────────┘
                                        (Amendment triggers new version)
```

**Business Rules:**

- Only one active PPMP per office per fiscal year
- Amendments create a new version, previous version is archived (never overwritten)
- Total estimated cost must not exceed allocated budget
- Items flagged as "common-use" auto-route to PS-DBM catalog pricing
- Quarterly schedule is mandatory for each line item
- PPMP must be submitted before APP consolidation deadline

### A.2 APP (Annual Procurement Plan)

**Purpose:** The Division Office consolidates all PPMPs into a single APP.

**Key Features:**

- Auto-consolidation of approved PPMPs from all offices/schools
- APP-level adjustments (grouping, re-categorization)
- APP versioning (independent of PPMP versions)
- Approval workflow (Division Supply Officer → Division Chief → SDS)
- Indicator columns: CSE (Common Supplies Equipment) vs. non-CSE
- Procurement method assignment per line item/group
- Quarterly breakdown with indicative budget
- Export to GPPB-prescribed APP format

**Status Workflow:**

```
Consolidating → Draft → Submitted → Reviewed → Approved → Posted (PhilGEPS)
                                                    │
                                                    ├── Amendment v2, v3...
                                                    └── Supplemental APP
```

**Business Rules:**

- Cannot be approved until all constituent PPMPs are approved
- APP total must reconcile with approved budget
- Supplemental APPs allowed mid-year with justification
- PhilGEPS posting flag tracked per APP version

### A.3 Linking to Budget

- Each PPMP line item maps to a `budget_line_item_id`
- System validates that total PPMP cost per budget line does not exceed allocation
- Real-time budget utilization display during PPMP creation
- Warning when PPMP total approaches 80% of budget allocation

---

## B. BUDGET MANAGEMENT MODULE

### B.1 Budget Structure

```
Fiscal Year
 └── Office Budget
      └── Fund Source (General Fund, MOOE, Trust Fund, SEF, etc.)
           └── Expense Class (PS, MOOE, CO, Financial Expenses)
                └── Budget Line Item (specific account code / UACS)
                     ├── Original Allotment
                     ├── Adjustments (+/-)
                     ├── Current Allotment
                     ├── Obligations
                     └── Available Balance
```

### B.2 Key Features

| Feature              | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| Budget Creation      | Per fiscal year, per office, per fund source                |
| Allotment Management | Sub-allotments to offices/schools with UACS codes           |
| Obligation Tracking  | Auto-debit when PO/Contract is approved                     |
| Balance Monitoring   | Real-time available balance per line item                   |
| Budget Adjustments   | Realignment, augmentation with audit trail                  |
| Multi-Year Support   | Continuing appropriations, carry-over tracking              |
| UACS Integration     | Chart of accounts aligned to Unified Account Code Structure |

### B.3 Budget-Procurement Integration

```
Budget Allocation
    ↓
PPMP References Budget Line
    ↓
PR (Purchase Request) → Obligation Request (OBR/ORS)
    ↓
Budget Officer certifies fund availability
    ↓
PO/Contract → Obligation recorded
    ↓
Delivery + Inspection → Disbursement Voucher
    ↓
Payment → Liquidation
```

### B.4 Business Rules

- No procurement can proceed without certified budget availability
- Obligations cannot exceed available allotment
- Budget Officer must digitally certify fund availability on every PR
- Realignments require approval from authorized signatory
- Year-end balances computed for continuing vs. lapsing appropriations
- Quarterly budget utilization reports auto-generated

---

## C. PROCUREMENT MODULE (END-TO-END)

### C.1 Procurement Methods Under RA 12009

| Method                            | Threshold / Condition                               | BAC Required              | Key Documents                                                          |
| --------------------------------- | --------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| **Competitive Bidding**           | Default method; above ₱1M (goods), ₱5M (infra)      | Yes - Full BAC            | ITB, Bid Docs, Bid Evaluation, Resolution of Award, NOA, NTP, Contract |
| **Small Value Procurement (SVP)** | ≤₱1M (goods), ≤₱5M (infra)                          | BAC or authorized officer | PR, RFQ (min 3 canvass), Abstract of Canvass, PO                       |
| **Direct Contracting**            | Proprietary/exclusive dealer, conditions met        | BAC recommends            | Justification, Price Reasonableness, Contract                          |
| **Repeat Order**                  | Within 6 months of original contract, ≤25% increase | BAC confirms              | Reference to original contract, price verification                     |
| **Shopping**                      | Unforeseen contingency ≤₱250K (goods)               | No                        | Canvass sheets, comparison                                             |
| **Emergency Procurement**         | Imminent danger, calamity                           | Post-facto BAC review     | Emergency Purchase Report, Justification                               |
| **Negotiated Procurement**        | Two failed biddings, specialized                    | BAC oversight             | Negotiation records, BAC resolution                                    |
| **Agency-to-Agency**              | Procurement from another government entity          | No                        | MOA/MOU                                                                |

### C.2 Universal Procurement Workflow Stages

Every procurement, regardless of method, passes through these stages:

```
Stage 1: INITIATION
  ├── Purchase Request (PR) created
  ├── PR linked to PPMP/APP line item
  ├── Budget availability certified (OBR/ORS)
  └── PR approved by authorized signatory

Stage 2: SOURCING
  ├── [Competitive Bidding] → ITB published, pre-bid, bid submission, bid opening
  ├── [SVP] → RFQ sent to ≥3 suppliers, quotations received
  ├── [Direct Contracting] → Single-source justification, price reasonableness
  ├── [Shopping] → Canvass ≥3 suppliers
  ├── [Emergency] → Immediate purchase, post-documentation
  └── [Repeat/Negotiated] → Method-specific sourcing

Stage 3: EVALUATION
  ├── BAC evaluates bids/quotations (where applicable)
  ├── Technical evaluation
  ├── Financial evaluation
  ├── Post-qualification (Competitive Bidding)
  └── BAC Resolution recommending award

Stage 4: AWARD
  ├── Notice of Award (NOA) issued
  ├── Performance security posted (if required)
  ├── Contract / Purchase Order prepared
  ├── Contract signed
  └── Notice to Proceed (NTP) issued

Stage 5: DELIVERY & INSPECTION
  ├── Supplier delivers goods/services
  ├── Inspection & Acceptance Committee (IAC) inspects
  ├── Inspection Report prepared
  ├── Goods accepted or rejected (partial/full)
  └── If partial → track remaining deliverables

Stage 6: PAYMENT
  ├── Disbursement Voucher (DV) prepared
  ├── Supporting documents compiled
  ├── Accountant certifies
  ├── Head of Office approves
  └── Payment released

Stage 7: COMPLETION
  ├── Contract completion recorded
  ├── Performance evaluation of supplier
  └── Documents filed and archived
```

### C.3 Detailed: Competitive Bidding Workflow

```
1.  PR Created and Approved
2.  BAC Secretariat prepares Bidding Documents
3.  Pre-Procurement Conference (BAC)
4.  Publication/Posting of ITB (PhilGEPS, newspaper, conspicuous place)
    └── Minimum 7 calendar days for goods ≤₱2M
    └── Minimum 21 calendar days for goods >₱50M
5.  Pre-Bid Conference (mandatory if ABC >₱1M for goods)
6.  Bid Submission Deadline
7.  Bid Opening (public, BAC + observers)
8.  Preliminary Examination (completeness, eligibility)
9.  Detailed Evaluation (technical then financial)
10. Post-Qualification of Lowest Calculated Responsive Bid
11. BAC Resolution recommending award
12. Approval by Head of Procuring Entity (HOPE)
13. Notice of Award (NOA)
14. Contract Preparation and Signing
15. Notice to Proceed (NTP)
16. Delivery, Inspection, Acceptance
17. Payment Processing
```

### C.4 Supplier Management

| Feature               | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| Supplier Registry     | Name, TIN, PhilGEPS number, contact, address, classification |
| Eligibility Documents | Track submitted docs, expiry dates                           |
| Performance Rating    | Per-contract rating (quality, time, compliance)              |
| Blacklist Status      | Flag suppliers blacklisted by GPPB or agency                 |
| Bid History           | All bids submitted, won/lost, prices                         |
| Contact Management    | Multiple contacts per supplier                               |

### C.5 Document Generation & Tracking

The system generates or tracks these documents per procurement:

| Document                              | Generated | Tracked | Template              |
| ------------------------------------- | --------- | ------- | --------------------- |
| Purchase Request (PR)                 | ✅        | ✅      | Standard DepEd format |
| Obligation Request (OBR/ORS)          | ✅        | ✅      | COA prescribed format |
| Request for Quotation (RFQ)           | ✅        | ✅      | Standard format       |
| Abstract of Canvass/Bids              | ✅        | ✅      | BAC format            |
| BAC Resolution                        | ✅        | ✅      | Standard resolution   |
| Notice of Award (NOA)                 | ✅        | ✅      | GPPB format           |
| Purchase Order (PO)                   | ✅        | ✅      | Standard DepEd format |
| Contract                              | Template  | ✅      | Method-specific       |
| Notice to Proceed (NTP)               | ✅        | ✅      | Standard format       |
| Inspection Report                     | ✅        | ✅      | IAC format            |
| Disbursement Voucher (DV)             | ✅        | ✅      | COA format            |
| Inventory Custodian Slip (ICS)        | ✅        | ✅      | COA format            |
| Property Acknowledgment Receipt (PAR) | ✅        | ✅      | COA format            |

---

## D. ASSET MANAGEMENT MODULE

### D.1 Asset Lifecycle

```
Procurement Delivery
    ↓
Inspection & Acceptance
    ↓
Stock Entry (Inventory)
    ↓
Categorization & Tagging
    ├── Semi-Expendable (ICS) → below threshold
    └── Property/Equipment (PAR) → above threshold
    ↓
Assignment to Custodian
    ↓
In-Service (Active)
    ├── Transfer between custodians
    ├── Repair/Maintenance
    └── Periodic Physical Count
    ↓
Disposal (when unserviceable)
    ├── Condemnation proceedings
    ├── Disposal method (sale, donation, destruction)
    └── Removal from inventory
```

### D.2 Inventory Management

| Feature            | Description                                     |
| ------------------ | ----------------------------------------------- |
| Stock-In           | From procurement delivery, donations, transfers |
| Stock-Out          | Issuance to end-users, transfers, disposals     |
| Stock Cards        | Per-item running balance (Supplies Ledger Card) |
| Physical Count     | Periodic reconciliation with book balance       |
| Reorder Point      | Configurable minimum stock levels with alerts   |
| Warehouse/Location | Track physical location of items                |

### D.3 Asset Categorization

| Category                          | Threshold                  | Document                              | Depreciation |
| --------------------------------- | -------------------------- | ------------------------------------- | ------------ |
| Consumable Supplies               | Any value, consumed on use | RIS (Requisition & Issue Slip)        | N/A          |
| Semi-Expendable Property          | Below ₱50,000\*            | ICS (Inventory Custodian Slip)        | Optional     |
| Property, Plant & Equipment (PPE) | ₱50,000 and above\*        | PAR (Property Acknowledgment Receipt) | Required     |

\*Threshold per COA Circular, configurable in system settings.

### D.4 Property Tagging

- Auto-generated property numbers following DepEd/COA format
- QR code generation for physical tagging
- Format: `{OFFICE_CODE}-{YEAR}-{CATEGORY}-{SEQUENCE}`
- Example: `SDO-CEBU-2026-EQ-00142`

### D.5 Depreciation Tracking

| Method              | Application                            |
| ------------------- | -------------------------------------- |
| Straight-Line       | Default for government assets per COA  |
| Useful Life         | Per COA-prescribed useful life table   |
| Residual Value      | 10% of acquisition cost (COA standard) |
| Monthly Computation | Auto-computed, viewable per asset      |
| Impairment          | Manual recording with justification    |

### D.6 Custodian Management

- Assign assets to specific persons (custodians)
- Transfer of accountability (custodian-to-custodian)
- Return of property
- Clearance requirement (custodian must return/account for all assets before clearance)
- PAR/ICS history per custodian

---

## E. REQUEST SYSTEM

### E.1 Request Types

| Type                 | Description                                  | Triggers                  |
| -------------------- | -------------------------------------------- | ------------------------- |
| Supply Request (RIS) | Request for consumable supplies from stock   | Stock-out                 |
| Equipment Request    | Request for equipment not currently assigned | Assignment or Procurement |
| Service Request      | Request for repair/maintenance service       | Work order or Procurement |
| Procurement Request  | Request for items not in stock               | PR creation               |

### E.2 Request Workflow

```
End-User creates request
    ↓
Immediate Supervisor approves
    ↓
Supply Officer checks stock availability
    ├── [In Stock] → Issue from inventory → Stock-out recorded
    └── [Not in Stock] →
         ├── [In PPMP/APP] → Create Purchase Request → Procurement workflow
         └── [Not in PPMP] → Flag for supplemental PPMP/APP amendment
    ↓
Request fulfilled
    ↓
End-User acknowledges receipt
```

### E.3 Business Rules

- Requests must reference office and specific need/purpose
- Stock issuance requires Supply Officer processing
- If item not in stock AND not in APP, system flags it — requires APP amendment before procurement
- Emergency requests bypass normal routing with justification (logged for audit)
- Request history maintained per office and per user

---

# 3. DATABASE DESIGN (SUPABASE)

## 3.1 Schema Overview

The database is organized into these schemas:

| Schema         | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `procurements` | Core application tables                                       |
| `platform`     | Platform-level tables (divisions, subscriptions, super admin) |
| `auth`         | Supabase Auth (managed)                                       |
| `storage`      | Supabase Storage (managed)                                    |
| `audit`        | Audit log tables                                              |

## 3.2 Core Tables

### PLATFORM TABLES (Super Admin / Multi-Division)

```sql
-- Divisions: Top-level tenant entity (one per Schools Division Office)
CREATE TABLE platform.divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                     -- e.g., 'Schools Division of Cebu City'
    code TEXT NOT NULL UNIQUE,              -- e.g., 'SDO-CEBU-CITY'
    region TEXT,                            -- e.g., 'Region VII - Central Visayas'
    address TEXT,
    contact_number TEXT,
    email TEXT,
    logo_url TEXT,                          -- Division logo for branding
    -- Subscription management
    subscription_status TEXT NOT NULL DEFAULT 'pending' CHECK (subscription_status IN (
        'pending', 'trial', 'active', 'suspended', 'expired'
    )),
    subscription_plan TEXT DEFAULT 'standard', -- Future: 'basic', 'standard', 'premium'
    trial_ends_at TIMESTAMPTZ,
    subscription_starts_at TIMESTAMPTZ,
    subscription_ends_at TIMESTAMPTZ,
    max_users INTEGER DEFAULT 500,          -- Configurable per subscription
    max_schools INTEGER DEFAULT 100,
    -- Metadata
    onboarded_by UUID REFERENCES auth.users(id), -- Super Admin who onboarded
    onboarded_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Platform-level announcements (from Super Admin to all divisions)
CREATE TABLE platform.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'maintenance', 'update')),
    target_divisions UUID[],               -- NULL = all divisions
    is_active BOOLEAN DEFAULT true,
    published_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Platform activity log (Super Admin actions)
CREATE TABLE platform.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,                   -- 'division_created', 'subscription_changed', etc.
    target_division_id UUID REFERENCES platform.divisions(id),
    details JSONB,
    performed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### ORGANIZATION & USERS

```sql
-- Offices: Offices and schools WITHIN a division
CREATE TABLE offices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,                     -- e.g., 'SDO-CEBU', 'CEBU-NHS'
    office_type TEXT NOT NULL CHECK (office_type IN ('division_office', 'school', 'section')),
    parent_office_id UUID REFERENCES offices(id) ON DELETE RESTRICT,
    address TEXT,
    contact_number TEXT,
    email TEXT,
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(division_id, code)              -- Code unique WITHIN a division, not globally
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    employee_id TEXT,                       -- DepEd Employee ID
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    suffix TEXT,
    position TEXT,                          -- Official designation
    department TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    contact_number TEXT,
    is_super_admin BOOLEAN DEFAULT false,   -- Platform-level Super Admin flag
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(division_id, employee_id)        -- Employee ID unique within division
);

-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,              -- 'super_admin', 'division_admin', 'budget_officer', etc.
    display_name TEXT NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,   -- Cannot be deleted
    scope TEXT NOT NULL DEFAULT 'division' CHECK (scope IN (
        'platform',                         -- Super Admin (cross-division)
        'division',                         -- Division-wide roles (HOPE, Auditor, Div Admin)
        'office'                            -- Office-scoped roles (Supply Officer, End User)
    )),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- User-Role assignments (many-to-many, scoped to division + office)
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    office_id UUID REFERENCES offices(id) ON DELETE RESTRICT, -- NULL for platform/division-wide roles
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,                 -- Soft revoke
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id, role_id, division_id, office_id)
);

-- Permissions
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,              -- e.g., 'ppmp.create', 'pr.approve', 'division.manage'
    module TEXT NOT NULL,                   -- 'platform', 'planning', 'budget', 'procurement', etc.
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'division' CHECK (scope IN ('platform', 'division', 'office')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Role-Permission mapping
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
    UNIQUE(role_id, permission_id)
);
```

### BUDGET TABLES

```sql
-- Fiscal years (per division — each division may have different statuses)
CREATE TABLE fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    year INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT false,        -- Only one active per division
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('planning', 'open', 'closing', 'closed')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(division_id, year)               -- Year unique per division
);

-- Fund sources (platform-level shared lookup, managed by Super Admin)
CREATE TABLE fund_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,              -- 'GF', 'SEF', 'TF', etc.
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- UACS (platform-level shared lookup, managed by Super Admin)
CREATE TABLE account_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,              -- UACS code e.g., '5020301000'
    name TEXT NOT NULL,                     -- e.g., 'Office Supplies Expenses'
    expense_class TEXT NOT NULL CHECK (expense_class IN ('PS', 'MOOE', 'CO', 'FE')),
    parent_code_id UUID REFERENCES account_codes(id),
    level INTEGER NOT NULL,                 -- Hierarchy depth
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Budget allocations per office
CREATE TABLE budget_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    fund_source_id UUID NOT NULL REFERENCES fund_sources(id) ON DELETE RESTRICT,
    account_code_id UUID NOT NULL REFERENCES account_codes(id) ON DELETE RESTRICT,
    original_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    adjusted_amount NUMERIC(15,2) NOT NULL DEFAULT 0,  -- After realignments
    obligated_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    disbursed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(fiscal_year_id, office_id, fund_source_id, account_code_id)
);

-- Budget adjustments (realignment, augmentation, etc.)
CREATE TABLE budget_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    budget_allocation_id UUID NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
        'realignment', 'augmentation', 'reduction', 'transfer_in', 'transfer_out'
    )),
    amount NUMERIC(15,2) NOT NULL,          -- Positive or negative
    justification TEXT NOT NULL,
    reference_number TEXT,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);
```

### PLANNING TABLES (PPMP/APP with Versioning)

```sql
-- PPMP header (parent record, never deleted)
CREATE TABLE ppmps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    current_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'under_review', 'revision_required', 'approved', 'locked'
    )),
    submitted_at TIMESTAMPTZ,
    submitted_by UUID REFERENCES auth.users(id),
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    review_notes TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(office_id, fiscal_year_id)
);

-- PPMP versions (immutable snapshots)
CREATE TABLE ppmp_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ppmp_id UUID NOT NULL REFERENCES ppmps(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    version_type TEXT NOT NULL CHECK (version_type IN ('original', 'amendment', 'supplemental')),
    amendment_justification TEXT,           -- Required for amendments
    total_estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    snapshot_data JSONB,                    -- Full snapshot for archival
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'approved', 'superseded'
    )),
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(ppmp_id, version_number)
);

-- PPMP line items (belong to a version)
CREATE TABLE ppmp_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ppmp_version_id UUID NOT NULL REFERENCES ppmp_versions(id) ON DELETE RESTRICT,
    ppmp_id UUID NOT NULL REFERENCES ppmps(id) ON DELETE RESTRICT,
    item_number INTEGER NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'common_use_supplies', 'non_common_supplies', 'equipment', 'services', 'infrastructure'
    )),
    description TEXT NOT NULL,
    unit TEXT NOT NULL,                     -- e.g., 'pc', 'ream', 'unit', 'lot'
    quantity INTEGER NOT NULL,
    estimated_unit_cost NUMERIC(15,2) NOT NULL,
    estimated_total_cost NUMERIC(15,2) NOT NULL,
    procurement_method TEXT CHECK (procurement_method IN (
        'competitive_bidding', 'svp', 'direct_contracting', 'repeat_order',
        'shopping', 'emergency', 'negotiated', 'agency_to_agency'
    )),
    budget_allocation_id UUID REFERENCES budget_allocations(id) ON DELETE RESTRICT,
    schedule_q1 INTEGER DEFAULT 0,         -- Quantity per quarter
    schedule_q2 INTEGER DEFAULT 0,
    schedule_q3 INTEGER DEFAULT 0,
    schedule_q4 INTEGER DEFAULT 0,
    is_cse BOOLEAN DEFAULT false,           -- Common Supplies Equipment (PS-DBM)
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- APP header
CREATE TABLE apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT, -- Division office
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    current_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'consolidating' CHECK (status IN (
        'consolidating', 'draft', 'submitted', 'reviewed', 'approved', 'posted'
    )),
    philgeps_reference TEXT,               -- PhilGEPS posting reference
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(office_id, fiscal_year_id)
);

-- APP versions
CREATE TABLE app_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    version_type TEXT NOT NULL CHECK (version_type IN ('original', 'amendment', 'supplemental')),
    amendment_justification TEXT,
    total_estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    snapshot_data JSONB,
    status TEXT NOT NULL DEFAULT 'draft',
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(app_id, version_number)
);

-- APP line items (consolidated from PPMPs)
CREATE TABLE app_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_version_id UUID NOT NULL REFERENCES app_versions(id) ON DELETE RESTRICT,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    source_ppmp_item_id UUID REFERENCES ppmp_items(id) ON DELETE RESTRICT,
    item_number INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    estimated_unit_cost NUMERIC(15,2) NOT NULL,
    estimated_total_cost NUMERIC(15,2) NOT NULL,
    procurement_method TEXT NOT NULL,
    budget_allocation_id UUID REFERENCES budget_allocations(id) ON DELETE RESTRICT,
    schedule_q1 INTEGER DEFAULT 0,
    schedule_q2 INTEGER DEFAULT 0,
    schedule_q3 INTEGER DEFAULT 0,
    schedule_q4 INTEGER DEFAULT 0,
    is_cse BOOLEAN DEFAULT false,
    source_office_id UUID REFERENCES offices(id) ON DELETE RESTRICT,
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);
```

### PROCUREMENT TABLES

```sql
-- Suppliers (scoped per division; each division maintains own supplier registry)
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    trade_name TEXT,
    tin TEXT,                               -- Tax Identification Number
    philgeps_number TEXT,
    address TEXT,
    city TEXT,
    province TEXT,
    zip_code TEXT,
    contact_person TEXT,
    contact_number TEXT,
    email TEXT,
    website TEXT,
    business_type TEXT,                     -- Sole proprietor, corporation, etc.
    classification TEXT[],                  -- ['office_supplies', 'it_equipment', etc.]
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'blacklisted', 'suspended', 'inactive'
    )),
    blacklist_reason TEXT,
    blacklist_date DATE,
    blacklist_until DATE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(division_id, tin)               -- TIN unique within division
);

-- Purchase Requests
CREATE TABLE purchase_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    pr_number TEXT NOT NULL,               -- Auto-generated: PR-{OFFICE}-{YEAR}-{SEQ}
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ DEFAULT now(),
    fund_source_id UUID REFERENCES fund_sources(id) ON DELETE RESTRICT,
    budget_allocation_id UUID REFERENCES budget_allocations(id) ON DELETE RESTRICT,
    app_item_id UUID REFERENCES app_items(id) ON DELETE RESTRICT, -- Link to APP
    total_estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'budget_certified', 'approved',
        'in_procurement', 'completed', 'cancelled'
    )),
    budget_certified_by UUID REFERENCES auth.users(id),
    budget_certified_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES auth.users(id),
    cancelled_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(division_id, pr_number)         -- PR number unique within division
);

-- PR line items
CREATE TABLE pr_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
    item_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    estimated_unit_cost NUMERIC(15,2) NOT NULL,
    estimated_total_cost NUMERIC(15,2) NOT NULL,
    ppmp_item_id UUID REFERENCES ppmp_items(id),  -- Trace back to PPMP
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Procurement activities (one per procurement action)
CREATE TABLE procurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    procurement_number TEXT NOT NULL,        -- PROC-{OFFICE}-{YEAR}-{SEQ}
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
    purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
    procurement_method TEXT NOT NULL CHECK (procurement_method IN (
        'competitive_bidding', 'svp', 'direct_contracting', 'repeat_order',
        'shopping', 'emergency', 'negotiated', 'agency_to_agency'
    )),
    abc_amount NUMERIC(15,2) NOT NULL,      -- Approved Budget for the Contract
    current_stage TEXT NOT NULL DEFAULT 'initiation' CHECK (current_stage IN (
        'initiation', 'pre_procurement', 'sourcing', 'evaluation',
        'post_qualification', 'award', 'contract', 'delivery',
        'payment', 'completed', 'failed', 'cancelled'
    )),
    awarded_supplier_id UUID REFERENCES suppliers(id),
    contract_amount NUMERIC(15,2),
    savings_amount NUMERIC(15,2),           -- ABC - Contract amount
    failure_reason TEXT,                     -- If procurement failed
    failure_count INTEGER DEFAULT 0,        -- Number of failed biddings
    philgeps_reference TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Procurement stage tracking (workflow history)
CREATE TABLE procurement_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE RESTRICT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'completed', 'skipped', 'failed'
    )),
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Bids / Quotations
CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    bid_amount NUMERIC(15,2) NOT NULL,
    bid_date TIMESTAMPTZ NOT NULL,
    is_responsive BOOLEAN,                  -- Technical evaluation result
    is_eligible BOOLEAN,                    -- Eligibility check
    is_compliant BOOLEAN,                   -- Compliance check
    rank INTEGER,                           -- After evaluation
    evaluation_score NUMERIC(5,2),
    status TEXT DEFAULT 'submitted' CHECK (status IN (
        'submitted', 'evaluated', 'post_qualified', 'awarded',
        'disqualified', 'withdrawn'
    )),
    disqualification_reason TEXT,
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bid items (line-level pricing from suppliers)
CREATE TABLE bid_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
    pr_item_id UUID NOT NULL REFERENCES pr_items(id) ON DELETE RESTRICT,
    offered_unit_cost NUMERIC(15,2) NOT NULL,
    offered_total_cost NUMERIC(15,2) NOT NULL,
    brand_model TEXT,
    specifications TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Purchase Orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    po_number TEXT NOT NULL,                -- PO-{OFFICE}-{YEAR}-{SEQ}
    procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    total_amount NUMERIC(15,2) NOT NULL,
    delivery_date DATE,
    delivery_address TEXT,
    payment_terms TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft', 'approved', 'issued', 'partially_delivered',
        'fully_delivered', 'completed', 'cancelled'
    )),
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    issued_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- PO line items
CREATE TABLE po_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    pr_item_id UUID NOT NULL REFERENCES pr_items(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(15,2) NOT NULL,
    total_cost NUMERIC(15,2) NOT NULL,
    delivered_quantity INTEGER DEFAULT 0,
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Deliveries & Inspection
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    delivery_number TEXT NOT NULL,
    delivery_date DATE NOT NULL,
    received_by UUID REFERENCES auth.users(id),
    inspection_date DATE,
    inspected_by UUID REFERENCES auth.users(id),
    inspection_status TEXT CHECK (inspection_status IN (
        'pending', 'passed', 'failed', 'partial_acceptance'
    )),
    inspection_report_number TEXT,
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Delivery items
CREATE TABLE delivery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
    po_item_id UUID NOT NULL REFERENCES po_items(id) ON DELETE RESTRICT,
    quantity_delivered INTEGER NOT NULL,
    quantity_accepted INTEGER NOT NULL DEFAULT 0,
    quantity_rejected INTEGER NOT NULL DEFAULT 0,
    rejection_reason TEXT,
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Obligation Requests (OBR/ORS)
CREATE TABLE obligation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    obr_number TEXT NOT NULL,               -- OBR-{OFFICE}-{YEAR}-{SEQ}
    purchase_request_id UUID REFERENCES purchase_requests(id) ON DELETE RESTRICT,
    procurement_id UUID REFERENCES procurements(id) ON DELETE RESTRICT,
    budget_allocation_id UUID NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    amount NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'certified', 'obligated', 'cancelled'
    )),
    certified_by UUID REFERENCES auth.users(id),
    certified_at TIMESTAMPTZ,
    obligated_at TIMESTAMPTZ,
    remarks TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);
```

### ASSET MANAGEMENT TABLES

```sql
-- Item categories/catalog
CREATE TABLE item_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN (
        'consumable', 'semi_expendable', 'ppe'
    )),
    unit TEXT NOT NULL,
    account_code_id UUID REFERENCES account_codes(id),
    useful_life_years INTEGER,              -- For depreciation
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Inventory (stock tracking)
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_catalog_id UUID NOT NULL REFERENCES item_catalog(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    current_quantity INTEGER NOT NULL DEFAULT 0,
    reorder_point INTEGER DEFAULT 0,
    location TEXT,                          -- Physical storage location
    last_count_date DATE,
    last_count_quantity INTEGER,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(item_catalog_id, office_id)
);

-- Stock movements (ledger)
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'stock_in', 'stock_out', 'adjustment', 'transfer_in', 'transfer_out', 'return'
    )),
    quantity INTEGER NOT NULL,              -- Positive for in, negative for out
    reference_type TEXT,                    -- 'delivery', 'ris', 'transfer', etc.
    reference_id UUID,                      -- ID of the source document
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Assets (individual tracked items - PPE and semi-expendable)
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    property_number TEXT NOT NULL,          -- Auto-generated tag
    item_catalog_id UUID NOT NULL REFERENCES item_catalog(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    brand_model TEXT,
    serial_number TEXT,
    acquisition_date DATE NOT NULL,
    acquisition_cost NUMERIC(15,2) NOT NULL,
    source_po_id UUID REFERENCES purchase_orders(id),
    source_delivery_id UUID REFERENCES deliveries(id),
    asset_type TEXT NOT NULL CHECK (asset_type IN ('semi_expendable', 'ppe')),
    condition_status TEXT DEFAULT 'serviceable' CHECK (condition_status IN (
        'serviceable', 'needs_repair', 'unserviceable', 'disposed'
    )),
    current_custodian_id UUID REFERENCES auth.users(id),
    location TEXT,
    -- Depreciation fields (PPE)
    useful_life_years INTEGER,
    residual_value NUMERIC(15,2),
    accumulated_depreciation NUMERIC(15,2) DEFAULT 0,
    book_value NUMERIC(15,2),
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'transferred', 'for_disposal', 'disposed', 'lost', 'donated'
    )),
    disposal_date DATE,
    disposal_method TEXT,
    disposal_reference TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Asset assignments (custody history)
CREATE TABLE asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    custodian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    document_type TEXT NOT NULL CHECK (document_type IN ('par', 'ics')),
    document_number TEXT NOT NULL,          -- PAR/ICS number
    assigned_date DATE NOT NULL,
    returned_date DATE,
    remarks TEXT,
    assigned_by UUID REFERENCES auth.users(id),
    is_current BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Depreciation records (monthly)
CREATE TABLE depreciation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    depreciation_amount NUMERIC(15,2) NOT NULL,
    accumulated_amount NUMERIC(15,2) NOT NULL,
    book_value NUMERIC(15,2) NOT NULL,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(asset_id, period_year, period_month)
);
```

### REQUEST SYSTEM TABLES

```sql
-- Requests (from offices/end-users)
CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    request_number TEXT NOT NULL,            -- REQ-{OFFICE}-{YEAR}-{SEQ}
    request_type TEXT NOT NULL CHECK (request_type IN (
        'supply', 'equipment', 'service', 'procurement'
    )),
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL,
    urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'emergency')),
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'supervisor_approved', 'processing',
        'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'
    )),
    supervisor_id UUID REFERENCES auth.users(id),
    supervisor_approved_at TIMESTAMPTZ,
    supervisor_remarks TEXT,
    processed_by UUID REFERENCES auth.users(id), -- Supply Officer
    processed_at TIMESTAMPTZ,
    fulfillment_type TEXT CHECK (fulfillment_type IN (
        'from_stock', 'for_procurement', 'mixed'
    )),
    linked_pr_id UUID REFERENCES purchase_requests(id), -- If triggers procurement
    rejection_reason TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Request line items
CREATE TABLE request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
    item_catalog_id UUID REFERENCES item_catalog(id),
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity_requested INTEGER NOT NULL,
    quantity_issued INTEGER DEFAULT 0,
    item_number INTEGER NOT NULL,
    inventory_id UUID REFERENCES inventory(id),  -- If fulfilled from stock
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### AUDIT & DOCUMENTS TABLES

```sql
-- Audit log (all critical operations)
CREATE TABLE audit.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID REFERENCES platform.divisions(id),  -- NULL for platform-level actions
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'STATUS_CHANGE')),
    old_data JSONB,
    new_data JSONB,
    changed_fields TEXT[],
    user_id UUID REFERENCES auth.users(id),
    user_ip TEXT,
    user_agent TEXT,
    office_id UUID,
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Document attachments (stored in Supabase Storage)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_type TEXT NOT NULL,           -- 'procurement', 'delivery', 'asset', etc.
    reference_id UUID NOT NULL,
    document_type TEXT NOT NULL,            -- 'pr', 'po', 'noa', 'contract', 'inspection_report', etc.
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,               -- Supabase Storage path
    file_size INTEGER,
    mime_type TEXT,
    version INTEGER DEFAULT 1,
    uploaded_by UUID REFERENCES auth.users(id),
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Approval workflow log
CREATE TABLE approval_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_type TEXT NOT NULL,           -- 'ppmp', 'pr', 'po', 'budget_adjustment', etc.
    reference_id UUID NOT NULL,
    step_name TEXT NOT NULL,                -- 'supervisor_approval', 'budget_certification', etc.
    step_order INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'returned', 'forwarded')),
    acted_by UUID NOT NULL REFERENCES auth.users(id),
    acted_at TIMESTAMPTZ DEFAULT now(),
    remarks TEXT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'action_required', 'success', 'error')),
    reference_type TEXT,
    reference_id UUID,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- System settings (division-scoped + platform-scoped)
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID REFERENCES platform.divisions(id) ON DELETE RESTRICT, -- NULL = platform-wide setting
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    category TEXT,
    updated_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(division_id, key)               -- Same key can exist per division + once at platform level
);

-- Sequence counters (for auto-numbering, division-scoped)
CREATE TABLE sequence_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
    counter_type TEXT NOT NULL,             -- 'pr', 'po', 'asset', etc.
    fiscal_year INTEGER NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    prefix TEXT NOT NULL,
    UNIQUE(division_id, office_id, counter_type, fiscal_year)
);
```

## 3.3 Entity Relationship Summary

```
platform.divisions ─── (TOP-LEVEL TENANT BOUNDARY)
    │
    ├── offices ──────┬── user_profiles ── user_roles ── roles ── role_permissions ── permissions
    │                 │
    ├── fiscal_years ─┼── budget_allocations ── budget_adjustments
    │                 │         │
    │                 ├── ppmps ── ppmp_versions ── ppmp_items
    │                 │                                  │
    │                 ├── apps ── app_versions ── app_items (← ppmp_items)
    │                 │
    │                 ├── purchase_requests ── pr_items
    │                 │         │
    │                 ├── procurements ── procurement_stages
    │                 │    │    │
    │                 │    │    ├── bids ── bid_items
    │                 │    │    │
    │                 │    │    └── purchase_orders ── po_items
    │                 │    │              │
    │                 │    │              └── deliveries ── delivery_items
    │                 │    │
    │                 │    └── obligation_requests
    │                 │
    │                 ├── inventory ── stock_movements
    │                 │
    │                 ├── assets ── asset_assignments
    │                 │           └── depreciation_records
    │                 │
    │                 ├── requests ── request_items
    │                 │
    │                 └── documents, notifications, audit_logs, approval_logs
    │
    ├── suppliers (per division)
    ├── system_settings (per division + platform-wide)
    └── sequence_counters (per division)

platform.announcements ── (Super Admin → All divisions)
platform.platform_audit_logs ── (Super Admin actions)

Shared lookups (platform-managed): fund_sources, account_codes
```

---

# 4. USER ROLES & PERMISSIONS

## 4.1 Role Definitions

### Platform-Level Roles (Cross-Division)

| Role            | Code          | Scope         | Description                                                                                                                                   |
| --------------- | ------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin** | `super_admin` | Platform-wide | Manages divisions, subscriptions, platform settings, shared lookup data. Cannot access division operational data (budgets, procurement, etc.) |

### Division-Level Roles

| Role                                           | Code             | Scope         | Description                                                                                            |
| ---------------------------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| **Division Admin**                             | `division_admin` | Division-wide | Full admin within their division: users, offices, schools, roles, settings. Cannot see other divisions |
| **Schools Division Superintendent (SDS/HOPE)** | `hope`           | Division-wide | Final approving authority for procurement, APP, budgets                                                |
| **Division Chief**                             | `division_chief` | Division-wide | Reviews and recommends for HOPE approval                                                               |
| **Auditor**                                    | `auditor`        | Division-wide | Read-only access to all data within the division for audit                                             |

### Office-Level Roles

| Role                           | Code                 | Scope         | Description                                          |
| ------------------------------ | -------------------- | ------------- | ---------------------------------------------------- |
| **Budget Officer**             | `budget_officer`     | Office-scoped | Budget creation, certification, monitoring           |
| **Supply Officer**             | `supply_officer`     | Office-scoped | PPMP/APP, procurement processing, inventory          |
| **BAC Chairperson**            | `bac_chair`          | Office-scoped | Leads BAC proceedings, signs resolutions             |
| **BAC Member**                 | `bac_member`         | Office-scoped | Evaluates bids, participates in BAC                  |
| **BAC Secretariat**            | `bac_secretariat`    | Office-scoped | Prepares bid documents, manages procurement timeline |
| **Inspection Committee (IAC)** | `iac_member`         | Office-scoped | Inspects deliveries, signs inspection reports        |
| **Property Custodian**         | `property_custodian` | Office-scoped | Manages assigned assets, reports condition           |
| **End User**                   | `end_user`           | Office-scoped | Creates requests, views own requests/assets          |
| **School Head**                | `school_head`        | School-scoped | Approves school-level requests, PPMPs                |
| **Accountant**                 | `accountant`         | Office-scoped | Certifies disbursements, financial reports           |

## 4.2 Permission Matrix

### Platform-Level Permissions (Super Admin Only)

| Permission                              | Super Admin |
| --------------------------------------- | :---------: |
| division.create                         |     ✅      |
| division.manage                         |     ✅      |
| division.suspend                        |     ✅      |
| subscription.manage                     |     ✅      |
| platform.settings                       |     ✅      |
| platform.announcements                  |     ✅      |
| platform.audit_logs                     |     ✅      |
| lookup_data.manage (UACS, fund sources) |     ✅      |
| platform.analytics                      |     ✅      |

**Note:** Super Admin does NOT have access to division-level operational data (budgets, procurement, assets). This is by design — operational data belongs to the division.

### Division-Level Permissions

| Permission          | Div Admin | HOPE | Div Chief | Budget Off. | Supply Off. | BAC Chair | BAC Mem | BAC Sec | IAC | End User | School Head | Auditor | Accountant |
| ------------------- | :-------: | :--: | :-------: | :---------: | :---------: | :-------: | :-----: | :-----: | :-: | :------: | :---------: | :-----: | :--------: |
| **PLANNING**        |
| ppmp.create         |    ✅     |      |           |             |     ✅      |           |         |         |     |          |     ✅      |         |            |
| ppmp.edit           |    ✅     |      |           |             |     ✅      |           |         |         |     |          |     ✅      |         |            |
| ppmp.submit         |    ✅     |      |           |             |     ✅      |           |         |         |     |          |     ✅      |         |            |
| ppmp.review         |    ✅     |      |    ✅     |             |  ✅ (div)   |           |         |         |     |          |             |         |            |
| ppmp.approve        |    ✅     |  ✅  |    ✅     |             |             |           |         |         |     |          |             |         |            |
| ppmp.view_all       |    ✅     |  ✅  |    ✅     |     ✅      |     ✅      |           |         |         |     |          |             |   ✅    |            |
| app.manage          |    ✅     |      |           |             |  ✅ (div)   |           |         |         |     |          |             |         |            |
| app.approve         |    ✅     |  ✅  |           |             |             |           |         |         |     |          |             |         |            |
| **BUDGET**          |
| budget.create       |    ✅     |      |           |     ✅      |             |           |         |         |     |          |             |         |            |
| budget.adjust       |    ✅     |      |           |     ✅      |             |           |         |         |     |          |             |         |            |
| budget.certify      |    ✅     |      |           |     ✅      |             |           |         |         |     |          |             |         |            |
| budget.approve_adj  |    ✅     |  ✅  |    ✅     |             |             |           |         |         |     |          |             |         |            |
| budget.view_all     |    ✅     |  ✅  |    ✅     |     ✅      |     ✅      |           |         |         |     |          |             |   ✅    |     ✅     |
| **PROCUREMENT**     |
| pr.create           |    ✅     |      |           |             |     ✅      |           |         |   ✅    |     |    ✅    |     ✅      |         |            |
| pr.approve          |    ✅     |  ✅  |    ✅     |             |             |           |         |         |     |          |     ✅      |         |            |
| proc.manage         |    ✅     |      |           |             |     ✅      |           |         |   ✅    |     |          |             |         |            |
| bid.evaluate        |    ✅     |      |           |             |             |    ✅     |   ✅    |         |     |          |             |         |            |
| bid.award           |    ✅     |  ✅  |           |             |             |    ✅     |         |         |     |          |             |         |            |
| po.create           |    ✅     |      |           |             |     ✅      |           |         |   ✅    |     |          |             |         |            |
| po.approve          |    ✅     |  ✅  |    ✅     |             |             |           |         |         |     |          |             |         |            |
| delivery.inspect    |    ✅     |      |           |             |     ✅      |           |         |         | ✅  |          |             |         |            |
| **ASSETS**          |
| asset.manage        |    ✅     |      |           |             |     ✅      |           |         |         |     |          |             |         |            |
| asset.assign        |    ✅     |      |           |             |     ✅      |           |         |         |     |          |     ✅      |         |            |
| asset.view_own      |    ✅     |  ✅  |    ✅     |     ✅      |     ✅      |    ✅     |   ✅    |   ✅    | ✅  |    ✅    |     ✅      |   ✅    |     ✅     |
| asset.dispose       |    ✅     |  ✅  |           |             |     ✅      |           |         |         |     |          |             |         |            |
| inventory.manage    |    ✅     |      |           |             |     ✅      |           |         |         |     |          |             |         |            |
| **REQUESTS**        |
| request.create      |    ✅     |      |           |             |             |           |         |         |     |    ✅    |     ✅      |         |            |
| request.approve     |    ✅     |      |    ✅     |             |             |           |         |         |     |          |     ✅      |         |            |
| request.process     |    ✅     |      |           |             |     ✅      |           |         |         |     |          |             |         |            |
| **REPORTS**         |
| reports.all         |    ✅     |  ✅  |    ✅     |             |             |           |         |         |     |          |             |   ✅    |     ✅     |
| reports.office      |    ✅     |  ✅  |    ✅     |     ✅      |     ✅      |    ✅     |         |         |     |          |     ✅      |   ✅    |     ✅     |
| **DIVISION ADMIN**  |
| users.manage        |    ✅     |      |           |             |             |           |         |         |     |          |             |         |            |
| roles.assign        |    ✅     |      |           |             |             |           |         |         |     |          |             |         |            |
| offices.manage      |    ✅     |  ✅  |           |             |             |           |         |         |     |          |             |         |            |
| division.settings   |    ✅     |      |           |             |             |           |         |         |     |          |             |         |            |
| division.audit_logs |    ✅     |      |           |             |             |           |         |         |     |          |             |   ✅    |            |

---

# 5. WORKFLOW DIAGRAMS (TEXT-BASED)

## 5.1 End-to-End: Planning → Budget → Procurement → Asset → Assignment

```
[1] BUDGET PREPARATION (Start of Fiscal Year)
    │
    ├── Budget Officer creates budget allocations per office
    ├── Allocations broken down by fund source and UACS
    └── Budget approved by HOPE
          │
[2] PLANNING
    │
    ├── Each office creates PPMP (linked to budget line items)
    ├── System validates: PPMP total ≤ budget allocation
    ├── School Head / Office Head submits PPMP
    ├── Division Supply Officer reviews
    ├── PPMP approved
    │     │
    ├── Division Supply Officer consolidates into APP
    ├── APP reviewed by Division Chief
    ├── APP approved by SDS (HOPE)
    └── APP posted to PhilGEPS
          │
[3] PROCUREMENT (Per APP line item or group)
    │
    ├── End-User or Supply Officer creates Purchase Request (PR)
    │     ├── PR linked to APP line item
    │     └── System validates: item is in approved APP
    │
    ├── Budget Officer certifies fund availability
    │     └── Obligation Request (OBR) created
    │
    ├── Office Head approves PR
    │
    ├── Procurement method determined (based on ABC amount + APP)
    │     │
    │     ├── [ABC ≤ ₱250K & shopping conditions] → SHOPPING
    │     │     ├── Canvass ≥3 suppliers
    │     │     ├── Prepare Abstract
    │     │     └── Award to lowest
    │     │
    │     ├── [ABC ≤ ₱1M goods] → SMALL VALUE PROCUREMENT
    │     │     ├── Post RFQ (PhilGEPS if >₱50K)
    │     │     ├── Receive ≥3 quotations
    │     │     ├── BAC/authorized officer evaluates
    │     │     └── Award to lowest responsive
    │     │
    │     ├── [ABC > ₱1M goods] → COMPETITIVE BIDDING
    │     │     ├── Pre-procurement conference
    │     │     ├── Publish ITB (PhilGEPS + newspaper)
    │     │     ├── Pre-bid conference
    │     │     ├── Bid submission & opening
    │     │     ├── BAC evaluation (technical → financial)
    │     │     ├── Post-qualification
    │     │     ├── BAC Resolution → HOPE approval
    │     │     └── NOA → Contract → NTP
    │     │
    │     ├── [Exclusive distributor] → DIRECT CONTRACTING
    │     │     ├── Justification prepared
    │     │     ├── BAC recommends
    │     │     ├── HOPE approves
    │     │     └── Contract executed
    │     │
    │     ├── [Emergency/calamity] → EMERGENCY PROCUREMENT
    │     │     ├── Immediate purchase authorized
    │     │     ├── Documentation post-facto
    │     │     └── BAC reviews within 30 days
    │     │
    │     └── [Two failed biddings] → NEGOTIATED PROCUREMENT
    │           ├── BAC negotiates
    │           └── HOPE approves
    │
    ├── Purchase Order / Contract issued
    │
    ├── Supplier delivers
    │     ├── IAC inspects
    │     ├── [PASS] → Acceptance
    │     ├── [PARTIAL] → Accept partial, track remaining
    │     └── [FAIL] → Reject, notify supplier
    │
    └── Payment processed (DV → Accountant → HOPE → Release)
          │
[4] ASSET MANAGEMENT
    │
    ├── Delivered items entered into inventory
    │     ├── [Consumable] → Stock card updated
    │     ├── [Semi-expendable] → ICS prepared, assigned to custodian
    │     └── [PPE] → PAR prepared, property number assigned, custodian designated
    │
    ├── Asset tagged (QR code generated)
    ├── Depreciation schedule started (for PPE)
    └── Asset tracked in system
          │
[5] ASSIGNMENT & USAGE
    │
    ├── End-user creates request
    ├── Supervisor approves request
    ├── Supply Officer processes
    │     ├── [In stock] → Issue via RIS → Stock-out recorded
    │     └── [Not in stock] → Route to procurement
    ├── End-user receives and acknowledges
    └── Custodian accountability updated
```

## 5.2 PPMP Amendment Workflow

```
Approved PPMP (v1)
    │
    ├── Need identified for change (new item, qty change, etc.)
    │
    ├── Supply Officer initiates amendment
    │     └── System creates PPMP v2 (copy of v1 + changes)
    │     └── v1 status → 'superseded'
    │
    ├── v2 goes through same approval workflow
    │     Draft → Submitted → Reviewed → Approved
    │
    ├── If v2 approved:
    │     ├── v2 becomes current version
    │     ├── APP amendment triggered
    │     └── Budget impact recalculated
    │
    └── If v2 rejected:
          └── v1 remains current, v2 archived as 'rejected'
```

## 5.3 Failed Procurement Workflow

```
Procurement attempt fails (no responsive bids, etc.)
    │
    ├── BAC declares failure
    │     └── Failure reason documented
    │
    ├── failure_count incremented
    │
    ├── Decision point:
    │     ├── [failure_count = 1] → Re-bid (new timeline)
    │     ├── [failure_count = 2] → Eligible for Negotiated Procurement
    │     └── [failure_count ≥ 2 + HOPE decides] → Alternative method
    │
    └── New procurement record created referencing failed procurement
```

---

# 6. API / BACKEND STRUCTURE

## 6.1 Supabase PostgREST (Auto-generated REST API)

All tables automatically get CRUD endpoints via PostgREST. RLS policies enforce access control.

## 6.2 RPC Functions (PostgreSQL Functions exposed via Supabase)

| Function                                                       | Purpose                                         | Called By        |
| -------------------------------------------------------------- | ----------------------------------------------- | ---------------- |
| `get_user_division_id()`                                       | Return current user's division_id (used by RLS) | System/RLS       |
| `is_super_admin()`                                             | Check if current user is Super Admin            | System/RLS       |
| `is_division_active()`                                         | Check subscription status of user's division    | System/RLS       |
| `onboard_division(name, code, admin_email, ...)`               | Create division + root office + admin account   | Super Admin      |
| `suspend_division(division_id, reason)`                        | Change subscription to suspended                | Super Admin      |
| `generate_sequence_number(division_id, office_id, type, year)` | Generate next PR/PO/etc. number                 | System           |
| `certify_budget_availability(pr_id)`                           | Budget Officer certifies funds                  | Budget Officer   |
| `create_ppmp_amendment(ppmp_id, justification)`                | Clone current version, create new               | Supply Officer   |
| `consolidate_app(division_id, fiscal_year_id)`                 | Aggregate approved PPMPs into APP               | Supply Officer   |
| `record_obligation(obr_data)`                                  | Debit budget, create OBR                        | Budget Officer   |
| `process_delivery(delivery_data)`                              | Update PO status, create inventory entries      | Supply Officer   |
| `calculate_depreciation(asset_id)`                             | Monthly depreciation computation                | Scheduled/Manual |
| `run_monthly_depreciation(fiscal_year, month)`                 | Batch depreciation for all assets               | Scheduled        |
| `get_budget_summary(office_id, fiscal_year_id)`                | Budget utilization dashboard data               | Any authorized   |
| `get_procurement_dashboard(office_id)`                         | Procurement status summary                      | Any authorized   |
| `check_split_contract(office_id, category, amount)`            | Warn if cumulative amount suggests splitting    | System           |
| `get_ppmp_version_history(ppmp_id)`                            | All versions with diff summary                  | Any authorized   |
| `fulfill_request_from_stock(request_id)`                       | Issue items, update inventory                   | Supply Officer   |
| `transfer_asset(asset_id, new_custodian_id)`                   | Transfer custody with audit trail               | Supply Officer   |

## 6.3 Edge Functions (Deno-based, for complex logic)

| Function                 | Purpose                                                      | Trigger             |
| ------------------------ | ------------------------------------------------------------ | ------------------- |
| `generate-document`      | PDF generation (PR, PO, NOA, ICS, PAR, etc.)                 | On-demand           |
| `send-notification`      | Email/push notifications for approvals, deadlines            | Event-driven        |
| `import-ppmp`            | Parse Excel/CSV uploads for bulk PPMP creation               | On-demand           |
| `export-reports`         | Generate Excel/PDF reports (APP format, COA reports)         | On-demand           |
| `scheduled-depreciation` | Monthly depreciation batch job                               | Cron (1st of month) |
| `budget-alerts`          | Check utilization thresholds, send alerts                    | Cron (weekly)       |
| `philgeps-data-prep`     | Prepare data in PhilGEPS posting format                      | On-demand           |
| `check-subscriptions`    | Flag divisions approaching trial/subscription expiry         | Cron (daily)        |
| `division-usage-stats`   | Compute per-division usage metrics for Super Admin dashboard | Cron (daily)        |

## 6.4 Database Triggers

| Trigger                     | Table                  | Purpose                                     |
| --------------------------- | ---------------------- | ------------------------------------------- |
| `audit_trigger`             | All critical tables    | Log changes to `audit.audit_logs`           |
| `update_timestamp`          | All tables             | Auto-update `updated_at` on modification    |
| `update_budget_balance`     | `obligation_requests`  | Recalculate available budget on obligation  |
| `update_inventory_quantity` | `stock_movements`      | Recalculate current stock on movement       |
| `update_po_delivery_status` | `delivery_items`       | Update PO status based on delivery progress |
| `update_asset_book_value`   | `depreciation_records` | Update asset book value after depreciation  |
| `notify_on_status_change`   | Workflow tables        | Create notification records                 |

## 6.5 Data Validation Strategy

| Layer        | Validation                              | Implementation                     |
| ------------ | --------------------------------------- | ---------------------------------- |
| **Frontend** | Input format, required fields, UX hints | Zod schemas + React Hook Form      |
| **API**      | Business rules, authorization           | Supabase RLS + RPC function checks |
| **Database** | Data integrity, constraints             | CHECK constraints, FKs, triggers   |

**Principle:** Never trust the frontend alone. All critical business rules (budget availability, procurement thresholds, approval sequences) are enforced at the database or RPC level.

## 6.6 RLS (Row Level Security) Policies

### Division Isolation (CRITICAL — applied FIRST on every table)

```sql
-- Helper function: get current user's division_id
CREATE OR REPLACE FUNCTION get_user_division_id()
RETURNS UUID AS $$
    SELECT division_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT is_super_admin FROM user_profiles WHERE id = auth.uid()),
        false
    )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### RLS Pattern: Two-Layer Isolation

**Layer 1 — Division Boundary (HARD WALL):**
Every division-scoped table gets this policy FIRST:

```sql
-- EVERY division-scoped table gets this as the foundational policy
-- This ensures Division A can NEVER see Division B's data

-- Example: offices table
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;

-- Super Admin sees all divisions (platform management only)
CREATE POLICY "super_admin_all" ON offices
    FOR SELECT USING (is_super_admin());

-- Division Admin sees all offices in their division
CREATE POLICY "division_isolation" ON offices
    FOR ALL USING (
        division_id = get_user_division_id()
    );
```

**Layer 2 — Office-Level Access (within the division):**

```sql
-- Division-wide roles see all within their division (already filtered by Layer 1)
CREATE POLICY "division_wide_read" ON offices
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = auth.uid()
                AND r.name IN ('division_admin', 'hope', 'auditor', 'division_chief')
                AND ur.is_active = true
                AND ur.division_id = offices.division_id)
    );

-- Office-scoped users see their own office
CREATE POLICY "own_office_read" ON offices
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles up
                WHERE up.id = auth.uid()
                AND up.office_id = offices.id)
    );
```

### Example: purchase_requests with Division Isolation

```sql
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

-- Layer 1: Division wall (every query is ALWAYS filtered by division)
CREATE POLICY "division_wall" ON purchase_requests
    FOR ALL USING (
        division_id = get_user_division_id()
    );

-- Layer 2: Office-level read
CREATE POLICY "office_pr_read" ON purchase_requests
    FOR SELECT USING (
        office_id IN (
            SELECT COALESCE(ur.office_id, up.office_id)
            FROM user_roles ur
            JOIN user_profiles up ON up.id = ur.user_id
            WHERE ur.user_id = auth.uid() AND ur.is_active = true
        )
    );

-- Layer 2: Create — must be within user's division AND office
CREATE POLICY "create_pr" ON purchase_requests
    FOR INSERT WITH CHECK (
        division_id = get_user_division_id()
        AND EXISTS (SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = auth.uid()
                AND r.name IN ('supply_officer', 'bac_secretariat', 'end_user', 'school_head', 'division_admin')
                AND ur.is_active = true
                AND ur.office_id = office_id)
    );
```

### Platform Tables RLS

```sql
-- platform.divisions: Only Super Admin can manage
ALTER TABLE platform.divisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_manage" ON platform.divisions
    FOR ALL USING (is_super_admin());

-- Division Admin can read their own division record (for display)
CREATE POLICY "own_division_read" ON platform.divisions
    FOR SELECT USING (id = get_user_division_id());
```

### Subscription Enforcement

```sql
-- Helper: check if division subscription is active
CREATE OR REPLACE FUNCTION is_division_active()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT subscription_status IN ('active', 'trial')
         FROM platform.divisions
         WHERE id = get_user_division_id()),
        false
    )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Applied to INSERT/UPDATE policies on all operational tables:
-- Users in suspended/expired divisions get read-only access
CREATE POLICY "active_subscription_write" ON purchase_requests
    FOR INSERT WITH CHECK (
        is_division_active()
        AND division_id = get_user_division_id()
        -- ... plus role checks
    );
```

### RLS Policy Summary (applied to ALL tenant-scoped tables)

| Role Level                                | SELECT                               | INSERT               | UPDATE               | DELETE (soft)        |
| ----------------------------------------- | ------------------------------------ | -------------------- | -------------------- | -------------------- |
| Super Admin                               | All divisions (platform tables only) | Platform tables only | Platform tables only | Platform tables only |
| Division Admin                            | All within own division              | Own division         | Own division         | Own division         |
| Division roles (HOPE, Auditor, Div Chief) | All within own division              | Own office           | Based on permission  | Based on permission  |
| Office roles (Budget, Supply, BAC)        | Own office within division           | Own office           | Based on permission  | Based on permission  |
| End User                                  | Own records within division          | Own records          | Own draft records    | Own draft records    |
| Suspended Division                        | Read-only (all above)                | BLOCKED              | BLOCKED              | BLOCKED              |

---

# 7. FRONTEND STRUCTURE (NEXT.JS)

## 7.1 App Router Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout (auth check, providers)
│   ├── page.tsx                      # Landing / redirect based on role
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   └── reset-password/page.tsx
│   │
│   ├── (platform)/                   # *** SUPER ADMIN AREA ***
│   │   ├── layout.tsx                # Platform shell (different from division)
│   │   ├── page.tsx                  # Platform dashboard (division overview)
│   │   ├── divisions/
│   │   │   ├── page.tsx              # All divisions list + status
│   │   │   ├── new/page.tsx          # Onboard new division
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # Division detail + subscription
│   │   │       ├── settings/page.tsx # Division config
│   │   │       └── users/page.tsx    # Division admin accounts
│   │   ├── subscriptions/
│   │   │   └── page.tsx              # Subscription management
│   │   ├── lookup-data/
│   │   │   ├── account-codes/page.tsx # UACS management
│   │   │   └── fund-sources/page.tsx
│   │   ├── announcements/
│   │   │   ├── page.tsx
│   │   │   └── new/page.tsx
│   │   ├── analytics/
│   │   │   └── page.tsx              # Cross-division usage stats
│   │   └── audit-logs/page.tsx       # Platform action logs
│   │
│   ├── (dashboard)/                  # *** DIVISION USER AREA ***
│   │   ├── layout.tsx                # Dashboard shell (sidebar, topbar, division context)
│   │   ├── page.tsx                  # Dashboard home (role-based widgets)
│   │   │
│   │   ├── planning/
│   │   │   ├── page.tsx              # Planning overview
│   │   │   ├── ppmp/
│   │   │   │   ├── page.tsx          # PPMP list (filterable by office, year, status)
│   │   │   │   ├── new/page.tsx      # Create PPMP
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── page.tsx      # PPMP detail (current version)
│   │   │   │   │   ├── edit/page.tsx # Edit PPMP (draft only)
│   │   │   │   │   └── versions/page.tsx  # Version history
│   │   │   │   └── import/page.tsx   # Bulk import
│   │   │   └── app/
│   │   │       ├── page.tsx          # APP list
│   │   │       ├── [id]/
│   │   │       │   ├── page.tsx      # APP detail
│   │   │       │   ├── consolidate/page.tsx  # Consolidation view
│   │   │       │   └── versions/page.tsx
│   │   │       └── new/page.tsx
│   │   │
│   │   ├── budget/
│   │   │   ├── page.tsx              # Budget overview / dashboard
│   │   │   ├── allocations/
│   │   │   │   ├── page.tsx          # Allocation list
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx     # Allocation detail
│   │   │   ├── adjustments/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── obligations/
│   │   │   │   └── page.tsx          # OBR list
│   │   │   └── reports/page.tsx      # Budget utilization reports
│   │   │
│   │   ├── procurement/
│   │   │   ├── page.tsx              # Procurement dashboard
│   │   │   ├── purchase-requests/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── activities/
│   │   │   │   ├── page.tsx          # All procurement activities
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx      # Procurement detail (stage tracker)
│   │   │   │       ├── bids/page.tsx # Bid management
│   │   │   │       └── evaluation/page.tsx
│   │   │   ├── purchase-orders/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── deliveries/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx     # Delivery + inspection
│   │   │   ├── suppliers/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   └── reports/page.tsx
│   │   │
│   │   ├── assets/
│   │   │   ├── page.tsx              # Asset dashboard
│   │   │   ├── inventory/
│   │   │   │   ├── page.tsx          # Stock list
│   │   │   │   ├── [id]/page.tsx     # Stock card view
│   │   │   │   └── physical-count/page.tsx
│   │   │   ├── registry/
│   │   │   │   ├── page.tsx          # All assets (PPE + semi-expendable)
│   │   │   │   └── [id]/page.tsx     # Asset detail + history
│   │   │   ├── assignments/
│   │   │   │   ├── page.tsx          # Current assignments
│   │   │   │   └── transfer/page.tsx
│   │   │   ├── disposal/
│   │   │   │   └── page.tsx
│   │   │   └── reports/page.tsx      # RPCPPE, inventory reports
│   │   │
│   │   ├── requests/
│   │   │   ├── page.tsx              # My requests / all requests
│   │   │   ├── new/page.tsx
│   │   │   ├── [id]/page.tsx
│   │   │   └── approvals/page.tsx    # Pending approvals
│   │   │
│   │   ├── reports/
│   │   │   ├── page.tsx              # Report center
│   │   │   ├── procurement/page.tsx
│   │   │   ├── budget/page.tsx
│   │   │   ├── assets/page.tsx
│   │   │   └── compliance/page.tsx   # COA / DepEd compliance reports
│   │   │
│   │   ├── approvals/
│   │   │   └── page.tsx              # Unified approval inbox
│   │   │
│   │   ├── notifications/
│   │   │   └── page.tsx
│   │   │
│   │   └── admin/                    # Division Admin area
│   │       ├── page.tsx              # Division admin dashboard
│   │       ├── users/
│   │       │   ├── page.tsx          # Users within THIS division
│   │       │   └── [id]/page.tsx
│   │       ├── offices/
│   │       │   ├── page.tsx          # Schools/offices within THIS division
│   │       │   └── [id]/page.tsx
│   │       ├── roles/page.tsx        # Role assignment within division
│   │       ├── item-catalog/page.tsx # Division item catalog
│   │       ├── fiscal-years/page.tsx # Division fiscal year config
│   │       ├── settings/page.tsx     # Division-specific settings
│   │       └── audit-logs/page.tsx   # Division audit logs
│   │
│   └── api/                          # API routes (if needed beyond Supabase)
│       └── ...
│
├── components/
│   ├── ui/                           # Base UI components (shadcn/ui recommended)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── table.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   ├── badge.tsx
│   │   ├── card.tsx
│   │   └── ...
│   │
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   ├── breadcrumbs.tsx
│   │   └── page-header.tsx
│   │
│   ├── shared/
│   │   ├── data-table.tsx            # Reusable table with sort/filter/pagination
│   │   ├── status-badge.tsx          # Status indicators
│   │   ├── approval-actions.tsx      # Approve/reject/return buttons
│   │   ├── document-viewer.tsx       # PDF preview
│   │   ├── file-upload.tsx
│   │   ├── office-selector.tsx       # Office dropdown (respects RLS)
│   │   ├── fiscal-year-selector.tsx
│   │   ├── amount-display.tsx        # Currency formatting
│   │   ├── version-history.tsx       # Reusable version comparison
│   │   └── workflow-tracker.tsx      # Stage progress indicator
│   │
│   ├── planning/
│   │   ├── ppmp-form.tsx
│   │   ├── ppmp-item-table.tsx
│   │   ├── ppmp-version-diff.tsx
│   │   ├── app-consolidation-view.tsx
│   │   └── budget-linkage-widget.tsx
│   │
│   ├── budget/
│   │   ├── allocation-form.tsx
│   │   ├── budget-utilization-chart.tsx
│   │   ├── fund-availability-badge.tsx
│   │   └── adjustment-form.tsx
│   │
│   ├── procurement/
│   │   ├── pr-form.tsx
│   │   ├── procurement-stage-tracker.tsx
│   │   ├── bid-evaluation-table.tsx
│   │   ├── abstract-of-canvass.tsx
│   │   ├── po-form.tsx
│   │   ├── delivery-inspection-form.tsx
│   │   └── supplier-form.tsx
│   │
│   ├── assets/
│   │   ├── asset-form.tsx
│   │   ├── stock-card.tsx
│   │   ├── assignment-form.tsx
│   │   ├── depreciation-schedule.tsx
│   │   ├── qr-code-display.tsx
│   │   └── physical-count-form.tsx
│   │
│   └── requests/
│       ├── request-form.tsx
│       └── request-fulfillment.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # Browser client
│   │   ├── server.ts                 # Server client (RSC)
│   │   ├── middleware.ts             # Auth middleware
│   │   └── admin.ts                  # Service role client (server only)
│   │
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-division.ts           # Current division context
│   │   ├── use-office.ts
│   │   ├── use-permissions.ts
│   │   ├── use-is-super-admin.ts     # Platform-level check
│   │   └── use-fiscal-year.ts
│   │
│   ├── schemas/                      # Zod validation schemas
│   │   ├── ppmp.ts
│   │   ├── budget.ts
│   │   ├── procurement.ts
│   │   ├── asset.ts
│   │   └── request.ts
│   │
│   ├── utils/
│   │   ├── format-currency.ts
│   │   ├── format-date.ts
│   │   ├── generate-number.ts
│   │   └── permissions.ts
│   │
│   └── types/
│       ├── database.ts               # Generated from Supabase (supabase gen types)
│       ├── enums.ts
│       └── ...
│
├── store/                            # If using Redux (optional — prefer server state)
│   ├── index.ts
│   ├── slices/
│   │   ├── auth-slice.ts
│   │   └── ui-slice.ts              # Sidebar state, modals, etc.
│   └── providers.tsx
│
└── middleware.ts                      # Next.js middleware (auth redirect, division/office context,
                                      #   route Super Admin to /platform, others to /dashboard,
                                      #   block suspended division users from write operations)
```

## 7.2 State Management Recommendation

**Prefer server-driven state (React Server Components + Supabase)** over Redux for data:

| Concern                           | Approach                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Server data (PPMP, budgets, etc.) | Server Components + Supabase queries                                              |
| Real-time updates                 | Supabase Realtime subscriptions                                                   |
| Forms                             | React Hook Form + Zod                                                             |
| Client UI state (sidebar, modals) | Zustand or lightweight Redux slice                                                |
| Auth state                        | Supabase Auth context                                                             |
| Division context                  | React Context — set at login, immutable for session (Super Admin has no division) |
| Office/FY context                 | React Context (set once, used everywhere, scoped within division)                 |

---

# 8. VERSIONING STRATEGY (CRITICAL)

## 8.1 Architecture: Parent + Version Table Pattern

```
┌───────────────────┐       ┌───────────────────────┐
│      ppmps        │       │    ppmp_versions       │
│ (parent record)   │──────→│ (immutable snapshots)  │
│                   │  1:N  │                        │
│ current_version   │       │ version_number         │
│ status            │       │ version_type           │
│ office_id         │       │ snapshot_data (JSONB)  │
│ fiscal_year_id    │       │ status                 │
└───────────────────┘       └───────────┬────────────┘
                                        │ 1:N
                            ┌───────────┴────────────┐
                            │     ppmp_items          │
                            │ (belong to a version)   │
                            │                         │
                            │ ppmp_version_id         │
                            │ description, qty, cost  │
                            └─────────────────────────┘
```

## 8.2 How It Works

### Creating the Original PPMP

1. Insert into `ppmps` (parent) with `current_version = 1`
2. Insert into `ppmp_versions` with `version_number = 1, version_type = 'original'`
3. Insert line items into `ppmp_items` referencing the version

### Creating an Amendment

1. System copies all `ppmp_items` from current version to a new version
2. Insert into `ppmp_versions` with `version_number = N+1, version_type = 'amendment'`
3. User edits items in the new version (adds, removes, modifies)
4. When new version is approved:
   - Previous version's status → `'superseded'`
   - New version's status → `'approved'`
   - Parent `ppmps.current_version` → `N+1`
5. Optionally, `snapshot_data` stores a full JSON snapshot for fast retrieval

### Retrieving Version History

```sql
-- Get all versions of a PPMP
SELECT * FROM ppmp_versions
WHERE ppmp_id = $1
ORDER BY version_number DESC;

-- Get items for a specific version
SELECT * FROM ppmp_items
WHERE ppmp_version_id = $1
ORDER BY item_number;

-- Compare two versions (application-level diff)
-- Fetch items for both versions and compute diff in frontend/RPC
```

## 8.3 Key Rules

| Rule                                           | Enforcement                                                   |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Approved versions are NEVER modified           | RLS policy + trigger: block UPDATE on approved versions       |
| Only one version can be in 'draft' status      | CHECK constraint via trigger                                  |
| Amendments require justification               | NOT NULL on `amendment_justification` when type = 'amendment' |
| Parent record always points to latest approved | Trigger on version approval updates parent                    |
| Full snapshot stored for archival              | JSONB `snapshot_data` populated on approval                   |

## 8.4 Same Pattern for APP

The APP follows the identical versioning strategy:

- `apps` → `app_versions` → `app_items`
- APP versions are independent of PPMP versions (an APP amendment may include multiple PPMP amendments)

---

# 9. IMPLEMENTATION ROADMAP

## Phase 1: Foundation + Platform Layer (Weeks 1-4)

| Task                         | Details                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Project setup                | Next.js 15, Supabase project, TypeScript config, ESLint, Prettier                                         |
| **Platform schema**          | `platform.divisions`, `platform.announcements`, `platform.platform_audit_logs`                            |
| **Division management**      | Super Admin UI: create divisions, set subscription status, manage onboarding                              |
| Database foundation          | Offices (with `division_id`), user_profiles, roles (with scope), permissions, user_roles, system_settings |
| Authentication               | Supabase Auth, login/logout, password reset, session management                                           |
| **Division-aware auth**      | Login routes user to correct area: Super Admin → `/platform`, Division users → `/dashboard`               |
| Authorization                | RLS policies with **two-layer isolation** (division wall + office-level)                                  |
| **Division Admin module**    | Office CRUD, user management, role assignment — all scoped to own division                                |
| **Super Admin module**       | Division list, onboard new division, subscription management, platform announcements                      |
| Layout & navigation          | Two layouts: Platform shell (Super Admin) + Dashboard shell (Division users)                              |
| Audit infrastructure         | Audit log table (with `division_id`), trigger function, audit log viewer                                  |
| **Subscription enforcement** | Suspended divisions → read-only; expired divisions → login blocked                                        |

**Deliverable:** Super Admin can onboard divisions. Division Admins can manage their offices/users/roles. Full tenant isolation verified.

## Phase 2: Planning + Budget (Weeks 4-7)

| Task                | Details                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Budget tables       | account_codes, fund_sources, budget_allocations, budget_adjustments |
| Budget module UI    | Allocation CRUD, adjustment workflow, utilization dashboard         |
| PPMP tables         | ppmps, ppmp_versions, ppmp_items                                    |
| PPMP module UI      | Create, edit, submit, version history, version diff                 |
| PPMP workflows      | Approval chain, amendment flow, status management                   |
| APP tables          | apps, app_versions, app_items                                       |
| APP consolidation   | Auto-consolidation RPC, consolidation UI, approval flow             |
| Budget-PPMP linkage | Validation that PPMP totals don't exceed budget, real-time display  |
| Import/Export       | Excel import for PPMP, APP export in GPPB format                    |

**Deliverable:** Complete planning cycle — budget allocation → PPMP creation → APP consolidation → approval.

## Phase 3: Procurement (Weeks 8-13)

| Task                     | Details                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Supplier management      | suppliers table, CRUD UI, classification, status tracking          |
| Purchase Requests        | PR creation linked to APP, budget certification, approval          |
| Procurement engine       | procurements, procurement_stages tables, method-specific workflows |
| SVP workflow             | RFQ generation, quotation entry, abstract of canvass, award        |
| Competitive bidding      | ITB, bid submission, evaluation, post-qual, NOA, contract          |
| Other methods            | Direct contracting, shopping, emergency, repeat order, negotiated  |
| Purchase Orders          | PO creation, approval, issuance, tracking                          |
| Delivery & inspection    | Delivery recording, IAC inspection, acceptance/rejection           |
| Obligation tracking      | OBR creation, budget debit on obligation                           |
| Document generation      | PDF generation for PR, PO, NOA, abstract, etc.                     |
| Split-contract detection | Year-to-date monitoring per category per office                    |

**Deliverable:** Full procurement lifecycle from PR to delivery for all methods.

## Phase 4: Asset Management (Weeks 14-17)

| Task                 | Details                                                      |
| -------------------- | ------------------------------------------------------------ |
| Item catalog         | Catalog management, categorization                           |
| Inventory system     | Stock-in from deliveries, stock-out via RIS, stock cards     |
| Asset registration   | Auto-create assets from accepted deliveries (semi-exp + PPE) |
| Property tagging     | Auto-numbering, QR code generation                           |
| PAR/ICS              | Document generation, assignment to custodians                |
| Custodian management | Assignment, transfer, return, clearance                      |
| Depreciation         | Monthly computation, schedule display, batch processing      |
| Physical count       | Count entry, variance report, adjustment                     |
| Disposal             | Condemnation workflow, disposal recording                    |

**Deliverable:** Assets tracked from procurement through lifecycle to disposal.

## Phase 5: Requests + Integration + Reports (Weeks 18-22)

| Task                     | Details                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Request system           | Request creation, approval chain, stock check, fulfillment/routing |
| Unified approval inbox   | All pending approvals across modules in one view                   |
| Notifications            | In-app + email notifications for approvals, deadlines, alerts      |
| Reports: Budget          | Budget utilization, obligation tracking, allotment summary         |
| Reports: Procurement     | Procurement monitoring, method distribution, savings               |
| Reports: Assets          | RPCPPE, inventory report, depreciation schedule, stock status      |
| Reports: Compliance      | APP vs actual, procurement timeline compliance, COA reports        |
| Dashboard widgets        | Role-based dashboard with key metrics, charts, action items        |
| Data export              | Excel/PDF export for all reports                                   |
| Performance optimization | Query optimization, caching, pagination tuning                     |
| UAT & bug fixes          | User acceptance testing, bug fixes, refinements                    |

**Deliverable:** Fully integrated system with reporting and compliance features.

---

# 10. EDGE CASES & GOVERNMENT COMPLIANCE

## 10.1 Multi-Year Budgets

| Scenario                  | Handling                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| Continuing appropriations | `budget_allocations` supports multi-year flag; carry-over to next FY |
| Multi-year contracts      | Contract spans multiple FYs; obligation split per year               |
| Year-end processing       | Auto-compute lapsing vs. continuing balances                         |

## 10.2 Mid-Year Revisions

| Scenario                | Handling                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| PPMP amendment mid-year | New version created; items already procured remain untouched                 |
| Budget realignment      | Budget adjustment with approval; auto-recompute available for PPMPs          |
| Supplemental APP        | New APP version type = 'supplemental'; adds items without replacing existing |
| Organizational changes  | Office merge/split handled via office status + data migration script         |

## 10.3 Failed Procurement

| Scenario                       | Handling                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| No bidders                     | Mark as failed; failure_count++; option to re-bid or alternative method |
| All bids non-responsive        | Same as above; BAC resolution documenting failure                       |
| Two failed biddings            | Unlocks negotiated procurement option                                   |
| Supplier backs out after award | Record failure; blacklist consideration; re-procure                     |
| Contract termination           | Partial completion recorded; remaining balance returned to budget       |

## 10.4 Partial Deliveries

| Scenario                  | Handling                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Partial delivery          | `delivery_items.quantity_delivered` < PO quantity; PO status = 'partially_delivered' |
| Multiple delivery batches | Multiple delivery records per PO; each independently inspected                       |
| Partial acceptance        | Some items accepted, others rejected; separate quantities tracked                    |
| Liquidated damages        | Computed based on delay; deducted from payment                                       |

## 10.5 COA Audit Requirements

| Requirement             | Implementation                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| Complete document trail | All documents linked and traceable (PR → PO → Delivery → Payment)           |
| No gaps in numbering    | Sequence counters; cancelled numbers tracked, not reused                    |
| Approval evidence       | Digital signatures (approval_logs with timestamp + user)                    |
| Asset accountability    | PAR/ICS with custodian; clearance requirement                               |
| Physical inventory      | Annual physical count feature with variance reporting                       |
| Soft delete only        | `deleted_at` field; no hard deletes; audit log captures all deletions       |
| Historical data         | Version tables preserve all states; no data overwriting                     |
| Fund utilization        | Budget module tracks from allocation through disbursement                   |
| Procurement compliance  | Method thresholds enforced; timeline tracking; required documents checklist |

## 10.6 Multi-Division Edge Cases

| Case                                                | Handling                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Division subscription expires                       | All users get read-only; pending approvals frozen; Super Admin notified                                                                                                                          |
| Division wants to reactivate after expiry           | Super Admin reactivates; all data intact; in-flight workflows resume                                                                                                                             |
| User accidentally assigned to wrong division        | Division Admin can only manage own division users; Super Admin must intervene for cross-division correction                                                                                      |
| Two divisions procure from same supplier            | Each division maintains own supplier registry; no cross-division supplier sharing (by design, for data isolation)                                                                                |
| Division merge (real-world reorganization)          | Manual migration: Super Admin creates new division, migrates data via Edge Function script, deactivates old divisions                                                                            |
| Super Admin needs to view division data for support | Super Admin can view division metadata (user count, subscription, activity stats) but NOT operational data (budgets, PRs, assets). Support access requires explicit delegation by Division Admin |
| New UACS codes issued by COA                        | Super Admin updates shared `account_codes` table; immediately available to all divisions                                                                                                         |

## 10.7 Additional Edge Cases

| Case                                 | Handling                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| Duplicate items across PPMPs         | Warning during APP consolidation; manual merge option                             |
| Price escalation during procurement  | Re-quote option; ABC validation; if exceeds ABC → re-procure or adjust            |
| Items not in APP but urgently needed | Emergency procurement path OR supplemental APP amendment first                    |
| User transfers between offices       | Role revoked at old office, assigned at new; asset accountability cleared         |
| User transfers between divisions     | Rare; requires Division Admin at both ends + Super Admin coordination             |
| System downtime during deadline      | Audit log captures system issues; admin can backdate approvals with justification |
| Currency precision                   | NUMERIC(15,2) for all amounts; Philippine Peso only                               |

---

# 11. BONUS: AUTOMATION & REPORTING

## 11.1 Automation Opportunities

| Automation                     | Description                                                           | Priority |
| ------------------------------ | --------------------------------------------------------------------- | -------- |
| **Auto-number generation**     | PR, PO, OBR, property numbers auto-generated per office/year          | High     |
| **Budget availability check**  | Auto-validate fund availability when PR is created                    | High     |
| **APP auto-consolidation**     | One-click consolidation of approved PPMPs into APP                    | High     |
| **Split-contract detection**   | Alert when cumulative procurement per category approaches threshold   | High     |
| **Deadline reminders**         | Auto-notify when procurement timelines are at risk                    | Medium   |
| **Depreciation batch**         | Monthly auto-computation for all active PPE assets                    | Medium   |
| **Reorder alerts**             | Notify when stock falls below reorder point                           | Medium   |
| **Auto-route requests**        | If item in stock → issue; if not → create PR                          | Medium   |
| **Document auto-fill**         | Generate PR, PO, NOA PDFs with data pre-filled                        | High     |
| **PhilGEPS data prep**         | Auto-format data for PhilGEPS posting requirements                    | Low      |
| **Year-end processing**        | Auto-compute lapsing appropriations, carry-over balances              | Medium   |
| **Approval escalation**        | Auto-escalate if approval pending > N days                            | Low      |
| **Subscription expiry alert**  | Notify Super Admin + Division Admin before trial/subscription expires | High     |
| **Division onboarding wizard** | Guided setup: offices → schools → users → roles in sequence           | Medium   |
| **Cross-division analytics**   | Aggregate usage stats for Super Admin platform dashboard              | Medium   |

## 11.2 Reporting Dashboards

### Platform Dashboard (Super Admin)

- Total divisions (active, trial, suspended, expired)
- User count per division
- Subscription status overview + upcoming expirations
- System-wide activity volume (PRs, POs, logins per day)
- Division onboarding pipeline
- Platform announcements management
- Storage usage per division
- Error/issue summary

### Executive Dashboard (HOPE / Division Chief)

- Total budget vs. utilized (bar chart)
- Procurement status summary (pie chart: completed, in-progress, pending)
- APP compliance rate (% of APP items procured)
- Top spending categories
- Offices with lowest/highest utilization
- Pending approvals count

### Budget Dashboard (Budget Officer)

- Budget utilization by fund source
- Obligation rate by quarter
- Available balance by account code
- Budget adjustment history
- Projection: estimated year-end utilization

### Procurement Dashboard (Supply Officer / BAC)

- Active procurements by method
- Procurement timeline (Gantt-style)
- Savings generated (ABC vs. contract amount)
- Failed procurement rate
- Supplier performance rankings
- Average procurement cycle time

### Asset Dashboard (Supply Officer / Property Custodian)

- Total asset count by category
- Asset condition summary
- Depreciation summary
- Items for disposal
- Inventory stock levels (low stock alerts)
- Custodian accountability status

### Compliance Dashboard (Auditor / Admin)

- Procurement method distribution vs. thresholds
- Document completeness per procurement
- Approval timeline compliance
- Audit findings tracker
- Year-over-year comparison

### DepEd-Specific Reports

| Report                        | Description                            | Frequency           |
| ----------------------------- | -------------------------------------- | ------------------- |
| APP (GPPB format)             | Annual Procurement Plan                | Annual + amendments |
| Procurement Monitoring Report | Status of all procurement activities   | Quarterly           |
| RPCPPE                        | Report on Physical Count of PPE        | Annual              |
| Inventory Report              | Stock status of all supplies           | Semi-annual         |
| Budget Utilization Report     | Fund utilization by expense class      | Monthly/Quarterly   |
| Aging of Procurement          | Procurement activities beyond timeline | Monthly             |
| Supplier Performance Report   | Rating summary per supplier            | Per contract        |
| Waste Material Report         | Disposed/condemned items               | As needed           |

---

# 12. SUPABASE MCP + MIGRATION RULES

## 12.1 Migration Strategy

All schema changes will be delivered as numbered SQL migration files:

```
supabase/migrations/
├── 20260328000001_create_platform_schema_and_divisions.sql
├── 20260328000002_create_offices_with_division_id.sql
├── 20260328000003_create_user_profiles_and_roles.sql
├── 20260328000004_create_rls_helper_functions.sql
├── 20260328000005_create_fiscal_years_and_budget.sql
├── 20260328000006_create_planning_ppmp_app.sql
├── 20260328000007_create_procurement_tables.sql
├── 20260328000008_create_asset_tables.sql
├── 20260328000009_create_request_tables.sql
├── 20260328000010_create_audit_and_documents.sql
├── 20260328000011_create_rls_policies_division_isolation.sql
├── 20260328000012_create_rls_policies_office_level.sql
├── 20260328000013_create_triggers_and_functions.sql
├── 20260328000014_seed_roles_and_permissions.sql
├── 20260328000015_seed_super_admin.sql
└── ...
```

## 12.2 Standard Column Requirements

Every table includes:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
```

Division-scoped tables add (ALL operational tables):

```sql
division_id UUID NOT NULL REFERENCES platform.divisions(id) ON DELETE RESTRICT,
```

Office-scoped tables additionally add:

```sql
office_id UUID NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
```

User-tracked tables add:

```sql
created_by UUID REFERENCES auth.users(id),
```

Critical/financial tables add:

```sql
deleted_at TIMESTAMPTZ,  -- Soft delete
```

## 12.3 Foreign Key Policy

| Relationship                              | ON DELETE | Justification                       |
| ----------------------------------------- | --------- | ----------------------------------- |
| offices → divisions                       | RESTRICT  | Cannot delete division with offices |
| user_profiles → divisions                 | RESTRICT  | Cannot delete division with users   |
| offices → parent_office                   | RESTRICT  | Cannot delete office with children  |
| user_profiles → auth.users                | RESTRICT  | Cannot delete user with profile     |
| user_roles → users/roles/offices          | RESTRICT  | Cannot orphan role assignments      |
| budget_allocations → offices/fiscal_years | RESTRICT  | Cannot delete referenced data       |
| ppmp_items → ppmp_versions                | RESTRICT  | Version integrity                   |
| purchase_requests → offices/fiscal_years  | RESTRICT  | Cannot delete referenced data       |
| procurements → purchase_requests          | RESTRICT  | Full traceability                   |
| bids → procurements/suppliers             | RESTRICT  | Cannot lose bid history             |
| purchase_orders → procurements/suppliers  | RESTRICT  | Cannot orphan POs                   |
| deliveries → purchase_orders              | RESTRICT  | Cannot orphan deliveries            |
| assets → item_catalog                     | RESTRICT  | Cannot delete catalog with assets   |
| asset_assignments → assets/users          | RESTRICT  | Cannot orphan assignments           |

**General rule:** RESTRICT everywhere. No CASCADE on DELETE. Soft-delete pattern used instead.

## 12.4 Audit Trigger Template

```sql
-- Applied to all critical tables
CREATE OR REPLACE FUNCTION audit.log_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, new_data, user_id, division_id, office_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid(),
                CASE WHEN NEW ? 'division_id' THEN (NEW->>'division_id')::UUID ELSE NULL END,
                CASE WHEN NEW ? 'office_id' THEN (NEW->>'office_id')::UUID ELSE NULL END);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, old_data, new_data,
                                       changed_fields, user_id, division_id, office_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
                ARRAY(SELECT key FROM jsonb_each(to_jsonb(NEW))
                      WHERE to_jsonb(NEW) -> key IS DISTINCT FROM to_jsonb(OLD) -> key),
                auth.uid(),
                CASE WHEN NEW ? 'division_id' THEN (NEW->>'division_id')::UUID ELSE NULL END,
                CASE WHEN NEW ? 'office_id' THEN (NEW->>'office_id')::UUID ELSE NULL END);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, old_data, user_id, division_id)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid(),
                CASE WHEN OLD ? 'division_id' THEN (OLD->>'division_id')::UUID ELSE NULL END);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 12.5 Updated Timestamp Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to every table:
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON {table_name}
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

## 12.6 Immutability Guard for Approved Records

```sql
CREATE OR REPLACE FUNCTION prevent_approved_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'approved' AND NEW.status != 'superseded' THEN
        RAISE EXCEPTION 'Cannot modify approved records. Create an amendment instead.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to ppmp_versions, app_versions
CREATE TRIGGER guard_approved_versions
    BEFORE UPDATE ON ppmp_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_approved_modification();
```

## 12.7 Migration Output Format

Each migration file follows this structure:

```sql
-- Migration: {purpose}
-- Description: {what this migration does}
-- Risks/Assumptions: {any risks or assumptions}
-- Dependencies: {previous migrations required}

BEGIN;

-- Schema changes here

COMMIT;
```

---

# SUMMARY TABLE

| Section                               | Status                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| System Overview                       | ✅ Multi-division SaaS architecture                                 |
| Multi-Tenant Model                    | ✅ Two-layer: `division_id` (hard wall) + `office_id` (inner scope) |
| SaaS / Subscription                   | ✅ Division onboarding, subscription lifecycle, feature gating      |
| Core Modules (5 modules)              | ✅ Detailed                                                         |
| Database Design (35+ tables)          | ✅ Full schema with `division_id` on all operational tables         |
| Platform Tables                       | ✅ `platform.divisions`, announcements, platform audit logs         |
| User Roles (16 roles across 3 scopes) | ✅ Super Admin + Division Admin + 14 operational roles              |
| Workflow Diagrams                     | ✅ End-to-end + sub-flows                                           |
| API/Backend Structure                 | ✅ RPC, Edge Functions, Triggers, division-aware RLS                |
| Frontend Structure                    | ✅ Separate Platform + Dashboard layouts                            |
| Versioning Strategy                   | ✅ Parent + Version table pattern                                   |
| Implementation Roadmap                | ✅ 5 phases, ~23 weeks (Phase 1 expanded for platform)              |
| Edge Cases & Compliance               | ✅ 30+ edge cases including multi-division scenarios                |
| Automation & Reports                  | ✅ 15 automations, 6 dashboards (incl. Platform dashboard)          |
| Supabase Migration Rules              | ✅ Standards, triggers, guards, division isolation                  |

---

_This document serves as the authoritative reference for the DepEd Procurement, Asset, and Budget Management System. All implementation decisions should trace back to this plan. Deviations require documented justification._
