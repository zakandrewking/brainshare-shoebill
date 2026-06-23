import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { buildOAuthUrl } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);

    const state = randomBytes(16).toString("hex");
    const cookieStore = await cookies();
    cookieStore.set("drive_oauth_state", JSON.stringify({ state, userId: user.uid }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    const url = buildOAuthUrl(state);
    // Return the URL as JSON so the client can set window.location.href,
    // which allows the same-origin CSRF cookie to be stored first.
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Could not start Drive connection." }, { status: 500 });
  }
}
