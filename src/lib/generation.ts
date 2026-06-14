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

import {
  completeAnswerGeneration,
  completeAnswerRegeneration,
  failAnswerGeneration,
  getAnswerGenerationStatus,
  setGeneratingProgress,
} from "@/lib/answers";
import {
  embeddingInput,
  embedQuestions,
  getEmbeddingConfig,
} from "@/lib/embedding";
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
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  onProgress: (text: string, reasoning: string) => Promise<void>;
  mockText: string;
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
              reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "high",
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

    let questionEmbedding: number[] | null = null;
    let embeddingModel: string | null = null;
    try {
      const embeddings = await embedQuestions([embeddingInput(question, text)]);
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
      text,
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
    await completeAnswerRegeneration(
      answerId,
      userId,
      final.aiText,
      final.currentText,
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
