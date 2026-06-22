#!/usr/bin/env node
// Backfill idea-based cross-links across the whole corpus.
//
// Lists every entry via the deployed API and relinks each one in turn (each call
// weaves cross-links into that entry's stored prose). Idempotent: re-running only
// adds genuinely-warranted links and leaves entries unchanged when none apply.
//
// Usage:
//   SERVICE_API_TOKEN=... node scripts/relink-all.mjs [baseUrl]
//
// baseUrl defaults to https://www.brainshare.io. The service token is the
// allowlisted primary user (see AGENTS.md → "Prod Data Access").

const baseUrl = (process.argv[2] ?? "https://www.brainshare.io").replace(
  /\/$/,
  "",
);
const token = process.env.SERVICE_API_TOKEN;

if (!token) {
  console.error("SERVICE_API_TOKEN is required.");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

async function main() {
  const listResponse = await fetch(`${baseUrl}/api/answers`, { headers });
  if (!listResponse.ok) {
    console.error(`Failed to list entries: HTTP ${listResponse.status}`);
    process.exit(1);
  }
  const { answers } = await listResponse.json();
  console.log(`Relinking ${answers.length} entries against the corpus…\n`);

  let changed = 0;
  for (const answer of answers) {
    const label = answer.question.slice(0, 60);
    try {
      const response = await fetch(`${baseUrl}/api/relink`, {
        method: "POST",
        headers,
        body: JSON.stringify({ answerId: answer.id }),
      });
      if (!response.ok) {
        console.log(`  ✗ ${label} — HTTP ${response.status}`);
        continue;
      }
      const result = await response.json();
      if (result.changed) changed += 1;
      console.log(
        `  ${result.changed ? "✓" : "·"} ${label} — ${result.linkCount} link(s)`,
      );
    } catch (error) {
      console.log(`  ✗ ${label} — ${error.message}`);
    }
  }

  console.log(`\nDone. ${changed}/${answers.length} entries updated.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
