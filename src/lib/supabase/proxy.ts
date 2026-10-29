import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";
import { resilientFetch } from "./fetch";

const SIGNED_IN_ONLY = ["/dashboard", "/onboarding"];
const SIGNED_OUT_ONLY = ["/login", "/signup"];

/**
 * Refreshes the Supabase session cookie on every request and sends visitors
 * to the right place depending on whether they are signed in. This is only a
 * convenience: pages and actions check the user again, and the database
 * enforces access with Row Level Security.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseConfig();

  const supabase = createServerClient(url, key, {
    global: { fetch: resilientFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // Validates the session and refreshes it when it is about to expire.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && matchesAny(pathname, SIGNED_IN_ONLY)) {
    return redirectKeepingCookies(request, "/login", response);
  }
  if (isSignedIn && matchesAny(pathname, SIGNED_OUT_ONLY)) {
    return redirectKeepingCookies(request, "/dashboard", response);
  }

  return response;
}

function matchesAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectKeepingCookies(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
