import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";
import { resilientFetch } from "./fetch";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user, so every query is subject to Row Level Security.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseConfig();

  return createServerClient<Database>(url, key, {
    global: { fetch: resilientFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
