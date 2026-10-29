"use client";

import { useState, useTransition } from "react";
import { setGapStatus } from "@/app/actions/gaps";
import { Button } from "@/components/ui";

export function GapStatusButton({ id, topic, status }: { id: string; topic: string; status: "open" | "resolved" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = status === "open" ? "resolved" : "open";

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        className="px-3 py-2"
        pending={pending}
        pendingLabel="Saving…"
        aria-label={`${status === "open" ? "Mark as resolved" : "Open again"}: ${topic}`}
        onClick={() =>
          startTransition(async () => {
            const outcome = await setGapStatus(id, next);
            setError(outcome.error ?? null);
          })
        }
      >
        {status === "open" ? "Mark as resolved" : "Open again"}
      </Button>
      {error && (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
