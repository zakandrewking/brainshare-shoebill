import { listAnswers } from "./answers";
import { getUserSettings, upsertUserSettings, unsetUserSettings } from "./user-settings";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export type DriveStatus = "notSetup" | "tokenInvalid" | "syncing" | "synced";

export type DriveStatusResponse = {
  status: DriveStatus;
  lastSyncAt?: string;
  fileId?: string;
};

function clientId() {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID not configured");
  return v;
}

function clientSecret() {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET not configured");
  return v;
}

function callbackUrl() {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.brainshare.io";
  return `${base}/api/drive/callback`;
}

export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeAndStore(
  userId: string,
  code: string,
): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: callbackUrl(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Try again.");
  }
  await upsertUserSettings(userId, {
    driveRefreshToken: data.refresh_token,
    driveTokenInvalid: false,
  });
}

async function getAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

function buildMarkdown(
  answers: Awaited<ReturnType<typeof listAnswers>>,
): string {
  const now = new Date().toUTCString();
  const sections = answers
    .map(
      (a) =>
        `## ${a.question}\n\n${a.currentText}\n\n_Updated: ${a.updatedAt}_`,
    )
    .join("\n\n---\n\n");
  return `# Brainshare Answers\n\n_Synced ${now}_\n\n---\n\n${sections}`;
}

async function uploadFile(
  accessToken: string,
  fileId: string | undefined,
  content: string,
): Promise<string> {
  const boundary = "bs_boundary";
  const metadata = JSON.stringify({
    name: "Brainshare Answers.md",
    mimeType: "text/markdown",
  });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const url = fileId
    ? `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart`;

  const res = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const body2 = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${body2}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function syncDrive(userId: string): Promise<void> {
  const settings = await getUserSettings(userId);
  if (!settings.driveRefreshToken) return;

  // Rate-limit: skip if synced within the last 60 seconds.
  if (
    settings.driveLastSyncAt &&
    Date.now() - settings.driveLastSyncAt.getTime() < 60_000
  ) {
    return;
  }

  const accessToken = await getAccessToken(settings.driveRefreshToken);
  if (!accessToken) {
    await upsertUserSettings(userId, { driveTokenInvalid: true });
    return;
  }

  const answers = await listAnswers(userId);
  const content = buildMarkdown(answers);
  const fileId = await uploadFile(accessToken, settings.driveFileId, content);

  await upsertUserSettings(userId, {
    driveFileId: fileId,
    driveLastSyncAt: new Date(),
    driveTokenInvalid: false,
  });
}

export async function getDriveStatus(
  userId: string,
): Promise<DriveStatusResponse> {
  const settings = await getUserSettings(userId);

  if (!settings.driveRefreshToken) return { status: "notSetup" };
  if (settings.driveTokenInvalid) return { status: "tokenInvalid" };
  if (!settings.driveLastSyncAt) return { status: "syncing" };

  // Check whether any answer was updated after the last sync.
  const db = (await import("./mongodb")).getDatabase;
  const database = await db();
  const newer = await database.collection("answers").findOne(
    { userId, updatedAt: { $gt: settings.driveLastSyncAt } },
    { projection: { _id: 1 } },
  );

  return {
    status: newer ? "syncing" : "synced",
    lastSyncAt: settings.driveLastSyncAt.toISOString(),
    fileId: settings.driveFileId,
  };
}

export async function disconnectDrive(userId: string): Promise<void> {
  const settings = await getUserSettings(userId);
  if (settings.driveRefreshToken) {
    // Best-effort token revocation; ignore errors.
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(settings.driveRefreshToken)}`,
      { method: "POST" },
    ).catch(() => {});
  }
  await unsetUserSettings(userId, [
    "driveRefreshToken",
    "driveFileId",
    "driveLastSyncAt",
    "driveTokenInvalid",
  ]);
}
