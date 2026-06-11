import type { DecodedIdToken } from "firebase-admin/auth";

import { adminAuth } from "@/lib/firebase/admin";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 = 401,
  ) {
    super(message);
  }
}

export function getAllowedEmails() {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "zaking17@gmail.com")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requireAuthorizedUser(
  request: Request,
): Promise<DecodedIdToken> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];

  if (!token) {
    throw new AuthError("Sign in is required.");
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    throw new AuthError("Your session is invalid or expired.");
  }

  const email = decoded.email?.toLowerCase();
  if (!email || !getAllowedEmails().has(email)) {
    throw new AuthError("This account does not have access.", 403);
  }

  return decoded;
}
