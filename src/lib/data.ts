import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { addDays, leadsTimeZone, startOfDay, todayIn } from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string };

/** The signed-in user for this request, or null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Session checks compare token expiry with the current time, so they must
  // never run during prerendering, only for a real request.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  return { id: claims.sub, email: claims.email ?? "" };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The business owned by the signed-in user, or null if they have not finished
 * onboarding. Row Level Security guarantees only their own row can be read;
 * the user_id filter just makes the intent explicit.
 */
export const getCurrentBusiness = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, business_name, industry, website_domain, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Loading the business failed:", error);
    throw new Error("Could not load your business details.");
  }
  return data;
});

/** The signed-in client's clinic details, or null if none were saved yet. */
export const getCurrentBusinessProfile = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_profiles")
    .select("address, phone, whatsapp, email, opening_hours, doctors, services, fees, offers, languages, maps_url")
    .eq("client_id", business.id)
    .maybeSingle();

  if (error) throw new Error("Could not load your business info.");
  return data;
});

/** Everything the API Key page shows, read with the signed-in client's own permissions. */
export const getPublicAccessOverview = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // Row Level Security limits every query to this client's rows.
  const [key, settings, domains, usage, rejections] = await Promise.all([
    supabase.from("api_keys").select("public_key, requests_per_minute, created_at, regenerated_at").maybeSingle(),
    supabase
      .from("clients")
      .select("assistant_paused, test_mode, monthly_message_limit")
      .eq("id", business.id)
      .single(),
    supabase
      .from("allowed_domains")
      .select("domain, include_subdomains, created_at")
      .eq("client_id", business.id)
      .order("created_at"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", business.id)
      .eq("channel", "website")
      .gte("created_at", monthStart),
    supabase.from("public_api_rejections").select("reason, origin, created_at").order("created_at", { ascending: false }).limit(25),
  ]);

  for (const result of [key, settings, domains, usage, rejections]) {
    if (result.error) throw new Error("Could not load your API settings.");
  }

  return {
    key: key.data,
    settings: settings.data!,
    domains: domains.data ?? [],
    websiteMessagesThisMonth: usage.count ?? 0,
    rejections: rejections.data ?? [],
  };
});

/** Everything the Widget page shows, read with the signed-in client's own permissions. */
export const getWidgetOverview = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const [settings, key, domains] = await Promise.all([
    supabase
      .from("widget_settings")
      .select("assistant_name, brand_color, position, welcome_message, quick_replies, logo_path")
      .eq("client_id", business.id)
      .maybeSingle(),
    supabase.from("api_keys").select("public_key").maybeSingle(),
    supabase.from("allowed_domains").select("domain").eq("client_id", business.id).order("created_at"),
  ]);

  for (const result of [settings, key, domains]) {
    if (result.error) throw new Error("Could not load your widget settings.");
  }

  return { settings: settings.data, publicKey: key.data?.public_key ?? null, domains: (domains.data ?? []).map((d) => d.domain) };
});

/** Lead counts for the overview, in the clinic's time zone; weeks start on Monday. */
export const getLeadCounts = cache(async () => {
  const business = await getCurrentBusiness();
  if (!business) return null;
  const supabase = await createClient();

  const timeZone = leadsTimeZone();
  const today = todayIn(timeZone);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const since = {
    today: startOfDay(today, timeZone),
    week: startOfDay(addDays(today, -weekday), timeZone),
    month: startOfDay(`${today.slice(0, 8)}01`, timeZone),
  };

  const count = (from?: Date, unseen = false) => {
    let query = supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", business.id);
    if (from) query = query.gte("created_at", from.toISOString());
    if (unseen) query = query.is("seen_at", null);
    return query;
  };
  const results = await Promise.all([count(since.today), count(since.week), count(since.month), count(undefined, true)]);
  if (results.some((result) => result.error)) throw new Error("Could not load your lead counts.");
  const [todayCount, week, month, unseen] = results.map((result) => result.count ?? 0);
  return { today: todayCount, week, month, unseen };
});

/** A lead with its chat conversation and alert deliveries, or null if it is not this client's. */
export const getLead = cache(async (id: string) => {
  const business = await getCurrentBusiness();
  if (!business || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();

  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this lead.");
  if (!lead) return null;

  const [conversation, notifications] = await Promise.all([
    lead.conversation_id
      ? supabase
          .from("conversations")
          .select("visitor_message, assistant_reply, created_at")
          .eq("client_id", business.id)
          .eq("session_id", lead.conversation_id)
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("lead_notifications")
      .select("channel, recipient, status, error, created_at")
      .eq("lead_id", lead.id)
      .order("created_at"),
  ]);
  if (conversation.error || notifications.error) throw new Error("Could not load this lead.");

  return { lead, conversation: conversation.data ?? [], notifications: notifications.data ?? [] };
});

/** Where lead alerts go: the saved addresses, and the sign-in email used when there are none. */
export const getNotificationSettings = cache(async () => {
  const [user, business] = await Promise.all([requireUser(), getCurrentBusiness()]);
  if (!business) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("lead_alert_emails")
    .eq("client_id", business.id)
    .maybeSingle();
  if (error) throw new Error("Could not load your lead alert settings.");
  return { leadAlertEmails: data?.lead_alert_emails ?? [], accountEmail: user.email };
});
