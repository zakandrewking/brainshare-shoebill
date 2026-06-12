import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Must reflect the running deployment on every request, never a cached/prebuilt
// value — this is what the client diffs to detect a fresh deploy.
export const dynamic = "force-dynamic";

// The identity of the currently-deployed build. On Vercel this changes with
// every production deploy; locally it stays "dev" so the watcher never fires.
export function GET() {
  const version =
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "dev";

  return NextResponse.json(
    { version },
    { headers: { "cache-control": "no-store" } },
  );
}
