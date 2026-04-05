"use server"

import { getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { getAppsRequiringMyAction } from "@/lib/actions/app"

export async function getActionCounts(): Promise<{ ppmp: number; app: number }> {
  const [ppmpItems, appItems] = await Promise.all([
    getPpmpsRequiringMyAction(),
    getAppsRequiringMyAction(),
  ])
  return { ppmp: ppmpItems.length, app: appItems.length }
}
