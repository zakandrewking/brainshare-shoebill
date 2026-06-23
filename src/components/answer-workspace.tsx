"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { signOut, type User } from "firebase/auth";
import {
  CheckIcon,
  CloudIcon,
  CornerUpLeftIcon,
  HistoryIcon,
  LayersIcon,
  LinkIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

import { LiveMarkdownEditor } from "@/components/live-markdown-editor";
import { ThinkingPanel } from "@/components/thinking-panel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { attributeText, attributionCounts } from "@/lib/attribution";
import {
  findAutoLinks,
  type AutoLinkCandidate,
} from "@/lib/autolink";
import {
  findBacklinks,
  findCrosslinkRanges,
  normalizeTopic,
} from "@/lib/crosslinks";
import type { CrosslinkRange } from "@/lib/crosslinks";
import { findRelatedQuestions } from "@/lib/related";
import { cn } from "@/lib/utils";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { SerializedAnswer } from "@/lib/types";
import type { DriveStatusResponse } from "@/lib/drive";

async function authenticatedFetch(
  user: User,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const token = await user.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

type AnswerVersionRow = {
  index: number;
  kind: "edit" | "regenerate" | "revert";
  currentText: string;
  capturedAt: string;
};

const VERSION_KIND_LABELS: Record<AnswerVersionRow["kind"], string> = {
  edit: "Edit checkpoint",
  regenerate: "Before regenerate",
  revert: "Before restore",
};

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "Something went wrong.";
  } catch {
    return "Something went wrong.";
  }
}

// A fetch that dies at the network level rejects with a bare TypeError —
// Safari says just "Load failed", Chrome "Failed to fetch". Name the step and
// suggest a retry instead of toasting the browser's message verbatim; our own
// thrown errors (plain Error) pass through with their specific messages.
function describeActionError(error: unknown, step: string) {
  if (error instanceof TypeError) {
    return `Network error while ${step}. Check your connection and try again.`;
  }
  return error instanceof Error
    ? error.message
    : `Something went wrong while ${step}.`;
}

