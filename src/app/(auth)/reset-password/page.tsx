"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/field";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // null = still checking, false = no valid recovery session (link expired or opened directly)
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(Boolean(data.user)))
      .catch(() => setHasSession(false));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== String(form.get("confirm"))) return setError("The two passwords do not match.");

    setPending(true);
    setError(null);
    const { error: updateError } = await createClient().auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setPending(false);
    if (updateError) return setError(updateError.message);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      {hasSession === false ? (
        <div className="mt-6 space-y-3 text-sm">
          <p role="alert" className="text-danger">
            This reset link is invalid or has expired.
          </p>
          <Link href="/forgot-password" className="text-teal underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field label="New password" htmlFor="password" hint="At least 8 characters.">
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={8} maxLength={72} required />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending || hasSession === null}>
            {pending ? "Saving…" : "Save password"}
          </Button>
        </form>
      )}
    </div>
  );
}
