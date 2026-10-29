import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { listConversations, MAX_CONVERSATION_EXPORT, parseConversationFilters } from "@/lib/dashboard-data";
import { leadsTimeZone, todayIn } from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in client's website conversations as a CSV file, one row per
 * message, with the same search and filters as the Conversations page
 * (?q=&from=&to=&lead=yes|no).
 */
export async function GET(request: Request) {
  const business = (await getCurrentUser()) ? await getCurrentBusiness() : null;
  if (!business) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const filters = parseConversationFilters(Object.fromEntries(new URL(request.url).searchParams));
  let conversations;
  try {
    conversations = (await listConversations(filters, { limit: MAX_CONVERSATION_EXPORT, offset: 0 })).rows;
  } catch {
    return Response.json({ error: "Could not export your conversations." }, { status: 500 });
  }

  // Row Level Security limits this to the client's own messages.
  const supabase = await createClient();
  const sessions = conversations.map((row) => row.session_id);
  const messages = [];
  for (let start = 0; start < sessions.length; start += 200) {
    const { data, error } = await supabase
      .from("conversations")
      .select("session_id, visitor_message, assistant_reply, page_url, created_at")
      .eq("client_id", business.id)
      .eq("channel", "website")
      .in("session_id", sessions.slice(start, start + 200))
      .order("created_at");
    if (error) return Response.json({ error: "Could not export your conversations." }, { status: 500 });
    messages.push(...data);
  }

  const order = new Map(sessions.map((session, index) => [session, index]));
  messages.sort((a, b) => order.get(a.session_id)! - order.get(b.session_id)! || a.created_at.localeCompare(b.created_at));
  const hasLead = new Map(conversations.map((row) => [row.session_id, Boolean(row.lead_id)]));

  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: leadsTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const rows = [
    ["Conversation", "Time", "Visitor message", "Assistant reply", "Page", "Lead"],
    ...messages.map((message) => [
      message.session_id,
      time.format(new Date(message.created_at)).replace(",", ""),
      text(message.visitor_message),
      text(message.assistant_reply),
      text(message.page_url),
      hasLead.get(message.session_id) ? "Yes" : "No",
    ]),
  ];
  const csv = "﻿" + rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversations-${todayIn(leadsTimeZone())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Free text; a leading formula character is neutralized so spreadsheets show it as text. */
function text(value: string | null) {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
