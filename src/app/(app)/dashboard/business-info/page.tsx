import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusinessInfoForm } from "@/components/business-info-form";
import { LeadAlertsForm } from "@/components/lead-alerts-form";
import { PageSkeleton } from "@/components/page-skeleton";
import { profileFromRow } from "@/lib/business-profile";
import { getCurrentBusiness, getCurrentBusinessProfile, getNotificationSettings } from "@/lib/data";

export const metadata: Metadata = { title: "Business Info" };

export default function BusinessInfoPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BusinessInfo />
    </Suspense>
  );
}

async function BusinessInfo() {
  const [business, profile, alerts] = await Promise.all([
    getCurrentBusiness(),
    getCurrentBusinessProfile(),
    getNotificationSettings(),
  ]);
  if (!business) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Business Info</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your assistant always uses these details first when answering visitors. Anything you leave empty, it will
          not guess: it tells visitors the clinic will confirm.
        </p>
      </div>
      <BusinessInfoForm initialValues={profileFromRow(profile)} />
      {alerts && <LeadAlertsForm emails={alerts.leadAlertEmails} accountEmail={alerts.accountEmail} />}
    </div>
  );
}
