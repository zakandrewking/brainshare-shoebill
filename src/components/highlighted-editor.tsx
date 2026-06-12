"use client";

import { useMemo, useRef } from "react";

import { type AttributionSegment } from "@/lib/attribution";
import {
  decorateSegments,
  type CrosslinkRange,
} from "@/lib/crosslinks";
import { cn } from "@/lib/utils";

// Shared typography/box so the transparent textarea and the colored mirror
// align character-for-character.
const surface =
  "absolute inset-0 m-0 size-full whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6";

export function HighlightedEditor({
  value,
  segments,
  crosslinks = [],
  onChange,
  onBlur,
  autoFocus,
  className,
}: {
  value: string;
  segments: AttributionSegment[];
  /** Live `[[topic]]` ranges to decorate in place (see findCrosslinkRanges). */
  crosslinks?: CrosslinkRange[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Split attribution spans at crosslink boundaries; only colors/underlines
  // change, never the text, so the mirror stays aligned with the textarea.
  const pieces = useMemo(
    () => decorateSegments(segments, crosslinks),
    [segments, crosslinks],
  );

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
        {pieces.map((piece, index) => (
          <span
            key={index}
            className={cn(
              piece.source === "user" &&
                "rounded-sm bg-sky-500/15 text-sky-800 ring-1 ring-sky-500/20 dark:text-sky-200",
              piece.link === "resolved" &&
                "text-primary underline decoration-dotted underline-offset-2",
              piece.link === "unresolved" && "text-muted-foreground",
            )}
          >
            {piece.text}
          </span>
        ))}
        {/* Trailing newline guard so the final empty line is measured. */}
        {value.endsWith("\n") ? "\n" : null}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        autoFocus={autoFocus}
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
