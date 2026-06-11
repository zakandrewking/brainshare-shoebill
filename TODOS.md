# Brainshare TODOs

Single source of truth for what we're working on. **Committed** — keep it live
and push changes so alternative clients can coordinate. See `AGENTS.md` →
"Backlog (TODOS.md)" and "Multi-agent locking protocol".

**Locking legend.** Each open item has a stable `[T##]` id and a status:
`unclaimed` · `claimed:<agent>@<UTC>` · `wip:<agent>@<UTC>`. `<agent>` is a
unique per-instance handle `<model>/<short-id>` (e.g. `claude-opus-4.8/ae44`),
never just the model name. Claim an item by setting the status to your handle
and committing+pushing *before* you start work. If your push is rejected,
someone claimed first — pull and pick another. Stale claims (>30 min, no new
commits) may be reclaimed. On completion, move the item to "Recently shipped".
**Next free id: T20.**

## Now

- `[T14]` `wip:claude-opus-4.8/ae44@2026-06-11T15:28Z` (taken over from 9yf1, user-directed) — **Prod GitHub login is
  still broken.** CODE DONE (pushed): auth-gate now (a) surfaces the real
  Firebase error code instead of a generic message, (b) falls back from
  `signInWithPopup` to `signInWithRedirect` on popup/COOP failures, and (c)
  handles `getRedirectResult` + allowlist on return. Root cause is almost
  certainly CONFIG (can't see/change from here). USER CHECKLIST: 1) Firebase →
  Authentication → Settings → **Authorized domains** must include `brainshare.io`
  (and `www.`/the vercel.app domain). 2) GitHub OAuth App **callback URL** =
  `https://brainshare-a67c5.firebaseapp.com/__/auth/handler`. 3) Vercel
  `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `brainshare-a67c5.firebaseapp.com` (NOT
  brainshare.io). 4) GitHub provider enabled in Firebase Auth. THEN retry and
  report the error code now shown in the toast — it pinpoints which of the above.

## Next

- `[T13]` `unclaimed` — **Related-questions: vector/hybrid ranking (T06 follow-up).**
  Upgrade the keyword dropdown to hybrid search. Needs an infra decision
  (embeddings provider + vector store — Atlas Vector Search?), likely a server
  endpoint that embeds the query and ANN-searches stored question embeddings.

## Recently shipped

- [x] `[T15]` Splash logo + "Brainshare" title now centered (CardHeader
      `justify-items-center text-center`). Verified live at mobile (390px, 2x)
      and desktop widths via agent-browser screenshots.
- [x] `[T16]` Top bar mobile polish: Submissions/New collapse to icon-only
      buttons below `sm` (labels `hidden sm:inline`, `aria-label`s added), the
      wordmark truncates, mascot `shrink-0`, tighter `gap-1` on mobile. Build
      green; signed-in width review still needs OAuth (not headlessly drivable).
- [x] `[T17]` ChatGPT-style fade-in for streamed answers: Streamdown
      `animated={{ animation: "fadeIn", sep: "word", duration: 450 }}` on the
      streaming well (word-by-word fade; `sd-fadeIn` keyframes ship in
      streamdown/styles.css). Static rendered view unaffected.
- [x] `[T18]` Literary typography for generated answers: new `.literary-prose`
      (system old-style serif — Iowan/Palatino/Georgia — with book leading &
      measure, italic blockquotes, scaled headings) on the rendered + streaming
      wells; code/pre stay monospaced. Full markdown still renders. No web-font
      network dependency.
- [x] `[T19]` Splash no longer crashes on a bad/missing Firebase config:
      `getRedirectResult()` throws *synchronously* on `auth/invalid-api-key`,
      which was escaping the `.catch()` and taking the whole page to Next's error
      boundary. Auth init is now wrapped in try/catch (degrades to a toast + the
      reachable sign-in card), with a dedicated `auth/invalid-api-key` message.
      Reproduced the crash and verified the fix live in agent-browser.
- [x] `[T08]` Dev pattern for agent-browser: drive a **production build** (`pnpm build && pnpm start`) or the deployed preview — NOT `next dev`, whose Turbopack HMR/React Refresh stalls client hydration under agent-browser's CDP Chrome (reproduced headed+headless; prod hydrates fine). Documented in AGENTS.md Verification Loop. Also added a 6s auth-splash loading timeout so it can't hang. Verified brainshare.io hydrates in agent-browser + screenshotted the retro sign-in. (Signed-in E2E still needs GitHub OAuth, not headlessly drivable.)
- [x] `[T06]` Related-questions autocomplete (keyword half). Pure, unit-tested
      `findRelatedQuestions` (`lib/related.ts`, 8 tests) ranks the already-loaded
      submissions by shared significant words + a substring/prefix boost,
      stopword-filtered, newest-first tie-break. Dropdown under the question box
      surfaces matches as you type; clicking opens that submission (`?a=<id>`).
      No new infra/endpoint. Vector/hybrid ranking deferred to T13. Build green;
      needs signed-in visual review.
- [x] `[T07]` Auto-purge non-allowlisted emulator accounts. `scripts/clean-emulator-auth.mjs` deletes any emulator account whose email isn't in `ALLOWED_EMAILS`; `dev.mjs` runs it once the emulator is up, so stray imports (`panda.algae.*`) no longer survive restarts. Verified: injected junk account removed, allowlisted kept.
- [x] `[T12]` AGENTS.md: added an explicit rule that ALL feedback (corrections,
      reactions, "oops" notes, preferences, offhand remarks) is captured in
      TODOS.md first — not just explicit asks — and reactions to shipped work
      become new items before replying.
- [x] `[T11]` Splash robot mascot enlarged from `size-16` (64px) to `size-32`
      (128px) on the sign-in card; kept pixelated rendering.
- [x] `[T10]` Locking handles must be unique per instance (`<model>/<short-id>`).
      Updated the protocol in AGENTS.md and the TODOS legend.
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
