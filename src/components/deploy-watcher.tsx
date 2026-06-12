"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Poll the deployed build id and, when it changes, nudge the user to reload so
// they aren't left running stale chunks after a deploy. We prompt rather than
// hard-reload: a forced refresh mid-edit would throw away cursor/scroll (and is
// jarring), so the user reloads when it suits them. We also re-check whenever
// the tab regains focus, which is when a stale session most needs it.
const POLL_MS = 60_000;

export function DeployWatcher() {
  const baseline = useRef<string | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function currentVersion(): Promise<string | null> {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return null;
        const body = (await response.json()) as { version?: string };
        return body.version ?? null;
      } catch {
        return null;
      }
    }

    async function check() {
      const version = await currentVersion();
      if (cancelled || !version) return;

      // First successful read establishes the baseline for this session.
      if (baseline.current === null) {
        baseline.current = version;
        return;
      }

      if (version !== baseline.current && !notified.current) {
        notified.current = true;
        toast("A new version is available", {
          description: "Reload to get the latest update.",
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => window.location.reload(),
          },
        });
      }
    }

    void check();
    const interval = setInterval(() => void check(), POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
