import { NextResponse } from "next/server";
import { z } from "zod";

import { createAnswer, listAnswers } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { embedQuestions, getEmbeddingConfig } from "@/lib/embedding";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const answers = await listAnswers(user.uid);

    return NextResponse.json({ answers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Your submissions could not be loaded." },
      { status: 500 },
    );
  }
}

const requestSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  aiText: z.string().trim().min(1).max(20000),
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { question, aiText, provider, model } = requestSchema.parse(
      await request.json(),
    );

    // Embed the question for related-question ranking. Never block saving on
    // it — a failed or disabled embedding is backfilled lazily by /api/related.
    let questionEmbedding: number[] | null = null;
    let embeddingModel: string | null = null;
    try {
      const embeddings = await embedQuestions([question]);
      if (embeddings) {
        questionEmbedding = embeddings[0];
        embeddingModel = getEmbeddingConfig().model;
      }
    } catch (error) {
      console.error("[answers] question embedding failed:", error);
    }

    const answer = await createAnswer({
      userId: user.uid,
      userEmail: user.email!,
      question,
      aiText,
      currentText: aiText,
      provider,
      model,
      questionEmbedding,
      embeddingModel,
    });

    return NextResponse.json({ answer }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid question." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The answer could not be generated." },
      { status: 500 },
    );
  }
}
