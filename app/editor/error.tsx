"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function EditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[editor error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-medium">Something went wrong in the editor.</h2>
      <pre className="max-w-2xl overflow-auto rounded-md border border-border bg-muted p-3 text-left text-xs">
        {error?.message || "Unknown error"}
        {error?.stack ? `\n\n${error.stack}` : ""}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
