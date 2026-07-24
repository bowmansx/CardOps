import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for cron/server jobs that run with no user
 * session (RLS bypass). Returns null when SUPABASE_SERVICE_ROLE_KEY is not
 * configured — callers must degrade gracefully. Never import client-side.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
