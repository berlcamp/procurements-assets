"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cancelJoinRequest, getMyJoinRequest } from "@/lib/actions/onboarding";
import { createClient } from "@/lib/supabase/client";
import type { DivisionJoinRequestWithDivision } from "@/types/database";
import { ClockIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function PendingApprovalPage() {
  const router = useRouter();
  const [request, setRequest] =
    useState<DivisionJoinRequestWithDivision | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    async function load() {
      const req = await getMyJoinRequest();

      if (!req) {
        // No request found — redirect to onboarding
        router.replace("/onboarding");
        return;
      }

      if (req.status === "approved") {
        toast.success("Your request has been approved!");
        router.replace("/dashboard");
        return;
      }

      if (req.status === "rejected") {
        setRequest(req);
        setLoading(false);
        return;
      }

      setRequest(req);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleCancel() {
    setCancelling(true);
    const { error } = await cancelJoinRequest();
    if (error) {
      toast.error(error);
      setCancelling(false);
      return;
    }
    toast.info("Request cancelled. You can try a different division.");
    router.replace("/onboarding");
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isRejected = request?.status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">PABMS</h1>
        </div>

        <Card>
          <CardHeader className="text-center">
            {isRejected ? (
              <>
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                  <XCircleIcon className="h-6 w-6 text-destructive" />
                </div>
                <CardTitle>Request Declined</CardTitle>
                <CardDescription>
                  Your request to join{" "}
                  <span className="font-medium text-foreground">
                    {request?.division?.name ?? "the division"}
                  </span>{" "}
                  was declined.
                </CardDescription>
              </>
            ) : (
              <>
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                  <ClockIcon className="h-6 w-6 text-amber-600" />
                </div>
                <CardTitle>Pending Approval</CardTitle>
                <CardDescription>
                  Your request to join{" "}
                  <span className="font-medium text-foreground">
                    {request?.division?.name ?? "the division"}
                  </span>{" "}
                  is awaiting approval from a division administrator.
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {isRejected && request?.review_notes && (
              <div className="rounded-md border bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Reason
                </p>
                <p className="mt-1 text-sm">{request.review_notes}</p>
              </div>
            )}

            {request?.created_at && !isRejected && (
              <p className="text-center text-xs text-muted-foreground">
                Submitted on{" "}
                {new Date(request.created_at).toLocaleDateString("en-PH", {
                  dateStyle: "long",
                })}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling
                  ? "Cancelling..."
                  : isRejected
                    ? "Try a Different Division"
                    : "Cancel & Try Different Division"}
              </Button>
              <Button variant="ghost" onClick={handleSignOut}>
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
