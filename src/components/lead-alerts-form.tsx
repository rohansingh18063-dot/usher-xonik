"use client";

import { useActionState, useState } from "react";
import { saveLeadAlertEmails, type AlertEmailsState } from "@/app/actions/notification-settings";
import { Alert, Button, Card } from "@/components/ui";

export function LeadAlertsForm({ emails, accountEmail }: { emails: string[]; accountEmail: string }) {
  const [state, action, pending] = useActionState<AlertEmailsState, FormData>(saveLeadAlertEmails, {});
  // Controlled, so what the clinic typed stays in place when the address list has a mistake.
  const [value, setValue] = useState(emails.join(", "));
  const current = state.emails ?? emails;

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Lead alerts</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Who gets an email the moment a visitor requests an appointment. Not shared with visitors or the assistant.
        </p>
      </div>
      <form action={action} className="space-y-4 px-6 py-5">
        <div>
          <label htmlFor="lead-alert-emails" className="block text-sm font-medium text-slate-700">
            Email addresses for lead alerts
          </label>
          <textarea
            id="lead-alert-emails"
            name="emails"
            rows={2}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="frontdesk@myclinic.com, doctor@myclinic.com"
            aria-describedby="lead-alert-emails-hint"
            aria-invalid={state.error ? true : undefined}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
          />
          <p id="lead-alert-emails-hint" className="mt-1.5 text-sm text-slate-500">
            Up to 5 addresses, separated by commas.{" "}
            {current.length === 0 ? (
              <>
                While this is empty, alerts go to your sign-in email, <strong className="font-medium">{accountEmail}</strong>.
              </>
            ) : (
              <>Alerts go to: {current.join(", ")}.</>
            )}
          </p>
        </div>
        {state.error && <Alert>{state.error}</Alert>}
        {state.saved && <Alert tone="success">Lead alert addresses saved.</Alert>}
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          Save alert addresses
        </Button>
      </form>
    </Card>
  );
}
