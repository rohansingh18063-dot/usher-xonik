import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeleteAccount, EmailForm, PasswordForm, ProfileForm } from "@/components/account-settings";
import { PageSkeleton } from "@/components/page-skeleton";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { industryLabel } from "@/lib/business";
import { getCurrentBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

async function Settings({ searchParams }: Pick<PageProps<"/dashboard/settings">, "searchParams">) {
  const [business, params] = await Promise.all([getCurrentBusiness(), searchParams]);
  if (!business) redirect("/onboarding");

  // Read fresh from the auth server: the session token may still carry an old name or email.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";
  const fullName = typeof data.user?.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "";

  const details = [
    { label: "Business name", value: business.business_name, testId: "business-name" },
    { label: "Industry", value: industryLabel(business.industry), testId: "industry" },
    { label: "Website domain", value: business.website_domain, testId: "website-domain" },
    { label: "Account email", value: email, testId: "account-email" },
    { label: "Member since", value: dateFormat.format(new Date(business.created_at)), testId: "created-at" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-2 text-sm text-slate-600">Your profile, login and account.</p>
      </div>

      {params.saved && <Alert tone="success">Your business details have been updated.</Alert>}
      {params.email === "changed" && <Alert tone="success">Your login email has been changed.</Alert>}

      <ProfileForm fullName={fullName} businessName={business.business_name} />

      <Card>
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Business details</h2>
            <p className="mt-0.5 text-sm text-slate-500">Used to set up and personalize your assistant.</p>
          </div>
          <ButtonLink href="/dashboard/edit" variant="secondary">
            Edit details
          </ButtonLink>
        </div>
        <dl className="divide-y divide-slate-100">
          {details.map((detail) => (
            <div key={detail.label} className="grid gap-1 px-5 py-3.5 sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-slate-500">{detail.label}</dt>
              <dd className="text-sm break-words text-slate-900 sm:col-span-2" data-testid={detail.testId}>
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <EmailForm email={email} />
      <PasswordForm />
      <DeleteAccount businessName={business.business_name} />
    </div>
  );
}
