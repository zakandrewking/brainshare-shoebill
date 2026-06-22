// Background AI generation: called from after() so it runs after the HTTP
// response is sent and completes even if the client closes the page.

import {
  anthropic,
  type AnthropicProviderOptions,
} from "@ai-sdk/anthropic";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { streamText } from "ai";

import { attributeText } from "@/lib/attribution";
import {
  applyRelink,
  completeAnswerGeneration,
  completeAnswerRegeneration,
  failAnswerGeneration,
  getAnswer,
  getAnswerGenerationStatus,
  listRelatedCandidates,
  setGeneratingProgress,
} from "@/lib/answers";
import {
  embeddingInput,
  embedQuestions,
  getEmbeddingConfig,
} from "@/lib/embedding";
import {
  buildRelinkPrompt,
  countLinks,
  DEFAULT_RELINK_CONFIG,
  sanitizeLinks,
  selectRelinkCandidates,
  type RankedCandidate,
  type RelinkCandidate,
} from "@/lib/ideas";
import { placeholderizeUserSegments } from "@/lib/reinject";
import { embedWithCandidates } from "@/lib/semantic";
import {
  SECTION_DELIMITER,
  assembleAnswer,
  editedIndices,
  nonEditedIndices,
  paragraphUserPassages,
  parseSections,
  planParagraphs,
  weaveUserText,
} from "@/lib/paragraph-regen";

const systemPrompt =
  "You are a contemplative companion in the search for truth about the universe and our place in it. Treat every question as an invitation to philosophical inquiry — into existence, meaning, consciousness, nature, ethics, time, and the cosmos — and follow it toward what is true rather than merely what is comforting or conventional. Answer in clear, self-contained prose that is accurate, honest, and genuinely illuminating: reason from first principles, weigh competing views fairly, and acknowledge uncertainty and mystery where intellectual honesty demands it. Usually a single substantial paragraph is right; use a few paragraphs only when the question genuinely has distinct facets worth separating. Do not use headings, and do not use bullet points in the body of the answer. If a question is ambiguous or its intent is unclear, interpret it in its deepest philosophical sense and explore it in thorough, thoughtful detail. Write in plain prose: do not add wiki-style [[double-bracket]] links or any other markup for concepts — cross-references between entries are added automatically afterward. Cite academia-style: support specific claims inline with parenthetical author–year citations like (Nagel 1974) at the point where they bear on the argument, then end with a line reading exactly 'References:' followed by a compact bulleted list of the cited sources — two to four real, verifiable works, primary thinkers first, each as author, *title* (year). Every inline citation must appear in the references list and every listed reference must be cited inline at least once; never invent or embellish a citation, and if a claim rests on your own reasoning rather than a source, say so in the body instead of citing.";

// For the revision passes the structure is dictated by the per-call instruction
// (which blocks to output, delimiters), so this keeps only the voice + style.
const reviserSystemPrompt =
  "You are revising parts of an existing philosophical answer. Keep the same contemplative, truth-seeking voice and plain prose (no headings, no bullet points), and keep academia-style parenthetical citations where claims need them. Follow the user's instructions exactly about which blocks to output and how to delimit them.";

// Idea-relink pass: the model weaves cross-links into an existing entry based on
// shared IDEAS (not shared words). Keeps the entry's voice and meaning; only adds
// links and the minimal rephrasing needed for them to read naturally.
const relinkSystemPrompt =
  "You are an editor weaving idea-based cross-links into an existing encyclopedia-style entry. Preserve the entry's meaning, contemplative voice, plain prose (no headings, no bullet points), academia-style citations, and its 'References:' section. Add a wiki-link only where the entry genuinely engages an idea, claim, or question that another given entry is fundamentally about — a shared word or surface topic is never enough. You may lightly rephrase a sentence so a link reads naturally, but do not otherwise rewrite the entry, and never invent facts or citations. Output only the full entry text.";

