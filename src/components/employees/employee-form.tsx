"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { RoleName } from "@/lib/types";

type Created = { userId: string; email: string; temporaryPassword: string; emailed: boolean };

export function EmployeeForm({
  managers,
  canSuper,
  defaultValues,
  userId,
}: {
  managers: { id: string; name: string }[];
  canSuper: boolean;
  defaultValues?: Record<string, string>;
  userId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();
  const isEdit = Boolean(userId);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      if (isEdit && userId) {
        const res = await updateEmployee(userId, form);
        if ("error" in res && res.error) setError(res.error);
        else {
          toast.success("Changes saved");
          router.push(`/employees/${userId}`);
          router.refresh();
        }
        return;
      }
      const res = await createEmployee(form);
      if ("error" in res && res.error) setError(res.error);
      else if ("userId" in res && res.userId) {
        setCreated({
          userId: res.userId,
          email: res.email,
          temporaryPassword: res.temporaryPassword,
          emailed: res.emailed,
        });
        router.refresh();
      }
    });
  }

  if (created) {
    return (
      <div className="space-y-4" role="status">
        <h2 className="text-lg font-medium">Login created</h2>
        <p className="text-sm text-muted">
          {created.emailed
            ? `A welcome email with these details was sent to ${created.email}.`
            : "No email was sent (RESEND_API_KEY is not configured). Share these details securely."}{" "}
          The password is shown only once; the person is asked to change it after signing in.
        </p>
        <dl className="space-y-2 border border-line bg-paper p-4 text-sm">
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="font-mono">{created.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Temporary password</dt>
            <dd className="font-mono">{created.temporaryPassword}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${created.email}\n${created.temporaryPassword}`);
                toast.success("Copied");
              } catch {
                toast.error("Could not copy; select the text instead");
              }
            }}
          >
            Copy credentials
          </Button>
          <Link href={`/employees/${created.userId}`} className="inline-flex h-10 items-center bg-teal px-4 text-white">
            View profile
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCreated(null);
              setFormKey((k) => k + 1);
            }}
          >
            Add another
          </Button>
        </div>
      </div>
    );
  }

  const roles: RoleName[] = canSuper
    ? ["super_admin", "admin", "manager", "employee"]
    : ["admin", "manager", "employee"];

  return (
    <form key={formKey} onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {!isEdit ? (
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" required defaultValue={defaultValues?.email} />
        </Field>
      ) : (
        <input type="hidden" name="email" value={defaultValues?.email} />
      )}
      <Field label="Full name" htmlFor="fullName">
        <Input id="fullName" name="fullName" required minLength={2} maxLength={120} defaultValue={defaultValues?.fullName} />
      </Field>
      <Field label="Phone" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={defaultValues?.phone} />
      </Field>
      <Field label="Job title" htmlFor="jobTitle">
        <Input id="jobTitle" name="jobTitle" maxLength={120} defaultValue={defaultValues?.jobTitle} />
      </Field>
      <Field label="Department" htmlFor="department">
        <Input id="department" name="department" maxLength={120} defaultValue={defaultValues?.department} />
      </Field>
      <Field label="Location" htmlFor="location">
        <Input id="location" name="location" maxLength={120} defaultValue={defaultValues?.location} />
      </Field>
      <Field label="Role" htmlFor="roleName">
        <Select id="roleName" name="roleName" defaultValue={defaultValues?.roleName ?? "employee"}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ")}
            </option>
          ))}
          {defaultValues?.roleName === "super_admin" && !canSuper ? (
            <option value="super_admin" disabled>
              super admin
            </option>
          ) : null}
        </Select>
      </Field>
      <Field label="Status" htmlFor="status" hint="Inactive people cannot sign in.">
        <Select id="status" name="status" defaultValue={defaultValues?.status ?? "active"}>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
          <option value="on_leave">on leave</option>
        </Select>
      </Field>
      <Field label="Hire date" htmlFor="hireDate">
        <Input id="hireDate" name="hireDate" type="date" defaultValue={defaultValues?.hireDate} />
      </Field>
      <Field label="Employment type" htmlFor="employmentType">
        <Select id="employmentType" name="employmentType" defaultValue={defaultValues?.employmentType ?? "full_time"}>
          <option value="full_time">full time</option>
          <option value="contract">contract</option>
          <option value="intern">intern</option>
        </Select>
      </Field>
      <Field label="Reports to" htmlFor="managerId">
        <Select id="managerId" name="managerId" defaultValue={defaultValues?.managerId ?? ""}>
          <option value="">None</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="md:col-span-2">
        <Field label="Skills (comma separated)" htmlFor="skills">
          <Textarea id="skills" name="skills" rows={3} maxLength={1000} defaultValue={defaultValues?.skills} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create login"}
        </Button>
        <Link
          href={isEdit && userId ? `/employees/${userId}` : "/employees"}
          className="inline-flex h-10 items-center border border-line px-4 text-[15px] hover:bg-paper"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
