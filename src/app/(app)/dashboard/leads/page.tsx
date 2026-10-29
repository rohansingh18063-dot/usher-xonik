import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LeadStatusBadge, NewBadge } from "@/components/lead-status";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";
import { formatLeadDate, formatMobile, LEAD_STATUS_LABELS, LEAD_STATUSES, leadsTimeZone, PREFERRED_TIME_LABELS } from "@/lib/leads";
import { filtersToSearch, LEADS_PAGE_SIZE, leadsQuery, parseLeadFilters } from "@/lib/leads-query";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Leads searchParams={searchParams} />
    </Suspense>
  );
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none";

async function Leads({ searchParams }: Pick<PageProps<"/dashboard/leads">, "searchParams">) {
  const [business, params] = await Promise.all([getCurrentBusiness(), searchParams]);
  if (!business) redirect("/onboarding");

  const filters = parseLeadFilters(params);
  const supabase = await createClient();
  const start = (filters.page - 1) * LEADS_PAGE_SIZE;
  const { data: leads, count, error } = await leadsQuery(supabase, business.id, filters, { count: true }).range(
    start,
    start + LEADS_PAGE_SIZE - 1,
  );
  if (error) throw new Error("Could not load your leads.");

  const total = count ?? 0;
  const filtered = Boolean(filters.q || filters.status || filters.from || filters.to);
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const exportSearch = filtersToSearch({ ...filters, page: 1 }).toString();
  const pageLink = (page: number) => `/dashboard/leads?${filtersToSearch({ ...filters, page }).toString()}`;
  const received = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: leadsTimeZone() });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Leads</h1>
          <p className="mt-2 text-sm text-slate-600">
            Appointment and callback requests from your website. Call each visitor to confirm a time.
          </p>
        </div>
        <a href={`/api/leads/export${exportSearch ? `?${exportSearch}` : ""}`} className={buttonClass("secondary", "shrink-0")} download>
          Export CSV
        </a>
      </div>

      <Card>
        <form method="get" className="grid gap-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]" role="search">
          <div>
            <label htmlFor="q" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <input id="q" name="q" defaultValue={filters.q} placeholder="Name or mobile number" className={inputClass} />
          </div>
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <select id="status" name="status" defaultValue={filters.status} className={inputClass}>
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className="block text-sm font-medium text-slate-700">
              Received from
            </label>
            <input id="from" name="from" type="date" defaultValue={filters.from} className={inputClass} />
          </div>
          <div>
            <label htmlFor="to" className="block text-sm font-medium text-slate-700">
              Received to
            </label>
            <input id="to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClass("primary")}>
              Apply filters
            </button>
            {filtered && (
              <Link href="/dashboard/leads" className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {leads.length === 0 ? (
          <div className="px-6 py-12 text-center">
            {filtered ? (
              <p className="text-sm text-slate-600">No leads match these filters.</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-900">No leads yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  When visitors request an appointment on your website, they appear here and you get an email.{" "}
                  <Link href="/dashboard/widget" className="font-medium text-brand-700 underline underline-offset-2">
                    Set up your widget
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="leads-table">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Mobile</th>
                  <th className="px-5 py-3 font-medium">Preferred</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className={lead.seen_at ? "" : "bg-brand-50/40"} data-testid="lead-row">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {lead.name}
                        </Link>
                        {!lead.seen_at && <NewBadge />}
                      </div>
                      {lead.concern && <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{lead.concern}</p>}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-700">{formatMobile(lead.mobile)}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-700">
                      {formatLeadDate(lead.preferred_date)}, {PREFERRED_TIME_LABELS[lead.preferred_time].toLowerCase()}
                    </td>
                    <td className="px-5 py-3.5">
                      <LeadStatusBadge status={lead.status} />
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-500">{received.format(new Date(lead.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
            <p data-testid="lead-count">
              {total} {total === 1 ? "lead" : "leads"}
              {pages > 1 && ` · page ${filters.page} of ${pages}`}
            </p>
            {pages > 1 && (
              <div className="flex gap-2">
                {filters.page > 1 && (
                  <Link href={pageLink(filters.page - 1)} className={buttonClass("secondary", "px-3 py-1.5")}>
                    Previous
                  </Link>
                )}
                {filters.page < pages && (
                  <Link href={pageLink(filters.page + 1)} className={buttonClass("secondary", "px-3 py-1.5")}>
                    Next
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
