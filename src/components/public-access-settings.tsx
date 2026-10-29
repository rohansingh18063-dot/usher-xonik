"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import {
  addAllowedDomain,
  regenerateApiKey,
  removeAllowedDomain,
  setAssistantPaused,
  setTestMode,
  type ActionResult,
} from "@/app/actions/api-key";
import { Alert, Button, Card } from "@/components/ui";

type Domain = { domain: string; include_subdomains: boolean };

export function ApiKeyCard({ publicKey, issuedAt }: { publicKey: string; issuedAt: string }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult>({});
  const [pending, startTransition] = useTransition();

  async function copy() {
    await navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader
        title="Public key"
        description="Your website uses this key to talk to your assistant. It only works on the domains listed below."
      />
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={publicKey}
            aria-label="Public key"
            data-testid="public-key"
            onFocus={(event) => event.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900"
          />
          <Button type="button" variant="secondary" onClick={copy} className="sm:w-28">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Created <LocalDate value={issuedAt} />. This key is meant to be placed in your website&apos;s code; it is not a
          password.
        </p>

        {result.error && <Alert>{result.error}</Alert>}
        {result.ok && !confirming && <Alert tone="success">New key created. The old key no longer works.</Alert>}

        {confirming ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              The current key will stop working immediately. Your website&apos;s assistant will stop answering until you
              update it with the new key.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                className="bg-amber-600 hover:bg-amber-700"
                pending={pending}
                pendingLabel="Creating…"
                onClick={() =>
                  startTransition(async () => {
                    const outcome = await regenerateApiKey();
                    setResult(outcome);
                    if (outcome.ok) setConfirming(false);
                  })
                }
              >
                Regenerate key
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => { setResult({}); setConfirming(true); }}>
            Regenerate key
          </Button>
        )}
      </div>
    </Card>
  );
}

export function AssistantSwitches({ paused, testMode }: { paused: boolean; testMode: boolean }) {
  return (
    <Card>
      <CardHeader title="Assistant status" />
      <div className="divide-y divide-slate-100">
        <Switch
          label="Pause assistant"
          description={
            paused
              ? "Paused: your website's assistant is not answering. Visitors see a message asking them to contact you directly."
              : "Your assistant is answering visitors. Pause it at any time; your key and settings stay as they are."
          }
          checked={paused}
          onChange={setAssistantPaused}
        />
        <Switch
          label="Test mode"
          description="Allows localhost, so you can try the assistant on your own computer before going live. Turn it off when you are done."
          checked={testMode}
          onChange={setTestMode}
        />
      </div>
    </Card>
  );
}

function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-start justify-between gap-6 px-6 py-4">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await onChange(!checked);
            setError(outcome.error ?? null);
          })
        }
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 ${
          checked ? "bg-brand-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5.5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

export function AllowedDomains({ domains, testMode }: { domains: Domain[]; testMode: boolean }) {
  // Controlled and submitted without the form action prop, which would reset
  // the form afterwards: what the client typed stays in place when the domain
  // is refused, and the fields clear only once the domain is added.
  const [domain, setDomain] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [state, action, adding] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await addAllowedDomain(previous, formData);
    if (result.ok) {
      setDomain("");
      setIncludeSubdomains(false);
    }
    return result;
  }, {});
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        title="Allowed domains"
        description="Your assistant only answers on these websites. Each domain covers both the www and non-www address."
      />
      <div className="space-y-5 px-6 py-5">
        {domains.length === 0 ? (
          <p className="text-sm text-amber-800">
            No domains yet. Add your website&apos;s domain, or your assistant will not answer anywhere.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="domain-list">
            {domains.map((entry) => {
              const inactiveLocalhost = entry.domain === "localhost" && !testMode;
              return (
                <li key={entry.domain} className="flex items-center justify-between gap-4 px-4 py-3" data-testid="domain-row">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-slate-900">{entry.domain}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.domain === "localhost"
                        ? inactiveLocalhost
                          ? "Inactive: turn on Test mode to use localhost"
                          : "Test mode: any port on this computer"
                        : entry.include_subdomains
                          ? `${entry.domain}, www.${entry.domain} and all subdomains (*.${entry.domain})`
                          : `${entry.domain} and www.${entry.domain}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-3 py-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Remove ${entry.domain}`}
                    disabled={removing}
                    onClick={() =>
                      startRemoving(async () => {
                        const outcome = await removeAllowedDomain(entry.domain);
                        setRemoveError(outcome.error ?? null);
                      })
                    }
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {removeError && <Alert>{removeError}</Alert>}

        <form
          className="space-y-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            startTransition(() => action(formData));
          }}
        >
          <label htmlFor="new-domain" className="block text-sm font-medium text-slate-700">
            Add a domain
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="new-domain"
              name="domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="myclinic.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={state.error ? true : undefined}
              className={`min-w-0 flex-1 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:ring-4 focus:outline-none ${
                state.error
                  ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                  : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
              }`}
            />
            <Button type="submit" pending={adding} pendingLabel="Adding…">
              Add domain
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="include_subdomains"
              checked={includeSubdomains}
              onChange={(event) => setIncludeSubdomains(event.target.checked)}
              className="size-4 rounded border-slate-300 accent-brand-600"
            />
            Also allow all subdomains (for example book.myclinic.com)
          </label>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <p className="text-xs text-slate-500">
            You can also type *.myclinic.com. To test on your own computer, turn on Test mode and add localhost.
          </p>
        </form>
      </div>
    </Card>
  );
}

function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b border-slate-200 px-6 py-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
    </div>
  );
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export function LocalDate({ value }: { value: string }) {
  // Formatted in the viewer's time zone, which can differ from the server's.
  return (
    <time dateTime={value} suppressHydrationWarning>
      {dateTimeFormat.format(new Date(value))}
    </time>
  );
}