function buildPrompt(question: string, userPassages?: string[]): string {
  if (!userPassages || userPassages.length === 0) return question;
  const list = userPassages
    .map((passage, index) => `{{${index + 1}}}: ${passage}`)
    .join("\n");
  return `${question}

The author of this entry has woven passages of their own into the previous answer. Write a fresh answer to the question above that is built AROUND those passages: each one is a fixed island that will appear verbatim, so compose your prose to lead into it and to continue from it — the sentence before should set it up and the text after should pick up its thread, never leaving it stranded as an aside. At the single point where each passage belongs, output only its placeholder token (for example {{1}}) — never quote, echo, rewrite, or paraphrase the passage text itself; the placeholder is replaced with the author's exact words later. Use every placeholder exactly once, in whatever order serves the argument, and output no placeholder tokens other than those listed.

Author passages:
${list}`;
}

function buildMockText(question: string, userPassages?: string[]): string {
  const markers = (userPassages ?? [])
    .map((_, index) => `{{${index + 1}}}`)
    .join(" ");
  return `This is a local development answer to "${question}" (Mock Author 2026).${markers ? ` ${markers}` : ""} It is generated deterministically by the mock provider so authentication, persistence, editing, streaming, and authorship attribution can be tested without spending AI tokens (Another Mock 2025); configure AI_PROVIDER and AI_MODEL to use a production model.\n\nReferences:\n- Mock Author, *A Deterministic Treatise on Local Development* (2026)\n- Another Mock, *Streaming Without Spending* (2025)`;
}

function getConfig() {
  return {
    provider: process.env.AI_PROVIDER ?? "openai",
    model: process.env.AI_MODEL ?? "gpt-5.5",
  };
}

// One model completion. Streams text + reasoning, invoking `onProgress` with the
// running totals so the caller can persist partial progress. Honors the abort
// signal. For the mock provider it deterministically "streams" `mockText`.
async function streamModel({
  system,
  prompt,
  signal,
  onProgress,
  mockText,
  effort,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  onProgress: (text: string, reasoning: string) => Promise<void>;
  mockText: string;
  /** Override the OpenAI reasoning effort (e.g. "low" for editing passes). */
  effort?: string;
}): Promise<{ text: string; reasoning: string }> {
  const { provider, model } = getConfig();
  let text = "";
  let reasoning = "";

  if (provider === "mock") {
    const mockReasoning =
      "Considering the question, weighing interpretations, and framing a clear answer.";
    for (const chunk of mockReasoning.match(/.{1,18}(?:\s|$)/g) ?? []) {
      if (signal.aborted) break;
      reasoning += chunk;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await onProgress(text, reasoning);
    }
    for (const chunk of mockText.match(/.{1,16}(?:\s|$)/g) ?? [mockText]) {
      if (signal.aborted) break;
      text += chunk;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await onProgress(text, reasoning);
    }
    return { text, reasoning };
  }

  const languageModel =
    provider === "openai"
      ? openai(model)
      : provider === "anthropic"
        ? anthropic(model)
        : null;
  if (!languageModel) throw new Error(`Unsupported AI_PROVIDER: ${provider}`);

  const result = streamText({
    model: languageModel,
    system,
    prompt,
    abortSignal: signal,
    onError: ({ error }) => console.error("[streamModel] stream error:", error),
    providerOptions:
      provider === "openai"
        ? ({
            openai: {
              reasoningEffort:
                effort ?? process.env.OPENAI_REASONING_EFFORT ?? "high",
              reasoningSummary: "auto",
              store: false,
            },
          } satisfies { openai: OpenAILanguageModelResponsesOptions })
        : provider === "anthropic"
          ? ({
              anthropic: {
                thinking: { type: "enabled", budgetTokens: 10000 },
              },
            } satisfies { anthropic: AnthropicProviderOptions })
          : undefined,
  });

  for await (const part of result.fullStream) {
    if (signal.aborted) break;
    if (part.type === "text-delta" && part.text) {
      text += part.text;
      await onProgress(text, reasoning);
    } else if (part.type === "reasoning-delta" && part.text) {
      reasoning += part.text;
      await onProgress(text, reasoning);
    }
  }
  return { text, reasoning };
}

