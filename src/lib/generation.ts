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
import { extractUserPassages, weaveUserText } from "@/lib/reinject";
import type { AttributionSegment } from "@/lib/attribution";

const systemPrompt =
  "You are a contemplative companion in the search for truth about the universe and our place in it. Treat every question as an invitation to philosophical inquiry — into existence, meaning, consciousness, nature, ethics, time, and the cosmos — and follow it toward what is true rather than merely what is comforting or conventional. Answer in one clear, self-contained paragraph that is accurate, honest, and genuinely illuminating: reason from first principles, weigh competing views fairly, and acknowledge uncertainty and mystery where intellectual honesty demands it. Do not use headings, and do not use bullet points in the body of the answer. If a question is ambiguous or its intent is unclear, interpret it in its deepest philosophical sense and explore it in thorough, thoughtful detail. Write in plain prose: do not add wiki-style [[double-bracket]] links or any other markup for concepts — cross-references between entries are added automatically afterward. Cite academia-style: support specific claims inline with parenthetical author–year citations like (Nagel 1974) at the point where they bear on the argument, then end with a line reading exactly 'References:' followed by a compact bulleted list of the cited sources — two to four real, verifiable works, primary thinkers first, each as author, *title* (year). Every inline citation must appear in the references list and every listed reference must be cited inline at least once; never invent or embellish a citation, and if a claim rests on your own reasoning rather than a source, say so in the body instead of citing.";

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

/** Run AI generation server-side, saving intermediate progress to MongoDB. */
export async function runBackgroundGeneration({
  answerId,
  userId,
  question,
  userPassages,
  isRegeneration = false,
}: {
  answerId: string;
  userId: string;
  question: string;
  userPassages?: string[];
  isRegeneration?: boolean;
}): Promise<void> {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const model = process.env.AI_MODEL ?? "gpt-5.5";
  const controller = new AbortController();
  const { signal } = controller;

  let accumulatedText = "";
  let accumulatedReasoning = "";
  let lastDbUpdate = 0;

  const flushProgress = async (force = false) => {
    const now = Date.now();
    if (force || now - lastDbUpdate >= 2000) {
      lastDbUpdate = now;
      await setGeneratingProgress(
        answerId,
        userId,
        accumulatedText,
        accumulatedReasoning,
      ).catch(console.error);
    }
  };

  // Check for cancellation every 3 s so the background job stops quickly.
  const cancelInterval = setInterval(async () => {
    try {
      const status = await getAnswerGenerationStatus(answerId, userId);
      if (status === "cancelled") {
        clearInterval(cancelInterval);
        controller.abort();
      }
    } catch {
      // ignore transient DB errors
    }
  }, 3000);

  try {
    if (provider === "mock") {
      const text = buildMockText(question, userPassages);
      // Fake reasoning then text so the Thinking panel is exercisable locally.
      const mockReasoning = `Reading "${question}" closely, weighing a couple of interpretations, and deciding how to frame a clear, honest answer.`;
      for (const chunk of mockReasoning.match(/.{1,18}(?:\s|$)/g) ?? [
        mockReasoning,
      ]) {
        if (signal.aborted) break;
        accumulatedReasoning += chunk;
        await new Promise((resolve) => setTimeout(resolve, 25));
        await flushProgress();
      }
      for (const chunk of text.match(/.{1,12}(?:\s|$)/g) ?? [text]) {
        if (signal.aborted) break;
        accumulatedText += chunk;
        await new Promise((resolve) => setTimeout(resolve, 25));
        await flushProgress();
      }
    } else {
      const languageModel =
        provider === "openai"
          ? openai(model)
          : provider === "anthropic"
            ? anthropic(model)
            : null;
      if (!languageModel) throw new Error(`Unsupported AI_PROVIDER: ${provider}`);

      const result = streamText({
        model: languageModel,
        system: systemPrompt,
        prompt: buildPrompt(question, userPassages),
        abortSignal: signal,
        onError: ({ error }) =>
          console.error("[runBackgroundGeneration] stream error:", error),
        providerOptions:
          provider === "openai"
            ? ({
                openai: {
                  reasoningEffort:
                    process.env.OPENAI_REASONING_EFFORT ?? "high",
                  // Ask the Responses API for a reasoning summary so the
                  // Thinking panel has something to show (raw reasoning tokens
                  // are not exposed by OpenAI — only these summaries).
                  reasoningSummary: "auto",
                  store: false,
                },
              } satisfies {
                openai: OpenAILanguageModelResponsesOptions;
              })
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
          accumulatedText += part.text;
          await flushProgress();
        } else if (part.type === "reasoning-delta" && part.text) {
          accumulatedReasoning += part.text;
          await flushProgress();
        }
      }
    }

    if (signal.aborted) return; // cancelled — status already set in DB

    if (!accumulatedText.trim()) {
      await failAnswerGeneration(answerId, userId);
      return;
    }

    await flushProgress(true);

    if (isRegeneration) {
      const { aiText, currentText } =
        userPassages && userPassages.length > 0
          ? weaveUserText(accumulatedText, userPassages)
          : { aiText: accumulatedText, currentText: accumulatedText };
      await completeAnswerRegeneration(
        answerId,
        userId,
        aiText,
        currentText,
        accumulatedReasoning,
        provider,
        model,
      );
    } else {
      let questionEmbedding: number[] | null = null;
      let embeddingModel: string | null = null;
      try {
        const embeddings = await embedQuestions([
          embeddingInput(question, accumulatedText),
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
        accumulatedText,
        accumulatedReasoning,
        provider,
        model,
        questionEmbedding,
        embeddingModel,
      );
    }
  } catch (error) {
    console.error("[runBackgroundGeneration] error:", error);
    if (!signal.aborted) {
      await failAnswerGeneration(answerId, userId);
    }
  } finally {
    clearInterval(cancelInterval);
  }
}

/**
 * For a regeneration, read the existing answer's segments from the DB snapshot
 * (passed in) and extract user passages so the model can build around them.
 */
export function getUserPassagesFromDoc(
  segments: AttributionSegment[],
): string[] {
  return extractUserPassages(segments);
}
