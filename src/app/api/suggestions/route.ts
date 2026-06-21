import { after, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import {
  consumeSuggestion,
  listReadySuggestions,
  refillSuggestionsIfNeeded,
} from "@/lib/suggestions-store";

export const runtime = "nodejs";

function authError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const suggestions = await listReadySuggestions(user.uid);

    // Keep the pool warm for next time, after the response is sent. No-ops
    // cheaply when full / over budget / debounced (see refillSuggestionsIfNeeded).
    after(() => refillSuggestionsIfNeeded(user.uid));

    return NextResponse.json({ suggestions });
  } catch (error) {
    const handled = authError(error);
    if (handled) return handled;
    console.error(error);
    return NextResponse.json(
      { error: "Suggestions could not be loaded." },
      { status: 500 },
    );
  }
}

const consumeSchema = z.object({
  action: z.enum(["use", "dismiss"]),
  id: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const { action, id } = consumeSchema.parse(await request.json());

    await consumeSuggestion(
      user.uid,
      id,
      action === "use" ? "used" : "dismissed",
    );

    // Consuming dropped the pool below target — refill in the background.
    after(() => refillSuggestionsIfNeeded(user.uid));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const handled = authError(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "The suggestion could not be updated." },
      { status: 500 },
    );
  }
}