// A small per-job scaffold: throttled progress persistence + a cancellation
// watcher that aborts the model stream when the answer is cancelled in the DB.
// Reasoning accumulation across passes is handled by callers.
function createJob(answerId: string, userId: string) {
  const controller = new AbortController();
  let lastDbUpdate = 0;
  let latest = { text: "", reasoning: "" };

  const flush = async (force = false) => {
    const now = Date.now();
    if (force || now - lastDbUpdate >= 2000) {
      lastDbUpdate = now;
      await setGeneratingProgress(
        answerId,
        userId,
        latest.text,
        latest.reasoning,
      ).catch(console.error);
    }
  };

  const cancelInterval = setInterval(async () => {
    try {
      if ((await getAnswerGenerationStatus(answerId, userId)) === "cancelled") {
        clearInterval(cancelInterval);
        controller.abort();
      }
    } catch {
      // ignore transient DB errors
    }
  }, 3000);

  return {
    signal: controller.signal,
    onProgress: async (text: string, reasoning: string) => {
      latest = { text, reasoning };
      await flush();
    },
    flushNow: () => flush(true),
    stop: () => clearInterval(cancelInterval),
  };
}

/** Generate a brand-new answer in the background, persisting progress. */
export async function runBackgroundGeneration({
  answerId,
  userId,
  question,
}: {
  answerId: string;
  userId: string;
  question: string;
}): Promise<void> {
  const { provider, model } = getConfig();
  const job = createJob(answerId, userId);
  try {
    const { text, reasoning } = await streamModel({
      system: systemPrompt,
      prompt: question,
      signal: job.signal,
      onProgress: job.onProgress,
      mockText: buildMockText(question),
    });

    if (job.signal.aborted) return;
    if (!text.trim()) {
      await failAnswerGeneration(answerId, userId);
      return;
    }
    await job.flushNow();

    // Weave idea-based cross-links into the prose before persisting, so the
    // stored baseline ships with its links. A brand-new answer has no user
    // edits yet, so aiText === currentText here.
    const relinked = await relinkForGeneration({
      userId,
      answerId,
      question,
      aiText: text,
      currentText: text,
      signal: job.signal,
    });
    if (job.signal.aborted) return;
    const finalText = relinked.aiText;

    let questionEmbedding: number[] | null = null;
    let embeddingModel: string | null = null;
    try {
      const embeddings = await embedQuestions([
        embeddingInput(question, finalText),
      ]);
      if (embeddings) {
        questionEmbedding = embeddings[0];
        embeddingModel = getEmbeddingConfig().model;
      }
    } catch (error) {
      console.error("[runBackgroundGeneration] embedding failed:", error);
    }

    await completeAnswerGeneration(
      answerId,
      userId,
      finalText,
      reasoning,
      provider,
      model,
      questionEmbedding,
      embeddingModel,
    );
  } catch (error) {
    console.error("[runBackgroundGeneration] error:", error);
    if (!job.signal.aborted) await failAnswerGeneration(answerId, userId);
  } finally {
    job.stop();
  }
}

function buildPass1Prompt(
  question: string,
  blocks: { text: string; edited: boolean }[],
): string {
  let slot = 0;
  const rendered = blocks
    .map((block) => {
      if (block.edited) {
        return `[KEEP — the author's own text; use as fixed context, do NOT output it]\n${block.text}`;
      }
      slot += 1;
      return `[REWRITE ${slot}]\n${block.text}`;
    })
    .join("\n\n");

  return `You are revising the answer to this question: "${question}".

The current answer is shown below as blocks. Blocks marked [KEEP] are the author's own writing — treat them as fixed context your prose must flow with, but do NOT output them. Blocks marked [REWRITE n] should be rewritten as fresh, higher-quality prose that fits the KEEP blocks and the overall argument.

Output ONLY the rewritten blocks, in ascending n order, separated by a line containing exactly:
${SECTION_DELIMITER}

Do not output the KEEP blocks, the [REWRITE n] labels, or any commentary — only the rewritten prose with the delimiter between blocks.

Current answer:
${rendered}`;
}

