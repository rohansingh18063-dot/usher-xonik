import { Suspense } from "react";
import { DashboardNav } from "@/components/dashboard-nav";
import { Logo } from "@/components/ui";
import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { getNavigationCounts } from "@/lib/dashboard-data";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 lg:flex-row">
      <Suspense fallback={<NavPlaceholder />}>
        <Navigation />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

async function Navigation() {
  const [user, business, counts] = await Promise.all([getCurrentUser(), getCurrentBusiness(), getNavigationCounts()]);
  return (
    <DashboardNav businessName={business?.business_name ?? "Your business"} email={user?.email ?? ""} counts={counts} />
  );
}

function NavPlaceholder() {
  return (
    <>
      <div className="hidden h-dvh w-64 shrink-0 border-r border-slate-200 bg-white px-6 py-5 lg:block">
        <Logo href="/dashboard" />
      </div>
      <div className="flex h-14 items-center border-b border-slate-200 bg-white px-4 lg:hidden">
        <Logo href="/dashboard" />
      </div>
    </>
  );
}
