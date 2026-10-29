import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";

export default function DashboardNotFound() {
  return (
    <div data-testid="not-found">
      <Card className="px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Not found</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          This item does not exist, or it belongs to another account.
        </p>
        <Link href="/dashboard" className={buttonClass("secondary", "mt-6")}>
          Go to Overview
        </Link>
      </Card>
    </div>
  );
}
