"use server";

import { z } from "zod";
import { getCurrentBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type AlertEmailsState = { error?: string; saved?: boolean; emails?: string[] };

const MAX_ALERT_EMAILS = 5;
const email = z.email();

/** Saves where lead alerts go: up to 5 addresses, separated by commas, spaces or new lines. */
export async function saveLeadAlertEmails(_previous: AlertEmailsState, formData: FormData): Promise<AlertEmailsState> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please finish setting up your business first." };

  const emails = [
    ...new Set(
      String(formData.get("emails") ?? "")
        .split(/[\s,;]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const invalid = emails.find((value) => value.length > 254 || !email.safeParse(value).success);
  if (invalid) return { error: `"${invalid}" is not a valid email address.` };
  if (emails.length > MAX_ALERT_EMAILS) return { error: `You can add up to ${MAX_ALERT_EMAILS} email addresses.` };

  const supabase = await createClient();
  // Row Level Security limits the update to the signed-in client's settings.
  const { data, error } = await supabase
    .from("notification_settings")
    .update({ lead_alert_emails: emails })
    .eq("client_id", business.id)
    .select("client_id");
  if (error || data.length === 0) return { error: "We couldn't save these addresses. Please try again." };
  return { saved: true, emails };
}
