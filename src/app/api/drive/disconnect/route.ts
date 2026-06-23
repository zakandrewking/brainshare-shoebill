import { NextResponse } from "next/server";

import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { disconnectDrive } from "@/lib/drive";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    await disconnectDrive(user.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Could not disconnect Drive." }, { status: 500 });
  }
}
