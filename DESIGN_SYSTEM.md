# DepEd PABMS Design System

Unified design reference for the DepEd Procurement, Asset & Budget Management System.
Built on **Next.js 16 + Tailwind v4 + shadcn/ui + Geist**.

> This document codifies existing patterns and establishes conventions for consistency.
> It is the source of truth for spacing, typography, color, and component usage.

---

## 1. Design Principles

| #   | Principle                        | Rationale                                                                         |
| --- | -------------------------------- | --------------------------------------------------------------------------------- |
| 1   | **Data density over decoration** | Government users scan tables of 50-200 rows daily                                 |
| 2   | **Status at a glance**           | Procurement workflows have 5-8 approval states — color must communicate instantly |
| 3   | **Consistent rhythm**            | Uniform spacing creates visual hierarchy without cognitive overhead               |
| 4   | **Minimal custom CSS**           | Everything through Tailwind utilities + CSS variables — no one-off styles         |
| 5   | **Progressive disclosure**       | Show summary first, detail on click/expand                                        |

---

## 2. Spacing System

### 2.1 Spacing Scale (Tailwind default, 4px base)

| Token | Value | Use                                                      |
| ----- | ----- | -------------------------------------------------------- |
| `1`   | 4px   | Icon-to-text gap, tight inline spacing                   |
| `1.5` | 6px   | Compact form field internal spacing                      |
| `2`   | 8px   | Button icon gap, inline element spacing                  |
| `3`   | 12px  | Table cell padding, compact card padding                 |
| `4`   | 16px  | Card padding, grid gap, section element spacing          |
| `5`   | 20px  | Form field vertical spacing (`space-y-5`)                |
| `6`   | 24px  | Page section spacing (`space-y-6`), main content padding |
| `8`   | 32px  | Large section breaks                                     |

### 2.2 Layout Spacing Rules

```
Page padding:           p-6
Section gap:            space-y-6
Form field gap:         space-y-5
Card internal gap:      gap-4 (handled by card component)
Grid gap:               gap-4
Table search → table:   space-y-3
Button group gap:       gap-2
Icon → label gap:       gap-2
Inline badge gap:       gap-1.5
```

### 2.3 Container Widths

| Context           | Class               | Approx Width |
| ----------------- | ------------------- | ------------ |
| List page content | Full width (flex-1) | Fluid        |
| Detail page       | `mx-auto max-w-3xl` | 768px        |
| Form page         | `mx-auto max-w-2xl` | 672px        |
| Search input      | `max-w-sm`          | 384px        |
| Sidebar           | `w-64`              | 256px        |
| Topbar height     | `h-14`              | 56px         |

---

## 3. Typography

### 3.1 Font Stack

```css
--font-sans: var(--font-geist-sans); /* Body, headings, UI */
--font-mono: var(--font-geist-mono); /* Code, IDs, reference numbers */
```

### 3.2 Type Scale

| Role                 | Classes                                           | Usage                                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------- |
| **Page title**       | `text-2xl font-bold tracking-tight`               | Top of every page                           |
| **Page subtitle**    | `text-muted-foreground` (base size)               | Below page title                            |
| **Section heading**  | `text-lg font-semibold`                           | Card titles, section headers                |
| **Card title**       | Via `<CardTitle>` component                       | Auto-styled                                 |
| **Card description** | Via `<CardDescription>`                           | `text-sm text-muted-foreground`             |
| **Body text**        | `text-sm`                                         | Default for all content inside cards/tables |
| **Table header**     | `text-sm font-medium text-muted-foreground`       | Via `<TableHead>`                           |
| **Table cell**       | `text-sm`                                         | Via `<TableCell>`                           |
| **Form label**       | `text-sm font-medium`                             | Via `<FormLabel>`                           |
| **Form description** | `text-[0.8rem] text-muted-foreground`             | Via `<FormDescription>`                     |
| **Form error**       | `text-[0.8rem] font-medium text-destructive`      | Via `<FormMessage>`                         |
| **Helper/caption**   | `text-xs text-muted-foreground`                   | Timestamps, metadata                        |
| **Stat number**      | `text-2xl font-bold`                              | Dashboard stat cards                        |
| **Large stat**       | `text-3xl font-bold`                              | Hero metrics                                |
| **Code/ID**          | `font-mono text-sm`                               | Employee IDs, reference numbers, codes      |
| **System label**     | `text-xs font-semibold tracking-widest uppercase` | Branding, system labels                     |