function buildPass2Prompt(
  question: string,
  draft: string,
  editedBlocks: { passages: string[] }[],
): string {
  const rendered = editedBlocks
    .map((block, index) => {
      const list = block.passages
        .map((passage, i) => `{{${i + 1}}}: ${passage}`)
        .join("\n");
      return `Paragraph ${index + 1} (uses placeholders ${block.passages
        .map((_, i) => `{{${i + 1}}}`)
        .join(", ")}):\n${list}`;
    })
    .join("\n\n");

  return `You are polishing the answer to this question: "${question}".

Here is the current full draft for context:
"""
${draft}
"""

Below are the paragraphs that contain the author's own passages. Rewrite EACH paragraph so it reads well and connects with the draft above, while keeping the author's passages exactly. At each spot where one of a paragraph's passages belongs, output only its placeholder token (for example {{1}}) — never the passage text itself. Within each paragraph use that paragraph's placeholders, each exactly once.

Output ONLY the rewritten paragraphs, in order, separated by a line containing exactly:
${SECTION_DELIMITER}

${rendered}`;
}

/**
 * Regenerate an existing answer in the background. Two passes when the answer
 * has both user-edited and unedited paragraphs (pass 1 rewrites the unedited
 * ones around the retained edits; pass 2 reworks the edited paragraphs around
 * the author's exact words). Falls back to a single whole-answer regenerate for
 * the simple cases, and on ANY anomaly (empty output, section-count mismatch),
 * so regeneration can only improve on — never break.
 */
export async function runBackgroundRegeneration({
  answerId,
  userId,
  question,
  aiText,
  currentText,
}: {
  answerId: string;
  userId: string;
  question: string;
  aiText: string;
  currentText: string;
}): Promise<void> {
  const { provider, model } = getConfig();
  const job = createJob(answerId, userId);

  // Reasoning from completed passes; `onProgress` shows banked + current pass.
  let banked = "";
  let cumulativeReasoning = "";
  const onProgress = async (text: string, reasoning: string) => {
    cumulativeReasoning = banked + reasoning;
    await job.onProgress(text, cumulativeReasoning);
  };

  // Single whole-answer regenerate (used for the simple cases and as fallback).
  const singlePass = async (passages: string[]) => {
    const { text } = await streamModel({
      system: systemPrompt,
      prompt: buildPrompt(question, passages),
      signal: job.signal,
      onProgress,
      mockText: buildMockText(question, passages),
    });
    if (job.signal.aborted) return null;
    if (!text.trim()) return null;
    return passages.length > 0
      ? weaveUserText(text, passages)
      : { aiText: text, currentText: text };
  };

  try {
    const plan = planParagraphs(aiText, currentText);
    const edited = editedIndices(plan);
    const nonEdited = nonEditedIndices(plan);

    let final: { aiText: string; currentText: string } | null = null;

    if (edited.length === 0) {
      // No user edits: plain fresh regenerate.
      final = await singlePass([]);
    } else if (nonEdited.length === 0) {
      // Everything edited: whole-answer weave (legacy single-pass behavior).
      final = await singlePass(plan.flatMap(paragraphUserPassages));
    } else {
      // Two-pass.
      const rewrites = new Map<number, string>();
      const wovenEdited = new Map<
        number,
        { aiText: string; currentText: string }
      >();

      // Pass 1: rewrite the unedited blocks.
      const p1 = await streamModel({
        system: reviserSystemPrompt,
        prompt: buildPass1Prompt(question, plan),
        signal: job.signal,
        onProgress,
        mockText: nonEdited
          .map((_, i) => `Freshly rewritten block ${i + 1} (Mock 2026).`)
          .join(`\n${SECTION_DELIMITER}\n`),
      });
      banked += p1.reasoning; // retain pass-1 reasoning for the pass-2 display
      if (job.signal.aborted) return;

      const sections1 = parseSections(p1.text, nonEdited.length);
      if (!sections1) {
        // Couldn't align pass-1 output → safe fallback.
        final = await singlePass(plan.flatMap(paragraphUserPassages));
      } else {
        nonEdited.forEach((planIndex, i) => {
          rewrites.set(planIndex, sections1[i]);
        });
        const draft = assembleAnswer(plan, rewrites, new Map()).currentText;

        // Pass 2: rework the edited paragraphs around the author's passages.
        const editedPassages = edited.map((planIndex) =>
          paragraphUserPassages(plan[planIndex]),
        );
        const p2 = await streamModel({
          system: reviserSystemPrompt,
          prompt: buildPass2Prompt(
            question,
            draft,
            editedPassages.map((passages) => ({ passages })),
          ),
          signal: job.signal,
          onProgress,
          mockText: editedPassages
            .map((passages) =>
              passages.length > 0
                ? passages.map((_, i) => `{{${i + 1}}}`).join(" and ")
                : "Mock edited paragraph.",
            )
            .join(`\n${SECTION_DELIMITER}\n`),
        });
        if (job.signal.aborted) return;

        const sections2 = parseSections(p2.text, edited.length);
        if (sections2) {
          edited.forEach((planIndex, k) => {
            wovenEdited.set(planIndex, weaveUserText(sections2[k], editedPassages[k]));
          });
        }
        // If pass 2 failed to align, assembleAnswer retains the edited
        // paragraphs verbatim — still a valid, user-respecting result.
        final = assembleAnswer(plan, rewrites, wovenEdited);
      }
    }

    if (job.signal.aborted) return;
    if (!final || !final.currentText.trim()) {
      await failAnswerGeneration(answerId, userId);
      return;
    }
    await job.flushNow();

    // Re-weave idea-based cross-links into the regenerated text (user passages
    // are protected with placeholders inside the relink pass).
    const relinked = await relinkForGeneration({
      userId,
      answerId,
      question,
      aiText: final.aiText,
      currentText: final.currentText,
      signal: job.signal,
    });
    if (job.signal.aborted) return;

    await completeAnswerRegeneration(
      answerId,
      userId,
      relinked.aiText,
      relinked.currentText,
      cumulativeReasoning,
      provider,
      model,
    );
  } catch (error) {
    console.error("[runBackgroundRegeneration] error:", error);
    if (!job.signal.aborted) await failAnswerGeneration(answerId, userId);
  } finally {
    job.stop();
  }
}

