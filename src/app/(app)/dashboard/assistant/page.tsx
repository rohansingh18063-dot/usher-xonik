import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { PageSkeleton } from "@/components/page-skeleton";
import { getCurrentBusiness } from "@/lib/data";
import type { Industry } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Test Assistant" };

const SUGGESTIONS: Record<Industry, string[]> = {
  dentist: [
    "What happens during a root canal?",
    "How long do braces usually take?",
    "How much does teeth whitening cost?",
    "Mere daant mein bahut dard ho raha hai",
  ],
  pharmacy: ["What are your opening hours?", "Do you offer home delivery?"],
  other: ["What services do you offer?", "How can I contact you?"],
};

export default function TestAssistantPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TestAssistant />
    </Suspense>
  );
}

async function TestAssistant() {
  const business = await getCurrentBusiness();
  if (!business) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Test Assistant</h1>
        <p className="mt-2 text-sm text-slate-600">
          Chat with your assistant the way your website visitors will. These test conversations are saved to your
          account.
        </p>
      </div>
      <ChatPanel
        clientId={business.id}
        businessName={business.business_name}
        suggestions={SUGGESTIONS[business.industry]}
      />
    </div>
  );
}
