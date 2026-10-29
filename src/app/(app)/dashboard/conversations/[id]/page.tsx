import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LeadStatusBadge } from "@/components/lead-status";
import { PageSkeleton } from "@/components/page-skeleton";
import { Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";
import { getConversation } from "@/lib/dashboard-data";
import { leadsTimeZone } from "@/lib/leads";

export const metadata: Metadata = { title: "Conversation" };

export default function ConversationPage({ params }: PageProps<"/dashboard/conversations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Conversation params={params} />
    </Suspense>
  );
}

async function Conversation({ params }: Pick<PageProps<"/dashboard/conversations/[id]">, "params">) {
  const [business, { id }] = await Promise.all([getCurrentBusiness(), params]);
  if (!business) redirect("/onboarding");
  const conversation = await getConversation(id);
  if (!conversation) notFound();

  const { turns, lead } = conversation;
  const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: leadsTimeZone() });
  const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: leadsTimeZone() });
  const pages = [...new Set(turns.map((turn) => turn.page_url).filter((url): url is string => Boolean(url)))];

  return (
    <div className="space-y-6">
      <Link href="/dashboard/conversations" className="text-sm font-medium text-brand-700 hover:underline">
        ← All conversations
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Conversation</h1>
        <p className="mt-1 text-sm text-slate-600" data-testid="conversation-summary">
          Started {time.format(new Date(turns[0].created_at))} · {turns.length} {turns.length === 1 ? "message" : "messages"}
        </p>
      </div>

      {(lead || pages.length > 0) && (
        <Card>
          <dl className="divide-y divide-slate-100">
            {lead && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3.5">
                <dt className="w-32 text-sm text-slate-500">Lead</dt>
                <dd className="flex items-center gap-2 text-sm">
                  <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline" data-testid="conversation-lead">
                    {lead.name}
                  </Link>
                  <LeadStatusBadge status={lead.status} />
                </dd>
              </div>
            )}
            {pages.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-6 py-3.5">
                <dt className="w-32 text-sm text-slate-500">{pages.length === 1 ? "Page" : "Pages"}</dt>
                <dd className="min-w-0 flex-1 space-y-1 text-sm">
                  {pages.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-brand-700 hover:underline">
                      {url}
                    </a>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <Card>
        <ol className="space-y-4 bg-slate-50/60 px-4 py-6 sm:px-6" data-testid="conversation-messages">
          {turns.map((turn) => (
            <li key={turn.created_at} className="space-y-3">
              <div className="flex flex-col items-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                  <span className="sr-only">Visitor: </span>
                  {turn.visitor_message}
                </p>
                <span className="mt-1 text-[11px] text-slate-400">{clock.format(new Date(turn.created_at))}</span>
              </div>
              <div className="flex justify-start">
                <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
                  <span className="sr-only">Assistant: </span>
                  {turn.assistant_reply}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
