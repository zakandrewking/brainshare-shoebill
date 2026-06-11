# Brainshare TODOs

Single source of truth for what we're working on. **Committed** — keep it live
and push changes so alternative clients can coordinate. See `AGENTS.md` →
"Backlog (TODOS.md)" and "Multi-agent locking protocol".

**Locking legend.** Each open item has a stable `[T##]` id and a status:
`unclaimed` · `claimed:<agent>@<UTC>` · `wip:<agent>@<UTC>`. Claim an item by
setting the status to your agent handle and committing+pushing *before* you
start work. If your push is rejected, someone claimed first — pull and pick
another. Stale claims (>30 min, no new commits) may be reclaimed. On completion,
move the item to "Recently shipped". **Next free id: T11.**

## Now

_(Nothing actively in progress.)_

## Next

- `[T04]` `wip:claude-opus-4.8@2026-06-11T05:51Z` — **Get the app working in
  production.** Secrets set in Vercel Production (`OPENAI_API_KEY`, `MONGODB_URI`,
  `MONGODB_DB`); Atlas Network Access `0.0.0.0/0`. Autodeploy + brainshare.io
  alias current. ROOT CAUSE of prod 500 on all API routes (found via vercel
  logs): `ERR_REQUIRE_ESM` — `firebase-admin@14 → jwks-rsa@4` `require()`s
  `jose@6` (pure ESM) in the Vercel Node runtime. FIX IN FLIGHT: pin
  `engines.node` to `22.x` (require(ESM) of sync ESM works on Node ≥22.12; jose
  has no top-level await). If Vercel is already on 22 and it still 500s, fall
  back to bundling firebase-admin's jose instead of externalizing it. Verify:
  unauth API should return 401, and a signed-in smoke test should generate +
  persist.
- `[T05]` `unclaimed` — **Wikipedia-style crosslinks between answers.** Identify
  references across answers and link them. Approach TBD (title/entity match vs
  `[[wiki-link]]` the model emits vs embeddings relatedness). Depends on T02.
- `[T06]` `unclaimed` — **Related-questions autocomplete dropdown (hybrid search).**
  As the user types, surface related prior questions via keyword + vector
  search. Needs infra decision: embeddings provider + vector store (Atlas Vector
  Search?).
- `[T07]` `unclaimed` — **Emulator re-imports deleted accounts on restart.** Each
  restart re-imports `panda.algae.992@example.com` from
  `.firebase/emulator-data/auth_export/accounts.json`. Fix the fixture or enable
  export-on-exit so deletions persist.
- `[T08]` `unclaimed` — **Local dev pattern agent-browser can drive end-to-end.**
  Signed-in UI is unreachable from agent-browser's headless Chrome:
  `onAuthStateChanged` never fires there (works in a normal browser;
  emulator/connectivity fine). Options: dev-only auth bypass/seeded session,
  emulator REST state import, or a persistent pre-authed Chrome profile.
- `[T10]` `unclaimed` — **Locking handles must be unique per agent instance.**
  Two concurrent clients both claimed items as `claude-opus-4.8` (the model
  name), so claims can't be told apart and stale-claim takeover is ambiguous.
  Update the protocol to use a unique instance/session id (e.g.
  `claude-opus-4.8/<short-session>`), and document it in AGENTS.md.

## Recently shipped

- [x] `[T03]` Retro restyle (Win95 / classic Mac chrome): `--radius: 0`, silver
      palette + dark "graphite" variant, centralized raised/sunken bevel system
      in `globals.css` (unlayered `--raise`/`--sink` keyed off `data-slot`),
      classic system font stack, flattened the radial gradients, navy text
      selection. Inner reading/editor panels are white sunken wells. Build green;
      needs live visual review (built blind — agent-browser can't reach signed-in UI).
- [x] `[T02]` Rework submissions UI: moved the list into a slide-out Sheet (new
      `ui/sheet.tsx` on Base UI Dialog), opened from a header "Submissions"
      button with a count badge. Open answer is addressable via `?a=<id>` synced
      with the History API (deep links + back/forward; `/` stays statically
      rendered, no Suspense bailout).
- [x] `[T09]` Multi-agent locking protocol: stable `[T##]` ids + claim status on
      TODOS.md, documented in AGENTS.md (git-as-lock claim/push flow).
- [x] `[T01]` Regenerate + overwrite an existing submission in place (another
      client): `PUT /api/answers/[id]` + `regenerateAnswer` re-streams the model,
      replaces `aiText`, resets `currentText`, recomputes attribution; same id.
- [x] Vercel autodeploy on push to `main` (git-connected); pushes deploy to Production.
- [x] OPENAI_API_KEY + MONGODB_URI added to Vercel Production.
- [x] CLAUDE.md: log every request before acting; OK to combine/dedupe/organize.
- [x] 8-bit robot mascot replaces SparklesIcon in sign-in card + header.
- [x] Minimal workspace UI: removed hero copy + verbose card descriptions.
- [x] Removed the color-scheme picker; theme is always `system`.
- [x] Submissions list + `GET /api/answers` / `listAnswers`; header "New" button.
- [x] Delete submissions: `DELETE /api/answers/[id]` + `deleteAnswer` + row trash.
- [x] Sign-in card minimalism: dropped the description and "Private preview" line.
- [x] Removed the "Press ⌘/Ctrl + Enter" input hint.
- [x] System prompt: ambiguous → interpret as philosophical, answer in detail.
- [x] Inline attribution: merged Edit + Authorship into one `HighlightedEditor`
      that highlights AI vs. user text on the field as you type.
- [x] Switched local dev to REAL AI (`pnpm dev:local`, openai/gpt-5.5).
- [x] Deleted the non-allowlisted account from the local Firebase Auth emulator.
- [x] Confirmed the email allowlist is enforced server-side on every route.

## Ideas

_(Unscheduled. Promote to Now/Next with a fresh id when ready.)_
