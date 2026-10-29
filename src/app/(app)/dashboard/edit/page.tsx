import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusinessForm } from "@/components/business-form";
import { PageSkeleton } from "@/components/page-skeleton";
import { Card } from "@/components/ui";
import { getCurrentBusiness } from "@/lib/data";

export const metadata: Metadata = { title: "Edit business details" };

export default function EditBusinessPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditBusiness />
    </Suspense>
  );
}

async function EditBusiness() {
  const business = await getCurrentBusiness();
  if (!business) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/settings" className="text-sm font-medium text-slate-500 hover:text-slate-900">
        ← Back to settings
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Edit business details</h1>
      <p className="mt-2 text-sm text-slate-600">Update how your business appears to your assistant.</p>
      <Card className="mt-8 p-6 sm:p-8">
        <BusinessForm
          mode="edit"
          initialValues={{
            business_name: business.business_name,
            industry: business.industry,
            website_domain: business.website_domain,
          }}
        />
      </Card>
    </div>
  );
}
