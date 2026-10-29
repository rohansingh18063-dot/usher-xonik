// Lead alerts are sent through channels. Each channel decides who receives
// alerts and how to deliver one; the lead flow only calls notifyNewLead.
// To add WhatsApp later: add a channel next to email.ts that reads its
// recipients from notification_settings, and list it in index.ts.

export type LeadAlert = {
  businessName: string;
  name: string;
  /** Formatted for reading, for example +91 98450 12345. */
  mobile: string;
  /** International format for links, for example +919845012345. */
  mobileE164: string;
  preferredDate: string;
  preferredTime: string;
  concern: string | null;
  sourceUrl: string | null;
  receivedAt: string;
  dashboardUrl: string;
  /** Unique per lead, so a retried delivery is not sent twice. */
  deliveryKey: string;
};

export type AlertTargets = {
  leadAlertEmails: string[];
  /** The email address the client signs in with; used when no alert emails are set. */
  accountEmail: string | null;
};

export type Delivery = { status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string };

export type NotificationChannel = {
  channel: "email" | "whatsapp";
  recipients(targets: AlertTargets): string[];
  send(alert: LeadAlert, recipient: string): Promise<Delivery>;
};
