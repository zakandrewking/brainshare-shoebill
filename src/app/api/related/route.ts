import { NextResponse } from "next/server";
import { z } from "zod";

import { listRelatedCandidates } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { rankRelatedHybrid } from "@/lib/related";
import { embedWithCandidates } from "@/lib/semantic";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    // Free-text mode: rank against what's being typed (autocomplete).
    query: z.string().trim().min(2).max(4000).optional(),
    // Document mode: rank against an existing answer's stored doc vector —
    // doc-to-doc similarity sees what the answers discuss, which a short
    // question alone misses (e.g. bat ↔ consciousness).
    answerId: z.string().trim().max(100).optional(),
    excludeId: z.string().trim().max(100).optional(),
  })
  .refine((body) => body.query || body.answerId, {
    message: "Provide query or answerId.",
  });

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { query, answerId, excludeId } = requestSchema.parse(
      await request.json(),
    );

    const candidates = await listRelatedCandidates(user.uid);

    if (answerId) {
      const self = candidates.find((candidate) => candidate.id === answerId);
      if (!self) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      // Embeds nothing new unless vectors are missing/stale (backfill).
      const resolved = await embedWithCandidates(user.uid, [], candidates);
      const embedded =
        resolved?.candidates ??
        candidates.map(({ id, question }) => ({ id, question }));
      const selfEmbedding =
        resolved?.candidates.find((candidate) => candidate.id === answerId)
          ?.embedding ?? null;

      const questions = rankRelatedHybrid(self.question, selfEmbedding, embedded, {
        excludeId: answerId,
      });
      return NextResponse.json({ questions });
    }

    // Embeddings failing or disabled degrades to keyword-only ranking.
    const resolved = await embedWithCandidates(user.uid, [query!], candidates);

    const questions = rankRelatedHybrid(
      query!,
      resolved?.queryEmbeddings[0] ?? null,
      resolved?.candidates ??
        candidates.map(({ id, question }) => ({ id, question })),
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
