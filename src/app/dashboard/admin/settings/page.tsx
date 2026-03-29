"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { systemSettingSchema, type SystemSettingInput } from "@/lib/schemas/admin"
import { getSettings, upsertSetting, deleteSetting } from "@/lib/actions/settings"
import { useDivision } from "@/lib/hooks/use-division"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import type { SystemSetting } from "@/types/database"

export default function SettingsPage() {
  const { divisionId } = useDivision()
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SystemSettingInput>({
    resolver: zodResolver(systemSettingSchema),
    defaultValues: { key: "", value: "", category: "general" },
  })

  useEffect(() => {
    getSettings().then((data) => {
      setSettings(data)
      setLoading(false)
    })
  }, [])

  async function onSubmit(values: SystemSettingInput) {
    if (!divisionId) return
    setSaving(true)
    const result = await upsertSetting(values, divisionId)
    if (result.error) {
      toast.error(result.error)
      setSaving(false)
      return
    }
    toast.success("Setting saved.")
    reset({ category: "general" })
    const refreshed = await getSettings()
    setSettings(refreshed)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const result = await deleteSetting(id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Setting deleted.")
    setSettings((prev) => prev.filter((s) => s.id !== id))
  }

  const byCategory = settings.reduce<Record<string, SystemSetting[]>>(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = []
      acc[s.category].push(s)
      return acc
    },
    {}
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Division Settings</h1>
        <p className="text-muted-foreground">
          Configure system settings for your division.
        </p>
      </div>

      {/* Add new setting */}
      <Card>
        <CardHeader>
          <CardTitle>Add / Update Setting</CardTitle>
          <CardDescription>
            If the key already exists it will be updated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Key *</Label>
                <Input {...register("key")} placeholder="e.g. pr_prefix" />
                {errors.key && (
                  <p className="text-xs text-destructive">{errors.key.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input {...register("category")} placeholder="general" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Value *</Label>
              <Input {...register("value")} />
              {errors.value && (
                <p className="text-xs text-destructive">{errors.value.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                {...register("description")}
                rows={2}
                placeholder="Optional description"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Setting"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Existing settings */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : Object.keys(byCategory).length === 0 ? (
        <p className="text-sm text-muted-foreground">No settings configured yet.</p>
      ) : (
        Object.entries(byCategory).map(([category, items]) => (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base capitalize">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start justify-between py-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-mono font-medium">{s.key}</p>
                      <p className="text-sm text-muted-foreground">{s.value}</p>
                      {s.description && (
                        <p className="text-xs text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
