// Widget settings: limits and validation shared by the dashboard and the
// server. The database enforces the same limits (see the widget migration).

import { z } from "zod";

export const MAX_ASSISTANT_NAME = 60;
export const MAX_WELCOME_MESSAGE = 500;
export const MAX_QUICK_REPLIES = 6;
export const MAX_QUICK_REPLY = 40;
export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_BUCKET = "widget-logos";

export type WidgetPosition = "right" | "left";

export const QUICK_REPLY_ACTIONS = ["message", "appointment_form"] as const;
export type QuickReplyAction = (typeof QUICK_REPLY_ACTIONS)[number];
/** A quick reply either sends its text as a message or opens the appointment form. */
export type QuickReply = { text: string; action: QuickReplyAction };

/** What the widget needs to render; the same shape the public widget API returns. */
export type WidgetConfig = {
  /** Used in the appointment form's confirmation message. */
  businessName: string;
  assistantName: string;
  logoUrl: string | null;
  brandColor: string;
  position: WidgetPosition;
  welcomeMessage: string;
  quickReplies: QuickReply[];
  /** False while the client has paused their assistant. */
  available: boolean;
};

export const widgetSettingsSchema = z.object({
  assistantName: z
    .string()
    .trim()
    .min(1, "Enter a name for your assistant.")
    .max(MAX_ASSISTANT_NAME, `Use ${MAX_ASSISTANT_NAME} characters or fewer.`),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #2952e3.")
    .transform((value) => value.toLowerCase()),
  position: z.enum(["right", "left"], { error: "Choose where the chat button appears." }),
  welcomeMessage: z
    .string()
    .trim()
    .min(1, "Enter a welcome message.")
    .max(MAX_WELCOME_MESSAGE, `Use ${MAX_WELCOME_MESSAGE} characters or fewer.`),
  quickReplies: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1, "Enter text for this button, or remove it.")
          .max(MAX_QUICK_REPLY, `Use ${MAX_QUICK_REPLY} characters or fewer.`),
        action: z.enum(QUICK_REPLY_ACTIONS),
      }),
    )
    .max(MAX_QUICK_REPLIES, `You can add up to ${MAX_QUICK_REPLIES} quick replies.`)
    .refine(
      (replies) => new Set(replies.map((reply) => reply.text.toLowerCase())).size === replies.length,
      "Each quick reply must be different.",
    ),
});

export type WidgetSettingsInput = z.input<typeof widgetSettingsSchema>;

export type WidgetFormState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean };

/** Logo file types the widget accepts, recognized by their first bytes rather than the file name. */
export function detectLogoType(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export const LOGO_CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
