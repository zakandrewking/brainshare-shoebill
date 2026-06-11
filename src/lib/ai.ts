import { anthropic } from "@ai-sdk/anthropic";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { streamText } from "ai";

const systemPrompt =
  "Answer the user's question in one clear, self-contained paragraph. Be accurate, direct, and useful. Do not use headings or bullet points.";

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
