"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_MESSAGE_LENGTH, type ChatStreamEvent } from "@/lib/chat/events";
import { Button, Card } from "@/components/ui";

type Message = { id: string; role: "visitor" | "assistant"; text: string; failed?: boolean; offer?: boolean };

export function ChatPanel({
  clientId,
  businessName,
  suggestions,
}: {
  clientId: string;
  businessName: string;
  suggestions: string[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  function updateReply(id: string, update: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.id === id ? update(message) : message)));
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    sessionId.current ??= crypto.randomUUID();
    const replyId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "visitor", text: message },
      { id: replyId, role: "assistant", text: "" },
    ]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, sessionId: sessionId.current, message }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The assistant is unavailable right now. Please try again in a moment.");
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === "text") updateReply(replyId, (m) => ({ ...m, text: m.text + event.text }));
          else if (event.type === "reset") updateReply(replyId, (m) => ({ ...m, text: "" }));
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "action") updateReply(replyId, (m) => ({ ...m, offer: true }));
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const reason = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      updateReply(replyId, (m) => ({ ...m, text: m.text ? `${m.text}\n\n${reason}` : reason, failed: true }));
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
        textarea.current?.focus();
      }
    }
  }

  function startOver() {
    abort.current?.abort();
    abort.current = null;
    sessionId.current = null;
    setMessages([]);
    setBusy(false);
    setInput("");
    textarea.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <Card className="flex h-[min(680px,calc(100dvh-18rem))] min-h-[460px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {businessName.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{businessName}</p>
            <p className="text-xs text-slate-500">Website assistant</p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 px-3 py-2 whitespace-nowrap"
          onClick={startOver}
          disabled={!messages.length}
        >
          New conversation
        </Button>
      </div>

      <div
        ref={scroller}
        className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-5 py-6"
        aria-live="polite"
        aria-busy={busy}
        data-testid="chat-messages"
      >
        {messages.length === 0 ? (
          <div className="mx-auto max-w-md pt-6 text-center">
            <p className="text-sm font-medium text-slate-900">Ask anything a visitor might ask</p>
            <p className="mt-1 text-sm text-slate-500">Try one of these to get started:</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="chat-message" className="sr-only">
            Message
          </label>
          <textarea
            ref={textarea}
            id="chat-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Type a message…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
          />
          <Button type="submit" pending={busy} disabled={!input.trim()} className="h-11">
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "visitor") {
    return (
      <div className="flex justify-end">
        <p
          className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white"
          data-testid="visitor-message"
        >
          {message.text}
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm ${
          message.failed ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-800"
        }`}
        data-testid="assistant-message"
      >
        {message.text || <TypingDots />}
        {message.offer && (
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500" data-testid="form-offered">
            On your website, visitors see a button here to request an appointment.
          </p>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1 py-1.5" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
