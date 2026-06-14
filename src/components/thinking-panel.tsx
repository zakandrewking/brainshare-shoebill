"use client";

import { BrainIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// One persistent, collapsed "Thinking" indicator for the answer card. The SAME
// component renders whether generation is in progress, just finished, or the
// answer was loaded fresh later — so it never appears/disappears (no reflow).
// It holds the single loading spinner: spinning while active, a static brain
// icon otherwise. Collapsed by default; the chevron rotates to show open state.
export function ThinkingPanel({
  reasoning,
  active,
  className,
}: {
  reasoning: string;
  active: boolean;
  className?: string;
}) {
  const hasReasoning = reasoning.trim().length > 0;
  return (
    <details className={cn("group/think retro-sunken text-sm", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-medium text-muted-foreground">
        {active ? (
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
        ) : (
          <BrainIcon className="size-4 shrink-0" />
        )}
        Thinking
        <ChevronRightIcon className="ml-auto size-4 shrink-0 transition-transform group-open/think:rotate-90" />
      </summary>
      <div className="border-t border-foreground/10 px-3 py-2 whitespace-pre-wrap text-muted-foreground">
        {hasReasoning ? (
          reasoning
        ) : active ? (
          "Working through the question…"
        ) : (
          // The model reasons internally, but some providers (e.g. OpenAI)
          // only return a reasoning summary for verified accounts — so an
          // empty summary doesn't mean no thinking happened.
          "No reasoning summary was returned for this answer — the model may still have reasoned internally."
        )}
      </div>
    </details>
  );
}
