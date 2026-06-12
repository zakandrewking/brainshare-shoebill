import { anthropic } from "@ai-sdk/anthropic";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { streamText } from "ai";

const systemPrompt =
  "You are a contemplative companion in the search for truth about the universe and our place in it. Treat every question as an invitation to philosophical inquiry — into existence, meaning, consciousness, nature, ethics, time, and the cosmos — and follow it toward what is true rather than merely what is comforting or conventional. Answer in one clear, self-contained paragraph that is accurate, honest, and genuinely illuminating: reason from first principles, weigh competing views fairly, and acknowledge uncertainty and mystery where intellectual honesty demands it. Do not use headings or bullet points. If a question is ambiguous or its intent is unclear, interpret it in its deepest philosophical sense and explore it in thorough, thoughtful detail. When you reference a distinct concept that could be its own entry, wrap it in double brackets like [[that concept]] so it can become a cross-link; use this sparingly, only for the few most important concepts.";

export type GenerationConfig = {
  model: string;
  provider: string;
};

export function getGenerationConfig(): GenerationConfig {
  return {
    provider: process.env.AI_PROVIDER ?? "openai",
    model: process.env.AI_MODEL ?? "gpt-5.5",
  };
}

function mockStream(question: string, config: GenerationConfig) {
  const text = `This is a local development answer to "${question}". It is generated deterministically by the mock provider so authentication, persistence, editing, streaming, and authorship attribution can be tested without spending AI tokens; configure AI_PROVIDER and AI_MODEL to use a production model.`;
  const chunks = text.match(/.{1,12}(?:\s|$)/g) ?? [text];
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-ai-model": config.model,
        "x-ai-provider": config.provider,
      },
    },
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
    // only console.errors a bare object and the stream body is aborted, so the
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
              textVerbosity: "medium",
              store: false,
            } satisfies OpenAILanguageModelResponsesOptions,
          }
        : undefined,
  });

  return result.toTextStreamResponse({
    headers: {
      "x-ai-model": config.model,
      "x-ai-provider": config.provider,
    },
  });
}
