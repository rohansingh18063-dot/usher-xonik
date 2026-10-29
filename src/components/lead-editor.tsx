"use client";

import { useEffect, useState, useTransition } from "react";
import { markLeadSeen, updateLead } from "@/app/actions/leads";
import { Alert, Button, Card } from "@/components/ui";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, MAX_NOTES, type LeadStatus } from "@/lib/leads";

export function LeadEditor({ id, status, notes }: { id: string; status: LeadStatus; notes: string }) {
  const [values, setValues] = useState({ status, notes });
  const [saved, setSaved] = useState({ status, notes });
  const [result, setResult] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, startTransition] = useTransition();
  const dirty = values.status !== saved.status || values.notes !== saved.notes;

  function save() {
    startTransition(async () => {
      const outcome = await updateLead(id, values);
      setResult(outcome);
      if (outcome.saved) {
        setSaved(values);
      }
    });
  }

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Follow-up</h2>
      </div>
      <div className="space-y-4 px-6 py-5">
        <div>
          <label htmlFor="lead-status" className="block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="lead-status"
            value={values.status}
            onChange={(event) => {
              setValues({ ...values, status: event.target.value as LeadStatus });
              setResult({});
            }}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:w-64"
          >
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LEAD_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="lead-notes" className="block text-sm font-medium text-slate-700">
            Notes
          </label>
          <textarea
            id="lead-notes"
            rows={4}
            maxLength={MAX_NOTES}
            value={values.notes}
            placeholder="For example: called, booked for Tuesday 11 AM with Dr. Rao."
            onChange={(event) => {
              setValues({ ...values, notes: event.target.value });
              setResult({});
            }}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
          />
        </div>
        {result.error && <Alert>{result.error}</Alert>}
        {result.saved && !dirty && <Alert tone="success">Saved.</Alert>}
        <Button type="button" onClick={save} pending={pending} pendingLabel="Saving…" disabled={!dirty}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/** Marks the lead as seen once it has been opened, which removes its "New" badge. */
export function MarkSeen({ id }: { id: string }) {
  useEffect(() => {
    void markLeadSeen(id);
  }, [id]);
  return null;
}
