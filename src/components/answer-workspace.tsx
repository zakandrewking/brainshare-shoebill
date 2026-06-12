"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { signOut, type User } from "firebase/auth";
import {
  CheckIcon,
  LayersIcon,
  LinkIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

import { LiveMarkdownEditor } from "@/components/live-markdown-editor";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { attributeText, attributionCounts } from "@/lib/attribution";
import {
  findCrosslinkRanges,
  normalizeTopic,
  suggestQuestionForTopic,
} from "@/lib/crosslinks";
import { findRelatedQuestions } from "@/lib/related";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { SerializedAnswer } from "@/lib/types";

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
  // The model's live reasoning summary ("thinking"). Ephemeral — shown only
  // while generating and never persisted.
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  // Submissions semantically related to the open answer, shown as links so
  // entries cross-link even when the text carries no [[topic]] tokens.
  const [answerRelated, setAnswerRelated] = useState<
    { id: string; question: string }[]
  >([]);
  const [submissions, setSubmissions] = useState<SerializedAnswer[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [questionFocused, setQuestionFocused] = useState(false);
  // Mirror submissions for the popstate handler, which reads the latest list
  // without re-subscribing on every change.
  const submissionsRef = useRef<SerializedAnswer[]>([]);

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

  // Raw [[topic]] ranges, recomputed per keystroke (pure, client-side) so the
  // editor can show a link resolving the moment it matches a submission.
  // Lexical matches are instant; semantic ones light up when the lookup lands.
  const crosslinkRanges = useMemo(() => {
    // Never let a cached semantic match link an answer to itself.
    const semantic = Object.fromEntries(
      Object.entries(semanticLinks).filter(([, id]) => id !== answer?.id),
    );
    return findCrosslinkRanges(currentText, submissions, {
      excludeId: answer?.id,
      semantic,
    });
  }, [currentText, submissions, answer?.id, semanticLinks]);

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
      // Reasoning belongs to a generation event; it survives completion
      // (shown collapsed on the answer) but not switching submissions.
      setStreamingReasoning("");
      setAnswerRelated([]);
      setIsSaved(true);
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

  // A [[topic]] without an entry becomes the seed of one: open a fresh
  // workspace with a suggested question and focus the ask box, so the
  // related-questions dropdown immediately offers near-matches.
  function startQuestionForTopic(topic: string) {
    startNew();
    setQuestion(suggestQuestionForTopic(topic));
    requestAnimationFrame(() => {
      document.getElementById("question")?.focus();
    });
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

  // Stream a fresh answer for the question, updating the live preview as text
  // arrives. Returns the completed text plus the model that produced it.
  async function streamGeneration(trimmedQuestion: string) {
    const response = await authenticatedFetch(user, "/api/generate", {
      method: "POST",
      body: JSON.stringify({ question: trimmedQuestion }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readError(response));
    }

    const provider = response.headers.get("x-ai-provider") ?? "openai";
    const model = response.headers.get("x-ai-model") ?? "gpt-5.5";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let completeText = "";
    let reasoningText = "";

    // The body is newline-delimited JSON; each line is a reasoning/text/error
    // event (see ANSWER_STREAM_CONTENT_TYPE in lib/ai.ts).
    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: { t?: string; v?: string };
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (event.t === "text" && event.v) {
        completeText += event.v;
        setStreamingText(completeText);
      } else if (event.t === "reasoning" && event.v) {
        reasoningText += event.v;
        setStreamingReasoning(reasoningText);
      } else if (event.t === "error") {
        console.error("Answer stream reported an error:", event.v);
      }
    };

    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (possibly partial) line in the buffer.
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
    } catch (streamError) {
      // The stream can abort at finalization even after the full answer has been
      // delivered. Don't throw away the answer the user just watched stream in —
      // keep it and let the save proceed. Only fail if no text arrived at all.
      console.error("Answer stream ended with an error:", streamError);
      if (completeText.trim().length === 0) {
        throw new Error(
          "The answer stream failed before any text arrived. Please try again.",
        );
      }
    }

    buffer += decoder.decode();
    handleLine(buffer);
    return { completeText, provider, model };
  }

  async function generate() {
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length < 3) {
      toast.error("Ask a slightly longer question.");
      return;
    }

    setIsGenerating(true);
    setAnswer(null);
    setCurrentText("");
    setStreamingText("");
    setStreamingReasoning("");

    try {
      const { completeText, provider, model } =
        await streamGeneration(trimmedQuestion);

      const saveResponse = await authenticatedFetch(user, "/api/answers", {
        method: "POST",
        body: JSON.stringify({
          question: trimmedQuestion,
          aiText: completeText,
          provider,
          model,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error(await readError(saveResponse));
      }

      const body = (await saveResponse.json()) as {
        answer: SerializedAnswer;
      };
      setAnswer(body.answer);
      setCurrentText(body.answer.currentText);
      setStreamingText("");
      setIsSaved(true);
      pushAnswerUrl(body.answer.id);
      void loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "generating the answer"));
    } finally {
      setIsGenerating(false);
    }
  }

  // Re-run the model for an existing submission and overwrite it in place:
  // same id, fresh AI baseline, edits reset back to that baseline.
  async function regenerate() {
    if (!answer) return;

    setIsRegenerating(true);
    setStreamingText("");
    setStreamingReasoning("");

    try {
      const { completeText, provider, model } = await streamGeneration(
        answer.question,
      );

      const response = await authenticatedFetch(
        user,
        `/api/answers/${answer.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            aiText: completeText,
            provider,
            model,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as {
        answer: SerializedAnswer;
      };
      setAnswer(body.answer);
      setCurrentText(body.answer.currentText);
      setStreamingText("");
      setIsSaved(true);
      toast.success("Answer regenerated.");
      void loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "regenerating the answer"));
    } finally {
      setIsRegenerating(false);
    }
  }

  async function save() {
    if (!answer) return;
    setIsSaving(true);

    try {
      const response = await authenticatedFetch(
        user,
        `/api/answers/${answer.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ currentText }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as {
        answer: SerializedAnswer;
      };
      setAnswer(body.answer);
      setCurrentText(body.answer.currentText);
      setIsSaved(true);
      toast.success("Answer saved.");
      void loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(describeActionError(error, "saving your changes"));
    } finally {
      setIsSaving(false);
    }
  }

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
            <Avatar size="sm">
              {user.photoURL ? (
                <AvatarImage src={user.photoURL} alt={user.displayName ?? ""} />
              ) : null}
              <AvatarFallback>
                {(user.displayName ?? user.email ?? "Z").slice(0, 1)}
              </AvatarFallback>
            </Avatar>
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
                    <span className="line-clamp-2 w-full text-sm font-medium">
                      {submission.question}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(submission.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete submission"
                    onClick={() => deleteSubmission(submission.id)}
                  >
                    <Trash2Icon />
                  </Button>
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

      <div className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-6 sm:py-12">
        <Card>
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
                placeholder="For example: Does the universe have meaning, or do we give it one?"
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
                onClick={generate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <SendIcon />
                )}
                {isGenerating ? "Generating..." : "Generate answer"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {isGenerating || isRegenerating ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <LoaderCircleIcon className="size-4 animate-spin" />
                <CardTitle>
                  {streamingText
                    ? isRegenerating
                      ? "Regenerating"
                      : "Writing"
                    : "Thinking…"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {streamingReasoning ? (
                <details className="retro-sunken p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    Thinking
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    {streamingReasoning}
                  </div>
                </details>
              ) : null}
              {streamingText ? (
                <div className="retro-sunken literary-prose min-h-40 p-5">
                  <Streamdown
                    isAnimating
                    animated={{
                      animation: "fadeIn",
                      sep: "word",
                      duration: 450,
                    }}
                  >
                    {streamingText}
                  </Streamdown>
                </div>
              ) : (
                <div className="retro-sunken flex min-h-40 items-center justify-center p-5 text-sm text-muted-foreground">
                  {streamingReasoning ? "Forming an answer…" : "Thinking…"}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {answer ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Answer</CardTitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {answer.provider} / {answer.model}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={regenerate}
                      disabled={isGenerating || isRegenerating}
                    >
                      {isRegenerating ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : (
                        <RefreshCwIcon />
                      )}
                      {isRegenerating ? "Regenerating..." : "Regenerate"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {streamingReasoning && !isGenerating && !isRegenerating ? (
                  <details className="retro-sunken p-3 text-sm">
                    <summary className="cursor-pointer font-medium text-muted-foreground">
                      Thinking
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {streamingReasoning}
                    </div>
                  </details>
                ) : null}
                <LiveMarkdownEditor
                  value={currentText}
                  segments={segments}
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
                  onCreateCrosslink={startQuestionForTopic}
                />
                {answerRelated.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <LinkIcon className="size-3" />
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
                      {isSaved ? (
                        <>
                          <CheckIcon className="size-3.5" />
                          Saved
                        </>
                      ) : (
                        "Unsaved"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground">
                      Edit freely — highlights are yours; ⌘/Ctrl-click a
                      [[link]] to open its entry, or to start one if it’s
                      missing.
                    </p>
                    <Button
                      variant="secondary"
                      onClick={save}
                      disabled={isSaved || isSaving}
                    >
                      {isSaving ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : (
                        <SaveIcon />
                      )}
                      {isSaving ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Separator />
            <p className="text-center text-xs text-muted-foreground">
              Generated {new Date(answer.createdAt).toLocaleString()} · Last
              saved {new Date(answer.updatedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
