"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { signOut, type User } from "firebase/auth";
import {
  CheckIcon,
  LayersIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

import { HighlightedEditor } from "@/components/highlighted-editor";
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
import { resolveCrosslinks } from "@/lib/crosslinks";
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

export function AnswerWorkspace({ user }: { user: User }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<SerializedAnswer | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const [submissions, setSubmissions] = useState<SerializedAnswer[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Mirror submissions for the popstate handler, which reads the latest list
  // without re-subscribing on every change.
  const submissionsRef = useRef<SerializedAnswer[]>([]);

  const segments = useMemo(
    () => (answer ? attributeText(answer.aiText, currentText) : []),
    [answer, currentText],
  );
  // Resolve [[Topic]] wiki-links against other submissions for the rendered
  // view only; the editor keeps the raw text so edits stay authorable.
  const renderedText = useMemo(
    () => resolveCrosslinks(currentText, submissions, { excludeId: answer?.id }),
    [currentText, submissions, answer?.id],
  );
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
  const selectSubmission = useCallback((submission: SerializedAnswer | null) => {
    setAnswer(submission);
    setCurrentText(submission?.currentText ?? "");
    setQuestion(submission?.question ?? "");
    setStreamingText("");
    setIsSaved(true);
  }, []);

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

  function openSubmission(submission: SerializedAnswer) {
    selectSubmission(submission);
    pushAnswerUrl(submission.id);
    setSheetOpen(false);
  }

  function startNew() {
    selectSubmission(null);
    pushAnswerUrl(null);
    setSheetOpen(false);
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
      toast.error(error instanceof Error ? error.message : "Delete failed.");
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      completeText += decoder.decode(value, { stream: true });
      setStreamingText(completeText);
    }

    completeText += decoder.decode();
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
      toast.error(
        error instanceof Error ? error.message : "Generation failed.",
      );
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
      toast.error(
        error instanceof Error ? error.message : "Regeneration failed.",
      );
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
      toast.error(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="retro-raised sticky top-0 z-20 bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-6">
          <Image
            src="/robot-csv.png"
            alt="Brainshare robot"
            width={32}
            height={32}
            unoptimized
            priority
            className="size-8 [image-rendering:pixelated]"
          />
          <span className="font-semibold tracking-tight">Brainshare</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSheetOpen(true)}
            >
              <LayersIcon />
              Submissions
              {submissions.length > 0 ? (
                <Badge variant="secondary" className="ml-0.5 px-1.5">
                  {submissions.length}
                </Badge>
              ) : null}
            </Button>
            <Button variant="outline" size="sm" onClick={startNew}>
              <PlusIcon />
              New
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
            <Label htmlFor="question">What do you want to know?</Label>
            <Textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="For example: What makes a strong product strategy?"
              className="min-h-28 resize-y text-base"
              disabled={isGenerating}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
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
                  {isRegenerating ? "Regenerating" : "Writing"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="retro-sunken min-h-40 p-5">
                <Streamdown isAnimating>{streamingText}</Streamdown>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {answer ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Rendered answer</CardTitle>
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
              <CardContent>
                <div className="retro-sunken min-h-32 p-5">
                  <Streamdown mode="static">{renderedText}</Streamdown>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Edit answer</CardTitle>
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
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <HighlightedEditor
                  value={currentText}
                  segments={segments}
                  onChange={(next) => {
                    setCurrentText(next);
                    setIsSaved(false);
                  }}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Highlighted text is yours; the rest is the AI baseline.
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
