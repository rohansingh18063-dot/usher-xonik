import "server-only";
import type { LeadAlert, NotificationChannel } from "./types";

// Lead alert emails, sent with Resend (https://resend.com). RESEND_API_KEY and
// RESEND_FROM_EMAIL are read from the environment and never leave the server.

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Website Assistant <onboarding@resend.dev>";

export const emailChannel: NotificationChannel = {
  channel: "email",

  recipients({ leadAlertEmails, accountEmail }) {
    if (leadAlertEmails.length > 0) return leadAlertEmails;
    return accountEmail ? [accountEmail] : [];
  },

  async send(alert, recipient) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { status: "skipped", error: "Email is not set up (RESEND_API_KEY is missing)." };

    try {
      const response = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${alert.deliveryKey}:${recipient}`.slice(0, 256),
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM,
          to: [recipient],
          subject: leadEmailSubject(alert),
          html: leadEmailHtml(alert),
          text: leadEmailText(alert),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        return { status: "failed", error: String(body?.message ?? `Email service answered ${response.status}`).slice(0, 500) };
      }
      return { status: "sent", providerMessageId: body?.id };
    } catch (error) {
      return { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
    }
  },
};

export function leadEmailSubject(alert: LeadAlert) {
  return `New appointment request: ${alert.name}`;
}

function details(alert: LeadAlert): [string, string, string?][] {
  return [
    ["Name", alert.name],
    ["Mobile", alert.mobile, `tel:${alert.mobileE164}`],
    ["Preferred date", alert.preferredDate],
    ["Preferred time", alert.preferredTime],
    ["Treatment or concern", alert.concern ?? "Not given"],
    ["Sent from", alert.sourceUrl ?? "Your website", alert.sourceUrl ?? undefined],
    ["Received", alert.receivedAt],
  ];
}

export function leadEmailText(alert: LeadAlert) {
  return [
    `New appointment request for ${alert.businessName}`,
    "",
    ...details(alert).map(([label, value]) => `${label}: ${value}`),
    "",
    "Please call the visitor to confirm a time. No appointment has been booked yet.",
    "",
    `View the request and the chat: ${alert.dashboardUrl}`,
  ].join("\n");
}

export function leadEmailHtml(alert: LeadAlert) {
  const rows = details(alert)
    .map(
      ([label, value, href]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;width:170px;vertical-align:top">${escape(label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:15px;font-weight:600;word-break:break-word">${
            href ? `<a href="${escape(href)}" style="color:#2952e3;text-decoration:none">${escape(value)}</a>` : escape(value)
          }</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="background:#2952e3;padding:20px 28px">
            <p style="margin:0;color:#dae6ff;font-size:13px">${escape(alert.businessName)}</p>
            <h1 style="margin:4px 0 0;color:#ffffff;font-size:22px;font-weight:700">New appointment request</h1>
          </td></tr>
          <tr><td style="padding:24px 28px 8px">
            <p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5">
              <strong>${escape(alert.name)}</strong> asked to be called to arrange an appointment.
              Please call them to confirm a time; nothing has been booked yet.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          </td></tr>
          <tr><td style="padding:20px 28px 28px">
            <a href="${escape(alert.dashboardUrl)}" style="display:inline-block;background:#2952e3;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:8px">View request and chat</a>
          </td></tr>
        </table>
        <p style="max-width:560px;margin:16px auto 0;color:#94a3b8;font-size:12px;line-height:1.5">
          You receive this because your address is set to get lead alerts in Business Info.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
