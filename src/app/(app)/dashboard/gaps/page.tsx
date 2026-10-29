import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GapStatusButton } from "@/components/gap-status-button";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, Card } from "@/components/ui";
import type { GapCategory } from "@/lib/chat/hidden-tags";
import { getCurrentBusiness } from "@/lib/data";
import { getKnowledgeGaps } from "@/lib/dashboard-data";
import { leadsTimeZone } from "@/lib/leads";

export const metadata: Metadata = { title: "Knowledge gaps" };

export default function KnowledgeGapsPage({ searchParams }: PageProps<"/dashboard/gaps">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KnowledgeGaps searchParams={searchParams} />
    </Suspense>
  );
}

const CATEGORY_LABELS: Record<GapCategory, string> = {
  fees: "Fees",
  timings: "Timings",
  doctors: "Doctors",
  services: "Services",
  offers: "Offers",
  contact: "Contact",
  location: "Location",
  payments: "Payments",
  other: "Other",
};

/** Where the answer to each kind of gap belongs. */
const FIX: Record<GapCategory, { href: string; label: string } | null> = {
  fees: { href: "/dashboard/business-info#fees", label: "Add fees in Business Info" },
  timings: { href: "/dashboard/business-info#opening-hours", label: "Add opening hours in Business Info" },
  doctors: { href: "/dashboard/business-info#doctors", label: "Add doctors in Business Info" },
  services: { href: "/dashboard/business-info#services", label: "Add services in Business Info" },
  offers: { href: "/dashboard/business-info#offers", label: "Add offers in Business Info" },
  contact: { href: "/dashboard/business-info#contact", label: "Add contact details in Business Info" },
  location: { href: "/dashboard/business-info#contact", label: "Add the address in Business Info" },
  payments: null,
  other: null,
};

async function KnowledgeGaps({ searchParams }: Pick<PageProps<"/dashboard/gaps">, "searchParams">) {
  const [business, params] = await Promise.all([getCurrentBusiness(), searchParams]);
  if (!business) redirect("/onboarding");

  const status = params.status === "resolved" ? "resolved" : "open";
  const result = await getKnowledgeGaps(status);
  if (!result) redirect("/onboarding");
  const { gaps, openCount, resolvedCount } = result;
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: leadsTimeZone() });

  const tabs = [
    { status: "open", label: "Open", count: openCount, href: "/dashboard/gaps" },
    { status: "resolved", label: "Resolved", count: resolvedCount, href: "/dashboard/gaps?status=resolved" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Knowledge gaps</h1>
        <p className="mt-2 text-sm text-slate-600">
          Questions visitors asked that your assistant could not answer from your information, so it had to say the
          clinic will confirm. Add the answers and it will reply straight away next time.
        </p>
      </div>

      <nav aria-label="Gap status" className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <Link
            key={tab.status}
            href={tab.href}
            aria-current={status === tab.status ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${
              status === tab.status
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
            }`}
          >
            {tab.label} <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {gaps.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          {status === "open" ? (
            <>
              <p className="text-sm font-medium text-slate-900">No open gaps</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                When visitors ask about something your Business Info and documents don&apos;t cover, such as a fee or a
                timing, it appears here with how often it was asked.
              </p>
              <Link href="/dashboard/assistant" className={buttonClass("secondary", "mt-5")}>
                Try the Test Assistant
              </Link>
            </>
          ) : (
            <p className="text-sm text-slate-600">No resolved gaps yet. Gaps you mark as resolved are kept here.</p>
          )}
        </Card>
      ) : (
        <ul className="space-y-4" data-testid="gap-list">
          {gaps.map((gap) => {
            const fix = FIX[gap.category];
            return (
              <li key={gap.id} data-testid="gap" data-gap={gap.id} data-category={gap.category} data-count={gap.question_count}>
                <Card className="p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-slate-900" data-testid="gap-topic">
                          {gap.topic}
                        </h2>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {CATEGORY_LABELS[gap.category]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        Asked <strong className="font-semibold text-slate-900">{gap.question_count}</strong>{" "}
                        {gap.question_count === 1 ? "time" : "times"} · last on {when.format(new Date(gap.last_asked_at))}
                        {gap.resolved_at && ` · resolved on ${when.format(new Date(gap.resolved_at))}`}
                      </p>
                    </div>
                    <GapStatusButton id={gap.id} topic={gap.topic} status={gap.status} />
                  </div>

                  {gap.examples.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">What visitors asked</p>
                      <ul className="mt-2 space-y-1.5" data-testid="gap-questions">
                        {gap.examples.map((example) => (
                          <li key={`${example.created_at}-${example.question}`} className="flex gap-2 text-sm text-slate-700">
                            <span className="text-slate-300" aria-hidden="true">
                              “
                            </span>
                            {example.session_id ? (
                              <Link href={`/dashboard/conversations/${example.session_id}`} className="hover:text-brand-700 hover:underline">
                                {example.question}
                              </Link>
                            ) : (
                              <span>{example.question}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {gap.status === "open" && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {fix && (
                        <Link href={fix.href} className={buttonClass("primary")}>
                          {fix.label}
                        </Link>
                      )}
                      <Link href="/dashboard/documents" className={buttonClass(fix ? "secondary" : "primary")}>
                        Upload a document
                      </Link>
                      {!fix && (
                        <Link href="/dashboard/business-info" className={buttonClass("secondary")}>
                          Add to Business Info
                        </Link>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
