# Brainshare TODOs

Single source of truth for what we're working on. **Committed** — keep it live
and push changes so alternative clients can coordinate. See `AGENTS.md` →
"Backlog (TODOS.md)". When editing: capture every request the moment it's made,
and never drop an item — move finished work to "Recently shipped".

## Now

- [ ] **Regenerate + overwrite an existing submission.** When viewing a
      submission, offer "Regenerate" that re-runs the model for that question
      and overwrites the existing version in place (same id): replace `aiText`,
      reset `currentText`, recompute attribution.
- [ ] **Rework submissions UI: open via a button + per-submission URLs.** Move
      the submissions list off the main page behind a button (panel/sheet or
      dedicated view). Give each submission a real URL (route `/a/[id]` or
      `?a=<id>`) so answers are addressable/shareable. Foundational for crosslinks.
- [ ] **Retro restyle: minimalism / Windows 95 / classic Mac OS.** Another pass
      on the look — squared corners, classic gray chrome/bevels, system/pixel
      font, flatten gradients. Pairs with the 8-bit mascot. Building blind
      (agent-browser can't reach the signed-in UI); user reviews live.

## Next

- [ ] **Get the app working in production.** Blocked on two secrets set in NO
      Vercel environment — app can't generate or persist without them:
  - [ ] `OPENAI_API_KEY` (Production) — needs user value.
  - [ ] `MONGODB_URI` (Production) — Atlas connection string, needs user value.
  - Already in Vercel Production: Firebase web config, `FIREBASE_PROJECT_ID`,
    `AI_PROVIDER`, `AI_MODEL`, `OPENAI_REASONING_EFFORT`, `MONGODB_DB`,
    `ALLOWED_EMAILS`.
- [ ] **Autodeploy to Vercel on push.** Project is CLI-linked (`.vercel/`) but
      not git-connected, so `git push` does NOT deploy yet. Run
      `vercel git connect` to enable deploy-on-push to `main` — AFTER the two
      secrets land, so the first prod deploy isn't broken.
- [ ] **Wikipedia-style crosslinks between answers.** Identify references across
      answers and link them. Approach TBD (title/entity match vs `[[wiki-link]]`
      the model emits vs embeddings relatedness). Depends on per-submission URLs.
- [ ] **Related-questions autocomplete dropdown (hybrid search).** As the user
      types, surface related prior questions via keyword + vector search. Needs
      infra decision: embeddings provider + vector store (Atlas Vector Search?).
- [ ] **Emulator re-imports deleted accounts on restart.** Each restart
      re-imports `panda.algae.992@example.com` from
      `.firebase/emulator-data/auth_export/accounts.json` (re-deleted manually
      each time). Fix the fixture or enable export-on-exit so deletions persist.
- [ ] **Local dev pattern agent-browser can drive end-to-end.** Signed-in UI is
      unreachable from agent-browser's headless Chrome: `onAuthStateChanged`
      never fires there (works in a normal browser; emulator/connectivity fine).
      Options: dev-only auth bypass/seeded session, emulator REST state import,
      or a persistent Chrome profile with a pre-authed account.

## Recently shipped

- [x] 8-bit robot mascot replaces SparklesIcon in sign-in card + header. (committed)
- [x] Minimal workspace UI: removed hero copy + verbose card descriptions. (committed)
- [x] Removed the color-scheme picker; theme is always `system`.
- [x] Submissions list + `GET /api/answers` / `listAnswers`; header "New" button.
- [x] Delete submissions: `DELETE /api/answers/[id]` + `deleteAnswer` + row trash.
- [x] Sign-in card minimalism: dropped the description and the
      "Private preview for …" line.
- [x] Removed the "Press ⌘/Ctrl + Enter" input hint under the question box.
- [x] System prompt: if the query is ambiguous, interpret it as philosophical
      and answer in thorough detail.
- [x] Inline attribution: merged the Edit + Authorship areas into one editor
      that highlights AI vs. user text on the field as you type
      (`HighlightedEditor`).
- [x] Switched local dev to REAL AI (`pnpm dev:local`, openai/gpt-5.5); mock off.
- [x] Deleted the non-allowlisted account from the local Firebase Auth emulator.
- [x] Confirmed the email allowlist is enforced server-side on every route.
- [x] TODOS.md workflow: now committed (was briefly gitignored); AGENTS.md +
      CLAUDE.md hardened so requests are always logged and never dropped.

## Ideas

_(Unscheduled. Promote to Next when ready to act.)_
