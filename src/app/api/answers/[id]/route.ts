import { NextResponse } from "next/server";
import { z } from "zod";

import { updateAnswer } from "@/lib/answers";
import { AuthError, requireAuthorizedUser } from "@/lib/auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  currentText: z.string().max(20000),
});

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
