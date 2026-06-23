import { NextResponse } from "next/server";

import { AuthError, requireAuthorizedUser } from "@/lib/auth";
import { getDriveStatus } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthorizedUser(request);
    const status = await getDriveStatus(user.uid);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Could not fetch Drive status." }, { status: 500 });
  }
}
