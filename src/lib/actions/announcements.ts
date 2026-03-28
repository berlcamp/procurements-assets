"use server"

import { createClient } from "@/lib/supabase/server"
import type { Announcement, AnnouncementType } from "@/types/database"

export interface CreateAnnouncementInput {
  title: string
  message: string
  type?: AnnouncementType
  target_divisions?: string[] | null
  is_active?: boolean
  published_at?: string | null
  expires_at?: string | null
}

export async function getAnnouncements(): Promise<Announcement[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getAnnouncements error:", error)
    return []
  }

  return (data ?? []) as Announcement[]
}

export async function createAnnouncement(
  input: CreateAnnouncementInput
): Promise<{ data: Announcement | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("announcements")
    .insert({
      title: input.title,
      message: input.message,
      type: input.type ?? "info",
      target_divisions: input.target_divisions ?? null,
      is_active: input.is_active ?? true,
      published_at: input.published_at ?? null,
      expires_at: input.expires_at ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error("createAnnouncement error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as Announcement, error: null }
}

export async function updateAnnouncement(
  id: string,
  input: Partial<CreateAnnouncementInput>
): Promise<{ data: Announcement | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("announcements")
    .update(input)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    console.error("updateAnnouncement error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as Announcement, error: null }
}

export async function toggleAnnouncementStatus(
  id: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("platform")
    .from("announcements")
    .update({ is_active: isActive })
    .eq("id", id)

  if (error) {
    console.error("toggleAnnouncementStatus error:", error)
    return { error: error.message }
  }

  return { error: null }
}
