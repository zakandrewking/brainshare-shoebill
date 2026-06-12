import { anthropic } from "@ai-sdk/anthropic";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { streamText } from "ai";

const systemPrompt =
  "You are a contemplative companion in the search for truth about the universe and our place in it. Treat every question as an invitation to philosophical inquiry — into existence, meaning, consciousness, nature, ethics, time, and the cosmos — and follow it toward what is true rather than merely what is comforting or conventional. Answer in one clear, self-contained paragraph that is accurate, honest, and genuinely illuminating: reason from first principles, weigh competing views fairly, and acknowledge uncertainty and mystery where intellectual honesty demands it. Do not use headings, and do not use bullet points in the body of the answer. If a question is ambiguous or its intent is unclear, interpret it in its deepest philosophical sense and explore it in thorough, thoughtful detail. When you reference a distinct concept that could be its own entry, wrap it in double brackets like [[that concept]] so it can become a cross-link; use this sparingly, only for the few most important concepts. After the paragraph, you must end with a line reading exactly 'References:' followed by a compact bulleted list of two to four real, verifiable sources that ground or deepen the answer — primary thinkers and works first, each as author, *title* (year); never invent or embellish a citation, and if a claim rests on your own reasoning rather than a source, say so in the body instead of citing.";

export type GenerationConfig = {
  model: string;
  provider: string;
};

// Newline-delimited JSON streamed to the browser. Each line is one event so the
// client can show the model's reasoning ("thinking") separately from the answer
// text as both stream in. Reasoning is ephemeral and never persisted.
export const ANSWER_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export type AnswerStreamEvent =
  | { t: "reasoning"; v: string }
  | { t: "text"; v: string }
  | { t: "error"; v: string };

export function getGenerationConfig(): GenerationConfig {
  return {
    provider: process.env.AI_PROVIDER ?? "openai",
    model: process.env.AI_MODEL ?? "gpt-5.5",
  };
}

function streamHeaders(config: GenerationConfig) {
  return {
    "content-type": ANSWER_STREAM_CONTENT_TYPE,
    "x-ai-model": config.model,
    "x-ai-provider": config.provider,
  };
}

function encodeEvent(encoder: TextEncoder, event: AnswerStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function mockStream(question: string, config: GenerationConfig) {
  // Fake "thinking" then the deterministic answer, so the reasoning UI and the
  // streaming/persistence paths can be exercised locally without spending tokens.
  const reasoning = `Reading "${question}" closely, weighing a couple of interpretations, and deciding how to frame a clear, honest answer.`;
  // Ends with a References list to mirror the production system prompt.
  const text = `This is a local development answer to "${question}". It is generated deterministically by the mock provider so authentication, persistence, editing, streaming, and authorship attribution can be tested without spending AI tokens; configure AI_PROVIDER and AI_MODEL to use a production model.\n\nReferences:\n- Mock Author, *A Deterministic Treatise on Local Development* (2026)\n- Another Mock, *Streaming Without Spending* (2025)`;
  const encoder = new TextEncoder();
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 25));

  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of reasoning.match(/.{1,18}(?:\s|$)/g) ?? [reasoning]) {
          controller.enqueue(encodeEvent(encoder, { t: "reasoning", v: chunk }));
          await sleep();
        }
        for (const chunk of text.match(/.{1,12}(?:\s|$)/g) ?? [text]) {
          controller.enqueue(encodeEvent(encoder, { t: "text", v: chunk }));
          await sleep();
        }
        controller.close();
      },
    }),
    { headers: streamHeaders(config) },
  );
}

export function streamAnswer(question: string) {
  const config = getGenerationConfig();

  if (config.provider === "mock") {
    return mockStream(question, config);
  }

  const languageModel =
    config.provider === "openai"
      ? openai(config.model)
      : config.provider === "anthropic"
        ? anthropic(config.model)
        : null;

  if (!languageModel) {
    throw new Error(`Unsupported AI_PROVIDER: ${config.provider}`);
  }

  const result = streamText({
    model: languageModel,
    system: systemPrompt,
    prompt: question,
    // Surface the real provider error. Without this, the SDK's default handler
    // only console.errors a bare object and the stream is aborted, so the
    // browser sees "answer streamed, then failed" with no diagnosable cause.
    onError: ({ error }) => {
      console.error("[streamAnswer] generation stream error:", error);
    },
    providerOptions:
      config.provider === "openai"
        ? {
            openai: {
              reasoningEffort:
                process.env.OPENAI_REASONING_EFFORT ?? "high",
              // Ask the Responses API for a reasoning summary so we can show the
              // user what the model is thinking about (raw reasoning tokens are
              // not exposed by OpenAI — only these summaries).
              reasoningSummary: "auto",
              textVerbosity: "medium",
              store: false,
            } satisfies OpenAILanguageModelResponsesOptions,
          }
        : undefined,
  });

  // Re-frame the SDK's full event stream as our reasoning/text NDJSON protocol.
  // Iterating fullStream ourselves (instead of toTextStreamResponse) lets us
  // forward reasoning deltas and keep the answer streaming even if the model
  // emits a late error.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const part of result.fullStream) {
          if (part.type === "reasoning-delta" && part.text) {
            controller.enqueue(
              encodeEvent(encoder, { t: "reasoning", v: part.text }),
            );
          } else if (part.type === "text-delta" && part.text) {
            controller.enqueue(encodeEvent(encoder, { t: "text", v: part.text }));
          } else if (part.type === "error") {
            controller.enqueue(
              encodeEvent(encoder, { t: "error", v: String(part.error) }),
            );
          }
        }
      } catch (error) {
        console.error("[streamAnswer] stream iteration error:", error);
        controller.enqueue(
          encodeEvent(encoder, {
            t: "error",
            v: "The answer stream ended unexpectedly.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders(config) });
}
