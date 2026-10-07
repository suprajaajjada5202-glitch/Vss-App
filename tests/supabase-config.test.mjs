import test from "node:test";
import assert from "node:assert/strict";
import { isSupabaseConfigured, supabaseDashboardLink, supabaseProjectRef, supabaseUrlProblem } from "../src/lib/supabase/config.ts";
import { isSchemaMissing } from "../src/lib/supabase/errors.ts";

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test("the dashboard address is recognised as the wrong URL, with the fix spelled out", () => {
  const msg = supabaseUrlProblem("https://supabase.com/dashboard/project/abcdefghijklmnop");
  assert.match(msg, /dashboard address/);
  assert.match(msg, /https:\/\/abcdefghijklmnop\.supabase\.co/);
  assert.match(supabaseUrlProblem("https://supabase.com/somewhere"), /dashboard address/);
});

test("real API URLs pass, junk is rejected", () => {
  assert.equal(supabaseUrlProblem("https://abcdefghijklmnop.supabase.co"), null);
  assert.equal(supabaseUrlProblem("http://127.0.0.1:54321"), null);
  assert.equal(supabaseUrlProblem("https://db.my-company.com"), null);
  assert.match(supabaseUrlProblem("not a url"), /not a valid URL/);
  assert.match(supabaseUrlProblem(""), /not a valid URL/);
});

test("project ref and dashboard deep links only exist for hosted projects", () => {
  assert.equal(supabaseProjectRef("https://abcdefghijklmnop.supabase.co"), "abcdefghijklmnop");
  assert.equal(supabaseProjectRef("http://127.0.0.1:54321"), null);
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" }, () => {
    assert.equal(supabaseDashboardLink("/sql/new"), "https://supabase.com/dashboard/project/abcdefghijklmnop/sql/new");
  });
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, () => assert.equal(supabaseDashboardLink("/sql/new"), null));
});

test("placeholder keys count as not configured", () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://YOUR_PROJECT.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "your_anon_key" }, () => assert.equal(isSupabaseConfigured(), false));
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ.real.key" }, () => assert.equal(isSupabaseConfigured(), true));
});

test("isSchemaMissing recognises 'table not found' errors and nothing else", () => {
  assert.equal(isSchemaMissing({ code: "PGRST205" }), true);
  assert.equal(isSchemaMissing({ code: "42P01" }), true);
  for (const other of [{ code: "PGRST301" }, { code: "42501" }, {}, null, undefined]) assert.equal(isSchemaMissing(other), false);
});
