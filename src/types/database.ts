// ============================================================
// Platform types (Phase 2)
// ============================================================
export type SubscriptionStatus = 'pending' | 'trial' | 'active' | 'suspended' | 'expired'
export type AnnouncementType = 'info' | 'warning' | 'critical' | 'maintenance'
export type ExpenseClass = 'PS' | 'MOOE' | 'CO' | 'IG' | 'Others'

export interface Division {
  id: string
  name: string
  code: string
  region: string
  address: string | null
  contact_number: string | null
  email: string | null
  logo_url: string | null
  subscription_status: SubscriptionStatus
  subscription_plan: string
  trial_ends_at: string | null
  subscription_starts_at: string | null
  subscription_ends_at: string | null
  max_users: number
  max_schools: number
  onboarded_by: string | null
  onboarded_at: string | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface Announcement {
  id: string
  title: string
  message: string
  type: AnnouncementType
  target_divisions: string[] | null
  is_active: boolean
  published_at: string | null
  expires_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PlatformAuditLog {
  id: string
  action: string
  target_division_id: string | null
  details: Record<string, unknown> | null
  performed_by: string | null
  created_at: string
}

export interface FundSource {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

export interface AccountCode {
  id: string
  code: string
  name: string
  expense_class: ExpenseClass
  parent_code_id: string | null
  level: number
  is_active: boolean
  created_at: string
}

// ============================================================
// Organization & Auth types (Phase 3)
// ============================================================
export type OfficeType = 'division_office' | 'school' | 'section'
export type RoleScope = 'platform' | 'division' | 'office'
export type PermissionScope = 'platform' | 'division'
export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'approval'
export type ApprovalAction = 'approved' | 'rejected' | 'returned' | 'forwarded' | 'noted'
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

export interface Office {
  id: string
  division_id: string
  name: string
  code: string
  office_type: OfficeType
  parent_office_id: string | null
  address: string | null
  contact_number: string | null
  email: string | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface OfficeWithChildren extends Office {
  children?: OfficeWithChildren[]
}

export interface UserProfile {
  id: string
  division_id: string
  employee_id: string | null
  first_name: string
  middle_name: string | null
  last_name: string
  suffix: string | null
  position: string | null
  department: string | null
  office_id: string | null
  contact_number: string | null
  is_super_admin: boolean
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface UserProfileWithEmail extends UserProfile {
  email?: string
}

export interface Role {
  id: string
  name: string
  display_name: string
  description: string | null
  is_system_role: boolean
  scope: RoleScope
  created_at: string
  updated_at: string
}

export interface Permission {
  id: string
  code: string
  module: string
  description: string | null
  scope: PermissionScope
  created_at: string
}

export interface RolePermission {
  id: string
  role_id: string
  permission_id: string
}

export interface UserRole {
  id: string
  user_id: string
  role_id: string
  division_id: string
  office_id: string | null
  granted_by: string | null
  granted_at: string
  revoked_at: string | null
  is_active: boolean
}

export interface UserRoleWithRole extends UserRole {
  role: Role
  office?: Office | null
}

export interface SystemSetting {
  id: string
  division_id: string
  key: string
  value: string
  description: string | null
  category: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface SequenceCounter {
  id: string
  division_id: string
  office_id: string | null
  counter_type: string
  fiscal_year: number
  last_value: number
  prefix: string | null
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: NotificationType
  reference_type: string | null
  reference_id: string | null
  is_read: boolean
  read_at: string | null
  office_id: string | null
  created_at: string
}

export interface ApprovalLog {
  id: string
  reference_type: string
  reference_id: string
  step_name: string
  step_order: number
  action: ApprovalAction
  acted_by: string
  acted_at: string
  remarks: string | null
  office_id: string | null
  created_at: string
}

export interface Document {
  id: string
  reference_type: string
  reference_id: string
  document_type: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  version: number
  uploaded_by: string
  office_id: string | null
  deleted_at: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  division_id: string | null
  table_name: string
  record_id: string | null
  action: AuditAction
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_fields: string[] | null
  user_id: string | null
  user_ip: string | null
  user_agent: string | null
  office_id: string | null
  session_id: string | null
  created_at: string
}

export interface AuditLogWithUser extends AuditLog {
  user_profile?: Pick<UserProfile, 'first_name' | 'last_name' | 'employee_id'> | null
}

// ============================================================
// Budget types (Phase 4)
// ============================================================
export type FiscalYearStatus = 'planning' | 'open' | 'closing' | 'closed'
export type BudgetAllocationStatus = 'active' | 'inactive' | 'closed'
export type BudgetAdjustmentType = 'realignment' | 'augmentation' | 'reduction' | 'transfer_in' | 'transfer_out'
export type BudgetAdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface FiscalYear {
  id: string
  division_id: string
  year: number
  is_active: boolean
  start_date: string | null
  end_date: string | null
  status: FiscalYearStatus
  created_at: string
  updated_at: string
}

export interface BudgetAllocation {
  id: string
  division_id: string
  fiscal_year_id: string
  office_id: string
  fund_source_id: string
  account_code_id: string
  original_amount: string
  adjusted_amount: string
  obligated_amount: string
  disbursed_amount: string
  description: string | null
  status: BudgetAllocationStatus
  created_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface BudgetAllocationWithDetails extends BudgetAllocation {
  office?: Pick<Office, 'id' | 'name' | 'code'>
  fund_source?: Pick<FundSource, 'id' | 'name' | 'code'>
  account_code?: Pick<AccountCode, 'id' | 'name' | 'code' | 'expense_class'>
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
}

export interface BudgetAdjustment {
  id: string
  division_id: string
  budget_allocation_id: string
  office_id: string
  adjustment_type: BudgetAdjustmentType
  amount: string
  justification: string
  reference_number: string | null
  status: BudgetAdjustmentStatus
  approved_by: string | null
  approved_at: string | null
  remarks: string | null
  created_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface BudgetAdjustmentWithDetails extends BudgetAdjustment {
  budget_allocation?: BudgetAllocationWithDetails
  office?: Pick<Office, 'id' | 'name' | 'code'>
}

export interface BudgetSummaryRow {
  allocation_id: string
  fund_source_id: string
  fund_source_name: string
  account_code_id: string
  account_code: string
  account_name: string
  expense_class: ExpenseClass
  original_amount: string
  adjusted_amount: string
  obligated_amount: string
  disbursed_amount: string
  available_amount: string
  utilization_pct: string
  status: BudgetAllocationStatus
}

export interface BudgetUtilizationByOffice {
  office_id: string
  office_name: string
  office_code: string
  total_adjusted: string
  total_obligated: string
  total_disbursed: string
  total_available: string
  utilization_pct: string
}

export interface BudgetUtilizationByFundSource {
  fund_source_id: string
  fund_source_name: string
  fund_source_code: string
  total_adjusted: string
  total_obligated: string
  total_disbursed: string
  total_available: string
  utilization_pct: string
}

// ============================================================
// Planning types (Phase 5 — PPMP)
// ============================================================

export type PpmpStatus =
  | 'draft'
  | 'submitted'
  | 'chief_reviewed'
  | 'budget_certified'
  | 'approved'
  | 'revision_required'
  | 'locked'

export type PpmpVersionStatus =
  | 'draft'
  | 'submitted'
  | 'chief_reviewed'
  | 'budget_certified'
  | 'approved'
  | 'superseded'

export type PpmpVersionType = 'original' | 'amendment' | 'supplemental'

export type PpmpProjectType = 'goods' | 'infrastructure' | 'consulting_services'

export type IndicativeFinal = 'indicative' | 'final'

export interface Ppmp {
  id: string
  division_id: string
  office_id: string
  fiscal_year_id: string
  current_version: number
  status: PpmpStatus
  indicative_final: IndicativeFinal
  submitted_at: string | null
  submitted_by: string | null
  chief_reviewed_by: string | null
  chief_reviewed_at: string | null
  chief_review_notes: string | null
  budget_certified_by: string | null
  budget_certified_at: string | null
  budget_certification_notes: string | null
  approved_by: string | null
  approved_at: string | null
  approval_notes: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PpmpVersion {
  id: string
  ppmp_id: string
  version_number: number
  version_type: PpmpVersionType
  amendment_justification: string | null
  total_estimated_budget: string
  snapshot_data: Record<string, unknown> | null
  status: PpmpVersionStatus
  indicative_final: IndicativeFinal
  approved_by: string | null
  approved_at: string | null
  office_id: string
  created_at: string
  created_by: string | null
}

// GPPB Form Columns 1-2 (project-level)
export interface PpmpProject {
  id: string
  ppmp_version_id: string
  ppmp_id: string
  project_number: number
  general_description: string
  project_type: PpmpProjectType
  office_id: string
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

// GPPB Form Columns 3-12 (lot-level row)
export interface PpmpLot {
  id: string
  ppmp_project_id: string
  lot_number: number
  lot_title: string | null
  procurement_mode: string
  pre_procurement_conference: boolean
  procurement_start: string | null
  procurement_end: string | null
  delivery_period: string | null
  source_of_funds: string | null
  estimated_budget: string
  supporting_documents: string | null
  remarks: string | null
  budget_allocation_id: string | null
  created_at: string
  updated_at: string
}

// GPPB Form Column 3 detail items (within a lot)
export interface PpmpLotItem {
  id: string
  ppmp_lot_id: string
  item_number: number
  description: string
  quantity: string
  unit: string
  specification: string | null
  estimated_unit_cost: string
  estimated_total_cost: string
  created_at: string
  updated_at: string
}

// Joined types for UI display
export interface PpmpWithDetails extends Ppmp {
  office?: Pick<Office, 'id' | 'name' | 'code' | 'office_type'>
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
}

export interface PpmpLotWithItems extends PpmpLot {
  ppmp_lot_items?: PpmpLotItem[]
}

export interface PpmpProjectWithLots extends PpmpProject {
  ppmp_lots?: PpmpLotWithItems[]
}

export interface PpmpVersionWithProjects extends PpmpVersion {
  ppmp_projects?: PpmpProjectWithLots[]
}

export interface PpmpLotWithAllocation extends PpmpLot {
  budget_allocation?: BudgetAllocationWithDetails
}

// Version history row returned by get_ppmp_version_history RPC
export interface PpmpVersionHistoryRow {
  version_number: number
  version_type: PpmpVersionType
  status: PpmpVersionStatus
  indicative_final: IndicativeFinal
  total_estimated_budget: string
  amendment_justification: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  project_count: number
}
