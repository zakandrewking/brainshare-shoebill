import { NextResponse } from "next/server";
import { z } from "zod";

import { listRelatedCandidates } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { matchTopics } from "@/lib/embedding";
import { embedWithCandidates } from "@/lib/semantic";

export const runtime = "nodejs";

const requestSchema = z.object({
  topics: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  excludeId: z.string().trim().max(100).optional(),
});

// Resolve [[topic]] wiki-links semantically: each topic is embedded and
// matched against the stored question embeddings, so "[[empathy]]" can link
// to "what is kindness?" without sharing a word. Lexical resolution happens
// client-side first; only unresolved topics arrive here.
export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { topics, excludeId } = requestSchema.parse(await request.json());

    const candidates = (await listRelatedCandidates(user.uid)).filter(
      (candidate) => candidate.id !== excludeId,
    );
    if (candidates.length === 0) {
      return NextResponse.json({ matches: {} });
    }

    const resolved = await embedWithCandidates(user.uid, topics, candidates);
    if (!resolved) {
      return NextResponse.json({ matches: {} });
    }

    const matches = matchTopics(
      topics,
      resolved.queryEmbeddings,
      resolved.candidates,
    );
    return NextResponse.json({ matches });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid topics." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Crosslinks could not be resolved." },
      { status: 500 },
    );
  }
}
