"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/data";
import { leadUpdateSchema, type LeadStatus } from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

export type LeadUpdateResult = { error?: string; saved?: boolean };

// Every action runs with the signed-in client's own permissions, so Row Level
// Security limits it to their own leads.

const leadId = z.uuid();

export async function updateLead(id: string, input: { status: LeadStatus; notes: string }): Promise<LeadUpdateResult> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please sign in again." };
  const parsed = leadUpdateSchema.safeParse(input);
  if (!leadId.safeParse(id).success || !parsed.success) {
    return { error: parsed.error?.issues[0]?.message ?? "We couldn't save this lead. Please try again." };
  }

  const supabase = await createClient();
  const notes = parsed.data.notes.trim();
  const { data, error } = await supabase
    .from("leads")
    .update({ status: parsed.data.status, notes: notes || null, seen_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", business.id)
    .select("id");
  if (error || data.length === 0) return { error: "We couldn't save this lead. Please try again." };
  return { saved: true };
}

/** Marks a lead as seen the first time the client opens it. */
export async function markLeadSeen(id: string) {
  const business = await getCurrentBusiness();
  if (!business || !leadId.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase
    .from("leads")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", business.id)
    .is("seen_at", null);
  // Updates the count of new leads in the navigation.
  revalidatePath("/dashboard", "layout");
}
