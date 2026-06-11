import { NextResponse } from "next/server";
import { z } from "zod";

import { createAnswer } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";

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
    const answer = await createAnswer({
      userId: user.uid,
      userEmail: user.email!,
      question,
      aiText,
      currentText: aiText,
      provider,
      model,
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
