"use client";

import { useSearchParams } from "next/navigation";

/** Confirms on the home page that an account was deleted. */
export function AccountDeletedNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("account") !== "deleted") return null;
  return (
    <div className="mx-auto mt-4 max-w-3xl px-4 sm:px-6">
      <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Your account and all of its data have been deleted.
      </p>
    </div>
  );
}
