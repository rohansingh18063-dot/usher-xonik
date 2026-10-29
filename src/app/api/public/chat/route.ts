import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/events";
import { startChat, STREAM_HEADERS } from "@/lib/chat/respond";
import {
  IP_LIMIT_PER_MINUTE,
  visitorIpHash,
  websiteMessagesThisMonth,
  withinRateLimit,
} from "@/lib/public-api/guard";
import {
  accessProblem,
  checkAccess,
  errorResponse,
  preflight,
  reject,
  unavailable,
  type Checked,
} from "@/lib/public-api/http";

export const maxDuration = 60;

/**
 * Public chat API, called from a client's website.
 *
 *   POST /api/public/chat?key=pk_live_...
 *   Content-Type: application/json
 *   { "sessionId": "<uuid>", "message": "...", "pageUrl": "https://..." }
 *
 * The key is in the URL so that the browser's CORS preflight, which carries no
 * body, can be checked against the same client's allowed domains.
 *
 * Checks, in order: the key exists, the assistant is active, the Origin is
 * one of the client's allowed domains, the request is valid, the visitor and
 * the key are within their rate limits, and the client is within its monthly
 * message limit. The reply streams as newline-delimited JSON events, the same
 * format the dashboard uses.
 *
 * Responses only carry CORS headers when the Origin is allowed for the key,
 * so other websites' scripts cannot read anything.
 */

const bodySchema = z.object({
  sessionId: z.uuid(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  // The page the visitor is on; kept only when it is a web address.
  pageUrl: z
    .string()
    .max(2000)
    .optional()
    .catch(undefined)
    .transform((value) => (value && /^https?:\/\//.test(value) ? value : null)),
});

export const OPTIONS = preflight;

export async function POST(request: Request) {
  let checked: Checked;
  try {
    checked = await checkAccess(request);
  } catch (error) {
    console.error("Public chat lookup failed:", error);
    return unavailable({});
  }

  const problem = accessProblem(checked);
  if (problem) return reject(checked, problem);
  const client = checked.client!;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reject(checked, "invalid_request");

  try {
    const ip = visitorIpHash(request);
    if (!(await withinRateLimit(checked.admin, `ip:${client.id}:${ip}`, IP_LIMIT_PER_MINUTE))) {
      return reject(checked, "ip_rate_limited");
    }
    if (!(await withinRateLimit(checked.admin, `key:${client.id}`, client.requests_per_minute))) {
      return reject(checked, "key_rate_limited");
    }
    if ((await websiteMessagesThisMonth(checked.admin, client.id)) >= client.monthly_message_limit) {
      return reject(checked, "monthly_limit_reached");
    }
  } catch (error) {
    console.error("Public chat limits check failed:", error);
    return unavailable(checked.cors);
  }

  const chat = await startChat({
    business: client,
    sessionId: parsed.data.sessionId,
    message: parsed.data.message,
    channel: "website",
    pageUrl: parsed.data.pageUrl,
    signal: request.signal,
  });
  if (!chat.ok) return errorResponse(chat.code, chat.message, chat.status, checked.cors);

  return new Response(chat.body, { headers: { ...STREAM_HEADERS, ...checked.cors } });
}
