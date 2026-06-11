import { Badge } from "@/components/ui/badge";
import { attributionCounts, type AttributionSegment } from "@/lib/attribution";
import { cn } from "@/lib/utils";

export function AttributionView({
  segments,
}: {
  segments: AttributionSegment[];
}) {
  const counts = attributionCounts(segments);
  const total = counts.ai + counts.user;
  const userPercent = total ? Math.round((counts.user / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">AI retained: {total - counts.user} chars</Badge>
        <Badge className="bg-sky-500/12 text-sky-700 dark:text-sky-300">
          You wrote: {counts.user} chars
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {userPercent}% edited
        </span>
      </div>
      <div className="min-h-44 whitespace-pre-wrap rounded-xl border bg-background/70 p-4 text-[15px] leading-7">
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
      </div>
      <p className="text-xs text-muted-foreground">
        Highlighted text is yours. Unhighlighted text remains from the
        generated baseline.
      </p>
    </div>
  );
}
