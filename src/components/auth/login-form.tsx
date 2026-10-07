"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { safeNextPath } from "@/lib/utils";

const NOTICES: Record<string, string> = {
  inactive: "This account has been deactivated. Contact an administrator.",
  missing:
    "You are signed in, but this account has no staff record yet. Project owner: run supabase/seed.sql (or `npm run db:setup -- --promote <your email>`). Everyone else: ask an administrator.",
  link: "That link has expired or was already used. Request a new one.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const notice = NOTICES[params.get("error") ?? ""] ?? null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const supabase = createClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (signError) {
        setPending(false);
        setError(
          signError.message.toLowerCase().includes("banned")
            ? NOTICES.inactive
            : signError.message
        );
        return;
      }
    } catch {
      setPending(false);
      setError("Could not reach Supabase. Check the keys in .env.local and restart the server.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {notice ? (
        <p role="status" className="border border-line bg-panel px-3 py-2 text-sm text-muted">
          {notice}
        </p>
      ) : null}
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/forgot-password" className="text-teal hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
