import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteAnswer,
  getAnswer,
  regenerateAnswer,
  updateAnswer,
} from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { syncDrive } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { id } = await params;
    const answer = await getAnswer(id, user.uid);
    if (!answer) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }
    return NextResponse.json({ answer });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "The answer could not be loaded." },
      { status: 500 },
    );
  }
}

const requestSchema = z.object({
  currentText: z.string().max(20000),
});

const regenerateSchema = z.object({
  aiText: z.string().trim().min(1).max(20000),
  // When regeneration preserved the author's passages (lib/reinject), the
  // woven text arrives separately so the diff still attributes them to the
  // user; absent, edits reset to the fresh baseline.
  currentText: z.string().trim().min(1).max(40000).optional(),
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { id } = await params;
    const deleted = await deleteAnswer(id, user.uid);

    if (!deleted) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }

    after(() => syncDrive(user.uid).catch(console.error));
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
      { error: "The answer could not be deleted." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { aiText, currentText, provider, model } = regenerateSchema.parse(
      await request.json(),
    );
    const { id } = await params;
    const answer = await regenerateAnswer(
      id,
      user.uid,
      aiText,
      provider,
      model,
      currentText,
    );

    if (!answer) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }

    after(() => syncDrive(user.uid).catch(console.error));
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
        { error: error.issues[0]?.message ?? "Invalid answer." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The answer could not be regenerated." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthorizedUser(request);
    const { currentText } = requestSchema.parse(await request.json());
    const { id } = await params;
    const answer = await updateAnswer(id, user.uid, currentText);

    if (!answer) {
      return NextResponse.json({ error: "Answer not found." }, { status: 404 });
    }

    after(() => syncDrive(user.uid).catch(console.error));
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
        { error: error.issues[0]?.message ?? "Invalid answer." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The answer could not be saved." },
      { status: 500 },
    );
  }
}
