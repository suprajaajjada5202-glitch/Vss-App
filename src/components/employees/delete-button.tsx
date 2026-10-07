"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteEmployee } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function DeleteEmployeeButton({ userId, name }: { userId: string; name?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete ${name ?? "this person"} and their login? This cannot be undone.`)) return;
        start(async () => {
          const res = await deleteEmployee(userId);
          if ("error" in res && res.error) toast.error(res.error);
          else {
            toast.success("Employee deleted");
            router.push("/employees");
          }
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