### 3.3 Typography Rules

- **Never use** `text-lg` or larger for body content
- **Headings** are always `font-bold` (page) or `font-semibold` (section)
- **Reference numbers** (PR-2025-001, PPMP IDs) always use `font-mono`
- **Dates** format: `en-PH` locale, `dateStyle: "medium"` → "Mar 29, 2026"
- **Currency** format: `en-PH` locale, PHP currency → "₱1,234,567.89"
- **Empty values** render as `"—"` (em dash), never blank or "N/A"

---

## 4. Color System

### 4.1 Foundation (CSS Variables — OKLch)

The base palette is **achromatic** (no hue). All semantic color comes from status classes.

| Variable             | Light      | Dark        | Usage                       |
| -------------------- | ---------- | ----------- | --------------------------- |
| `--background`       | White      | Near-black  | Page background             |
| `--foreground`       | Near-black | Near-white  | Primary text                |
| `--card`             | White      | Dark gray   | Card surfaces               |
| `--muted`            | Light gray | Dark gray   | Subtle backgrounds          |
| `--muted-foreground` | Mid gray   | Mid gray    | Secondary text              |
| `--border`           | Light gray | White/10%   | All borders                 |
| `--primary`          | Charcoal   | Light gray  | Primary buttons, active nav |
| `--destructive`      | Red-orange | Lighter red | Delete actions, errors      |
| `--ring`             | Mid gray   | Mid gray    | Focus rings                 |

### 4.2 Status Colors (The Core of This System)

Status colors are **hardcoded Tailwind classes** (not CSS variables) because they represent domain-specific procurement/workflow states that need to be scannable in dense tables.

| Status Category     | Statuses                                                             | Background       | Text               | Border               | Dot/Icon           |
| ------------------- | -------------------------------------------------------------------- | ---------------- | ------------------ | -------------------- | ------------------ |
| **Success**         | `active`, `approved`, `completed`, `delivered`, `success`            | `bg-green-100`   | `text-green-800`   | `border-green-200`   | `text-green-600`   |
| **Info/Process**    | `trial`, `in_progress`, `for_review`, `forwarded`, `info`            | `bg-blue-100`    | `text-blue-800`    | `border-blue-200`    | `text-blue-600`    |
| **Warning/Pending** | `pending`, `draft`, `for_approval`, `noted`                          | `bg-yellow-100`  | `text-yellow-800`  | `border-yellow-200`  | `text-yellow-600`  |
| **Danger**          | `suspended`, `expired`, `rejected`, `cancelled`, `error`, `returned` | `bg-red-100`     | `text-red-800`     | `border-red-200`     | `text-red-600`     |
| **Caution**         | `warning`, `maintenance`, `partially_delivered`                      | `bg-orange-100`  | `text-orange-800`  | `border-orange-200`  | `text-orange-600`  |
| **Critical**        | `critical`, `overdue`, `failed`                                      | `bg-red-100`     | `text-red-800`     | `border-red-200`     | `text-red-600`     |
| **Neutral**         | `inactive`, `archived`, unknown                                      | `bg-gray-100`    | `text-gray-700`    | `border-gray-200`    | `text-gray-500`    |
| **Violet/Special**  | `indicative` (APP type)                                              | `bg-violet-100`  | `text-violet-800`  | `border-violet-200`  | `text-violet-600`  |
| **Emerald/Final**   | `final` (APP type)                                                   | `bg-emerald-100` | `text-emerald-800` | `border-emerald-200` | `text-emerald-600` |

### 4.3 Status Color Usage Rules

1. **StatusBadge component** — always use `<StatusBadge status="..." />` in tables and detail views
2. **Stat card icons** — use the `text-{color}-600` variant for icons next to stat values
3. **Stat card values** — use `text-{color}-700` for the number itself
4. **Background tints** — only in badges and alert banners, never full card backgrounds
5. **Dark mode** — status colors are intentionally NOT inverted; they use Tailwind's built-in color scale which already provides adequate contrast on dark backgrounds when needed

### 4.4 Chart Colors

Charts use the achromatic `--chart-1` through `--chart-5` scale. For categorical data that needs color distinction (e.g., status breakdown pie charts), use the status colors above.

---

## 5. Component Patterns

### 5.1 Page Shell

Every page within the platform sits inside the sidebar + topbar shell:

