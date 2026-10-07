"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    const supabase = createClient();
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    if (resetError) setError(resetError.message);
    else setSent(true);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Reset access</h1>
      <p className="mt-2 text-sm text-muted">We email a one-time link to the address on your staff record.</p>
      {sent ? (
        <p className="mt-6 text-sm">Check your inbox. The link expires quickly.</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field label="Work email" htmlFor="email">
            <Input id="email" name="email" type="email" required />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-6 text-sm text-teal">
        Back to sign in
      </Link>
    </div>
  );
}
