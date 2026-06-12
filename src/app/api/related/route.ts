import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listRelatedCandidates,
  setQuestionEmbedding,
  type RelatedCandidateDocument,
} from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { embedQuestions, getEmbeddingConfig } from "@/lib/embedding";
import { rankRelatedHybrid, type HybridCandidate } from "@/lib/related";

export const runtime = "nodejs";

const requestSchema = z.object({
  query: z.string().trim().min(2).max(4000),
  excludeId: z.string().trim().max(100).optional(),
});

// Embed the query — and any candidates missing a current-model vector — in a
// single batch, persisting backfilled vectors. Returns null (keyword-only
// ranking) when embeddings are disabled or the provider call fails.
async function resolveEmbeddings(
  userId: string,
  query: string,
  candidates: RelatedCandidateDocument[],
): Promise<{ queryEmbedding: number[]; hybrid: HybridCandidate[] } | null> {
  const config = getEmbeddingConfig();
  if (config.provider === null) {
    return null;
  }

  const stale = candidates.filter(
    (candidate) =>
      candidate.embedding === null || candidate.embeddingModel !== config.model,
  );

  try {
    const embeddings = await embedQuestions([
      query,
      ...stale.map((candidate) => candidate.question),
    ]);
    if (!embeddings) {
      return null;
    }

    const [queryEmbedding, ...backfilled] = embeddings;
    const refreshed = new Map<string, number[]>();
    stale.forEach((candidate, index) => {
      refreshed.set(candidate.id, backfilled[index]);
    });
    await Promise.all(
      stale.map((candidate, index) =>
        setQuestionEmbedding(
          candidate.id,
          userId,
          backfilled[index],
          config.model,
        ),
      ),
    );

    return {
      queryEmbedding,
      hybrid: candidates.map((candidate) => ({
        id: candidate.id,
        question: candidate.question,
        embedding: refreshed.get(candidate.id) ?? candidate.embedding,
      })),
    };
  } catch (error) {
    console.error("[related] embedding failed; using keyword ranking:", error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { query, excludeId } = requestSchema.parse(await request.json());

    const candidates = await listRelatedCandidates(user.uid);
    const resolved = await resolveEmbeddings(user.uid, query, candidates);

    const questions = rankRelatedHybrid(
      query,
      resolved?.queryEmbedding ?? null,
      resolved?.hybrid ?? candidates.map(({ id, question }) => ({ id, question })),
      { excludeId },
    );

    return NextResponse.json({ questions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid query." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Related questions could not be loaded." },
      { status: 500 },
    );
  }
}
