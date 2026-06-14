import { NextResponse } from "next/server";
import { cosineSimilarity } from "ai";
import { z } from "zod";

import { listRelatedCandidates } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { embedWithCandidates } from "@/lib/semantic";

export const runtime = "nodejs";

const requestSchema = z.object({
  answerId: z.string().trim().min(1).max(100),
});

// Database context for automatic cross-references: for the open article, return
// every OTHER existing article with its embedding-cosine similarity to the open
// one. The client derives anchor phrases and decides which phrases become links
// (see lib/autolink) — keeping the matching pure, instant on keystroke, and
// tunable without a round-trip.
export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { answerId } = requestSchema.parse(await request.json());

    const candidates = await listRelatedCandidates(user.uid);
    const self = candidates.find((candidate) => candidate.id === answerId);
    if (!self) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    // Backfills any missing/stale vectors; degrades to no links if embeddings
    // are unavailable (similarity is what gates a keyword hit into a link).
    const resolved = await embedWithCandidates(user.uid, [], candidates);
    if (!resolved) {
      return NextResponse.json({ candidates: [] });
    }

    const selfEmbedding = resolved.candidates.find(
      (candidate) => candidate.id === answerId,
    )?.embedding;
    if (!selfEmbedding) {
      return NextResponse.json({ candidates: [] });
    }

    const out = resolved.candidates
      .filter((candidate) => candidate.id !== answerId && candidate.embedding)
      .map((candidate) => ({
        id: candidate.id,
        question: candidate.question,
        similarity: Math.max(
          0,
          cosineSimilarity(selfEmbedding, candidate.embedding!),
        ),
      }));

    return NextResponse.json({ candidates: out });
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
      { error: "Cross-references could not be loaded." },
      { status: 500 },
    );
  }
}
