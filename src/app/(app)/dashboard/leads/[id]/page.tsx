import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LeadEditor, MarkSeen } from "@/components/lead-editor";
import { PageSkeleton } from "@/components/page-skeleton";
import { Card } from "@/components/ui";
import { getCurrentBusiness, getLead } from "@/lib/data";
import { formatLeadDate, formatMobile, leadsTimeZone, PREFERRED_TIME_LABELS } from "@/lib/leads";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Lead params={params} />
    </Suspense>
  );
}

const DELIVERY: Record<"sent" | "failed" | "skipped", string> = {
  sent: "Sent",
  failed: "Could not be sent",
  skipped: "Not sent",
};

async function Lead({ params }: Pick<PageProps<"/dashboard/leads/[id]">, "params">) {
  const [business, { id }] = await Promise.all([getCurrentBusiness(), params]);
  if (!business) redirect("/onboarding");
  const found = await getLead(id);
  if (!found) notFound();

  const { lead, conversation, notifications } = found;
  const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: leadsTimeZone() });

  const details = [
    {
      label: "Mobile",
      value: (
        <a href={`tel:${lead.mobile}`} className="font-medium text-brand-700 hover:underline">
          {formatMobile(lead.mobile)}
        </a>
      ),
    },
    { label: "Preferred date", value: formatLeadDate(lead.preferred_date) },
    { label: "Preferred time", value: PREFERRED_TIME_LABELS[lead.preferred_time] },
    { label: "Treatment or concern", value: lead.concern ?? <span className="text-slate-400">Not given</span> },
    {
      label: "Sent from",
      value: lead.source_url ? (
        <a href={lead.source_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 hover:underline">
          {lead.source_url}
        </a>
      ) : (
        <span className="text-slate-400">Unknown page</span>
      ),
    },
    { label: "Received", value: timeFormat.format(new Date(lead.created_at)) },
  ];

  return (
    <div className="space-y-6">
      {!lead.seen_at && <MarkSeen id={lead.id} />}
      <Link href="/dashboard/leads" className="text-sm font-medium text-brand-700 hover:underline">
        ← All leads
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900" data-testid="lead-name">
        {lead.name}
      </h1>

      <Card>
        <dl className="divide-y divide-slate-100" data-testid="lead-details">
          {details.map((detail) => (
            <div key={detail.label} className="grid gap-1 px-6 py-3.5 sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm text-slate-500">{detail.label}</dt>
              <dd className="text-sm text-slate-900 sm:col-span-2">{detail.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <LeadEditor id={lead.id} status={lead.status} notes={lead.notes ?? ""} />

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Chat before the request</h2>
          <p className="mt-0.5 text-sm text-slate-500">What the visitor asked your assistant on the website.</p>
        </div>
        {conversation.length === 0 ? (
          <p className="px-6 py-6 text-sm text-slate-500">The visitor sent the request without chatting first.</p>
        ) : (
          <div className="space-y-3 bg-slate-50/60 px-6 py-5" data-testid="lead-conversation">
            {conversation.map((turn) => (
              <div key={turn.created_at} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                    {turn.visitor_message}
                  </p>
                </div>
                <div className="flex justify-start">
                  <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
                    {turn.assistant_reply}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Alerts</h2>
        </div>
        {notifications.length === 0 ? (
          <p className="px-6 py-5 text-sm text-slate-500">Alerts are on their way.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="lead-alerts">
            {notifications.map((alert) => (
              <li key={`${alert.channel}-${alert.recipient}-${alert.created_at}`} className="px-6 py-3.5 text-sm">
                <span className="font-medium text-slate-900">{alert.channel === "email" ? "Email" : "WhatsApp"}</span>
                {alert.recipient !== "(none)" && <span className="text-slate-600"> to {alert.recipient}</span>}:{" "}
                <span className={alert.status === "sent" ? "text-emerald-700" : "text-red-700"}>{DELIVERY[alert.status]}</span>
                {alert.error && alert.status !== "sent" && <span className="text-slate-500"> ({alert.error})</span>}
                <span className="text-slate-400"> · {timeFormat.format(new Date(alert.created_at))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
