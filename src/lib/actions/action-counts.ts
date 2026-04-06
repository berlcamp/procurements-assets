"use server"

import { getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { getAppsRequiringMyAction } from "@/lib/actions/app"
import { getPrsRequiringMyAction } from "@/lib/actions/procurement"

export async function getActionCounts(): Promise<{ ppmp: number; app: number; pr: number }> {
  const [ppmpItems, appItems, prItems] = await Promise.all([
    getPpmpsRequiringMyAction(),
    getAppsRequiringMyAction(),
    getPrsRequiringMyAction(),
  ])
  return { ppmp: ppmpItems.length, app: appItems.length, pr: prItems.length }
}
