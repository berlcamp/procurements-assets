"use client"

import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  getAccountCodes,
  createAccountCode,
  toggleAccountCodeStatus,
} from "@/lib/actions/account-codes"
import type { AccountCode, ExpenseClass } from "@/types/database"
import { DataTable } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Column, FilterDef } from "@/components/shared/data-table"

const EXPENSE_CLASSES: ExpenseClass[] = ["PS", "MOOE", "CO", "IG", "Others"]

const formSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  expense_class: z.enum(["PS", "MOOE", "CO", "IG", "Others"] as const),
  level: z.string().min(1),
})

type FormValues = z.infer<typeof formSchema>

export default function AccountCodesPage() {
  const [allCodes, setAllCodes] = useState<AccountCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("all")

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      expense_class: "MOOE",
      level: "1",
    },
  })

  const loadCodes = useCallback(async () => {
    setIsLoading(true)
    const data = await getAccountCodes()
    setAllCodes(data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    loadCodes()
  }, [loadCodes])

  const filteredCodes =
    activeTab === "all"
      ? allCodes
      : allCodes.filter((c) => c.expense_class === activeTab)

  async function handleToggle(id: string, current: boolean) {
    const { error } = await toggleAccountCodeStatus(id, !current)
    if (error) {
      toast.error("Failed to update status", { description: error })
    } else {
      setAllCodes((prev) =>
        prev.map((c) => (c.id === id ? { ...c, is_active: !current } : c))
      )
    }
  }

  async function onSubmit(values: FormValues) {
    const { error } = await createAccountCode({
      code: values.code,
      name: values.name,
      expense_class: values.expense_class,
      level: parseInt(values.level, 10),
    })
    if (error) {
      toast.error("Failed to create account code", { description: error })
      return
    }
    toast.success("Account code created")
    setSheetOpen(false)
    form.reset()
    loadCodes()
  }

  const columns: Column<AccountCode>[] = [
    { key: "code", header: "Code", className: "font-mono", hideable: false },
    { key: "name", header: "Name", hideable: false },
    {
      key: "expense_class",
      header: "Expense Class",
      render: (row) => <StatusBadge status={row.expense_class} />,
    },
    { key: "level", header: "Level", defaultHidden: true },
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

  const filters: FilterDef<AccountCode>[] = [
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
          <h1 className="text-2xl font-bold">Account Codes</h1>
          <p className="text-muted-foreground">
            UACS codes used for budget classification.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>Add Account Code</Button>
      </div>

      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(String(val))}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {EXPENSE_CLASSES.map((cls) => (
            <TabsTrigger key={cls} value={cls}>
              {cls}
            </TabsTrigger>
          ))}
        </TabsList>
        {["all", ...EXPENSE_CLASSES].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <DataTable
              columns={columns}
              data={filteredCodes}
              isLoading={isLoading}
              searchable
              searchPlaceholder="Search by code or name..."
              emptyMessage="No account codes found."
              filters={filters}
              columnToggle
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Add Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => setSheetOpen(open)}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Add Account Code</SheetTitle>
            <SheetDescription>
              Add a new UACS account code for budget classification.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <Form {...form}>
              <form
                id="account-code-form"
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
                        <Input placeholder="e.g. 5020302000" {...field} />
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
                        <Input
                          placeholder="e.g. Office Supplies Expense"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expense_class"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expense Class *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EXPENSE_CLASSES.map((cls) => (
                            <SelectItem key={cls} value={cls}>
                              {cls}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Level</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
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
              form="account-code-form"
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
