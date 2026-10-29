import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ChatTurn } from "./engine";
import type { IndustryPack } from "./prompt";

type Admin = SupabaseClient<Database>;

/** Earlier exchanges sent back to the model; older ones are left out. */
export const HISTORY_TURNS = 20;

/** Longest conversation allowed in one session before a new one is needed. */
export const MAX_SESSION_TURNS = 50;

/** The highest published version of the pack for an industry, or null. */
export async function loadIndustryPack(admin: Admin, industry: string): Promise<IndustryPack | null> {
  const { data, error } = await admin
    .from("industry_packs")
    .select("industry, version, knowledge, behavior_rules")
    .eq("industry", industry)
    .eq("is_published", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load the industry pack: ${error.message}`);
  return data;
}

/** The client's clinic details, or null if none were saved yet. */
export async function loadBusinessProfile(admin: Admin, clientId: string) {
  const { data, error } = await admin
    .from("business_profiles")
    .select("address, phone, whatsapp, email, opening_hours, doctors, services, fees, offers, languages, maps_url")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the business profile: ${error.message}`);
  return data;
}

/** The session's earlier turns, oldest first, plus how many there are in total. */
export async function loadSessionHistory(
  admin: Admin,
  clientId: string,
  sessionId: string,
): Promise<{ turns: ChatTurn[]; total: number }> {
  const { data, error, count } = await admin
    .from("conversations")
    .select("visitor_message, assistant_reply", { count: "exact" })
    .eq("client_id", clientId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);

  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  return { turns: data.reverse(), total: count ?? data.length };
}

export async function saveConversationTurn(
  admin: Admin,
  turn: {
    clientId: string;
    sessionId: string;
    visitorMessage: string;
    assistantReply: string;
    channel: "test" | "website";
    pageUrl?: string | null;
  },
) {
  const { error } = await admin.from("conversations").insert({
    client_id: turn.clientId,
    session_id: turn.sessionId,
    visitor_message: turn.visitorMessage,
    assistant_reply: turn.assistantReply,
    channel: turn.channel,
    page_url: turn.pageUrl ?? null,
  });
  if (error) throw new Error(`Could not save the conversation: ${error.message}`);
}
