"use client";

import { useRef } from "react";

import { type AttributionSegment } from "@/lib/attribution";
import { cn } from "@/lib/utils";

// Shared typography/box so the transparent textarea and the colored mirror
// align character-for-character.
const surface =
  "absolute inset-0 m-0 size-full whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6";

export function HighlightedEditor({
  value,
  segments,
  onChange,
  className,
}: {
  value: string;
  segments: AttributionSegment[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "retro-sunken relative min-h-72 overflow-hidden",
        className,
      )}
    >
      <div
        ref={mirrorRef}
        aria-hidden
        className={cn(surface, "overflow-auto text-foreground")}
      >
        {segments.map((segment, index) => (
          <span
            key={`${segment.source}-${index}`}
            className={cn(
              segment.source === "user" &&
                "rounded-sm bg-sky-500/15 text-sky-800 ring-1 ring-sky-500/20 dark:text-sky-200",
            )}
          >
            {segment.text}
          </span>
        ))}
        {/* Trailing newline guard so the final empty line is measured. */}
        {value.endsWith("\n") ? "\n" : null}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const mirror = mirrorRef.current;
          if (mirror) {
            mirror.scrollTop = event.currentTarget.scrollTop;
            mirror.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        spellCheck={false}
        style={{ caretColor: "var(--foreground)" }}
        className={cn(
          surface,
          "resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none selection:bg-sky-500/30",
        )}
      />
    </div>
  );
}
