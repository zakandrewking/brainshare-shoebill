import { NextResponse } from "next/server";
import { z } from "zod";

import { streamAnswer } from "@/lib/ai";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";
// High reasoning effort can think for minutes before the first text delta;
// 120s was killing some generations mid-stream. 300s is the Hobby-plan max.
export const maxDuration = 300;

const requestSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  // Regeneration: the author's own passages, which the model is prompted to
  // build its prose around via {{n}} placeholders (see lib/ai buildPrompt).
  userPassages: z
    .array(z.string().min(1).max(4000))
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  try {
    await requireAuthorizedUser(request);
    const { question, userPassages } = requestSchema.parse(
      await request.json(),
    );
    return streamAnswer(question, userPassages);
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
