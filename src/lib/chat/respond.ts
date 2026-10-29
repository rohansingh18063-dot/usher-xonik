import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Industry } from "@/lib/supabase/database.types";
import {
  loadBusinessProfile,
  loadIndustryPack,
  loadSessionHistory,
  MAX_SESSION_TURNS,
  saveConversationTurn,
} from "./data";
import { streamReply } from "./engine";
import type { ChatStreamEvent } from "./events";
import { recordKnowledgeGaps } from "./gaps";
import { HiddenTagFilter, readHiddenTags, removeHiddenTags, type ReplySignals } from "./hidden-tags";
import { buildSystemPrompt, buildVisitorTurn } from "./prompt";
import { searchClientDocuments } from "./retrieval";

export type ChatBusiness = { id: string; business_name: string; industry: Industry; website_domain: string };

/** Where a message came from: the dashboard's Test Assistant or a website. */
export type ChatChannel = "test" | "website";

export type ChatStart =
  | { ok: true; body: ReadableStream<Uint8Array> }
  | { ok: false; status: number; code: "unavailable" | "session_limit"; message: string };

export const UNAVAILABLE = "The assistant is unavailable right now. Please try again in a moment.";

/**
 * Prepares and streams the assistant's reply for an already-authorized
 * business: loads the industry pack, Business Info and session history,
 * searches the business's documents, streams the reply as newline-delimited
 * JSON events, and saves the exchange. Shared by the dashboard and the public
 * chat API.
 */
export async function startChat({
  business,
  sessionId,
  message,
  channel,
  pageUrl = null,
  signal,
}: {
  business: ChatBusiness;
  sessionId: string;
  message: string;
  channel: ChatChannel;
  /** The page the visitor was on, for website messages. */
  pageUrl?: string | null;
  signal: AbortSignal;
}): Promise<ChatStart> {
  const admin = createAdminClient();
  let pack, history, profile;
  try {
    [pack, history, profile] = await Promise.all([
      loadIndustryPack(admin, business.industry),
      loadSessionHistory(admin, business.id, sessionId),
      loadBusinessProfile(admin, business.id),
    ]);
  } catch (error) {
    console.error("Chat setup failed:", error);
    return { ok: false, status: 503, code: "unavailable", message: UNAVAILABLE };
  }

  if (history.total >= MAX_SESSION_TURNS) {
    return {
      ok: false,
      status: 429,
      code: "session_limit",
      message: "This conversation has reached its limit. Please start a new conversation.",
    };
  }

  // Include the previous visitor message so short follow-ups ("and for
  // children?") still find the right passages. Only this business's
  // documents are searched.
  const previous = history.turns.at(-1)?.visitor_message;
  const search = await searchClientDocuments(admin, business.id, previous ? `${previous}\n${message}` : message);

  const system = buildSystemPrompt({ pack, business, profile });
  const visitorTurn = buildVisitorTurn(message, search);
  const encoder = new TextEncoder();

  // Questions the assistant could not answer are recorded once the reply has
  // been sent, so the visitor never waits for it. Only website visitors'
  // questions count; the clinic's own tests do not.
  let replied: (signals: ReplySignals | null) => void = () => {};
  const signalsReady = new Promise<ReplySignals | null>((resolve) => (replied = resolve));
  if (channel === "website") {
    after(async () => {
      const signals = await signalsReady;
      if (signals?.gaps.length) await recordKnowledgeGaps(admin, business.id, sessionId, message, signals.gaps);
    });
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const tags = new HiddenTagFilter();
      let reply = "";
      let signals: ReplySignals | null = null;

      try {
        const result = await streamReply({
          system,
          history: history.turns,
          visitorTurn,
          signal,
          onText: (text) => {
            const visible = tags.push(text);
            reply += visible;
            if (visible) send({ type: "text", text: visible });
          },
          onReset: () => {
            reply = "";
            tags.reset();
            send({ type: "reset" });
          },
        });

        const rest = tags.finish();
        if (rest) send({ type: "text", text: rest });

        if (result.refused) {
          send({ type: "reset" });
          send({ type: "text", text: result.text });
          reply = result.text;
        } else {
          reply = removeHiddenTags(result.text);
          signals = readHiddenTags(tags.tags);
          if (signals.appointmentForm) send({ type: "action", action: "appointment_form" });
        }
      } catch (error) {
        if (!signal.aborted) {
          logModelError(error);
          send({ type: "error", message: UNAVAILABLE });
        }
      }

      // Save whatever the visitor actually received, including replies cut
      // short by a closed connection.
      if (reply.trim()) {
        try {
          await saveConversationTurn(admin, {
            clientId: business.id,
            sessionId,
            visitorMessage: message,
            assistantReply: reply.trim(),
            channel,
            pageUrl,
          });
        } catch (error) {
          console.error(error);
        }
      }

      replied(signals);
      if (!signal.aborted) {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return { ok: true, body };
}

export const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
};

function logModelError(error: unknown) {
  if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${error.status ?? ""}: ${error.message}`);
  } else {
    console.error("Chat reply failed:", error);
  }
}
