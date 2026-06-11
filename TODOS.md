# Brainshare TODOs

Single source of truth for what we're working on. **Committed** — keep it live
and push changes so alternative clients can coordinate. See `AGENTS.md` →
"Backlog (TODOS.md)" and "Multi-agent locking protocol".

**Locking legend.** Each open item has a stable `[T##]` id and a status:
`unclaimed` · `claimed:<agent>@<UTC>` · `wip:<agent>@<UTC>`. Claim an item by
setting the status to your agent handle and committing+pushing *before* you
start work. If your push is rejected, someone claimed first — pull and pick
another. Stale claims (>30 min, no new commits) may be reclaimed. On completion,
move the item to "Recently shipped". **Next free id: T13.**

## Now

_(Nothing actively in progress.)_

## Next

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

- [x] `[T12]` AGENTS.md: added an explicit rule that ALL feedback (corrections,
      reactions, "oops" notes, preferences, offhand remarks) is captured in
      TODOS.md first — not just explicit asks — and reactions to shipped work
      become new items before replying.
- [x] `[T11]` Splash robot mascot enlarged from `size-16` (64px) to `size-32`
      (128px) on the sign-in card; kept pixelated rendering.
- [x] `[T05]` Wikipedia-style crosslinks. Model emits `[[Topic]]` (system prompt
      updated, used sparingly); pure unit-tested `resolveCrosslinks` rewrites
      them to `[Label](?a=<id>)` when the topic matches another submission
      (normalized exact or phrase match, excludes self), else plain text so raw
      `[[ ]]` never leaks. Rendered answer passes through it before Streamdown;
      editor keeps raw text. 8 tests; build green. Visual click-through needs a
      signed-in review.
- [x] `[T04]` Prod unblocked. Root cause of the all-routes 500 was
      `ERR_REQUIRE_ESM` (`firebase-admin@14 → jwks-rsa@4` require()s ESM-only
      `jose@6` on Vercel). Fixed by pinning `jwks-rsa>jose` to `4.15.9` (CJS) via
      pnpm overrides in `pnpm-workspace.yaml`; also pinned `engines.node` 22.x.
      Live API now returns 401 for unauth (was 500); secrets + Atlas `0.0.0.0/0`
      set; autodeploy current on brainshare.io. REMAINING (user): signed-in
      smoke test — log in at brainshare.io, ask a question, confirm it streams,
      saves, and reappears after reload.
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
