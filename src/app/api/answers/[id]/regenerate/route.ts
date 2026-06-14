import { after } from "next/server";
import { NextResponse } from "next/server";

import { markAnswerRegenerating } from "@/lib/answers";
import { getGenerationConfig } from "@/lib/ai";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { runBackgroundRegeneration } from "@/lib/generation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { id } = await params;

    // Snapshot the current answer and mark it as generating.
    const existing = await markAnswerRegenerating(id, user.uid);
    if (!existing) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }

    const { provider, model } = getGenerationConfig();

    after(async () => {
      await runBackgroundRegeneration({
        answerId: id,
        userId: user.uid,
        question: existing.question,
        aiText: existing.aiText,
        currentText: existing.currentText,
      });
    });

    // Return the answer as it was before regeneration, but with
    // generationStatus: 'generating' so the client starts polling.
    return NextResponse.json({
      answer: {
        id,
        userId: existing.userId,
        userEmail: existing.userEmail,
        question: existing.question,
        aiText: existing.aiText,
        currentText: existing.currentText,
        segments: existing.segments,
        provider: provider,
        model: model,
        generationStatus: "generating",
        createdAt: existing.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Regeneration could not be started." },
      { status: 500 },
    );
  }
}
