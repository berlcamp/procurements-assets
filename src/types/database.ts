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
