"use server"

import { getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { getAppsRequiringMyAction } from "@/lib/actions/app"
import { getPrsRequiringMyAction } from "@/lib/actions/procurement"
import { getProcurementsRequiringMyAction } from "@/lib/actions/procurement-activities"

export async function getActionCounts(): Promise<{
  ppmp: number; app: number; pr: number; procurement: number; total: number
}> {
  const [ppmpItems, appItems, prItems, procItems] = await Promise.all([
    getPpmpsRequiringMyAction(),
    getAppsRequiringMyAction(),
    getPrsRequiringMyAction(),
    getProcurementsRequiringMyAction(),
  ])
  const ppmp = ppmpItems.length
  const app = appItems.length
  const pr = prItems.length
  const procurement = procItems.length
  return { ppmp, app, pr, procurement, total: ppmp + app + pr + procurement }
}
