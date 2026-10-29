import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DocumentsManager } from "@/components/documents-manager";
import { PageSkeleton } from "@/components/page-skeleton";
import { getCurrentBusiness } from "@/lib/data";
import { DOCUMENT_COLUMNS, toClientDocument } from "@/lib/documents/manage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Documents />
    </Suspense>
  );
}

async function Documents() {
  const business = await getCurrentBusiness();
  if (!business) redirect("/onboarding");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("client_id", business.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load your documents.");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Documents</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload price lists, treatment guides, policies or FAQs. Your assistant uses a document once it is ready, and
          stops using it as soon as you delete it.
        </p>
      </div>
      <DocumentsManager initialDocuments={data.map(toClientDocument)} />
    </div>
  );
}
