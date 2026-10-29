import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";
import {
  CONVERSATIONS_PAGE_SIZE,
  conversationFiltersToSearch,
  listConversations,
  parseConversationFilters,
} from "@/lib/dashboard-data";
import { leadsTimeZone } from "@/lib/leads";

export const metadata: Metadata = { title: "Conversations" };

export default function ConversationsPage({ searchParams }: PageProps<"/dashboard/conversations">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Conversations searchParams={searchParams} />
    </Suspense>
  );
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none";

/** A page address without the scheme, for reading at a glance. */
function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function Conversations({ searchParams }: Pick<PageProps<"/dashboard/conversations">, "searchParams">) {
  const [business, params] = await Promise.all([getCurrentBusiness(), searchParams]);
  if (!business) redirect("/onboarding");

  const filters = parseConversationFilters(params);
  const { rows, total } = await listConversations(filters, {
    limit: CONVERSATIONS_PAGE_SIZE,
    offset: (filters.page - 1) * CONVERSATIONS_PAGE_SIZE,
  });
  const filtered = Boolean(filters.q || filters.from || filters.to || filters.lead);
  const pages = Math.max(1, Math.ceil(total / CONVERSATIONS_PAGE_SIZE));
  const exportSearch = conversationFiltersToSearch({ ...filters, page: 1 }).toString();
  const pageLink = (page: number) => `/dashboard/conversations?${conversationFiltersToSearch({ ...filters, page }).toString()}`;
  const started = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: leadsTimeZone() });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Conversations</h1>
          <p className="mt-2 text-sm text-slate-600">Every chat visitors had with your assistant on your website.</p>
        </div>
        <a
          href={`/api/conversations/export${exportSearch ? `?${exportSearch}` : ""}`}
          className={buttonClass("secondary", "shrink-0")}
          download
        >
          Export CSV
        </a>
      </div>

      <Card>
        <form
          method="get"
          role="search"
          className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
        >
          <div>
            <label htmlFor="q" className="block text-sm font-medium text-slate-700">
              Search messages
            </label>
            <input id="q" name="q" defaultValue={filters.q} placeholder="For example: whitening" className={inputClass} />
          </div>
          <div>
            <label htmlFor="from" className="block text-sm font-medium text-slate-700">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={filters.from} className={inputClass} />
          </div>
          <div>
            <label htmlFor="to" className="block text-sm font-medium text-slate-700">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
          </div>
          <div>
            <label htmlFor="lead" className="block text-sm font-medium text-slate-700">
              Lead
            </label>
            <select id="lead" name="lead" defaultValue={filters.lead} className={inputClass}>
              <option value="">All conversations</option>
              <option value="yes">With a lead</option>
              <option value="no">Without a lead</option>
            </select>
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClass("primary")}>
              Apply filters
            </button>
            {filtered && (
              <Link href="/dashboard/conversations" className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            {filtered ? (
              <p className="text-sm text-slate-600">No conversations match these filters.</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-900">No conversations yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  Conversations appear here as soon as visitors chat with your assistant on your website.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Link href="/dashboard/widget" className={buttonClass("primary")}>
                    Install the widget
                  </Link>
                  <Link href="/dashboard/assistant" className={buttonClass("secondary")}>
                    Try the Test Assistant
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="conversation-list">
            {rows.map((row) => (
              <li key={row.session_id} data-testid="conversation-row" data-session={row.session_id}>
                <Link
                  href={`/dashboard/conversations/${row.session_id}`}
                  className="block px-5 py-4 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{started.format(new Date(row.started_at))}</span>
                    <span>
                      {row.message_count} {row.message_count === 1 ? "message" : "messages"}
                    </span>
                    {row.page_url && <span className="max-w-full truncate">{shortUrl(row.page_url)}</span>}
                    {row.lead_id && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">
                        Lead
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-900" data-testid="conversation-first-message">
                    {row.first_message}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-3 text-sm text-slate-600 sm:px-6">
            <p data-testid="conversation-count">
              {total} {total === 1 ? "conversation" : "conversations"}
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
