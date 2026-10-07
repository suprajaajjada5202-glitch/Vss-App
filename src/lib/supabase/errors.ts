/**
 * PostgREST answers PGRST205 ("Could not find the table … in the schema cache") — or Postgres 42P01 —
 * when supabase/schema.sql has not been run on the project yet.
 */
export function isSchemaMissing(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