```
┌─────────┬────────────────────────────────────────┐
│         │  Topbar (h-14, border-b)               │
│ Sidebar ├────────────────────────────────────────┤
│ (w-64)  │                                        │
│         │  Main Content (flex-1, overflow-y-auto) │
│         │  ┌─ p-6 ─────────────────────────────┐ │
│         │  │                                    │ │
│         │  │  Page content goes here            │ │
│         │  │                                    │ │
│         │  └────────────────────────────────────┘ │
└─────────┴────────────────────────────────────────┘
```

### 5.2 List Page Pattern

For all data listing pages (divisions, users, offices, PPMP items, etc.):

```tsx
<div className="space-y-6">
  {/* Page Header */}
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Page Title</h1>
      <p className="text-muted-foreground">
        Brief description of this section.
      </p>
    </div>
    <Button asChild>
      <Link href="/path/new">
        <Plus className="mr-2 h-4 w-4" />
        Create Item
      </Link>
    </Button>
  </div>

  {/* Optional: Filter bar */}
  <div className="flex items-center gap-3">
    <FiscalYearSelector />
    <OfficeSelector />
  </div>

  {/* Data Table */}
  <DataTable
    columns={columns}
    data={data}
    isLoading={isLoading}
    searchable
    searchPlaceholder="Search by name or code..."
    onRowClick={(row) => router.push(`/path/${row.id}`)}
    emptyMessage="No items found."
  />
</div>
```

### 5.3 Detail Page Pattern

For viewing a single record (division, user profile, PPMP, procurement request):

```tsx
<div className="mx-auto max-w-3xl space-y-6">
  {/* Header with Actions */}
  <div className="flex items-start justify-between">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{record.name}</h1>
      <p className="text-muted-foreground">{record.subtitle}</p>
    </div>
    <div className="flex gap-2">
      <Button variant="outline" size="sm">
        Edit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>Action 1</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  {/* Info Sections as Cards */}
  <Card>
    <CardHeader>
      <CardTitle>Section Title</CardTitle>
    </CardHeader>
    <CardContent>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Label</dt>
          <dd className="text-sm">{value ?? "—"}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</div>
```

### 5.4 Form Page Pattern

For create/edit forms:

```tsx
<div className="mx-auto max-w-2xl space-y-6">
  {/* Header */}
  <div>
    <h1 className="text-2xl font-bold tracking-tight">Create Item</h1>
    <p className="text-muted-foreground">Fill in the details below.</p>
  </div>

  {/* Form Card */}
  <Card>
    <CardHeader>
      <CardTitle>Item Details</CardTitle>
    </CardHeader>
    <CardContent>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {/* Single-column fields */}
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Name *</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          {/* Two-column grid for related fields */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField ... />
            <FormField ... />
          </div>

          {/* Full-width in grid */}
          <FormField ... /> {/* or use sm:col-span-2 inside grid */}

          {/* Toggle fields */}
          <FormField control={form.control} name="is_active" render={({ field }) => (
            <FormItem className="flex items-center gap-3">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div>
                <FormLabel>Active</FormLabel>
                <FormDescription>Enable this item.</FormDescription>
              </div>
            </FormItem>
          )} />

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Form>
    </CardContent>
  </Card>
</div>
```

### 5.5 Dashboard / Stats Pattern

For admin and role-based dashboards:

```tsx
<div className="space-y-6">
  <div>
    <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
    <p className="text-muted-foreground">Overview of your division.</p>
  </div>

  {/* Stat Cards — always 4-column grid */}
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card className="transition-colors hover:bg-muted/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Stat Label</CardTitle>
        <IconComponent className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">42</div>
        <p className="text-xs text-muted-foreground">Description text</p>
      </CardContent>
    </Card>
  </div>

  {/* Quick Actions — 2-column grid */}
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" /> Action Title
        </CardTitle>
        <CardDescription>What this action does.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/path">Go</Link>
        </Button>
      </CardContent>
    </Card>
  </div>
</div>
```

### 5.6 Workflow / Approval Timeline Pattern

For procurement and PPMP approval flows:

