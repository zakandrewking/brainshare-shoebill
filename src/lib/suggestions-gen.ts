// AI generation of a batch of starter questions. One completion produces
// several suggestions (the key token-economy win) and is non-streaming — we
// only need the final list.

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  SUGGESTION_BATCH_SIZE,
  parseSuggestionLines,
} from "@/lib/suggestions";

const suggestionSystemPrompt =
  "You generate short, inviting philosophical questions for a contemplative writing app. Each question is open-ended, intellectually serious yet accessible, and stands on its own. Vary the themes across consciousness, ethics, meaning, knowledge, time, free will, identity, beauty, death, and the cosmos. No preamble, numbering, or commentary — just the questions.";

function getConfig() {
  return {
    provider: process.env.AI_PROVIDER ?? "openai",
    model: process.env.AI_MODEL ?? "gpt-5.5",
  };
}

// Deterministic suggestions for the mock provider so the pool fills under
// `pnpm dev:mock` without spending tokens.
const MOCK_SUGGESTIONS = [
  "Does the universe have a purpose, or do we give it one?",
  "Is the self an illusion?",
  "Can a choice be truly free?",
  "What makes a life meaningful?",
  "Is mathematics discovered or invented?",
  "Why is there something rather than nothing?",
  "Can we ever truly know another mind?",
  "Is time a feature of reality or of perception?",
];

/**
 * Generate up to `count` fresh suggestions, avoiding `existing` questions.
 * Returns [] on failure (callers degrade silently — suggestions are optional).
 */
export async function generateSuggestionBatch(
  existing: string[],
  count = SUGGESTION_BATCH_SIZE,
): Promise<string[]> {
  const { provider, model } = getConfig();

  if (provider === "mock") {
    // Rotate so repeated dev refills don't all collide with `existing`.
    const rotated = [...MOCK_SUGGESTIONS].sort(() => Math.random() - 0.5);
    return parseSuggestionLines(rotated.join("\n"), existing).slice(0, count);
  }

  const languageModel =
    provider === "openai"
      ? openai(model)
      : provider === "anthropic"
        ? anthropic(model)
        : null;
  if (!languageModel) return [];

  const avoid = existing.slice(0, 40).map((q) => `- ${q}`).join("\n");
  const prompt = `Write ${count} short philosophical questions a curious person might want to explore. Each on its own line, no numbering or bullets, 6–18 words, ending in a question mark. Make them distinct from one another and from the list below.

Already explored (avoid these and close variants):
${avoid || "(none yet)"}`;

  try {
    const { text } = await generateText({
      model: languageModel,
      system: suggestionSystemPrompt,
      prompt,
      // Suggestions don't need deep reasoning; keep the spend minimal.
      providerOptions:
        provider === "openai"
          ? { openai: { reasoningEffort: "low" } }
          : undefined,
    });
    return parseSuggestionLines(text, existing).slice(0, count);
  } catch (error) {
    console.error("[generateSuggestionBatch] failed:", error);
    return [];
  }
}
