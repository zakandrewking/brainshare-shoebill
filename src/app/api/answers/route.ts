import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAnswerGenerating, listAnswers } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { getGenerationConfig } from "@/lib/ai";
import { syncDrive } from "@/lib/drive";
import { runBackgroundGeneration } from "@/lib/generation";

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
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { question } = requestSchema.parse(await request.json());
    const { provider, model } = getGenerationConfig();

    const answer = await createAnswerGenerating({
      userId: user.uid,
      userEmail: user.email!,
      question,
      provider,
      model,
    });

    // Fire and forget: generation continues after the response is sent, even
    // if the browser tab is closed.
    after(async () => {
      await runBackgroundGeneration({
        answerId: answer.id,
        userId: user.uid,
        question,
      });
      await syncDrive(user.uid).catch(console.error);
    });

    return NextResponse.json({ answer }, { status: 202 });
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
