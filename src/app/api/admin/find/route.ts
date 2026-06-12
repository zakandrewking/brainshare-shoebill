import { NextResponse } from "next/server";
import { z } from "zod";

import { findRequestSchema, toMongoFilter } from "@/lib/admin-find";
import { AuthError, requireServiceToken } from "@/lib/auth";
import { getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireServiceToken(request);
    const { collection, filter, projection, sort, limit } =
      findRequestSchema.parse(await request.json());

    const database = await getDatabase();
    const documents = await database
      .collection(collection)
      .find(toMongoFilter(filter), { projection, sort, limit })
      .toArray();

    return NextResponse.json({ count: documents.length, documents });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid query." },
        { status: 400 },
      );
    }

    console.error(error);
    return NextResponse.json(
      { error: "The query could not be run." },
      { status: 500 },
    );
  }
}
