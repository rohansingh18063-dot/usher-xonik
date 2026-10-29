import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DailyChart } from "@/components/daily-chart";
import { LeadStatusBadge, NewBadge } from "@/components/lead-status";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";
import { getOverview, getSetupChecklist, type ChecklistItem, type PeriodTotals } from "@/lib/dashboard-data";
import { formatLeadDate, formatMobile, PREFERRED_TIME_LABELS } from "@/lib/leads";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
] as const;

const numberFormat = new Intl.NumberFormat("en-US");

/** Leads per conversation, or a dash when there were no conversations. */
function conversion(totals: PeriodTotals) {
  return totals.conversations ? `${Math.round((totals.leads / totals.conversations) * 100)}%` : "—";
}

async function Overview() {
  const [business, overview, checklist] = await Promise.all([getCurrentBusiness(), getOverview(), getSetupChecklist()]);
  if (!business) redirect("/onboarding");
  if (!overview || !checklist) throw new Error("Could not load your dashboard.");

  const { totals, usage } = overview;
  const cards = [
    { id: "conversations", label: "Conversations", value: (t: PeriodTotals) => numberFormat.format(t.conversations) },
    { id: "messages", label: "Visitor messages", value: (t: PeriodTotals) => numberFormat.format(t.messages) },
    { id: "leads", label: "Leads", value: (t: PeriodTotals) => numberFormat.format(t.leads) },
    { id: "conversion", label: "Lead conversion", value: conversion, hint: "Leads per conversation" },
  ];
  const quiet = overview.chart.every((day) => day.conversations === 0 && day.leads === 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-600">Overview</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900" data-testid="business-title">
          {business.business_name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">How your website assistant is doing, and what to do next.</p>
      </div>

      <SetupChecklist items={checklist} />

      <section aria-label="Activity" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.id} className="p-5">
            <div data-testid={`stat-${card.id}`}>
              <h2 className="text-sm font-medium text-slate-600">{card.label}</h2>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {PERIODS.map((period) => (
                  <div key={period.key} data-period={period.key}>
                    <dt className="text-[11px] text-slate-500">{period.label}</dt>
                    <dd className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">{card.value(totals[period.key])}</dd>
                  </div>
                ))}
              </dl>
              {card.hint && <p className="mt-2 text-[11px] text-slate-400">{card.hint}</p>}
            </div>
          </Card>
        ))}
      </section>

      <UsageMeter used={usage.used} limit={usage.limit} resetsOn={usage.resetsOn} />

      <Card className="p-5 sm:p-6">
        {quiet && (
          <p className="mb-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No website conversations in the last 30 days yet. Once your widget is on your website, activity shows here.{" "}
            <Link href="/dashboard/widget" className="font-medium text-brand-700 underline underline-offset-2">
              Install the widget
            </Link>
          </p>
        )}
        <div className="grid gap-8 lg:grid-cols-2">
          <DailyChart
            title="Conversations per day"
            unit="conversations"
            testId="chart-conversations"
            points={overview.chart.map((day) => ({ day: day.day, value: day.conversations }))}
          />
          <DailyChart
            title="Leads per day"
            unit="leads"
            testId="chart-leads"
            points={overview.chart.map((day) => ({ day: day.day, value: day.leads }))}
          />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-slate-900">Latest leads</h2>
          <Link href="/dashboard/leads" className="text-sm font-medium text-brand-700 hover:underline">
            View all
          </Link>
        </div>
        {overview.latestLeads.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">
            No leads yet. Visitors who ask for an appointment on your website appear here, and you get an email.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="latest-leads">
            {overview.latestLeads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex flex-col gap-1 px-5 py-3.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{lead.name}</span>
                    {!lead.seen_at && <NewBadge />}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    <span>{formatMobile(lead.mobile)}</span>
                    <span>
                      {formatLeadDate(lead.preferred_date)}, {PREFERRED_TIME_LABELS[lead.preferred_time].toLowerCase()}
                    </span>
                    <LeadStatusBadge status={lead.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return null;

  return (
    <Card>
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6" data-testid="setup-checklist">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">Finish setting up</h2>
          <p className="text-sm text-slate-500">
            {done} of {items.length} done
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-slate-100">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            data-testid={`checklist-${item.id}`}
            data-done={item.done}
          >
            <div className="flex gap-3">
              {item.done ? (
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor" aria-hidden="true">
                    <path d="M8.1 13.6 4.5 10l1.1-1.1 2.5 2.5 6.3-6.3 1.1 1.1z" />
                  </svg>
                </span>
              ) : (
                <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-slate-300" aria-hidden="true" />
              )}
              <div>
                <p className={`text-sm font-medium ${item.done ? "text-slate-500 line-through" : "text-slate-900"}`}>
                  {item.label}
                  <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
              </div>
            </div>
            {!item.done && (
              <Link href={item.href} className={buttonClass("secondary", "shrink-0 self-start px-3 py-1.5 sm:self-auto")}>
                {item.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function UsageMeter({ used, limit, resetsOn }: { used: number; limit: number; resetsOn: Date }) {
  const share = limit > 0 ? used / limit : 1;
  const level = share >= 1 ? "limit" : share >= 0.8 ? "warning" : "normal";
  const percent = Math.min(100, Math.round(share * 100));
  const reset = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(resetsOn);
  const styles = {
    normal: { track: "bg-brand-100", fill: "bg-brand-600" },
    warning: { track: "bg-amber-100", fill: "bg-amber-500" },
    limit: { track: "bg-red-100", fill: "bg-red-600" },
  }[level];

  return (
    <Card className="p-5 sm:p-6">
      <div data-testid="usage" data-level={level}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Monthly usage</h2>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900 tabular-nums" data-testid="usage-used">
              {numberFormat.format(used)}
            </span>{" "}
            of <span data-testid="usage-limit">{numberFormat.format(limit)}</span> messages ({percent}%)
          </p>
        </div>
        <div
          className={`mt-3 h-2.5 overflow-hidden rounded-full ${styles.track}`}
          role="meter"
          aria-label="Messages used this month"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${used} of ${limit} messages`}
        >
          <div className={`h-full rounded-full ${styles.fill}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">Website messages only; Test Assistant messages are free. Resets on {reset}.</p>

        {level !== "normal" && (
          <div
            role={level === "limit" ? "alert" : "status"}
            data-testid="usage-warning"
            className={`mt-4 flex gap-3 rounded-lg border px-4 py-3 text-sm ${
              level === "limit" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0" fill="currentColor" aria-hidden="true">
              <path d="M10 2 1 18h18L10 2zm-.9 6h1.8v5H9.1V8zm0 6.5h1.8v1.8H9.1v-1.8z" />
            </svg>
            <p>
              {level === "limit" ? (
                <>
                  <strong>Monthly limit reached.</strong> Your assistant has stopped answering website visitors until {reset}.
                  Visitors are asked to contact you directly. Contact support to raise your limit.
                </>
              ) : (
                <>
                  <strong>You have used {percent}% of this month&apos;s messages.</strong> At {numberFormat.format(limit)}, your
                  assistant stops answering until {reset}.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

