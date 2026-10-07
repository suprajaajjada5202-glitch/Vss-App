import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden grid-overlay border-r border-line bg-ink text-[#f3efe6] lg:flex lg:flex-col lg:justify-between p-12">
        <p className="font-mono text-xs tracking-[0.22em] text-teal">VOOLA SOFTWARE · VSS PULSE</p>
        <div>
          <h1 className="max-w-lg text-5xl font-semibold leading-[1.1]">
            The floor plan for how this company actually works.
          </h1>
          <p className="mt-6 max-w-md text-base text-[#c9c2b3]">
            People, assignments, rooms, and a paper trail — built for a software house that still cares who owns the ticket.
          </p>
        </div>
        <p className="font-mono text-xs text-[#8a8376]">Restricted to Voola staff accounts.</p>
      </section>
      <section className="flex items-center justify-center bg-paper px-6 py-16">
        <div className="w-full max-w-md">
          <p className="mb-2 font-mono text-xs text-teal lg:hidden">VSS PULSE</p>
          <h2 className="text-3xl font-semibold">Sign in</h2>
          <p className="mb-8 mt-2 text-sm text-muted">Use the email your admin provisioned.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
