import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sanitizeVisitorText } from "./prompt";

export type ChatTurn = { visitor_message: string; assistant_reply: string };

export type ReplyResult = { text: string; refused: boolean };

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT = "low";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

// Upper bound on what one reply may cost. Replies are meant to be short; the
// limit also covers the model's internal reasoning.
const MAX_TOKENS = 4000;

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export const REFUSAL_REPLY =
  "I'm sorry, I can't help with that here. Please get in touch with the team directly and they will be happy to help.";

let client: Anthropic | undefined;

function anthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to your environment settings.");
  client ??= new Anthropic({ apiKey });
  return client;
}

export function chatSettings() {
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const configured = process.env.ANTHROPIC_EFFORT?.trim() as (typeof EFFORTS)[number] | undefined;
  const effort = configured && EFFORTS.includes(configured) ? configured : DEFAULT_EFFORT;
  return { model, effort };
}

/**
 * Streams the assistant's reply to the visitor's latest turn, given the system
 * prompt and the earlier turns of the same session. Calls `onText` for each
 * piece of text as it arrives and `onReset` if text sent so far must be
 * discarded (when a fallback model takes over mid-reply).
 */
export async function streamReply({
  system,
  history,
  visitorTurn,
  signal,
  onText,
  onReset,
}: {
  system: Anthropic.Beta.BetaTextBlockParam[];
  history: ChatTurn[];
  visitorTurn: Anthropic.Beta.BetaTextBlockParam[];
  signal?: AbortSignal;
  onText: (text: string) => void;
  onReset: () => void;
}): Promise<ReplyResult> {
  const { model, effort } = chatSettings();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.flatMap((turn): Anthropic.Beta.BetaMessageParam[] => [
      { role: "user", content: sanitizeVisitorText(turn.visitor_message) },
      { role: "assistant", content: turn.assistant_reply },
    ]),
    { role: "user", content: visitorTurn },
  ];

  // The system prompt carries the cache breakpoints. The conversation itself
  // is not cached: the latest turn includes document excerpts that change
  // with every message, so a cached copy would never be reused.
  const stream = anthropic().beta.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      output_config: { effort },
      ...(FALLBACK_MODELS.has(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    },
    { signal },
  );

  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "fallback") {
      text = "";
      onReset();
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onText(event.delta.text);
    }
  }

  const final = await stream.finalMessage();
  if (process.env.NODE_ENV === "development") {
    const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens } = final.usage;
    console.log(
      `Chat reply: ${final.model}, stop ${final.stop_reason}, input ${input_tokens}, ` +
        `cache read ${cache_read_input_tokens ?? 0}, cache write ${cache_creation_input_tokens ?? 0}, output ${output_tokens}`,
    );
  }
  if (final.stop_reason === "refusal") {
    return { text: REFUSAL_REPLY, refused: true };
  }
  return { text: text.trim(), refused: false };
}
