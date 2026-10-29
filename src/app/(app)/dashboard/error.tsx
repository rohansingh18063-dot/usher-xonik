"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClass, Card } from "@/components/ui";

/** Shown when a dashboard page could not load; the rest of the dashboard keeps working. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div data-testid="page-error">
      <Card className="px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-900">This page could not load</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Something went wrong while loading your data. Please try again; if it keeps happening, check your internet
          connection.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Link href="/dashboard" className={buttonClass("secondary")}>
            Go to Overview
          </Link>
        </div>
      </Card>
    </div>
  );
}
