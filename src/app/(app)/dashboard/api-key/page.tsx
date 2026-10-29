import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { AllowedDomains, ApiKeyCard, AssistantSwitches, LocalDate } from "@/components/public-access-settings";
import { Card } from "@/components/ui";
import { getCurrentBusiness, getPublicAccessOverview } from "@/lib/data";
import { IP_LIMIT_PER_MINUTE } from "@/lib/public-api/guard";
import type { RejectionReason } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "API Key" };

const REASONS: Record<RejectionReason, string> = {
  invalid_key: "Unknown or old key",
  assistant_paused: "Assistant paused",
  missing_origin: "No website address sent",
  origin_not_allowed: "Website not allowed",
  invalid_request: "Invalid request",
  ip_rate_limited: "Too many messages from one visitor",
  key_rate_limited: "Too many messages overall",
  monthly_limit_reached: "Monthly limit reached",
};

export default function ApiKeyPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApiKey />
    </Suspense>
  );
}

async function ApiKey() {
  const [business, overview] = await Promise.all([getCurrentBusiness(), getPublicAccessOverview()]);
  if (!business) redirect("/onboarding");
  if (!overview?.key) throw new Error("Your API key is missing. Please contact support.");

  const { key, settings, domains, websiteMessagesThisMonth, rejections } = overview;
  const usageShare = settings.monthly_message_limit
    ? Math.min(100, Math.round((websiteMessagesThisMonth / settings.monthly_message_limit) * 100))
    : 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">API Key</h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect your website to your assistant. Only the websites you list here can use your key.
        </p>
      </div>

      <ApiKeyCard publicKey={key.public_key} issuedAt={key.regenerated_at ?? key.created_at} />
      <AssistantSwitches paused={settings.assistant_paused} testMode={settings.test_mode} />
      <AllowedDomains domains={domains} testMode={settings.test_mode} />

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Usage this month</h2>
          <p className="mt-0.5 text-sm text-slate-500">Messages answered on your website. Test Assistant messages are not counted.</p>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-slate-900" data-testid="monthly-usage">
            <span className="text-2xl font-semibold">{websiteMessagesThisMonth}</span> of{" "}
            {settings.monthly_message_limit.toLocaleString("en-US")} messages
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${usageShare >= 90 ? "bg-amber-500" : "bg-brand-600"}`}
              style={{ width: `${usageShare}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Limits: up to {key.requests_per_minute} messages per minute across all visitors, and{" "}
            {IP_LIMIT_PER_MINUTE} per minute from any one visitor.
          </p>
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Rejected requests</h2>
          <p className="mt-0.5 text-sm text-slate-500">The most recent requests your assistant refused, and why.</p>
        </div>
        {rejections.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">No rejected requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="rejections">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-2.5 font-medium">Time</th>
                  <th className="px-6 py-2.5 font-medium">Reason</th>
                  <th className="px-6 py-2.5 font-medium">Website</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rejections.map((row, index) => (
                  <tr key={`${row.created_at}-${index}`}>
                    <td className="px-6 py-3 whitespace-nowrap text-slate-600">
                      <LocalDate value={row.created_at} />
                    </td>
                    <td className="px-6 py-3 text-slate-900">{REASONS[row.reason]}</td>
                    <td className="px-6 py-3 font-mono text-xs break-all text-slate-600">{row.origin ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
