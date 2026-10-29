import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusinessForm } from "@/components/business-form";
import { PageSkeleton } from "@/components/page-skeleton";
import { Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";

export const metadata: Metadata = { title: "Set up your business" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Onboarding />
    </Suspense>
  );
}

async function Onboarding() {
  const business = await getCurrentBusiness();
  if (business) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-medium text-brand-600">Welcome</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Tell us about your business</h1>
      <p className="mt-2 text-sm text-slate-600">
        We use these details to set up your assistant. You can change them at any time.
      </p>
      <Card className="mt-8 p-6 sm:p-8">
        <BusinessForm mode="create" />
      </Card>
    </div>
  );
}
