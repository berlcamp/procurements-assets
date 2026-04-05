"use client"

import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  getFundSources,
  createFundSource,
  toggleFundSourceStatus,
} from "@/lib/actions/fund-sources"
import type { FundSource } from "@/types/database"
import { DataTable } from "@/components/shared/data-table"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Column, FilterDef } from "@/components/shared/data-table"

const formSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

export default function FundSourcesPage() {
  const [fundSources, setFundSources] = useState<FundSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
    },
  })

  const loadFundSources = useCallback(async () => {
    setIsLoading(true)
    const data = await getFundSources()
    setFundSources(data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    loadFundSources()
  }, [loadFundSources])

  async function handleToggle(id: string, current: boolean) {
    const { error } = await toggleFundSourceStatus(id, !current)
    if (error) {
      toast.error("Failed to update status", { description: error })
    } else {
      setFundSources((prev) =>
        prev.map((f) => (f.id === id ? { ...f, is_active: !current } : f))
      )
    }
  }

  async function onSubmit(values: FormValues) {
    const { error } = await createFundSource({
      code: values.code.toUpperCase(),
      name: values.name,
      description: values.description || null,
    })
    if (error) {
      toast.error("Failed to create fund source", { description: error })
      return
    }
    toast.success("Fund source created")
    setSheetOpen(false)
    form.reset()
    loadFundSources()
  }

  const columns: Column<FundSource>[] = [
    { key: "code", header: "Code", className: "font-mono font-medium" },
    { key: "name", header: "Name" },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <span className="text-muted-foreground">
          {row.description ?? "—"}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Active",
      render: (row) => (
        <Switch
          checked={row.is_active}
          onCheckedChange={() => handleToggle(row.id, row.is_active)}
        />
      ),
    },
  ]

  const filters: FilterDef<FundSource>[] = [
    {
      key: "is_active",
      label: "Status",
      options: [
        { label: "Active", value: "true" },
        { label: "Inactive", value: "false" },
      ],
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fund Sources</h1>
          <p className="text-muted-foreground">
            Standard DepEd fund sources for procurement.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>Add Fund Source</Button>
      </div>

      <DataTable
        columns={columns}
        data={fundSources}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by code or name..."
        emptyMessage="No fund sources found."
        filters={filters}
      />

      {/* Add Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => setSheetOpen(open)}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Add Fund Source</SheetTitle>
            <SheetDescription>
              Add a new fund source for budget classification.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <Form {...form}>
              <form
                id="fund-source-form"
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. GF"
                          {...field}
                          onChange={(e) =>
                            field.onChange(e.target.value.toUpperCase())
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. General Fund" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Brief description of this fund source"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSheetOpen(false)
                form.reset()
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="fund-source-form"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Creating..." : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
