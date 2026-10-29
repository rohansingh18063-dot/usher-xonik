// Events streamed from /api/chat to the browser, one JSON object per line.

export type ChatStreamEvent =
  | { type: "text"; text: string }
  /** Discard the text received so far for this reply. */
  | { type: "reset" }
  /** The visitor asked for an appointment or a callback: offer the request form. */
  | { type: "action"; action: "appointment_form" }
  | { type: "done" }
  | { type: "error"; message: string };

export const MAX_MESSAGE_LENGTH = 1000;
