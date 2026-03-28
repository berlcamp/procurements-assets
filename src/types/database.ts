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
