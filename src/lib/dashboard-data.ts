import "server-only";
import { cache } from "react";
import { getCurrentBusiness } from "@/lib/data";
import { addDays, leadsTimeZone, startOfDay, todayIn } from "@/lib/leads";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Data for the Overview, Conversations and Knowledge gaps pages. Everything is
// read with the signed-in client's own permissions, so Row Level Security
// limits every query and function call to their own business.

export type DailyRow = { day: string; conversations: number; messages: number; leads: number };
export type PeriodTotals = { conversations: number; messages: number; leads: number };

/** Monday of the week that contains a date. */
export function weekStart(date: string) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

function sum(rows: DailyRow[], from: string): PeriodTotals {
  return rows
    .filter((row) => row.day >= from)
    .reduce(
      (total, row) => ({
        conversations: total.conversations + row.conversations,
        messages: total.messages + row.messages,
        leads: total.leads + row.leads,
      }),
      { conversations: 0, messages: 0, leads: 0 },
    );
}

/** The month whose messages count against the monthly limit (calendar month, UTC). */
export function usageMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, next };
}

export const getOverview = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const timeZone = leadsTimeZone();
  const today = todayIn(timeZone);
  const periods = { today, week: weekStart(today), month: `${today.slice(0, 8)}01` };
  const chartStart = addDays(today, -29);
  const from = [chartStart, periods.week, periods.month].sort()[0];
  const month = usageMonth();

  const [daily, client, usage, latestLeads] = await Promise.all([
    supabase.rpc("dashboard_daily", { p_from: from, p_to: today, p_time_zone: timeZone }, { get: true }),
    supabase.from("clients").select("monthly_message_limit").eq("id", business.id).single(),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", business.id)
      .eq("channel", "website")
      .gte("created_at", month.start.toISOString()),
    supabase
      .from("leads")
      .select("id, name, mobile, preferred_date, preferred_time, status, seen_at, created_at")
      .eq("client_id", business.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  for (const result of [daily, client, usage, latestLeads]) {
    if (result.error) throw new Error("Could not load your dashboard.");
  }

  const rows = daily.data ?? [];
  return {
    timeZone,
    totals: { today: sum(rows, periods.today), week: sum(rows, periods.week), month: sum(rows, periods.month) },
    chart: rows.filter((row) => row.day >= chartStart),
    usage: { used: usage.count ?? 0, limit: client.data!.monthly_message_limit, resetsOn: month.next },
    latestLeads: latestLeads.data ?? [],
  };
});

export type ChecklistItem = { id: string; label: string; description: string; href: string; action: string; done: boolean };

/** The setup steps, in order; the checklist is shown until all are done. */
export const getSetupChecklist = cache(async (): Promise<ChecklistItem[] | null> => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const [profile, documents, domains, widget, conversation] = await Promise.all([
    supabase.from("business_profiles").select("phone, whatsapp, email, address, opening_hours").eq("client_id", business.id).maybeSingle(),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("client_id", business.id),
    supabase
      .from("allowed_domains")
      .select("domain", { count: "exact", head: true })
      .eq("client_id", business.id)
      .neq("domain", "localhost"),
    supabase.from("widget_settings").select("installed_at, installed_origin").eq("client_id", business.id).maybeSingle(),
    supabase.from("conversations").select("id").eq("client_id", business.id).eq("channel", "website").limit(1),
  ]);
  for (const result of [profile, documents, domains, widget, conversation]) {
    if (result.error) throw new Error("Could not load your setup checklist.");
  }

  const info = profile.data;
  const hasContact = Boolean(info && (info.phone || info.whatsapp || info.email || info.address));
  const hasHours = Boolean(info && Object.values(info.opening_hours ?? {}).some((value) => String(value).trim()));

  return [
    {
      id: "business-info",
      label: "Fill in your Business Info",
      description: "Add your contact details and opening hours so the assistant can answer the basics.",
      href: "/dashboard/business-info",
      action: "Add Business Info",
      done: hasContact && hasHours,
    },
    {
      id: "document",
      label: "Upload a document",
      description: "A price list, brochure or FAQ teaches the assistant about your services.",
      href: "/dashboard/documents",
      action: "Upload a document",
      done: (documents.count ?? 0) > 0,
    },
    {
      id: "domain",
      label: "Add your website's domain",
      description: "Your assistant only answers on the websites you allow.",
      href: "/dashboard/api-key",
      action: "Add a domain",
      done: (domains.count ?? 0) > 0,
    },
    {
      id: "widget",
      label: "Install the widget on your website",
      description: widget.data?.installed_at
        ? `Seen on ${widget.data.installed_origin ?? "your website"}.`
        : "Paste one line of code into your website. This completes by itself once it loads there.",
      href: "/dashboard/widget",
      action: "Get the embed code",
      done: Boolean(widget.data?.installed_at),
    },
    {
      id: "conversation",
      label: "Receive your first conversation",
      description: "Completes when a visitor chats with your assistant on your website.",
      href: "/dashboard/widget",
      action: "Check your widget",
      done: (conversation.data ?? []).length > 0,
    },
  ];
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type ConversationFilters = { q: string; from: string; to: string; lead: "" | "yes" | "no"; page: number };

export const CONVERSATIONS_PAGE_SIZE = 25;
export const MAX_CONVERSATION_EXPORT = 2000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseConversationFilters(params: Record<string, string | string[] | undefined>): ConversationFilters {
  const value = (name: string) => {
    const raw = params[name];
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  };
  const page = Number.parseInt(value("page"), 10);
  const lead = value("lead");
  return {
    q: value("q").slice(0, 100),
    from: DATE.test(value("from")) ? value("from") : "",
    to: DATE.test(value("to")) ? value("to") : "",
    lead: lead === "yes" || lead === "no" ? lead : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function conversationFiltersToSearch(filters: Partial<ConversationFilters>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "page" && value === 1)) search.set(key, String(value));
  }
  return search;
}

export async function listConversations(filters: ConversationFilters, { limit, offset }: { limit: number; offset: number }) {
  const supabase = await createClient();
  const timeZone = leadsTimeZone();
  // A read, so it is sent as GET (retried if the connection drops). Unused
  // filters are left out rather than sent as null, which a URL cannot carry;
  // the function's defaults apply instead.
  const args: Database["public"]["Functions"]["conversation_list"]["Args"] = { p_limit: limit, p_offset: offset };
  if (filters.q) args.p_query = filters.q;
  if (filters.from) args.p_from = startOfDay(filters.from, timeZone).toISOString();
  if (filters.to) args.p_to = startOfDay(addDays(filters.to, 1), timeZone).toISOString();
  if (filters.lead) args.p_has_lead = filters.lead === "yes";
  const { data, error } = await supabase.rpc("conversation_list", args, { get: true });
  if (error) throw new Error("Could not load your conversations.");
  return { rows: data ?? [], total: data?.[0]?.total_count ?? 0 };
}

/** One website conversation with all its messages, or null if it is not this client's. */
export const getConversation = cache(async (sessionId: string) => {
  const business = await getCurrentBusiness();
  if (!business || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const supabase = await createClient();

  const [turns, lead] = await Promise.all([
    supabase
      .from("conversations")
      .select("visitor_message, assistant_reply, page_url, created_at")
      .eq("client_id", business.id)
      .eq("channel", "website")
      .eq("session_id", sessionId)
      .order("created_at"),
    supabase
      .from("leads")
      .select("id, name, status")
      .eq("client_id", business.id)
      .eq("conversation_id", sessionId)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (turns.error || lead.error) throw new Error("Could not load this conversation.");
  if (!turns.data?.length) return null;
  return { turns: turns.data, lead: lead.data };
});

// ---------------------------------------------------------------------------
// Knowledge gaps
// ---------------------------------------------------------------------------

export const getKnowledgeGaps = cache(async (status: "open" | "resolved") => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const [gaps, counts] = await Promise.all([
    supabase
      .from("knowledge_gaps")
      .select("id, category, topic, status, question_count, first_asked_at, last_asked_at, resolved_at")
      .eq("client_id", business.id)
      .eq("status", status)
      .order(status === "open" ? "question_count" : "resolved_at", { ascending: false })
      .order("last_asked_at", { ascending: false })
      .limit(200),
    supabase.from("knowledge_gaps").select("status").eq("client_id", business.id),
  ]);
  if (gaps.error || counts.error) throw new Error("Could not load your knowledge gaps.");

  const ids = (gaps.data ?? []).map((gap) => gap.id);
  const questions = ids.length
    ? await supabase
        .from("knowledge_gap_questions")
        .select("gap_id, question, session_id, created_at")
        .in("gap_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000)
    : { data: [], error: null };
  if (questions.error) throw new Error("Could not load your knowledge gaps.");

  const examples = new Map<string, { question: string; session_id: string | null; created_at: string }[]>();
  for (const question of questions.data ?? []) {
    const list = examples.get(question.gap_id) ?? [];
    if (list.length < 5) list.push(question);
    examples.set(question.gap_id, list);
  }

  return {
    gaps: (gaps.data ?? []).map((gap) => ({ ...gap, examples: examples.get(gap.id) ?? [] })),
    openCount: (counts.data ?? []).filter((gap) => gap.status === "open").length,
    resolvedCount: (counts.data ?? []).filter((gap) => gap.status === "resolved").length,
  };
});

/** Unseen leads and open knowledge gaps, shown as counts in the navigation. */
export const getNavigationCounts = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return { leads: 0, gaps: 0 };
  const supabase = await createClient();
  const [leads, gaps] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", business.id).is("seen_at", null),
    supabase.from("knowledge_gaps").select("id", { count: "exact", head: true }).eq("client_id", business.id).eq("status", "open"),
  ]);
  return { leads: leads.count ?? 0, gaps: gaps.count ?? 0 };
});
