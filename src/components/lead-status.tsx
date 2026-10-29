import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leads";

const STYLES: Record<LeadStatus, string> = {
  new: "bg-brand-50 text-brand-700 ring-brand-200",
  contacted: "bg-amber-50 text-amber-800 ring-amber-200",
  booked: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  not_interested: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

/** Shown on leads the clinic has not opened yet. */
export function NewBadge() {
  return (
    <span data-testid="new-badge" className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">
      New
    </span>
  );
}
