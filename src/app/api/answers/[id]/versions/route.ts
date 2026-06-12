import { NextResponse } from "next/server";
import { z } from "zod";

import { listAnswerVersions, revertAnswer } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { id } = await params;
    const versions = await listAnswerVersions(id, user.uid);

    if (versions === null) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }

    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "Versions could not be loaded." },
      { status: 500 },
    );
  }
}

const restoreSchema = z.object({
  restore: z.number().int().min(0).max(100),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { restore } = restoreSchema.parse(await request.json());
    const { id } = await params;
    const answer = await revertAnswer(id, user.uid, restore);

    if (!answer) {
      return NextResponse.json(
        { error: "Answer or version not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ answer });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid version." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The version could not be restored." },
      { status: 500 },
    );
  }
}
