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

export interface UserProfileForTable extends UserProfile {
  email?: string
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
  roles?: Pick<Role, 'id' | 'name' | 'display_name'>[]
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

// ============================================================
// Division Join Requests
// ============================================================
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected'

export interface DivisionJoinRequest {
  id: string
  user_id: string
  division_id: string
  first_name: string
  last_name: string
  middle_name: string | null
  suffix: string | null
  position: string | null
  office_id: string | null
  status: JoinRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
}

export interface DivisionJoinRequestWithDivision extends DivisionJoinRequest {
  division?: Pick<Division, 'id' | 'name' | 'code' | 'region'>
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
export type SubAroStatus = 'draft' | 'active' | 'fully_allocated' | 'expired' | 'cancelled'
export type AllotmentClass = 'current' | 'continuing'

export interface SubAllotmentReleaseOrder {
  id: string
  division_id: string
  fiscal_year_id: string
  sub_aro_number: string
  aro_number: string | null
  allotment_class: AllotmentClass
  fund_source_id: string
  releasing_office: string | null
  release_date: string | null
  validity_date: string | null
  purpose: string | null
  total_amount: string
  allocated_amount: string
  status: SubAroStatus
  document_url: string | null
  remarks: string | null
  created_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SubAroWithDetails extends SubAllotmentReleaseOrder {
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'> | null
  fund_source?: Pick<FundSource, 'id' | 'name' | 'code'> | null
  allocations?: BudgetAllocationWithDetails[]
}

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
  sub_aro_id: string | null
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
  sub_aro?: Pick<SubAllotmentReleaseOrder, 'id' | 'sub_aro_number' | 'aro_number' | 'allotment_class'> | null
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

/** Creator summary for PPMP list (e.g. My PPMP Created column) */
export interface PpmpCreatorSummary {
  full_name: string
  office_name: string | null
}

// Joined types for UI display
export interface PpmpWithDetails extends Ppmp {
  office?: Pick<Office, 'id' | 'name' | 'code' | 'office_type'>
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
  /** Set when list queries enrich with user_profiles (e.g. getMyPpmps) */
  creator?: PpmpCreatorSummary
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

// ============================================================
// Planning types (Phase 6 — APP)
// ============================================================

export type AppStatus =
  | 'populating'
  | 'indicative'
  | 'under_review'
  | 'bac_finalization'
  | 'final'
  | 'approved'
  | 'posted'

export type AppVersionStatus =
  | 'draft'
  | 'under_review'
  | 'bac_finalization'
  | 'final'
  | 'approved'
  | 'superseded'

export type AppVersionType = 'original' | 'amendment' | 'supplemental'

export type HopeReviewStatus = 'pending' | 'approved' | 'remarked'

export type AppLotStatus = 'draft' | 'finalized' | 'in_procurement'

export interface App {
  id: string
  division_id: string
  fiscal_year_id: string
  current_version: number
  status: AppStatus
  indicative_final: IndicativeFinal
  philgeps_reference: string | null
  approved_by: string | null
  approved_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface AppVersion {
  id: string
  app_id: string
  version_number: number
  version_type: AppVersionType
  amendment_justification: string | null
  total_estimated_cost: string
  snapshot_data: Record<string, unknown> | null
  status: AppVersionStatus
  indicative_final: IndicativeFinal
  approved_by: string | null
  approved_at: string | null
  created_at: string
  created_by: string | null
}

export interface AppItem {
  id: string
  app_version_id: string
  app_id: string
  source_ppmp_project_id: string | null
  source_ppmp_lot_id: string | null
  source_ppmp_id: string | null
  item_number: number
  general_description: string
  project_type: string | null
  procurement_mode: string | null
  estimated_budget: string
  source_of_funds: string | null
  procurement_start: string | null
  procurement_end: string | null
  delivery_period: string | null
  budget_allocation_id: string | null
  source_office_id: string | null
  hope_review_status: HopeReviewStatus
  hope_reviewed_by: string | null
  hope_reviewed_at: string | null
  hope_remarks: string | null
  lot_id: string | null
  lot_item_number: number | null
  remarks: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface AppLot {
  id: string
  app_id: string
  app_version_id: string
  lot_number: number
  lot_name: string
  description: string | null
  procurement_method: string | null
  total_estimated_cost: string
  status: AppLotStatus
  finalized_by: string | null
  finalized_at: string | null
  division_id: string
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

// Joined types for UI
export interface AppWithDetails extends App {
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
}

export interface AppItemWithOffice extends AppItem {
  source_office?: Pick<Office, 'id' | 'name' | 'code'> | null
  lot?: Pick<AppLot, 'id' | 'lot_name' | 'lot_number'> | null
  source_ppmp_lot?: {
    ppmp_lot_items: Pick<PpmpLotItem, 'id' | 'item_number' | 'description' | 'quantity' | 'unit' | 'estimated_unit_cost' | 'estimated_total_cost' | 'specification'>[]
  } | null
}

export interface AppLotWithItems extends AppLot {
  app_items?: AppItem[]
}

export interface AppSummary {
  total_items: number
  pending_items: number
  approved_items: number
  remarked_items: number
  lotted_items: number
  unlotted_items: number
  total_lots: number
  finalized_lots: number
  draft_lots: number
  total_budget: string
}

// ============================================================
// Procurement types (Phase 7)
// ============================================================

export type SupplierStatus = 'active' | 'blacklisted' | 'suspended' | 'inactive'

export type PrStatus =
  | 'draft'
  | 'submitted'
  | 'budget_certified'
  | 'approved'
  | 'in_procurement'
  | 'completed'
  | 'cancelled'

export type ObrStatus = 'pending' | 'certified' | 'obligated' | 'cancelled'

export interface Supplier {
  id: string
  division_id: string
  name: string
  trade_name: string | null
  tin: string
  philgeps_number: string | null
  address: string | null
  city: string | null
  province: string | null
  zip_code: string | null
  contact_person: string | null
  contact_number: string | null
  email: string | null
  website: string | null
  business_type: string | null
  classification: string[]
  status: SupplierStatus
  blacklist_reason: string | null
  blacklist_date: string | null
  blacklist_until: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PurchaseRequest {
  id: string
  division_id: string
  pr_number: string
  office_id: string
  fiscal_year_id: string
  purpose: string
  requested_by: string
  requested_at: string | null
  fund_source_id: string | null
  budget_allocation_id: string | null
  total_estimated_cost: string
  procurement_id: string | null
  procurement_mode: string | null
  abc_ceiling: string | null
  status: PrStatus
  budget_certified_by: string | null
  budget_certified_at: string | null
  approved_by: string | null
  approved_at: string | null
  cancellation_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PrItem {
  id: string
  purchase_request_id: string
  item_number: number
  description: string
  unit: string
  quantity: string
  estimated_unit_cost: string
  estimated_total_cost: string
  ppmp_item_id: string | null
  app_item_id: string | null
  remarks: string | null
  office_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  app_item?: Pick<AppItem, 'id' | 'item_number' | 'general_description' | 'estimated_budget' | 'procurement_mode' | 'project_type' | 'source_of_funds'> | null
}

export interface ObligationRequest {
  id: string
  division_id: string
  obr_number: string
  purchase_request_id: string
  procurement_id: string | null
  budget_allocation_id: string | null
  office_id: string | null
  amount: string
  status: ObrStatus
  certified_by: string | null
  certified_at: string | null
  obligated_at: string | null
  remarks: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface ObligationRequestWithDetails extends ObligationRequest {
  purchase_request?: Pick<PurchaseRequest, 'id' | 'pr_number' | 'purpose' | 'status' | 'total_estimated_cost'> & {
    office?: Pick<Office, 'id' | 'name' | 'code'> | null
    fiscal_year?: Pick<FiscalYear, 'id' | 'year'> | null
  } | null
  procurement?: Pick<ProcurementActivity, 'id' | 'procurement_number' | 'procurement_method' | 'status'> | null
  budget_allocation?: Pick<BudgetAllocation, 'id' | 'adjusted_amount' | 'obligated_amount'> & {
    fund_source?: Pick<FundSource, 'id' | 'name' | 'code'> | null
    account_code?: { id: string; code: string; name: string } | null
  } | null
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
  certified_by_profile?: { id: string; first_name: string; last_name: string } | null
}

// Joined types for UI

export interface PurchaseRequestWithDetails extends PurchaseRequest {
  office?: Pick<Office, 'id' | 'name' | 'code'>
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
  fund_source?: Pick<FundSource, 'id' | 'name' | 'code'> | null
  budget_allocation?: Pick<BudgetAllocation, 'id' | 'adjusted_amount' | 'obligated_amount'> | null
  pr_items?: PrItem[]
  obr?: ObligationRequest | null
  requester?: Pick<UserProfile, 'id' | 'first_name' | 'last_name' | 'position'> | null
}

export interface ProcurementDashboardStats {
  total_prs: number
  draft_prs: number
  pending_certification: number
  pending_approval: number
  in_procurement: number
  completed_prs: number
  total_obligated: string
  total_prs_value: string
}

export interface SplitContractWarning {
  warning: boolean
  cumulative_amount: number
  threshold: number
  pr_count: number
}

// ── Phase 8: Procurement Activities (SVP + Shopping) ─────────

export interface ProcurementLot {
  id: string
  procurement_id: string
  lot_number: number
  lot_name: string
  description: string | null
  abc_amount: string
  awarded_supplier_id: string | null
  awarded_amount: string | null
  status: 'open' | 'awarded' | 'failed' | 'cancelled'
  failure_reason: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface SupplierDocumentType {
  code: string
  display_name: string
  required_for_bidding: boolean
  required_for_svp: boolean
  ngpa_section: string | null
  notes: string | null
  sort_order: number
}

export interface SupplierDocument {
  id: string
  supplier_id: string
  document_type: string
  document_number: string | null
  document_url: string | null
  issuing_authority: string | null
  issue_date: string | null
  expiry_date: string | null
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface SupplierEligibilityCheck {
  is_eligible: boolean
  missing: string[]
  expired: string[]
}

export interface ProcurementMethodCeiling {
  procurement_mode: string
  ceiling_amount: string | null
  effective_from: string
  ra_reference: string | null
  notes: string | null
  min_quotations: number | null
  min_posting_days: number | null
  requires_philgeps_publication: boolean
  ngpa_section: string | null
  display_name: string | null
  requires_bid_security: boolean
  bid_security_percentage: string | null
  requires_performance_security: boolean
  performance_security_percentage: string | null
  min_bac_quorum: number | null
}

export interface BidEvaluation {
  id: string
  bid_id: string
  evaluator_id: string
  is_responsive: boolean
  is_eligible: boolean
  is_compliant: boolean
  technical_pass: boolean | null
  financial_pass: boolean | null
  evaluation_score: string | null
  remarks: string | null
  status: 'confirmed' | 'stale'
  confirmed_at: string
  invalidated_at: string | null
  created_at: string
  updated_at: string
}

export type SecurityForm =
  | 'cash'
  | 'bank_draft'
  | 'managers_check'
  | 'irrevocable_loc'
  | 'surety_bond'
  | 'bank_guarantee'

export interface BidSecurityStatus {
  required: boolean
  posted: boolean
  sufficient: boolean
  required_amount: string | null
  posted_amount: string | null
  form?: SecurityForm | null
  error?: string
}

export type ProcurementMethod = 'svp' | 'shopping' | 'competitive_bidding' | 'direct_contracting' | 'repeat_order' | 'emergency' | 'negotiated' | 'agency_to_agency'
export type ProcurementActivityStatus = 'active' | 'completed' | 'failed' | 'cancelled'
export type BidStatus = 'submitted' | 'evaluated' | 'awarded' | 'disqualified'
export type ProcurementStageStatus = 'completed' | 'current' | 'skipped'

export interface ProcurementActivity {
  id: string
  division_id: string
  procurement_number: string
  office_id: string
  fiscal_year_id: string
  purchase_request_id: string
  procurement_method: ProcurementMethod
  abc_amount: string
  current_stage: string
  awarded_supplier_id: string | null
  contract_amount: string | null
  savings_amount: string | null
  failure_reason: string | null
  failure_count: number
  philgeps_reference: string | null
  posting_date: string | null
  submission_deadline: string | null
  posting_required_days: number | null
  philgeps_published_at: string | null
  performance_security_required: boolean
  performance_security_amount: string | null
  performance_security_form: SecurityForm | null
  performance_security_reference: string | null
  performance_security_received_at: string | null
  performance_security_returned_at: string | null
  bac_resolution_number: string | null
  bac_resolution_date: string | null
  bac_resolution_file_url: string | null
  bac_resolution_uploaded_at: string | null
  bac_resolution_uploaded_by: string | null
  noa_file_url: string | null
  noa_issued_at: string | null
  noa_uploaded_by: string | null
  signed_contract_file_url: string | null
  contract_signed_at: string | null
  signed_contract_uploaded_by: string | null
  ntp_file_url: string | null
  ntp_issued_at: string | null
  ntp_uploaded_by: string | null
  // Direct Contracting
  justification_type: string | null
  justification_text: string | null
  price_reasonableness_note: string | null
  // Repeat Order
  reference_procurement_id: string | null
  original_contract_date: string | null
  price_increase_percentage: string | null
  // Emergency
  emergency_type: string | null
  emergency_justification: string | null
  emergency_purchase_date: string | null
  emergency_review_deadline: string | null
  // Negotiated
  negotiation_records_note: string | null
  // Agency-to-Agency
  partner_agency_name: string | null
  moa_reference: string | null
  moa_date: string | null
  status: ProcurementActivityStatus
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface ProcurementActivityWithDetails extends ProcurementActivity {
  purchase_request?: PurchaseRequestWithDetails
  supplier?: Pick<Supplier, 'id' | 'name' | 'trade_name' | 'tin'> | null
  office?: Pick<Office, 'id' | 'name' | 'code'>
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'>
  stages?: ProcurementStage[]
  bids?: BidWithDetails[]
}

export interface ProcurementStage {
  id: string
  procurement_id: string
  stage: string
  status: ProcurementStageStatus
  started_at: string
  completed_at: string | null
  completed_by: string | null
  notes: string | null
  office_id: string | null
  created_at: string
}

export interface Bid {
  id: string
  procurement_id: string
  supplier_id: string
  lot_id: string | null
  bid_amount: string
  bid_date: string
  is_responsive: boolean
  is_eligible: boolean
  is_compliant: boolean
  rank: number | null
  evaluation_score: string | null
  status: BidStatus
  disqualification_reason: string | null
  remarks: string | null
  office_id: string | null
  bid_security_amount: string | null
  bid_security_form: SecurityForm | null
  bid_security_reference: string | null
  bid_security_received_at: string | null
  bid_security_returned_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface BidWithDetails extends Bid {
  supplier?: Pick<Supplier, 'id' | 'name' | 'trade_name' | 'tin'>
  items?: BidItem[]
}

export interface BidItem {
  id: string
  bid_id: string
  pr_item_id: string
  offered_unit_cost: string
  offered_total_cost: string
  brand_model: string | null
  specifications: string | null
  remarks: string | null
  created_at: string
}

export interface ProcurementSummary {
  total: number
  active: number
  completed: number
  failed: number
  svp_count: number
  shopping_count: number
  total_abc: string
  total_awarded: string
  total_savings: string
}

// ── Phase 11: Purchase Orders & Delivery ─────────────────────

export type PoStatus = 'draft' | 'approved' | 'issued' | 'partially_delivered' | 'fully_delivered' | 'completed' | 'cancelled'
export type InspectionStatus = 'pending' | 'passed' | 'failed' | 'partial_acceptance'

export interface PurchaseOrder {
  id: string
  division_id: string
  po_number: string
  procurement_id: string
  supplier_id: string
  office_id: string
  fiscal_year_id: string
  total_amount: string
  delivery_date: string | null
  delivery_address: string | null
  payment_terms: string | null
  status: PoStatus
  approved_by: string | null
  approved_at: string | null
  issued_at: string | null
  cancellation_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PoItem {
  id: string
  purchase_order_id: string
  pr_item_id: string | null
  bid_item_id: string | null
  description: string
  unit: string
  quantity: string
  unit_cost: string
  total_cost: string
  delivered_quantity: string
  accepted_quantity: string
  remarks: string | null
  office_id: string | null
  created_at: string
  updated_at: string
}

export interface Delivery {
  id: string
  division_id: string
  purchase_order_id: string
  delivery_number: string
  delivery_date: string
  received_by: string | null
  inspection_date: string | null
  inspected_by: string | null
  inspection_status: InspectionStatus
  inspection_report_number: string | null
  remarks: string | null
  office_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface DeliveryItem {
  id: string
  delivery_id: string
  po_item_id: string
  quantity_delivered: string
  quantity_accepted: string
  quantity_rejected: string
  rejection_reason: string | null
  remarks: string | null
  office_id: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  procurement?: Pick<ProcurementActivity, 'id' | 'procurement_number' | 'procurement_method' | 'abc_amount' | 'contract_amount'> | null
  supplier?: Pick<Supplier, 'id' | 'name' | 'trade_name' | 'tin'> | null
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
  fiscal_year?: Pick<FiscalYear, 'id' | 'year' | 'status'> | null
  po_items?: PoItemWithPrItem[]
  deliveries?: DeliveryWithItems[]
}

export interface PoItemWithPrItem extends PoItem {
  pr_item?: Pick<PrItem, 'id' | 'description' | 'unit' | 'quantity' | 'estimated_unit_cost'> | null
}

export interface DeliveryWithItems extends Delivery {
  delivery_items?: DeliveryItemWithPoItem[]
  received_by_profile?: { id: string; first_name: string; last_name: string } | null
  inspected_by_profile?: { id: string; first_name: string; last_name: string } | null
}

export interface DeliveryItemWithPoItem extends DeliveryItem {
  po_item?: Pick<PoItem, 'id' | 'description' | 'unit' | 'quantity' | 'unit_cost'> | null
}

// ============================================================
// Phase 12: Asset Management — Inventory types
// ============================================================

export type ItemCategory = 'consumable' | 'semi_expendable' | 'ppe'
export type MovementType = 'stock_in' | 'stock_out' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'return'

export interface ItemCatalog {
  id: string
  division_id: string
  code: string
  name: string
  description: string | null
  category: ItemCategory
  unit: string
  account_code_id: string | null
  useful_life_years: number | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface Inventory {
  id: string
  division_id: string
  item_catalog_id: string
  office_id: string
  current_quantity: string
  reorder_point: string
  location: string | null
  last_count_date: string | null
  last_count_quantity: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface StockMovement {
  id: string
  division_id: string
  inventory_id: string
  movement_type: MovementType
  quantity: string
  reference_type: string | null
  reference_id: string | null
  remarks: string | null
  office_id: string | null
  created_by: string | null
  created_at: string
}

export interface ItemCatalogWithDetails extends ItemCatalog {
  account_code?: Pick<AccountCode, 'id' | 'name' | 'code' | 'expense_class'> | null
}

export interface InventoryWithDetails extends Inventory {
  item_catalog?: ItemCatalogWithDetails | null
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
}

export interface StockMovementWithDetails extends StockMovement {
  inventory?: Pick<Inventory, 'id' | 'item_catalog_id' | 'office_id'> & {
    item_catalog?: Pick<ItemCatalog, 'id' | 'code' | 'name' | 'unit'> | null
  } | null
  created_by_profile?: { id: string; first_name: string; last_name: string } | null
}

// ============================================================
// Phase 13: Asset Management — Property types
// ============================================================

export type AssetType = 'semi_expendable' | 'ppe'
export type ConditionStatus = 'serviceable' | 'needs_repair' | 'unserviceable' | 'disposed'
export type AssetStatus = 'active' | 'transferred' | 'for_disposal' | 'disposed' | 'lost' | 'donated'
export type AssignmentDocType = 'par' | 'ics'

export interface Asset {
  id: string
  division_id: string
  property_number: string
  item_catalog_id: string
  office_id: string
  description: string | null
  brand_model: string | null
  serial_number: string | null
  acquisition_date: string
  acquisition_cost: string
  source_po_id: string | null
  source_delivery_id: string | null
  source_delivery_item_id: string | null
  asset_type: AssetType
  condition_status: ConditionStatus
  current_custodian_id: string | null
  location: string | null
  useful_life_years: number | null
  residual_value: string
  accumulated_depreciation: string
  book_value: string
  status: AssetStatus
  disposal_date: string | null
  disposal_method: string | null
  disposal_reference: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface AssetAssignment {
  id: string
  division_id: string
  asset_id: string
  custodian_id: string
  office_id: string
  document_type: AssignmentDocType
  document_number: string
  assigned_date: string
  returned_date: string | null
  remarks: string | null
  assigned_by: string | null
  is_current: boolean
  created_at: string
  updated_at: string
}

export interface DepreciationRecord {
  id: string
  asset_id: string
  period_year: number
  period_month: number
  depreciation_amount: string
  accumulated_amount: string
  book_value: string
  office_id: string
  created_at: string
}

export interface AssetWithDetails extends Asset {
  item_catalog?: ItemCatalogWithDetails | null
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
  current_custodian_profile?: { id: string; first_name: string; last_name: string } | null
}

export interface AssetAssignmentWithDetails extends AssetAssignment {
  asset?: Pick<Asset, 'id' | 'property_number' | 'description' | 'asset_type' | 'status'> | null
  custodian_profile?: { id: string; first_name: string; last_name: string } | null
  assigned_by_profile?: { id: string; first_name: string; last_name: string } | null
  office?: Pick<Office, 'id' | 'name' | 'code'> | null
}
