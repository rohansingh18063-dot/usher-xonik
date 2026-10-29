import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";
import { resilientFetch } from "./fetch";

/**
 * Supabase client that acts as the server itself and bypasses Row Level
 * Security. Use only on the server, only for data the current request has
 * already been authorized for, and never send its results to the browser
 * without filtering them first.
 */
export function createAdminClient() {
  const { url } = getSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set. Add it to your environment settings.");
  }

  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: resilientFetch },
  });
}
