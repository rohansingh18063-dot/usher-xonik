import "server-only";
import { formatLeadDate, formatMobile, leadsTimeZone, PREFERRED_TIME_LABELS } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailChannel } from "./email";
import type { AlertTargets, LeadAlert, NotificationChannel } from "./types";

/** Every way a clinic can be alerted. A WhatsApp channel goes here later. */
const CHANNELS: NotificationChannel[] = [emailChannel];

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Alerts the clinic about a new lead on every channel and records each
 * delivery in lead_notifications, where the dashboard shows it. A failure
 * on one channel or recipient never stops the others.
 */
export async function notifyNewLead(admin: Admin, leadId: string) {
  try {
    const { alert, targets, clientId } = await loadAlert(admin, leadId);

    for (const channel of CHANNELS) {
      const recipients = channel.recipients(targets);
      if (recipients.length === 0) {
        await record(admin, { leadId, clientId, channel: channel.channel, recipient: "(none)" }, {
          status: "skipped",
          error: "No recipients are set for lead alerts.",
        });
        continue;
      }
      await Promise.all(
        recipients.map(async (recipient) => {
          const delivery = await channel.send(alert, recipient);
          if (delivery.status !== "sent") console.error(`Lead alert by ${channel.channel} ${delivery.status}:`, delivery.error);
          await record(admin, { leadId, clientId, channel: channel.channel, recipient }, delivery);
        }),
      );
    }
  } catch (error) {
    console.error("Sending lead alerts failed:", error);
  }
}

async function loadAlert(admin: Admin, leadId: string) {
  const { data: lead, error } = await admin.from("leads").select("*").eq("id", leadId).single();
  if (error) throw new Error(`Lead lookup failed: ${error.message}`);

  const [client, settings] = await Promise.all([
    admin.from("clients").select("business_name, user_id").eq("id", lead.client_id).single(),
    admin.from("notification_settings").select("lead_alert_emails").eq("client_id", lead.client_id).maybeSingle(),
  ]);
  if (client.error) throw new Error(`Client lookup failed: ${client.error.message}`);

  const leadAlertEmails = settings.data?.lead_alert_emails ?? [];
  let accountEmail: string | null = null;
  if (leadAlertEmails.length === 0) {
    const { data } = await admin.auth.admin.getUserById(client.data.user_id);
    accountEmail = data.user?.email ?? null;
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const alert: LeadAlert = {
    businessName: client.data.business_name,
    name: lead.name,
    mobile: formatMobile(lead.mobile),
    mobileE164: lead.mobile,
    preferredDate: formatLeadDate(lead.preferred_date),
    preferredTime: PREFERRED_TIME_LABELS[lead.preferred_time],
    concern: lead.concern,
    sourceUrl: lead.source_url,
    receivedAt: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: leadsTimeZone(),
    }).format(new Date(lead.created_at)),
    dashboardUrl: `${site}/dashboard/leads/${lead.id}`,
    deliveryKey: `lead-${lead.id}`,
  };
  const targets: AlertTargets = { leadAlertEmails, accountEmail };
  return { alert, targets, clientId: lead.client_id };
}

async function record(
  admin: Admin,
  target: { leadId: string; clientId: string; channel: NotificationChannel["channel"]; recipient: string },
  delivery: { status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string },
) {
  const { error } = await admin.from("lead_notifications").insert({
    lead_id: target.leadId,
    client_id: target.clientId,
    channel: target.channel,
    recipient: target.recipient,
    status: delivery.status,
    provider_message_id: delivery.providerMessageId ?? null,
    error: delivery.error ?? null,
  });
  if (error) console.error("Recording a lead alert failed:", error);
}
