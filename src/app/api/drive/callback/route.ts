import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { exchangeCodeAndStore, syncDrive } from "@/lib/drive";

export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.brainshare.io";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const cookieStore = await cookies();
  const raw = cookieStore.get("drive_oauth_state")?.value;
  cookieStore.delete("drive_oauth_state");

  if (error) {
    return NextResponse.redirect(`${APP_URL}/?drive_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !raw) {
    return NextResponse.redirect(`${APP_URL}/?drive_error=invalid_state`);
  }

  let stored: { state: string; userId: string };
  try {
    stored = JSON.parse(raw);
  } catch {
    return NextResponse.redirect(`${APP_URL}/?drive_error=invalid_state`);
  }

  if (stored.state !== state) {
    return NextResponse.redirect(`${APP_URL}/?drive_error=state_mismatch`);
  }

  try {
    await exchangeCodeAndStore(stored.userId, code);
    // Kick off an initial sync in the background after the response redirects.
    // Use after() equivalent: fire and don't await the redirect.
    syncDrive(stored.userId).catch(console.error);
    return NextResponse.redirect(`${APP_URL}/?drive_connected=1`);
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${APP_URL}/?drive_error=${encodeURIComponent(msg)}`,
    );
  }
}
