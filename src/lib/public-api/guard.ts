import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatBusiness } from "@/lib/chat/respond";
import type { Database, RejectionReason } from "@/lib/supabase/database.types";
import type { AllowedDomain } from "./origin";

type Admin = SupabaseClient<Database>;

export const PUBLIC_KEY_PATTERN = /^pk_live_[A-Za-z0-9_-]{32}$/;

/** Messages per minute from one visitor IP to one client's assistant. */
export const IP_LIMIT_PER_MINUTE = Number(process.env.PUBLIC_CHAT_IP_LIMIT_PER_MINUTE ?? 20);
export const RATE_WINDOW_SECONDS = 60;

export type PublicClient = ChatBusiness & {
  assistant_paused: boolean;
  test_mode: boolean;
  monthly_message_limit: number;
  requests_per_minute: number;
  domains: AllowedDomain[];
};

/** The client a public key belongs to, with its settings, or null. */
export async function findClientByKey(admin: Admin, key: string | null): Promise<PublicClient | null> {
  if (!key || !PUBLIC_KEY_PATTERN.test(key)) return null;

  const { data: apiKey, error } = await admin
    .from("api_keys")
    .select("client_id, requests_per_minute")
    .eq("public_key", key)
    .maybeSingle();
  if (error) throw new Error(`Key lookup failed: ${error.message}`);
  if (!apiKey) return null;

  const [client, domains] = await Promise.all([
    admin
      .from("clients")
      .select("id, business_name, industry, website_domain, assistant_paused, test_mode, monthly_message_limit")
      .eq("id", apiKey.client_id)
      .single(),
    admin.from("allowed_domains").select("domain, include_subdomains").eq("client_id", apiKey.client_id),
  ]);
  if (client.error) throw new Error(`Client lookup failed: ${client.error.message}`);
  if (domains.error) throw new Error(`Domain lookup failed: ${domains.error.message}`);

  return { ...client.data, requests_per_minute: apiKey.requests_per_minute, domains: domains.data };
}

/** Counts one request against a limit; returns false when it is over. */
export async function withinRateLimit(admin: Admin, bucket: string, limit: number) {
  const { data, error } = await admin.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data;
}

/** Seconds until the current rate-limit window ends. */
export function secondsUntilNextWindow() {
  return RATE_WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % RATE_WINDOW_SECONDS);
}

/** Website messages the client's assistant has answered this calendar month (UTC). */
export async function websiteMessagesThisMonth(admin: Admin, clientId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("channel", "website")
    .gte("created_at", monthStart);
  if (error) throw new Error(`Usage lookup failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The visitor's IP address, as reported by the hosting platform's proxy.
 * Only a one-way hash of it is ever stored.
 */
export function visitorIpHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function logRejection(
  admin: Admin,
  rejection: { clientId: string | null; reason: RejectionReason; origin: string | null },
) {
  const { error } = await admin.from("public_api_rejections").insert({
    client_id: rejection.clientId,
    reason: rejection.reason,
    origin: rejection.origin?.slice(0, 255) ?? null,
  });
  if (error) console.error("Logging a rejected request failed:", error);
}
