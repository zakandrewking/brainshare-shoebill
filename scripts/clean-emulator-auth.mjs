// Prune Firebase Auth emulator accounts that are not in the allowlist.
//
// The emulator imports its previous export on startup, so stray test accounts
// (e.g. the auto-generated `panda.algae.*` user) reappear after every restart
// even once deleted. Running this on dev startup keeps the emulator's auth
// state limited to the allowed address(es).

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const PROJECT =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "demo-brainshare-shoebill";
const allowed = new Set(
  (process.env.ALLOWED_EMAILS ?? "zaking17@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const headers = {
  Authorization: "Bearer owner",
  "content-type": "application/json",
};
const idToolkit = `http://${HOST}/identitytoolkit.googleapis.com/v1`;

async function emulatorReady() {
  try {
    const response = await fetch(
      `http://${HOST}/emulator/v1/projects/${PROJECT}/config`,
      { headers },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await emulatorReady()) {
      break;
    }
    if (attempt === 59) {
      console.warn("[clean-auth] auth emulator not reachable; skipping");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const response = await fetch(`${idToolkit}/projects/${PROJECT}/accounts:query`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!response.ok) {
    console.warn(`[clean-auth] account query failed: ${response.status}`);
    return;
  }

  const { userInfo = [] } = await response.json();
  let removed = 0;
  for (const user of userInfo) {
    const email = (user.email ?? "").toLowerCase();
    if (allowed.has(email)) {
      continue;
    }
    await fetch(`${idToolkit}/accounts:delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ localId: user.localId }),
    });
    console.log(`[clean-auth] removed ${user.email ?? user.localId}`);
    removed += 1;
  }

  if (removed > 0) {
    console.log(`[clean-auth] removed ${removed} non-allowlisted account(s)`);
  }
}

main().catch((error) => console.warn("[clean-auth]", error.message));
