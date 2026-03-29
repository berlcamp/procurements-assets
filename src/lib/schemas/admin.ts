import { z } from "zod"

export const officeSchema = z.object({
  name: z.string().min(1, "Office name is required"),
  code: z.string().min(1, "Office code is required").max(20),
  office_type: z.enum(["division_office", "school", "section"]),
  parent_office_id: z.string().uuid().nullable().optional(),
  address: z.string().nullable().optional(),
  contact_number: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
})

export type OfficeInput = z.infer<typeof officeSchema>

export const userProfileSchema = z.object({
  email: z.string().email("Valid email required"),
  first_name: z.string().min(1, "First name is required"),
  middle_name: z.string().nullable().optional(),
  last_name: z.string().min(1, "Last name is required"),
  suffix: z.string().nullable().optional(),
  employee_id: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  office_id: z.string().uuid().nullable().optional(),
  contact_number: z.string().nullable().optional(),
})

export type UserProfileInput = z.infer<typeof userProfileSchema>

export const assignRoleSchema = z.object({
  user_id: z.string().uuid(),
  role_id: z.string().uuid(),
  office_id: z.string().uuid().nullable().optional(),
})

export type AssignRoleInput = z.infer<typeof assignRoleSchema>

export const systemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().min(1),
})

export type SystemSettingInput = z.infer<typeof systemSettingSchema>
