import type { DecodedIdToken } from "firebase-admin/auth";

import { adminAuth } from "@/lib/firebase/admin";
import { getDatabase } from "@/lib/mongodb";
import { isServiceToken } from "@/lib/service-token";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 = 401,
  ) {
    super(message);
  }
}

export type AuthorizedUser = Pick<DecodedIdToken, "uid" | "email">;

export function getAllowedEmails() {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "zaking17@gmail.com")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.match(/^Bearer (.+)$/i)?.[1];
}

let serviceUserPromise: Promise<AuthorizedUser> | undefined;

// The service token always acts as the primary allowlisted account, so all
// userId-scoped routes behave exactly as they do for that signed-in user.
function getServiceUser() {
  if (!serviceUserPromise) {
    serviceUserPromise = lookupServiceUser();
    serviceUserPromise.catch(() => {
      serviceUserPromise = undefined;
    });
  }
  return serviceUserPromise;
}

async function lookupServiceUser(): Promise<AuthorizedUser> {
  const [email] = getAllowedEmails();
  if (!email) {
    throw new AuthError("No allowlisted email is configured.", 403);
  }

  try {
    const record = await adminAuth.getUserByEmail(email);
    return { uid: record.uid, email: record.email ?? email };
  } catch {
    // Production has no Admin credentials (ID tokens are verified via public
    // JWKS), so recover the uid from the user's stored answers instead.
    const database = await getDatabase();
    const existing = await database
      .collection<{ userId: string }>("answers")
      .findOne(
        { userEmail: email },
        { sort: { updatedAt: -1 }, projection: { userId: 1 } },
      );

    if (existing?.userId) {
      return { uid: existing.userId, email };
    }

    throw new AuthError("The service identity could not be resolved.", 403);
  }
}

export async function requireAuthorizedUser(
  request: Request,
): Promise<AuthorizedUser> {
  const token = getBearerToken(request);

  if (!token) {
    throw new AuthError("Sign in is required.");
  }

  if (isServiceToken(token)) {
    return getServiceUser();
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

export async function requireServiceToken(request: Request): Promise<void> {
  const token = getBearerToken(request);

  if (!token || !isServiceToken(token)) {
    throw new AuthError("A valid service token is required.");
  }
}
