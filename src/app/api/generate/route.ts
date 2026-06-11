import { NextResponse } from "next/server";
import { z } from "zod";

import { streamAnswer } from "@/lib/ai";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  question: z.string().trim().min(3).max(4000),
});

export async function POST(request: Request) {
  try {
    await requireAuthorizedUser(request);
    const { question } = requestSchema.parse(await request.json());
    return streamAnswer(question);
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
