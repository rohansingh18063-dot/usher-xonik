import "server-only";
import { after } from "next/server";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/events";
import { UNAVAILABLE } from "@/lib/chat/respond";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RejectionReason } from "@/lib/supabase/database.types";
import { findClientByKey, logRejection, secondsUntilNextWindow, type PublicClient } from "./guard";
import { isOriginAllowed } from "./origin";

// Shared by the public API routes the website widget calls.

export const REJECTION_MESSAGES: Record<RejectionReason, string> = {
  invalid_key: "This assistant key is not valid.",
  assistant_paused: "This assistant is not available right now. Please contact the business directly.",
  missing_origin: "This assistant can only be used from the business's own website.",
  origin_not_allowed: "This website is not allowed to use this assistant.",
  invalid_request: `Please send a session ID and a message of 1 to ${MAX_MESSAGE_LENGTH} characters.`,
  ip_rate_limited: "You're sending messages a little too fast. Please slow down and try again in a minute.",
  key_rate_limited: "The assistant is very busy right now. Please try again in a minute.",
  monthly_limit_reached:
    "This assistant has reached its message limit for this month. Please contact the business directly.",
};

const STATUS: Record<RejectionReason, number> = {
  invalid_key: 401,
  assistant_paused: 503,
  missing_origin: 403,
  origin_not_allowed: 403,
  invalid_request: 400,
  ip_rate_limited: 429,
  key_rate_limited: 429,
  monthly_limit_reached: 429,
};

export type Checked = {
  admin: ReturnType<typeof createAdminClient>;
  client: PublicClient | null;
  origin: string | null;
  cors: Record<string, string>;
};

/** Looks up the key in the URL and decides whether this Origin gets CORS headers. */
export async function checkAccess(request: Request): Promise<Checked> {
  const admin = createAdminClient();
  const origin = request.headers.get("origin");
  const key = new URL(request.url).searchParams.get("key");
  const client = await findClientByKey(admin, key);
  const allowed = client !== null && isOriginAllowed(origin, client.domains, client.test_mode);
  return { admin, client, origin, cors: allowed && origin ? corsHeaders(origin) : {} };
}

export function hasCors(checked: Checked) {
  return "Access-Control-Allow-Origin" in checked.cors;
}

/** Checks for chat and lead requests, in order: key, assistant active, Origin allowed. */
export function accessProblem(checked: Checked): RejectionReason | null {
  const { client, origin } = checked;
  if (!client) return "invalid_key";
  if (client.assistant_paused) return "assistant_paused";
  if (!origin) return "missing_origin";
  if (!hasCors(checked)) return "origin_not_allowed";
  return null;
}

/**
 * Answers a CORS preflight. It passes exactly when the request would get
 * CORS headers; a paused assistant still passes on an allowed website, so
 * the widget can read the friendly "not available" reply to the request.
 */
export async function preflight(request: Request) {
  let checked: Checked;
  try {
    checked = await checkAccess(request);
  } catch (error) {
    console.error("Preflight failed:", error);
    return new Response(null, { status: 503, headers: { Vary: "Origin" } });
  }
  if (!hasCors(checked)) return reject(checked, accessProblem(checked) ?? "origin_not_allowed");

  return new Response(null, {
    status: 204,
    headers: {
      ...checked.cors,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
}

/** Refuses the request with a friendly message and logs why, for the client to see. */
export function reject(checked: Checked, reason: RejectionReason) {
  const { admin, client, origin, cors } = checked;
  // Written after the response is sent, so rejections stay fast.
  after(() => logRejection(admin, { clientId: client?.id ?? null, reason, origin }));

  const headers: Record<string, string> = { ...cors };
  if (STATUS[reason] === 429 && reason !== "monthly_limit_reached") {
    headers["Retry-After"] = String(secondsUntilNextWindow());
  }
  return errorResponse(reason, REJECTION_MESSAGES[reason], STATUS[reason], headers);
}

export function unavailable(cors: HeadersInit) {
  return errorResponse("unavailable", UNAVAILABLE, 503, cors);
}

export function errorResponse(code: string, message: string, status: number, headers: HeadersInit) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...headers, "Cache-Control": "no-store", Vary: "Origin" } },
  );
}

function corsHeaders(origin: string): Record<string, string> {
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}