export function AnswerWorkspace({ user }: { user: User }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<SerializedAnswer | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  // Reasoning is no longer streamed (background generation); kept for the
  // post-generation display of the last reasoning summary.
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  // ID of the answer currently being polled for background generation progress.
  const pollingAnswerIdRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  // Submissions semantically related to the open answer, shown as links so
  // entries cross-link even when the text carries no [[topic]] tokens.
  const [answerRelated, setAnswerRelated] = useState<
    { id: string; question: string }[]
  >([]);
  // Database context for automatic cross-references: the other articles plus
  // their embedding similarity to the open one, fetched when the answer opens.
  const [autoLinkCandidates, setAutoLinkCandidates] = useState<
    AutoLinkCandidate[]
  >([]);
  // Revert history for the open answer; null until fetched.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<AnswerVersionRow[] | null>(null);
  // Which stored version is being previewed in the history modal (its `index`).
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [submissions, setSubmissions] = useState<SerializedAnswer[]>([]);
  // AI-generated starter questions for the blank workspace, kept warm by the
  // server-side pool so they appear instantly.
  const [suggestions, setSuggestions] = useState<
    { id: string; text: string }[]
  >([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [questionFocused, setQuestionFocused] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveStatusResponse | null>(null);
  const [driveDialogOpen, setDriveDialogOpen] = useState(false);
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isDisconnectingDrive, setIsDisconnectingDrive] = useState(false);
  // Mirror submissions for the popstate handler, which reads the latest list
  // without re-subscribing on every change.
  const submissionsRef = useRef<SerializedAnswer[]>([]);
  // Latest editor text; lets a finished save know whether it's still current.
  const currentTextRef = useRef("");
  useEffect(() => {
    currentTextRef.current = currentText;
  });

  // Prior questions related to what's being typed, surfaced as autocomplete.
  // The local keyword ranking renders instantly; the server's hybrid
  // (keyword + embedding) ranking replaces it when it arrives.
  const relatedQuestions = useMemo(
    () => findRelatedQuestions(question, submissions, { excludeId: answer?.id }),
    [question, submissions, answer?.id],
  );
  const [serverRelated, setServerRelated] = useState<{
    query: string;
    items: { id: string; question: string }[];
  } | null>(null);
  // Latest debounced query; an in-flight response for anything else is stale.
  const relatedQueryRef = useRef("");

  useEffect(() => {
    const query = question.trim();
    if (!questionFocused || isGenerating || query.length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      relatedQueryRef.current = query;
      try {
        const response = await authenticatedFetch(user, "/api/related", {
          method: "POST",
          body: JSON.stringify({ query, excludeId: answer?.id }),
        });
        if (!response.ok || relatedQueryRef.current !== query) {
          return;
        }
        const body = (await response.json()) as {
          questions: { id: string; question: string }[];
        };
        setServerRelated({ query, items: body.questions });
      } catch (error) {
        // Keep the local keyword suggestions on a failed fetch.
        console.error(error);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [question, questionFocused, isGenerating, answer?.id, user]);

  const displayedRelated =
    serverRelated && serverRelated.query === question.trim()
      ? serverRelated.items
      : relatedQuestions;
  const showRelated =
    questionFocused && !isGenerating && displayedRelated.length > 0;

  // Doc-to-doc related entries for the open answer (its stored vector covers
  // question + answer text), so entries cross-link by what they discuss —
  // independent of any [[topic]] tokens. Keyed on the id so saves don't
  // refetch.
  const answerId = answer?.id;
  useEffect(() => {
    if (!answerId) {
      return;
    }
    let stale = false;
    void (async () => {
      try {
        const response = await authenticatedFetch(user, "/api/related", {
          method: "POST",
          body: JSON.stringify({ answerId }),
        });
        if (!response.ok || stale) return;
        const body = (await response.json()) as {
          questions: { id: string; question: string }[];
        };
        setAnswerRelated(body.questions);
      } catch (error) {
        // Related links are an enhancement; fail to an empty row silently.
        console.error(error);
      }
    })();
    return () => {
      stale = true;
    };
  }, [answerId, user]);

  // Fetch the database context for automatic cross-references when the open
  // answer changes: the other articles and how similar each is to this one.
  useEffect(() => {
    if (!answerId) {
      return;
    }
    let stale = false;
    void (async () => {
      try {
        const response = await authenticatedFetch(user, "/api/autolink", {
          method: "POST",
          body: JSON.stringify({ answerId }),
        });
        if (!response.ok || stale) return;
        const body = (await response.json()) as {
          candidates: AutoLinkCandidate[];
        };
        setAutoLinkCandidates(body.candidates);
      } catch (error) {
        // Auto cross-references are an enhancement; fail silent (no links).
        console.error(error);
      }
    })();
    return () => {
      stale = true;
    };
  }, [answerId, user]);

  const segments = useMemo(
    () => (answer ? attributeText(answer.aiText, currentText) : []),
    [answer, currentText],
  );
  // Semantic [[topic]] resolutions from /api/crosslinks: normalized topic →
  // submission id. The cache also remembers misses (null) so each topic is
  // looked up at most once per session.
  const [semanticLinks, setSemanticLinks] = useState<Record<string, string>>(
    {},
  );
  const semanticCacheRef = useRef(new Map<string, string | null>());

  // Legacy [[topic]] ranges from older answers — kept only for the ones that
  // RESOLVE to an existing article (semantic lookups fill in the rest). We no
  // longer surface unresolved topics: links must point to articles that exist.
  const resolvedWikiRanges = useMemo(() => {
    if (!currentText.includes("[[")) return [];
    const semantic = Object.fromEntries(
      Object.entries(semanticLinks).filter(([, id]) => id !== answer?.id),
    );
    return findCrosslinkRanges(currentText, submissions, {
      excludeId: answer?.id,
      semantic,
    }).filter((range) => range.resolved);
  }, [currentText, submissions, answer?.id, semanticLinks]);

  // Automatic cross-references to existing articles, computed live from the text
  // against the database context (see lib/autolink). Pure + instant per
  // keystroke. Set localStorage.autolinkDebug="1" to inspect link scoring.
  const autoLinkRanges = useMemo(() => {
    const links = findAutoLinks(currentText, autoLinkCandidates);
    if (
      typeof window !== "undefined" &&
      window.localStorage?.getItem("autolinkDebug") === "1" &&
      links.length > 0
    ) {
      console.table(
        links.map((link) => ({
          phrase: link.target,
          targetId: link.targetId,
          score: Number(link.score.toFixed(3)),
          anchor: link.signals.anchor,
          lexical: Number(link.signals.lexical.toFixed(3)),
          similarity: Number(link.signals.similarity.toFixed(3)),
        })),
      );
    }
    return links;
  }, [currentText, autoLinkCandidates]);

  // What the editor decorates and the chip row lists: resolved legacy wiki links
  // plus the automatic ones — all pointing at existing articles. autolink ranges
  // never overlap [[...]] tokens (see forbiddenRanges), so a simple concat is
  // safe; the editor sorts decorations.
  const crosslinkRanges = useMemo<CrosslinkRange[]>(() => {
    const auto: CrosslinkRange[] = autoLinkRanges.map((link) => ({
      start: link.start,
      end: link.end,
      target: link.target,
      resolved: true,
      targetId: link.targetId,
    }));
    return [...resolvedWikiRanges, ...auto];
  }, [resolvedWikiRanges, autoLinkRanges]);

  // Deduped tappable chip row of cross-references — the editor's ⌘/Ctrl-click
  // navigation has no equivalent on touch devices. Existing articles only.
  const linkChips = useMemo(() => {
    const seen = new Set<string>();
    const chips: { target: string; targetId: string }[] = [];
    for (const range of crosslinkRanges) {
      if (!range.targetId || seen.has(range.targetId)) continue;
      seen.add(range.targetId);
      chips.push({ target: range.target, targetId: range.targetId });
    }
    return chips;
  }, [crosslinkRanges]);

  // Entries whose text [[links]] to the open one (reverse crosslinks).
  const backlinks = useMemo(
    () => (answer ? findBacklinks(answer, submissions) : []),
    [answer, submissions],
  );

  // Look up topics that didn't resolve lexically, debounced while typing.
  useEffect(() => {
    const pending = [
      ...new Set(
        crosslinkRanges
          .filter((range) => !range.resolved)
          .map((range) => range.target)
          .filter(
            (target) => !semanticCacheRef.current.has(normalizeTopic(target)),
          ),
      ),
    ].slice(0, 20);
    if (pending.length === 0) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await authenticatedFetch(user, "/api/crosslinks", {
          method: "POST",
          body: JSON.stringify({ topics: pending, excludeId: answer?.id }),
        });
        if (!response.ok) return;
        const body = (await response.json()) as {
          matches: Record<string, { id: string }>;
        };
        for (const topic of pending) {
          semanticCacheRef.current.set(
            normalizeTopic(topic),
            body.matches[topic]?.id ?? null,
          );
        }
        const next: Record<string, string> = {};
        for (const [key, id] of semanticCacheRef.current) {
          if (id) next[key] = id;
        }
        setSemanticLinks(next);
      } catch (error) {
        // Semantic resolution is an enhancement; lexical links still work.
        console.error(error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [crosslinkRanges, answer?.id, user]);
  const counts = useMemo(() => attributionCounts(segments), [segments]);
  // The version currently being previewed in the history modal.
  const previewVersion =
    versions?.find((version) => version.index === previewIndex) ?? null;
  const userPercent =
    counts.ai + counts.user
      ? Math.round((counts.user / (counts.ai + counts.user)) * 100)
      : 0;

  const loadSubmissions = useCallback(async () => {
    try {
      const response = await authenticatedFetch(user, "/api/answers");
      if (!response.ok) return [];
      const body = (await response.json()) as {
        answers: SerializedAnswer[];
      };
      submissionsRef.current = body.answers;
      setSubmissions(body.answers);
      return body.answers;
    } catch (error) {
      console.error(error);
      return [];
    }
  }, [user]);

  // Fetch the ready starter suggestions. Returns the count so the warm-up
  // effect can retry while the pool is still filling on a cold start.
  const loadSuggestions = useCallback(async () => {
    try {
      const response = await authenticatedFetch(user, "/api/suggestions");
      if (!response.ok) return 0;
      const body = (await response.json()) as {
        suggestions: { id: string; text: string }[];
      };
      setSuggestions(body.suggestions);
      return body.suggestions.length;
    } catch (error) {
      console.error(error);
      return 0;
    }
  }, [user]);

  // Warm the pool on mount; if it's empty (first-ever load), the GET triggers a
  // background refill — retry a few times to pick up that first batch. After
  // that the pool stays full, so later visits show suggestions instantly.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      const count = await loadSuggestions();
      attempts += 1;
      if (!cancelled && count === 0 && attempts < 4) {
        setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [loadSuggestions]);

  // Submit a suggestion in one tap: mark it used (fire-and-forget) and generate.
  function submitSuggestion(suggestion: { id: string; text: string }) {
    setSuggestions((previous) =>
      previous.filter((item) => item.id !== suggestion.id),
    );
    void authenticatedFetch(user, "/api/suggestions", {
      method: "POST",
      body: JSON.stringify({ action: "use", id: suggestion.id }),
    }).catch((error) => console.error(error));
    void generate(suggestion.text);
  }

  // Dismiss a suggestion: drop it locally, tell the server (which refills), and
  // pick up the replacement shortly.
  function dismissSuggestion(id: string) {
    setSuggestions((previous) => previous.filter((item) => item.id !== id));
    void authenticatedFetch(user, "/api/suggestions", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss", id }),
    }).catch((error) => console.error(error));
    setTimeout(() => void loadSuggestions(), 5000);
  }

  const loadDriveStatus = useCallback(async () => {
    try {
      const response = await authenticatedFetch(user, "/api/drive/status");
      if (!response.ok) return;
      const body = (await response.json()) as DriveStatusResponse;
      setDriveStatus(body);
    } catch (error) {
      console.error(error);
    }
  }, [user]);

  // Load drive status on mount; handle ?drive_connected / ?drive_error params
  // returned by the OAuth callback redirect.
  useEffect(() => {
    void loadDriveStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.has("drive_connected")) {
      window.history.replaceState({}, "", window.location.pathname);
      toast.success("Google Drive connected! Your answers will sync automatically.");
      setDriveDialogOpen(true);
    } else if (params.has("drive_error")) {
      window.history.replaceState({}, "", window.location.pathname);
      toast.error(`Drive connection failed: ${params.get("drive_error")}`);
    }
  }, [loadDriveStatus]);

  async function connectDrive() {
    setIsConnectingDrive(true);
    try {
      const res = await authenticatedFetch(user, "/api/drive/connect");
      if (!res.ok) throw new Error(await readError(res));
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (error) {
      toast.error(describeActionError(error, "connecting to Drive"));
      setIsConnectingDrive(false);
    }
  }

  async function handleDisconnectDrive() {
    setIsDisconnectingDrive(true);
    try {
      const res = await authenticatedFetch(user, "/api/drive/disconnect", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res));
      setDriveStatus({ status: "notSetup" });
      setDriveDialogOpen(false);
      toast.success("Google Drive disconnected.");
    } catch (error) {
      toast.error(describeActionError(error, "disconnecting Drive"));
    } finally {
      setIsDisconnectingDrive(false);
    }
  }

  // Load only the submission state (no URL navigation). Used when reconciling
  // the open answer with the `?a=<id>` param on mount and on back/forward.
  const selectSubmission = useCallback(
    (
      submission: SerializedAnswer | null,
      options: { keepQuestion?: boolean } = {},
    ) => {
      setAnswer(submission);
      setCurrentText(submission?.currentText ?? "");
      // keepQuestion preserves a typed draft (e.g. opening a suggestion):
      // never silently discard text the user spent time on.
      if (!options.keepQuestion) {
        setQuestion(submission?.question ?? "");
      }
      setStreamingText("");
      setStreamingReasoning("");
      setAnswerRelated([]);
      setAutoLinkCandidates([]);
      setHistoryOpen(false);
      setVersions(null);
      setPreviewIndex(null);
      setIsSaved(true);
      setIsGenerating(false);
      setIsRegenerating(false);
      // Stop the poll loop for any previous answer.
      pollingAnswerIdRef.current = null;
    },
    [],
  );

  // Read `?a=<id>` and open the matching submission (or reset to a blank
  // workspace if absent/unknown). Reads the latest list from the ref so it can
  // run as a stable popstate listener.
  const applyUrlState = useCallback(() => {
    const id = new URLSearchParams(window.location.search).get("a");
    const found = id
      ? submissionsRef.current.find((submission) => submission.id === id)
      : undefined;
    selectSubmission(found ?? null);
  }, [selectSubmission]);

  useEffect(() => {
    void (async () => {
      await loadSubmissions();
      // Reconcile after the list resolves so a deep link can open its answer.
      applyUrlState();
    })();
  }, [loadSubmissions, applyUrlState]);

  useEffect(() => {
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, [applyUrlState]);

  // Reflect the open answer in the URL as `?a=<id>` so it is addressable and
  // shareable, and so browser back/forward move between answers.
  function pushAnswerUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("a", id);
    } else {
      url.searchParams.delete("a");
    }
    window.history.pushState(null, "", url);
  }

  function openSubmission(
    submission: SerializedAnswer,
    options: { keepQuestion?: boolean } = {},
  ) {
    selectSubmission(submission, options);
    pushAnswerUrl(submission.id);
    setSheetOpen(false);
  }

  function startNew() {
    selectSubmission(null);
    pushAnswerUrl(null);
    setSheetOpen(false);
  }

  async function loadVersions(answerId: string) {
    try {
      const response = await authenticatedFetch(
        user,
        `/api/answers/${answerId}/versions`,
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const body = (await response.json()) as {
        versions: AnswerVersionRow[];
      };
      setVersions(body.versions);
      // Preview the newest version by default so opening the modal shows
      // something to read immediately.
      const newest = body.versions[body.versions.length - 1];
      setPreviewIndex(newest ? newest.index : null);
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "loading the history"));
    }
  }

  function openHistory() {
    if (!answer) return;
    setHistoryOpen(true);
    setVersions(null);
    setPreviewIndex(null);
    void loadVersions(answer.id);
  }

  async function restoreVersion(index: number) {
    if (!answer) return;
    setIsRestoring(true);
    try {
      const response = await authenticatedFetch(
        user,
        `/api/answers/${answer.id}/versions`,
        {
          method: "POST",
          body: JSON.stringify({ restore: index }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const body = (await response.json()) as { answer: SerializedAnswer };
      setAnswer(body.answer);
      setCurrentText(body.answer.currentText);
      setIsSaved(true);
      setSubmissions((previous) => {
        const next = previous.map((submission) =>
          submission.id === body.answer.id ? body.answer : submission,
        );
        submissionsRef.current = next;
        return next;
      });
      toast.success("Earlier version restored.");
      setHistoryOpen(false);
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "restoring the version"));
    } finally {
      setIsRestoring(false);
    }
  }

  async function deleteSubmission(id: string) {
    try {
      const response = await authenticatedFetch(user, `/api/answers/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setSubmissions((previous) =>
        previous.filter((submission) => submission.id !== id),
      );
      if (answer?.id === id) {
        startNew();
      }
      toast.success("Submission deleted.");
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "deleting the submission"));
    }
  }

  // Poll a background generation until it completes, is cancelled, or errors.
  // Updates streamingText from generatingText so the user sees text building up.
  // Must be called with the answer already set in state.
  const pollGeneration = useCallback(
    async (
      answerId: string,
      setGenerating: (v: boolean) => void,
      isRegen: boolean,
    ) => {
      pollingAnswerIdRef.current = answerId;
      const STALE_MS = 10 * 60 * 1000; // 10 minutes
      try {
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          // Stop if the user navigated away from this answer.
          if (pollingAnswerIdRef.current !== answerId) return;

          let polled: SerializedAnswer;
          try {
            const res = await authenticatedFetch(
              user,
              `/api/answers/${answerId}`,
            );
            if (!res.ok) {
              toast.error("Polling failed. Refresh to check the result.");
              return;
            }
            const body = (await res.json()) as { answer: SerializedAnswer };
            polled = body.answer;
          } catch (error) {
            console.error("Generation poll error:", error);
            continue; // transient network error — retry
          }

          // Show partial text + reasoning as they build up.
          if (polled.generatingText) {
            setStreamingText(polled.generatingText);
          }
          if (polled.generatingReasoning !== undefined) {
            setStreamingReasoning(polled.generatingReasoning);
          }

          if (polled.generationStatus === "done") {
            setAnswer(polled);
            setCurrentText(polled.currentText);
            setStreamingText("");
            setStreamingReasoning("");
            setIsSaved(true);
            if (isRegen) toast.success("Answer regenerated.");
            else void loadSubmissions();
            return;
          }

          if (polled.generationStatus === "cancelled") {
            setStreamingText("");
            if (isRegen) {
              // Restore the old answer state by fetching fresh
              try {
                const res = await authenticatedFetch(
                  user,
                  `/api/answers/${answerId}`,
                );
                if (res.ok) {
                  const body = (await res.json()) as {
                    answer: SerializedAnswer;
                  };
                  setAnswer(body.answer);
                  setCurrentText(body.answer.currentText);
                  setIsSaved(true);
                }
              } catch {
                // ignore
              }
            }
            toast.info("Generation cancelled.");
            return;
          }

          if (polled.generationStatus === "error") {
            setStreamingText("");
            toast.error("Generation failed. Please try again.");
            return;
          }

          // Guard against stale generating state (lambda timed out, etc.)
          if (
            polled.generatingStartedAt &&
            Date.now() - new Date(polled.generatingStartedAt).getTime() >
              STALE_MS
          ) {
            setStreamingText("");
            toast.error(
              "Generation timed out. The server may still be working — refresh to check.",
            );
            return;
          }
        }
      } finally {
        if (pollingAnswerIdRef.current === answerId) {
          pollingAnswerIdRef.current = null;
        }
        setGenerating(false);
      }
    },
    [user, loadSubmissions],
  );

  // When the open answer is already generating (e.g. page reload with ?a=id),
  // resume the polling loop so the UI stays live.
  const answerGenerationStatus = answer?.generationStatus;
  const answerId2 = answer?.id;
  useEffect(() => {
    if (
      answerGenerationStatus === "generating" &&
      answerId2 &&
      pollingAnswerIdRef.current !== answerId2
    ) {
      setIsGenerating(true);
      void pollGeneration(answerId2, setIsGenerating, false);
    }
  }, [answerGenerationStatus, answerId2, pollGeneration]);

  async function cancelGeneration(answerId: string) {
    try {
      const res = await authenticatedFetch(
        user,
        `/api/answers/${answerId}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) {
        throw new Error(await readError(res));
      }
    } catch (error) {
      toast.error(describeActionError(error, "cancelling the generation"));
    }
  }

  async function generate(explicitQuestion?: string) {
    const trimmedQuestion = (explicitQuestion ?? question).trim();
    // Empty field + a hinted suggestion → run the hint (the placeholder is
    // what you get if you don't type). Routes through submitSuggestion so the
    // suggestion is marked used and the pool refills.
    if (!explicitQuestion && trimmedQuestion.length < 3) {
      const hint = !answer ? suggestions[0] : undefined;
      if (hint) {
        submitSuggestion(hint);
        return;
      }
      toast.error("Ask a slightly longer question.");
      return;
    }
    if (trimmedQuestion.length < 3) {
      toast.error("Ask a slightly longer question.");
      return;
    }
    // Reflect a one-tap suggestion in the box so the user sees what's running.
    if (explicitQuestion) setQuestion(explicitQuestion);

    setIsGenerating(true);
    setAnswer(null);
    setCurrentText("");
    setStreamingText("");
    setStreamingReasoning("");

    try {
      const response = await authenticatedFetch(user, "/api/answers", {
        method: "POST",
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as { answer: SerializedAnswer };
      const placeholder = body.answer;

      // Show the placeholder immediately so the submission list updates.
      setAnswer(placeholder);
      pushAnswerUrl(placeholder.id);
      void loadSubmissions();

      // Poll until the background job completes.
      void pollGeneration(placeholder.id, setIsGenerating, false);
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "starting the generation"));
      setIsGenerating(false);
    }
  }

  // Re-run the model for an existing submission in the background.
  // User passages are extracted server-side from the current segments.
  async function regenerate() {
    if (!answer) return;

    setIsRegenerating(true);
    setStreamingText("");
    setStreamingReasoning("");

    try {
      const response = await authenticatedFetch(
        user,
        `/api/answers/${answer.id}/regenerate`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as { answer: SerializedAnswer };
      setAnswer(body.answer);

      // Poll until the background job completes.
      void pollGeneration(answer.id, setIsRegenerating, true);
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "starting regeneration"));
      setIsRegenerating(false);
    }
  }

  // Persist a snapshot of the edited text. Quiet by design (autosave): no
  // success toast, and the editor's text is never reset from the response —
  // keystrokes typed while the request was in flight must survive.
  const saveText = useCallback(
    async (answerId: string, text: string) => {
      setIsSaving(true);
      try {
        const response = await authenticatedFetch(
          user,
          `/api/answers/${answerId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ currentText: text }),
          },
        );

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const body = (await response.json()) as {
          answer: SerializedAnswer;
        };
        setAnswer((previous) =>
          previous?.id === answerId ? body.answer : previous,
        );
        // Keep the loaded list fresh (backlinks/related derive from it)
        // without refetching.
        setSubmissions((previous) => {
          const next = previous.map((submission) =>
            submission.id === answerId ? body.answer : submission,
          );
          submissionsRef.current = next;
          return next;
        });
        // Only mark saved when no newer keystrokes arrived mid-flight.
        if (currentTextRef.current === text) {
          setIsSaved(true);
        }
      } catch (error) {
        console.error(error);
        toast.error(describeActionError(error, "saving your changes"));
      } finally {
        setIsSaving(false);
      }
    },
    [user],
  );

  // Save as the user types: debounce after the last change, skip while a
  // request is in flight (the isSaving flip re-arms this effect, catching
  // text typed mid-save), and stay out of programmatic text updates
  // (generate/regenerate set their text as already-saved).
  useEffect(() => {
    if (!answer || isSaved || isSaving || isGenerating || isRegenerating) {
      return;
    }
    const answerId = answer.id;
    const text = currentText;
    const timer = setTimeout(() => {
      void saveText(answerId, text);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    currentText,
    isSaved,
    isSaving,
    isGenerating,
    isRegenerating,
    answer,
    saveText,
  ]);

  return (
    <main className="min-h-screen bg-background">
      <header className="retro-raised sticky top-0 z-20 bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Image
            src="/robot-csv.png"
            alt="Brainshare robot"
            width={32}
            height={32}
            unoptimized
            priority
            className="size-8 shrink-0 [image-rendering:pixelated]"
          />
          <span className="truncate font-semibold tracking-tight">
            Brainshare
          </span>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="outline"
              size="sm"
              aria-label="Submissions"
              onClick={() => setSheetOpen(true)}
            >
              <LayersIcon />
              <span className="hidden sm:inline">Submissions</span>
              {submissions.length > 0 ? (
                <Badge variant="secondary" className="ml-0.5 px-1.5">
                  {submissions.length}
                </Badge>
              ) : null}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="New"
              onClick={startNew}
            >
              <PlusIcon />
              <span className="hidden sm:inline">New</span>
            </Button>
            <button
              type="button"
              aria-label="Drive settings"
              onClick={() => setDriveDialogOpen(true)}
              className="relative flex shrink-0 cursor-pointer rounded-full ring-offset-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Avatar size="sm">
                {user.photoURL ? (
                  <AvatarImage src={user.photoURL} alt={user.displayName ?? ""} />
                ) : null}
                <AvatarFallback>
                  {(user.displayName ?? user.email ?? "Z").slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              {driveStatus && driveStatus.status !== "notSetup" && (
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background",
                    driveStatus.status === "tokenInvalid" && "bg-red-500",
                    driveStatus.status === "syncing" && "bg-amber-500",
                    driveStatus.status === "synced" && "bg-green-500",
                  )}
                />
              )}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => signOut(getFirebaseAuth())}
            >
              <LogOutIcon />
            </Button>
          </div>
        </div>
      </header>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Submissions</SheetTitle>
            <SheetDescription>
              Open a saved answer or start a new one.
            </SheetDescription>
          </SheetHeader>
          {submissions.length > 0 ? (
            <div className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
              {submissions.map((submission) => (
                <div
                  key={submission.id}
                  className={`flex items-center gap-1 rounded-lg border pr-1 transition-colors hover:bg-muted/60 ${
                    answer?.id === submission.id
                      ? "border-primary bg-muted/40"
                      : "border-transparent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openSubmission(submission)}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      {submission.generationStatus === "generating" ? (
                        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : null}
                      <span className="line-clamp-2">{submission.question}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(submission.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  {submission.generationStatus === "generating" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Cancel generation"
                      onClick={(e) => {
                        e.stopPropagation();
                        void cancelGeneration(submission.id);
                      }}
                    >
                      <XCircleIcon />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete submission"
                      onClick={() => deleteSubmission(submission.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <p>No submissions yet.</p>
              <p>Ask a question to create your first one.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-3 py-8 sm:px-6 sm:py-12">
        <Card className="[--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)]">
          <CardContent className="space-y-3">
            <Label htmlFor="question">What truth do you seek?</Label>
            <div className="relative">
              <Textarea
                id="question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onFocus={() => setQuestionFocused(true)}
                // Delay so a click on a suggestion lands before it unmounts.
                onBlur={() => setTimeout(() => setQuestionFocused(false), 120)}
                placeholder={
                  !answer && suggestions[0]
                    ? suggestions[0].text
                    : "For example: Does the universe have meaning, or do we give it one?"
                }
                className="min-h-28 resize-y pr-10 text-base"
                disabled={isGenerating}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuestionFocused(false);
                    return;
                  }
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    void generate();
                  }
                }}
              />
              {question && !isGenerating ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear question"
                  className="absolute top-2 right-2 size-7"
                  // Keep focus in the textarea so the suggestions don't blink.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuestion("");
                    document.getElementById("question")?.focus();
                  }}
                >
                  <XIcon />
                </Button>
              ) : !answer && !isGenerating && suggestions[0] ? (
                // The empty-field hint is a real suggestion: shuffle to a
                // different one. (Submitting it = Generate on the empty field.)
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Show a different suggestion"
                  title="Show a different suggestion"
                  className="absolute top-2 right-2 size-7 text-muted-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => dismissSuggestion(suggestions[0].id)}
                >
                  <RefreshCwIcon />
                </Button>
              ) : null}
              {showRelated ? (
                // In normal flow (not an overlay) so the suggestions push the
                // "Generate answer" row down instead of covering it.
                <div className="retro-raised mt-1 max-h-64 overflow-y-auto bg-popover py-1">
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">
                    Related questions
                  </p>
                  {displayedRelated.map((related) => (
                    <button
                      key={related.id}
                      type="button"
                      // Keep focus on the textarea so onBlur doesn't fire first.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const match = submissions.find(
                          (submission) => submission.id === related.id,
                        );
                        if (match) {
                          // Show the entry below but keep the typed draft —
                          // the user's text must never vanish on a click.
                          openSubmission(match, { keepQuestion: true });
                        }
                        setQuestionFocused(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="line-clamp-1">{related.question}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                size="lg"
                onClick={() => void generate()}
                disabled={isGenerating}
              >
                <SendIcon />
                {isGenerating ? "Generating" : "Generate answer"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {answer ? (
          <div className="space-y-6">
            <Card className="[--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)]">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Answer</CardTitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {answer.provider} / {answer.model}
                    </Badge>
                    {isGenerating || isRegenerating ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void cancelGeneration(answer.id)}
                      >
                        <XCircleIcon />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={regenerate}
                        disabled={isGenerating || isRegenerating}
                      >
                        <RefreshCwIcon />
                        Regenerate
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openHistory}
                      disabled={isGenerating || isRegenerating}
                    >
                      <HistoryIcon />
                      History
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* One persistent, collapsed Thinking indicator holding the
                    single spinner — same component in-progress / done / loaded. */}
                <ThinkingPanel
                  reasoning={isGenerating || isRegenerating
                    ? streamingReasoning
                    : answer.reasoning ?? ""}
                  active={isGenerating || isRegenerating}
                />
                {isGenerating || isRegenerating ? (
                  <div className="retro-sunken literary-prose min-h-72 p-4 sm:p-5">
                    {streamingText ? (
                      <Streamdown>{streamingText}</Streamdown>
                    ) : (
                      <p className="text-muted-foreground">
                        Your answer will appear here as it’s written. This keeps
                        running in the background — you can leave this page and
                        come back.
                      </p>
                    )}
                  </div>
                ) : (
                  <LiveMarkdownEditor
                    value={currentText}
                    aiText={answer.aiText}
                    crosslinks={crosslinkRanges}
                    onChange={(next) => {
                      setCurrentText(next);
                      setIsSaved(false);
                    }}
                    onOpenCrosslink={(id) => {
                      const match = submissions.find(
                        (submission) => submission.id === id,
                      );
                      if (match) {
                        openSubmission(match);
                      }
                    }}
                  />
                )}
                {linkChips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <LinkIcon className="size-3" />
                      Links:
                    </span>
                    {linkChips.map((chip) => {
                      const target = submissions.find(
                        (submission) => submission.id === chip.targetId,
                      );
                      const label = target?.question ?? chip.target;
                      return (
                        <button
                          key={chip.targetId}
                          type="button"
                          title={`“${chip.target}” → ${label}`}
                          onClick={() => {
                            if (target) openSubmission(target);
                          }}
                          className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {backlinks.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CornerUpLeftIcon className="size-3" />
                      Mentioned in:
                    </span>
                    {backlinks.map((backlink) => (
                      <button
                        key={backlink.id}
                        type="button"
                        onClick={() => {
                          const match = submissions.find(
                            (submission) => submission.id === backlink.id,
                          );
                          if (match) {
                            openSubmission(match);
                          }
                        }}
                        className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {backlink.question}
                      </button>
                    ))}
                  </div>
                ) : null}
                {answerRelated.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <SearchIcon className="size-3" />
                      Related:
                    </span>
                    {answerRelated.map((related) => (
                      <button
                        key={related.id}
                        type="button"
                        onClick={() => {
                          const match = submissions.find(
                            (submission) => submission.id === related.id,
                          );
                          if (match) {
                            openSubmission(match);
                          }
                        }}
                        className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {related.question}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">AI: {counts.ai} chars</Badge>
                    <Badge className="bg-sky-500/12 text-sky-700 dark:text-sky-300">
                      You: {counts.user} chars
                    </Badge>
                    <span>{userPercent}% edited</span>
                    <span className="flex items-center gap-1">
                      {isSaving ? (
                        "Saving"
                      ) : isSaved ? (
                        <>
                          <CheckIcon className="size-3.5" />
                          Saved
                        </>
                      ) : (
                        "Unsaved"
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saves as you type — highlights are yours; tap or
                    ⌘/Ctrl-click a [[link]] to open its entry, or to start
                    one if it’s missing.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Dialog
              open={historyOpen}
              onOpenChange={(open) => {
                setHistoryOpen(open);
                if (!open) {
                  setPreviewIndex(null);
                }
              }}
            >
              <DialogContent className="max-w-3xl sm:h-[80dvh]">
                <DialogHeader>
                  <DialogTitle>Version history</DialogTitle>
                  <DialogDescription>
                    Preview any saved version, then restore it. Restoring swaps
                    it in and keeps your current text as a new version, so it
                    stays reversible.
                  </DialogDescription>
                </DialogHeader>
                {versions === null ? (
                  <p className="text-sm text-muted-foreground">
                    Loading versions…
                  </p>
                ) : versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No earlier versions yet — they appear after edits,
                    regenerations, and restores.
                  </p>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
                    <ul className="retro-sunken flex max-h-36 shrink-0 flex-col overflow-y-auto p-1 sm:max-h-none sm:w-56">
                      {[...versions].reverse().map((version) => {
                        const active = version.index === previewIndex;
                        return (
                          <li key={version.index}>
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(version.index)}
                              aria-current={active}
                              className={cn(
                                "w-full px-2 py-1.5 text-left",
                                active
                                  ? "bg-primary/15 text-foreground"
                                  : "text-muted-foreground hover:bg-foreground/5",
                              )}
                            >
                              <span className="block text-sm font-medium">
                                {VERSION_KIND_LABELS[version.kind]}
                              </span>
                              <span className="block text-xs opacity-80">
                                {new Date(
                                  version.capturedAt,
                                ).toLocaleString()}
                              </span>
                              <span className="mt-0.5 block truncate text-xs opacity-70">
                                {version.currentText}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="retro-sunken literary-prose min-h-0 flex-1 overflow-y-auto p-4">
                      {previewVersion ? (
                        <Streamdown>{previewVersion.currentText}</Streamdown>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Select a version to preview it.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={isRestoring || previewVersion === null}
                    onClick={() => {
                      if (previewVersion) {
                        void restoreVersion(previewVersion.index);
                      }
                    }}
                  >
                    {isRestoring ? "Restoring" : "Restore this version"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Separator />
            <p className="text-center text-xs text-muted-foreground">
              Generated {new Date(answer.createdAt).toLocaleString()} · Last
              saved {new Date(answer.updatedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
      </div>

      <Dialog open={driveDialogOpen} onOpenChange={setDriveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudIcon className="size-4" />
              Google Drive Export
            </DialogTitle>
            <DialogDescription>
              Auto-export all your Q&amp;A to a single markdown file in your
              Google Drive. It stays in sync whenever you save.
            </DialogDescription>
          </DialogHeader>
          {!driveStatus || driveStatus.status === "notSetup" ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to enable automatic backups.
              </p>
              <Button onClick={connectDrive} disabled={isConnectingDrive}>
                {isConnectingDrive ? "Redirecting…" : "Connect Google Drive"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "size-3 rounded-full shrink-0",
                    driveStatus.status === "tokenInvalid" && "bg-red-500",
                    driveStatus.status === "syncing" && "bg-amber-500",
                    driveStatus.status === "synced" && "bg-green-500",
                  )}
                />
                <div>
                  <p className="text-sm font-medium">
                    {driveStatus.status === "tokenInvalid" &&
                      "Drive token expired — reconnect to resume syncing"}
                    {driveStatus.status === "syncing" && "Syncing…"}
                    {driveStatus.status === "synced" && "Up to date"}
                  </p>
                  {driveStatus.lastSyncAt && (
                    <p className="text-xs text-muted-foreground">
                      Last synced{" "}
                      {new Date(driveStatus.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              {driveStatus.status === "tokenInvalid" && (
                <Button onClick={connectDrive} disabled={isConnectingDrive}>
                  {isConnectingDrive ? "Redirecting…" : "Reconnect Drive"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleDisconnectDrive}
                disabled={isDisconnectingDrive}
              >
                {isDisconnectingDrive ? "Disconnecting…" : "Disconnect Drive"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
