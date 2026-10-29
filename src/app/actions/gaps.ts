"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

/** Marks a knowledge gap as resolved, or opens it again. */
export async function setGapStatus(id: string, status: "open" | "resolved"): Promise<{ error?: string; ok?: boolean }> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please sign in again." };
  if (!z.uuid().safeParse(id).success || !["open", "resolved"].includes(status)) {
    return { error: "We couldn't update this gap. Please try again." };
  }

  // Row Level Security limits the update to the signed-in client's gaps.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_gaps")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("client_id", business.id)
    .select("id");
  if (error || data.length === 0) return { error: "We couldn't update this gap. Please try again." };

  // Refreshes the page and the open-gap count in the navigation.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