```tsx
{
  /* Approval Status Header */
}
<Card>
  <CardHeader>
    <div className="flex items-center justify-between">
      <CardTitle>Approval Status</CardTitle>
      <StatusBadge status={currentStatus} />
    </div>
  </CardHeader>
  <CardContent>
    {/* Step Timeline */}
    <div className="space-y-4">
      {steps.map((step, i) => (
        <div key={step.id} className="flex gap-3">
          {/* Step indicator */}
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2",
                step.completed && "border-green-500 bg-green-50 text-green-600",
                step.current && "border-blue-500 bg-blue-50 text-blue-600",
                step.pending && "border-gray-300 bg-gray-50 text-gray-400",
                step.rejected && "border-red-500 bg-red-50 text-red-600",
              )}
            >
              {step.completed ? (
                <Check className="h-4 w-4" />
              ) : step.rejected ? (
                <X className="h-4 w-4" />
              ) : (
                <span className="text-xs font-medium">{i + 1}</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-full w-0.5",
                  step.completed ? "bg-green-300" : "bg-gray-200",
                )}
              />
            )}
          </div>
          {/* Step content */}
          <div className="flex-1 pb-4">
            <p className="text-sm font-medium">{step.step_name}</p>
            <p className="text-xs text-muted-foreground">
              {step.acted_by_name} — {formatDate(step.acted_at)}
            </p>
            {step.remarks && (
              <p className="mt-1 text-sm text-muted-foreground italic">
                "{step.remarks}"
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  </CardContent>
</Card>;
```

### 5.7 Definition List (Key-Value Display)

For displaying record details inside cards:

```tsx
<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
  {/* Standard field */}
  <div>
    <dt className="text-sm font-medium text-muted-foreground">Field Label</dt>
    <dd className="text-sm">{value ?? "—"}</dd>
  </div>

  {/* With status badge */}
  <div>
    <dt className="text-sm font-medium text-muted-foreground">Status</dt>
    <dd>
      <StatusBadge status={record.status} />
    </dd>
  </div>

  {/* With monospace code */}
  <div>
    <dt className="text-sm font-medium text-muted-foreground">Reference No.</dt>
    <dd className="font-mono text-sm">{record.reference_no ?? "—"}</dd>
  </div>

  {/* Currency */}
  <div>
    <dt className="text-sm font-medium text-muted-foreground">Total Amount</dt>
    <dd className="text-sm font-medium">
      {formatCurrency(record.total_amount)}
    </dd>
  </div>

  {/* Full-width field */}
  <div className="sm:col-span-2">
    <dt className="text-sm font-medium text-muted-foreground">Description</dt>
    <dd className="text-sm">{record.description ?? "—"}</dd>
  </div>
</dl>
```

---

## 6. Component Inventory

### 6.1 shadcn/ui Base Components (27)

| Category      | Components                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| **Input**     | Button, Input, InputGroup, Textarea, Select, Checkbox, RadioGroup, Switch, Calendar |
| **Display**   | Badge, Avatar, Skeleton, Separator                                                  |
| **Container** | Card, ScrollArea, Tabs                                                              |
| **Overlay**   | Dialog, Sheet, Popover, Tooltip, DropdownMenu, Command                              |
| **Form**      | Form, Label                                                                         |
| **Data**      | Table                                                                               |
| **Feedback**  | Alert, Sonner (toast)                                                               |

### 6.2 Custom Shared Components

| Component            | Path                              | Purpose                                       |
| -------------------- | --------------------------------- | --------------------------------------------- |
| `StatusBadge`        | `shared/status-badge.tsx`         | Maps status string → colored badge            |
| `DataTable`          | `shared/data-table.tsx`           | Generic table with search, loading, row click |
| `FiscalYearSelector` | `shared/fiscal-year-selector.tsx` | Year filter dropdown                          |
| `OfficeSelector`     | `shared/office-selector.tsx`      | Office filter with type grouping              |

### 6.3 Layout Components

| Component     | Path                     | Purpose                                     |
| ------------- | ------------------------ | ------------------------------------------- |
| `Sidebar`     | `layout/sidebar.tsx`     | Fixed left nav, active state, icons         |
| `Topbar`      | `layout/topbar.tsx`      | Top bar with title                          |
| `PageHeader`  | `layout/page-header.tsx` | Title + description + breadcrumbs + actions |
| `Breadcrumbs` | `layout/breadcrumbs.tsx` | Breadcrumb navigation                       |

---

## 7. Interaction Patterns

### 7.1 Focus & Accessibility

```
Focus ring:     focus-visible:ring-3 focus-visible:ring-ring/50
Error ring:     aria-invalid:ring-destructive/20
Disabled:       disabled:opacity-50 disabled:cursor-not-allowed
```

### 7.2 Hover States

