import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, LEAD_STATUSES, leadsTimeZone, startOfDay, type LeadStatus } from "./leads";

// Lead search and filters, shared by the Leads page and the CSV export so
// both always return the same leads. Queries run with the signed-in
// client's own permissions, so Row Level Security limits them to their leads.

export type LeadFilters = { q: string; status: LeadStatus | ""; from: string; to: string; page: number };

export const LEADS_PAGE_SIZE = 25;
export const MAX_EXPORT_ROWS = 5000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLeadFilters(params: Record<string, string | string[] | undefined>): LeadFilters {
  const value = (name: string) => {
    const raw = params[name];
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  };
  const status = value("status");
  const page = Number.parseInt(value("page"), 10);
  return {
    q: value("q").slice(0, 100),
    status: (LEAD_STATUSES as readonly string[]).includes(status) ? (status as LeadStatus) : "",
    from: DATE.test(value("from")) ? value("from") : "",
    to: DATE.test(value("to")) ? value("to") : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The filters as URL search parameters, leaving out empty ones. */
export function filtersToSearch(filters: Partial<LeadFilters>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "page" && value === 1)) search.set(key, String(value));
  }
  return search;
}

export const LEAD_LIST_COLUMNS =
  "id, name, mobile, preferred_date, preferred_time, concern, status, notes, source_url, seen_at, created_at";

export function leadsQuery(
  supabase: SupabaseClient<Database>,
  clientId: string,
  filters: LeadFilters,
  options: { count?: boolean } = {},
) {
  let query = supabase
    .from("leads")
    .select(LEAD_LIST_COLUMNS, options.count ? { count: "exact" } : undefined)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);

  const timeZone = leadsTimeZone();
  if (filters.from) query = query.gte("created_at", startOfDay(filters.from, timeZone).toISOString());
  if (filters.to) query = query.lt("created_at", startOfDay(addDays(filters.to, 1), timeZone).toISOString());

  const search = searchFilter(filters.q);
  if (search) query = query.or(search);

  return query;
}

/**
 * Matches the name (any part, any case) or the mobile number (any run of
 * digits). Characters with a meaning in the filter syntax are removed, and
 * the name is quoted so spaces, dots and commas are matched literally.
 */
function searchFilter(q: string) {
  const name = q.replace(/["\\%_*()]/g, "").trim();
  const digits = q.replace(/\D/g, "");
  const parts: string[] = [];
  if (/\p{L}/u.test(name)) parts.push(`name.ilike."%${name}%"`);
  if (digits.length >= 3) parts.push(`mobile.like."%${digits}%"`);
  return parts.join(",");
}