// ---------------------------------------------------------------------------
// Idea-based relinking
// ---------------------------------------------------------------------------

/**
 * Narrow the corpus to the entries worth offering the model as link targets for
 * `self`: embeds the source (and lazily backfills candidate vectors), then ranks
 * by embedding recall. Returns [] when there are no candidates or embeddings are
 * unavailable (relinking then no-ops, leaving the text untouched).
 */
async function gatherRelinkCandidates(
  userId: string,
  selfId: string,
  selfQuestion: string,
  selfText: string,
): Promise<RankedCandidate[]> {
  const others = (await listRelatedCandidates(userId)).filter(
    (candidate) => candidate.id !== selfId && candidate.text.trim().length > 0,
  );
  if (others.length === 0) {
    return [];
  }
  const resolved = await embedWithCandidates(
    userId,
    [embeddingInput(selfQuestion, selfText)],
    others,
  );
  if (!resolved) {
    return [];
  }
  const selfEmbedding = resolved.queryEmbeddings[0] ?? null;
  const embeddingById = new Map(
    resolved.candidates.map((candidate) => [candidate.id, candidate.embedding]),
  );
  const relinkCandidates: RelinkCandidate[] = others.map((candidate) => ({
    id: candidate.id,
    question: candidate.question,
    text: candidate.text,
    embedding: embeddingById.get(candidate.id) ?? candidate.embedding,
  }));
  return selectRelinkCandidates(selfEmbedding, relinkCandidates, selfId);
}

function buildMockRelink(
  placeholderText: string,
  candidates: RankedCandidate[],
): string {
  // Deterministically link the top candidate so the relink path (sanitize +
  // weave + render) is exercisable under AI_PROVIDER=mock without spending tokens.
  if (candidates.length === 0) return placeholderText;
  return `${placeholderText}\n\nThis connects to the question of [[${candidates[0].question}|a related idea]].`;
}

