"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness } from "@/lib/data";
import { MAX_ALLOWED_DOMAINS, parseAllowedDomain } from "@/lib/public-api/domains";
import { LOCALHOST } from "@/lib/public-api/origin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string; ok?: boolean };

const PAGE = "/dashboard/api-key";
const UNIQUE_VIOLATION = "23505";

// Every action runs with the signed-in client's own permissions, so Row Level
// Security limits it to that client's key, settings and domains.

export async function regenerateApiKey(): Promise<ActionResult> {
  if (!(await getCurrentBusiness())) return { error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_public_key");
  if (error) return { error: "We couldn't create a new key. Please try again." };
  revalidatePath(PAGE);
  return { ok: true };
}

export async function setAssistantPaused(paused: boolean): Promise<ActionResult> {
  return updateSettings({ assistant_paused: paused });
}

export async function setTestMode(enabled: boolean): Promise<ActionResult> {
  return updateSettings({ test_mode: enabled });
}

async function updateSettings(change: { assistant_paused?: boolean; test_mode?: boolean }): Promise<ActionResult> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(change).eq("id", business.id);
  if (error) return { error: "We couldn't save this setting. Please try again." };
  revalidatePath(PAGE);
  return { ok: true };
}

export async function addAllowedDomain(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please sign in again." };

  const parsed = parseAllowedDomain(String(formData.get("domain") ?? ""), formData.get("include_subdomains") === "on");
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const [{ data: settings }, { count }] = await Promise.all([
    supabase.from("clients").select("test_mode").eq("id", business.id).single(),
    supabase.from("allowed_domains").select("domain", { count: "exact", head: true }).eq("client_id", business.id),
  ]);

  if (parsed.domain === LOCALHOST && !settings?.test_mode) {
    return { error: "Turn on Test mode to allow localhost." };
  }
  if ((count ?? 0) >= MAX_ALLOWED_DOMAINS) {
    return { error: `You can add up to ${MAX_ALLOWED_DOMAINS} domains.` };
  }

  const { error } = await supabase.from("allowed_domains").insert({
    client_id: business.id,
    domain: parsed.domain,
    include_subdomains: parsed.includeSubdomains,
  });
  if (error?.code === UNIQUE_VIOLATION) {
    return { error: `${parsed.domain} is already in your list. Remove it first to change its settings.` };
  }
  if (error) return { error: "We couldn't add this domain. Please try again." };

  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeAllowedDomain(domain: string): Promise<ActionResult> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.from("allowed_domains").delete().eq("client_id", business.id).eq("domain", domain);
  if (error) return { error: "We couldn't remove this domain. Please try again." };
  revalidatePath(PAGE);
  return { ok: true };
}
