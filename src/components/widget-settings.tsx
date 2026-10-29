"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type ReactNode } from "react";
import { saveWidgetSettings } from "@/app/actions/widget";
import { Alert, Button, Card } from "@/components/ui";
import {
  MAX_ASSISTANT_NAME,
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY,
  MAX_WELCOME_MESSAGE,
  type QuickReply,
  type WidgetConfig,
  type WidgetPosition,
} from "@/lib/widget";

export type WidgetValues = {
  assistantName: string;
  brandColor: string;
  position: WidgetPosition;
  welcomeMessage: string;
  quickReplies: QuickReply[];
};

type Reply = QuickReply & { id: string };
type Values = Omit<WidgetValues, "quickReplies"> & { quickReplies: Reply[] };

const withIds = (replies: QuickReply[]): Reply[] => replies.map((reply) => ({ ...reply, id: crypto.randomUUID() }));
const plain = (values: Values): WidgetValues => ({
  ...values,
  quickReplies: values.quickReplies.map(({ text, action }) => ({ text, action })),
});

// The preview runs the real widget script in preview mode, so it always
// matches what visitors see.
const PREVIEW_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;min-height:100vh;background:#e9eef5;font:14px system-ui,sans-serif;color:#64748b">
<p style="margin:0;padding:20px">Your website</p>
<script src="/widget.js" data-preview></script></body></html>`;

export function WidgetSettings({
  businessName,
  initial,
  initialLogoUrl,
}: {
  businessName: string;
  initial: WidgetValues;
  initialLogoUrl: string | null;
}) {
  const [values, setValues] = useState<Values>(() => ({ ...initial, quickReplies: withIds(initial.quickReplies) }));
  const [saved, setSaved] = useState<WidgetValues>(initial);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);

  const dirty = JSON.stringify(plain(values)) !== JSON.stringify(saved);

  // Sends the current settings to the preview whenever they change, and when
  // the preview (re)loads and asks for them.
  const config: WidgetConfig = {
    ...plain(values),
    businessName,
    quickReplies: plain(values)
      .quickReplies.map((reply) => ({ ...reply, text: reply.text.trim() }))
      .filter((reply) => reply.text),
    brandColor: /^#[0-9a-f]{6}$/i.test(values.brandColor) ? values.brandColor : saved.brandColor,
    logoUrl,
    available: true,
  };
  const configJson = JSON.stringify(config);

  useEffect(() => {
    const post = () =>
      frame.current?.contentWindow?.postMessage(
        { type: "chat-widget-preview", config: JSON.parse(configJson) },
        window.location.origin,
      );
    post();
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === "chat-widget-ready") post();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [configJson]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus(null);
  }

  function updateReply(index: number, change: Partial<QuickReply>) {
    update(
      "quickReplies",
      values.quickReplies.map((reply, i) => (i === index ? { ...reply, ...change } : reply)),
    );
  }

  function moveReply(index: number, offset: number) {
    const replies = [...values.quickReplies];
    const [moved] = replies.splice(index, 1);
    replies.splice(index + offset, 0, moved);
    update("quickReplies", replies);
  }

  function save() {
    startSaving(async () => {
      const input = plain(values);
      const result = await saveWidgetSettings(input);
      setFieldErrors(result.fieldErrors ?? {});
      if (result.saved) {
        const trimmed = {
          ...input,
          assistantName: input.assistantName.trim(),
          welcomeMessage: input.welcomeMessage.trim(),
          brandColor: input.brandColor.toLowerCase(),
          quickReplies: input.quickReplies.map((r) => ({ ...r, text: r.text.trim() })),
        };
        setSaved(trimmed);
        setValues({ ...trimmed, quickReplies: values.quickReplies.map((r) => ({ ...r, text: r.text.trim() })) });
        setStatus({ tone: "success", text: "Saved. Your website shows the new settings on the next page load." });
      } else {
        setStatus({ tone: "error", text: result.error ?? "We couldn't save your widget settings. Please try again." });
      }
    });
  }

  function discard() {
    setValues({ ...saved, quickReplies: withIds(saved.quickReplies) });
    setFieldErrors({});
    setStatus(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Appearance</h2>
          <p className="mt-0.5 text-sm text-slate-500">Changes show in the preview right away. Save to publish them.</p>
        </div>

        <div className="space-y-6 px-6 py-5">
          <TextInput
            id="assistant-name"
            label="Assistant name"
            hint="Shown at the top of the chat window."
            value={values.assistantName}
            maxLength={MAX_ASSISTANT_NAME}
            error={fieldErrors.assistantName}
            onChange={(value) => update("assistantName", value)}
          />

          <LogoPicker logoUrl={logoUrl} onChange={setLogoUrl} />

          <div>
            <label htmlFor="brand-color" className="block text-sm font-medium text-slate-700">
              Brand color
            </label>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                type="color"
                aria-label="Pick brand color"
                value={/^#[0-9a-f]{6}$/i.test(values.brandColor) ? values.brandColor : saved.brandColor}
                onChange={(event) => update("brandColor", event.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
              />
              <input
                id="brand-color"
                value={values.brandColor}
                onChange={(event) => update("brandColor", event.target.value)}
                maxLength={7}
                spellCheck={false}
                aria-invalid={fieldErrors.brandColor ? true : undefined}
                aria-describedby={fieldErrors.brandColor ? "brand-color-error" : undefined}
                className={inputClass(Boolean(fieldErrors.brandColor), "w-32 font-mono")}
              />
            </div>
            {fieldErrors.brandColor && (
              <p id="brand-color-error" className="mt-1.5 text-sm text-red-600">
                {fieldErrors.brandColor}
              </p>
            )}
          </div>

          <fieldset className="min-w-0">
            <legend className="text-sm font-medium text-slate-700">Button position</legend>
            <div className="mt-2 flex gap-3">
              {(["right", "left"] as const).map((position) => (
                <label
                  key={position}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-brand-600 ${
                    values.position === position ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-300 text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="position"
                    value={position}
                    checked={values.position === position}
                    onChange={() => update("position", position)}
                    className="size-4 accent-brand-600"
                  />
                  Bottom {position}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="welcome-message" className="block text-sm font-medium text-slate-700">
              Welcome message
            </label>
            <textarea
              id="welcome-message"
              rows={3}
              value={values.welcomeMessage}
              maxLength={MAX_WELCOME_MESSAGE}
              onChange={(event) => update("welcomeMessage", event.target.value)}
              aria-invalid={fieldErrors.welcomeMessage ? true : undefined}
              aria-describedby="welcome-message-hint"
              className={inputClass(Boolean(fieldErrors.welcomeMessage), "mt-1.5 w-full resize-y")}
            />
            <p id="welcome-message-hint" className={`mt-1.5 text-sm ${fieldErrors.welcomeMessage ? "text-red-600" : "text-slate-500"}`}>
              {fieldErrors.welcomeMessage ?? "The first message visitors see when they open the chat."}
            </p>
          </div>

          <fieldset className="min-w-0">
            <legend className="text-sm font-medium text-slate-700">Quick replies</legend>
            <p className="mt-0.5 text-sm text-slate-500">
              Buttons visitors can tap instead of typing. Shown until they send their first message. A button that opens the
              appointment form lets visitors leave their name and number for the clinic to call back.
            </p>
            <ol className="mt-3 space-y-3" data-testid="quick-replies">
              {values.quickReplies.map((reply, index) => {
                const error = fieldErrors[`quickReplies.${index}.text`] ?? fieldErrors[`quickReplies.${index}`];
                return (
                  <li key={reply.id}>
                    <div className="flex items-center gap-2">
                      <input
                        value={reply.text}
                        maxLength={MAX_QUICK_REPLY}
                        aria-label={`Quick reply ${index + 1}`}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => updateReply(index, { text: event.target.value })}
                        className={inputClass(Boolean(error), "min-w-0 flex-1")}
                      />
                      <IconButton label={`Move quick reply ${index + 1} up`} disabled={index === 0} onClick={() => moveReply(index, -1)}>
                        <path d="M12 19V5m-6 6 6-6 6 6" />
                      </IconButton>
                      <IconButton
                        label={`Move quick reply ${index + 1} down`}
                        disabled={index === values.quickReplies.length - 1}
                        onClick={() => moveReply(index, 1)}
                      >
                        <path d="M12 5v14m6-6-6 6-6-6" />
                      </IconButton>
                      <IconButton
                        label={`Remove quick reply ${index + 1}`}
                        danger
                        onClick={() => update("quickReplies", values.quickReplies.filter((_, i) => i !== index))}
                      >
                        <path d="M6 6l12 12M18 6 6 18" />
                      </IconButton>
                    </div>
                    <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={reply.action === "appointment_form"}
                        onChange={(event) =>
                          updateReply(index, { action: event.target.checked ? "appointment_form" : "message" })
                        }
                        className="size-4 rounded border-slate-300 accent-brand-600"
                        aria-label={`Quick reply ${index + 1} opens the appointment form`}
                      />
                      Opens the appointment form
                    </label>
                    {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
                  </li>
                );
              })}
            </ol>
            {fieldErrors.quickReplies && <p className="mt-2 text-sm text-red-600">{fieldErrors.quickReplies}</p>}
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={values.quickReplies.length >= MAX_QUICK_REPLIES}
              onClick={() => update("quickReplies", [...values.quickReplies, { id: crypto.randomUUID(), text: "", action: "message" }])}
            >
              Add quick reply
            </Button>
            {values.quickReplies.length >= MAX_QUICK_REPLIES && (
              <p className="mt-1.5 text-sm text-slate-500">You can add up to {MAX_QUICK_REPLIES} quick replies.</p>
            )}
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button type="button" onClick={save} pending={saving} pendingLabel="Saving…" disabled={!dirty}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" onClick={discard} disabled={!dirty || saving}>
            Discard changes
          </Button>
          {dirty && !saving && <span className="text-sm text-amber-700">You have unsaved changes.</span>}
        </div>
        {status && (
          <div className="px-6 pb-5">
            <Alert tone={status.tone}>{status.text}</Alert>
          </div>
        )}
      </Card>

      <div className="lg:sticky lg:top-6">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">Live preview</h2>
          </div>
          {/* Beside the form, the preview is a 500px-wide desktop view scaled to fit,
              so it shows the desktop layout rather than the full-screen phone layout. */}
          <div className="overflow-hidden lg:h-[593px] lg:w-[390px]">
            <iframe
              ref={frame}
              title="Widget preview"
              srcDoc={PREVIEW_DOCUMENT}
              className="block h-[700px] w-full bg-slate-100 lg:h-[760px] lg:w-[500px] lg:origin-top-left lg:scale-[0.78]"
              data-testid="widget-preview"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function LogoPicker({ logoUrl, onChange }: { logoUrl: string | null; onChange: (url: string | null) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(init: RequestInit) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/widget/logo", init);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Something went wrong. Please try again.");
      onChange(body.logoUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("logo", file);
    void request({ method: "POST", body: form });
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700">Logo</p>
      <div className="mt-1.5 flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
          {logoUrl ? (
            // Stored in Supabase Storage; a plain img keeps the preview identical to the widget.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Current logo" className="size-full object-contain p-1" data-testid="logo-image" />
          ) : (
            <span className="text-xs text-slate-400">No logo</span>
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <label
            className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600 ${
              pending ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {pending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={upload}
              disabled={pending}
              data-testid="logo-input"
            />
          </label>
          {logoUrl && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void request({ method: "DELETE" })}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className={`mt-1.5 text-sm ${error ? "text-red-600" : "text-slate-500"}`} role={error ? "alert" : undefined}>
        {error ?? "PNG, JPG or WebP, up to 512 KB. Square images look best. Logo changes are saved right away."}
      </p>
    </div>
  );
}

export function EmbedCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <pre
        className="rounded-lg bg-slate-900 px-4 py-3.5 font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-slate-100"
        data-testid="embed-code"
      >
        <code>{code}</code>
      </pre>
      <Button type="button" className="mt-3" onClick={copy}>
        {copied ? "Copied" : "Copy embed code"}
      </Button>
      <span className="sr-only" role="status">
        {copied ? "Embed code copied" : ""}
      </span>
    </div>
  );
}

function TextInput({
  id,
  label,
  hint,
  value,
  maxLength,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  maxLength: number;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={inputClass(Boolean(error), "mt-1.5 w-full")}
      />
      <p id={`${id}-hint`} className={`mt-1.5 text-sm ${error ? "text-red-600" : "text-slate-500"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}

function IconButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function inputClass(invalid: boolean, extra = "") {
  return `rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
    invalid ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
  } ${extra}`;
}
