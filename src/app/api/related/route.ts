import { NextResponse } from "next/server";
import { z } from "zod";

import { listRelatedCandidates } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { rankRelatedHybrid } from "@/lib/related";
import { embedWithCandidates } from "@/lib/semantic";

export const runtime = "nodejs";

const requestSchema = z.object({
  query: z.string().trim().min(2).max(4000),
  excludeId: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { query, excludeId } = requestSchema.parse(await request.json());

    const candidates = await listRelatedCandidates(user.uid);
    // Embeddings failing or disabled degrades to keyword-only ranking.
    const resolved = await embedWithCandidates(user.uid, [query], candidates);

    const questions = rankRelatedHybrid(
      query,
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
