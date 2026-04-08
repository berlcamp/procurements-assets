"use server"

import { getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { getAppsRequiringMyAction } from "@/lib/actions/app"
import { getPrsRequiringMyAction } from "@/lib/actions/procurement"
import { getProcurementsRequiringMyAction } from "@/lib/actions/procurement-activities"

export async function getActionCounts(): Promise<{ ppmp: number; app: number; pr: number; procurement: number }> {
  const [ppmpItems, appItems, prItems, procItems] = await Promise.all([
    getPpmpsRequiringMyAction(),
    getAppsRequiringMyAction(),
    getPrsRequiringMyAction(),
    getProcurementsRequiringMyAction(),
  ])
  return { ppmp: ppmpItems.length, app: appItems.length, pr: prItems.length, procurement: procItems.length }
}
