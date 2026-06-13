import { NextResponse } from "next/server";

import { cancelAnswerGeneration } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { id } = await params;
    const cancelled = await cancelAnswerGeneration(id, user.uid);
    if (!cancelled) {
      return NextResponse.json(
        { error: "No in-progress generation found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "Could not cancel the generation." },
      { status: 500 },
    );
  }
}
