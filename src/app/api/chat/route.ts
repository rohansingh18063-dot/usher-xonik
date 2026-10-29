import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/events";
import { startChat, STREAM_HEADERS } from "@/lib/chat/respond";
import { getCurrentUser } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  clientId: z.uuid(),
  sessionId: z.uuid(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

/**
 * Chat with a client's assistant from the dashboard (Test Assistant). Takes a
 * client ID, a session ID and the message; streams the reply as
 * newline-delimited JSON events. Only the signed-in owner of the client can
 * use it. Websites use /api/public/chat instead.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Please sign in again.", 401);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(`Please send a message between 1 and ${MAX_MESSAGE_LENGTH} characters.`, 400);
  }
  const { clientId, sessionId, message } = parsed.data;

  // Row Level Security only returns the business if it belongs to this user.
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("clients")
    .select("id, business_name, industry, website_domain")
    .eq("id", clientId)
    .maybeSingle();
  if (!business) return jsonError("Assistant not found.", 404);

  const chat = await startChat({ business, sessionId, message, channel: "test", signal: request.signal });
  if (!chat.ok) return jsonError(chat.message, chat.status);

  return new Response(chat.body, { headers: STREAM_HEADERS });
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