| Element        | Hover                                          |
| -------------- | ---------------------------------------------- |
| Primary button | `hover:bg-primary/80`                          |
| Outline button | `hover:bg-accent hover:text-accent-foreground` |
| Ghost button   | `hover:bg-accent hover:text-accent-foreground` |
| Table row      | `hover:bg-muted/50`                            |
| Clickable card | `transition-colors hover:bg-muted/50`          |
| Sidebar link   | `hover:bg-accent hover:text-accent-foreground` |
| Link text      | `hover:underline underline-offset-4`           |

### 7.3 Loading States

| Context        | Pattern                                                   |
| -------------- | --------------------------------------------------------- |
| Table loading  | 5 skeleton rows via `<Skeleton className="h-4 w-full" />` |
| Button loading | `disabled={isSubmitting}` + text change ("Saving...")     |
| Page loading   | Skeleton cards matching layout shape                      |
| Data fetch     | `isLoading` prop on `DataTable`                           |

### 7.4 Empty States

| Context         | Pattern                                                     |
| --------------- | ----------------------------------------------------------- |
| Empty table     | Centered `text-muted-foreground` in full-width cell, `h-24` |
| Empty detail    | Em dash `"—"` for null values                               |
| Empty dashboard | Show zero counts in stat cards (never hide cards)           |

### 7.5 Toast Notifications

```tsx
// Success
toast.success("Division created", { description: "You can now configure it." });

// Error
toast.error("Failed to save", { description: error.message });

// Info (sparingly)
toast.info("Changes saved");
```

---

## 8. Responsive Breakpoints

| Breakpoint | Width   | Usage                                    |
| ---------- | ------- | ---------------------------------------- |
| Default    | 0px+    | Single column, stacked layout            |
| `sm:`      | 640px+  | 2-column grids, side-by-side form fields |
| `md:`      | 768px+  | Reserved (not heavily used currently)    |
| `lg:`      | 1024px+ | 4-column stat grids, wider table layouts |

### Common Responsive Patterns

```
Stats grid:     grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
Action grid:    grid-cols-1 sm:grid-cols-2
Form fields:    grid-cols-1 sm:grid-cols-2
DL fields:      grid-cols-1 sm:grid-cols-2
```

---

## 9. Dark Mode

- Implemented via `.dark` class on `<html>` (next-themes)
- All base colors flip via CSS variable overrides in `globals.css`
- Sidebar in dark mode uses a **blue accent** (`oklch(0.488 0.243 264.376)`) for active state
- Status badge colors (Tailwind utilities) work in both modes without override
- Input fields in dark mode: `dark:bg-input/30`, `dark:hover:bg-input/50`

---

## 10. Border Radius Scale

| Token         | Computed | Usage                  |
| ------------- | -------- | ---------------------- |
| `rounded-sm`  | 6px      | Small badges, tags     |
| `rounded-md`  | 8px      | Buttons, inputs        |
| `rounded-lg`  | 10px     | Cards (base)           |
| `rounded-xl`  | 14px     | Card component default |
| `rounded-2xl` | 18px     | Large modals           |

---

## 11. Naming Conventions

### File Names

- Components: `kebab-case.tsx` (e.g., `status-badge.tsx`, `data-table.tsx`)
- Pages: `page.tsx` (Next.js convention)
- Server actions: `kebab-case.ts` in `lib/actions/`

### Component Exports

- Named exports only (no default exports)
- Props interface: `{ComponentName}Props`
- Column definitions: `Column<T>` generic

### CSS/Tailwind

- Use `cn()` utility for conditional classes
- CVA for component variants
- `data-slot` attributes for component identification

---

## 12. Quick Reference: "Which Pattern Do I Use?"

| Building...               | Use Pattern                                             |
| ------------------------- | ------------------------------------------------------- |
| A page that lists records | **5.2 List Page**                                       |
| A page showing one record | **5.3 Detail Page**                                     |
| A create/edit form        | **5.4 Form Page**                                       |
| A role-based landing page | **5.5 Dashboard**                                       |
| Approval tracking UI      | **5.6 Workflow Timeline**                               |
| Key-value record fields   | **5.7 Definition List**                                 |
| A status indicator        | `<StatusBadge status="..." />`                          |
| A data table              | `<DataTable columns={...} data={...} />`                |
| A filter toolbar          | Flex row with gap-3, selectors as children              |
| Currency display          | `formatCurrency()` with `en-PH` locale                  |
| Reference/ID display      | `font-mono text-sm`                                     |
| A date                    | `.toLocaleDateString("en-PH", { dateStyle: "medium" })` |