/**
 * Run the idea-relink model pass over one entry. Returns the relinked
 * `{ aiText, currentText }` when at least one genuine cross-link was added, or
 * `null` to leave the entry unchanged (no candidates, model declined to link, or
 * the pass failed). User passages are protected with `{{n}}` placeholders so the
 * model relinks the AI prose around them without altering the author's words.
 */
async function relinkText({
  question,
  aiText,
  currentText,
  candidates,
  signal,
}: {
  question: string;
  aiText: string;
  currentText: string;
  candidates: RankedCandidate[];
  signal: AbortSignal;
}): Promise<{ aiText: string; currentText: string; linkCount: number } | null> {
  if (candidates.length === 0 || !currentText.trim()) {
    return null;
  }
  const segments = attributeText(aiText, currentText);
  const { text: placeholderText, passages } =
    placeholderizeUserSegments(segments);

  const { text } = await streamModel({
    system: relinkSystemPrompt,
    prompt: buildRelinkPrompt(
      question,
      placeholderText,
      candidates,
      DEFAULT_RELINK_CONFIG,
      passages.length > 0,
    ),
    signal,
    onProgress: async () => {},
    mockText: buildMockRelink(placeholderText, candidates),
    effort: "low",
  });
  if (signal.aborted || !text.trim()) {
    return null;
  }

  const sanitized = sanitizeLinks(
    text,
    candidates.map((candidate) => candidate.question),
    { maxLinks: DEFAULT_RELINK_CONFIG.maxLinks, selfQuestion: question },
  );
  // Purely additive: if the pass added no links, discard any incidental rephrase
  // and keep the original text untouched.
  if (countLinks(sanitized) === 0) {
    return null;
  }

  const woven = weaveUserText(sanitized, passages);
  return {
    aiText: woven.aiText,
    currentText: woven.currentText,
    linkCount: countLinks(woven.currentText),
  };
}

/**
 * Relink the text of a freshly generated/regenerated answer in place (called
 * before the answer is persisted, so the stored baseline already carries its
 * cross-links). Never throws — relinking is an enhancement, so any failure
 * leaves the original text. Returns the (possibly unchanged) text.
 */
async function relinkForGeneration({
  userId,
  answerId,
  question,
  aiText,
  currentText,
  signal,
}: {
  userId: string;
  answerId: string;
  question: string;
  aiText: string;
  currentText: string;
  signal: AbortSignal;
}): Promise<{ aiText: string; currentText: string }> {
  try {
    const candidates = await gatherRelinkCandidates(
      userId,
      answerId,
      question,
      currentText,
    );
    const relinked = await relinkText({
      question,
      aiText,
      currentText,
      candidates,
      signal,
    });
    if (relinked) {
      return { aiText: relinked.aiText, currentText: relinked.currentText };
    }
  } catch (error) {
    console.error("[relinkForGeneration] failed; leaving text as-is:", error);
  }
  return { aiText, currentText };
}

/**
 * Relink an existing answer on demand (the /api/relink endpoint and the corpus
 * backfill). Loads the answer, runs the relink pass against the rest of the
 * corpus, and persists the result (snapshotting the pre-relink state). Returns
 * the number of links in the result, or null when the answer was not found.
 */
export async function runRelink({
  answerId,
  userId,
}: {
  answerId: string;
  userId: string;
}): Promise<{ linkCount: number; changed: boolean } | null> {
  const answer = await getAnswer(answerId, userId);
  if (!answer) {
    return null;
  }
  if (!answer.currentText.trim()) {
    return { linkCount: 0, changed: false };
  }

  const candidates = await gatherRelinkCandidates(
    userId,
    answerId,
    answer.question,
    answer.currentText,
  );
  const relinked = await relinkText({
    question: answer.question,
    aiText: answer.aiText,
    currentText: answer.currentText,
    candidates,
    signal: new AbortController().signal,
  });
  if (!relinked) {
    return { linkCount: countLinks(answer.currentText), changed: false };
  }

  await applyRelink(answerId, userId, relinked.aiText, relinked.currentText);
  return { linkCount: relinked.linkCount, changed: true };
}
