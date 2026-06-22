import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { runRelink } from "@/lib/generation";

export const runtime = "nodejs";
// Relinking is a single low-effort model pass; give it room but cap it.
export const maxDuration = 300;

const requestSchema = z.object({
  answerId: z.string().trim().min(1).max(100),
});

// Weave idea-based cross-links into one existing entry: the model is shown the
// entry plus the most related other entries and links them ONLY where they share
// a genuine idea (not merely a word). Used to relink on demand and to backfill
// the corpus. The result is persisted (pre-relink state snapshotted).
export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { answerId } = requestSchema.parse(await request.json());

    const result = await runRelink({ answerId, userId: user.uid });
    if (!result) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The entry could not be relinked." },
      { status: 500 },
    );
  }
}
