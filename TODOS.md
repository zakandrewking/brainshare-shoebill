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
**Next free id: T31.**

## Now

_(empty — claim the first actionable item in Next/Ideas)_

## Next

_(empty — promote from Ideas when ready)_

## Recently shipped

- [x] `[T30]` Related-questions suggestions no longer cover the "Generate
      answer" button: the panel renders in normal flow under the textarea
      (pushing the button down) instead of as an absolute overlay.
- [x] `[T13]` **Hybrid related-questions shipped + verified live (2026-06-12).**
      Questions are embedded server-side (AI SDK `embedMany` + OpenAI
      `text-embedding-3-small` at 256 dims; deterministic local embedder under
      `AI_PROVIDER=mock`), stored on the answer doc with an
      `embeddingModel` tag (`openai/text-embedding-3-small@256`) so stale
      vectors re-embed. New `POST /api/related` embeds the typed query +
      lazily backfills missing candidate vectors in one batch, ranks via pure
      `rankRelatedHybrid` (0.6·cosine + 0.4·normalized keyword, cosine floor
      0.3 for zero-keyword matches; degrades to keyword-only without a
      backend). Workspace debounces (250 ms) to the endpoint, keeps instant
      local keyword results as fallback. No new infra — brute-force cosine
      over the tiny corpus; ANN/Atlas Vector Search deferred until scale
      demands it. 14 new tests; `pnpm verify` green. Verified on prod:
      "compassion toward people you do not know" → "should i be kind to
      strangers?", "the subjective experience of animals" → "whats it like to
      be a bat" (zero keyword overlap), 401 unauthorized, all 3 prod docs
      backfilled with vectors.
- [x] `[T14]` **Prod GitHub login: RESOLVED — verified working (2026-06-12).**
      Remotely verified every item of the old user checklist: authorized
      domains include `brainshare.io`/`www`/firebaseapp.com (public
      identitytoolkit `getProjectConfig`), GitHub provider enabled
      (`createAuthUri` returns a live authorize URL), GitHub OAuth callback
      accepted (no `redirect_uri_mismatch` page), Vercel
      `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=brainshare-a67c5.firebaseapp.com`
      matches the live bundle's inlined config, `/__/auth/handler` + iframe
      serve 200, no COOP headers on www.brainshare.io. agent-browser
      click-through on prod reaches GitHub's sign-in page cleanly. Decisive
      evidence: prod answers created/edited 01:01–01:52Z on 2026-06-12 — the
      first two predate the service token's existence (first token commit
      01:50Z), so they required real signed-in browser sessions. The earlier
      auth-gate fix (error surfacing + popup→redirect fallback) stands.
- [x] `[T28]` Session handoff saved (2026-06-12). State: prod-data API access
      (T24–T27) fully shipped and verified; `SERVICE_API_TOKEN` lives in Vercel
      Production (type `encrypted`) AND the Claude environment env vars; usage
      documented in AGENTS.md → "Prod Data Access (agents)". Open work: `[T14]`
      (blocked on the user console checklist) and `[T13]` (needs an
      embeddings/vector-store infra decision + Atlas index access). Agent
      sandbox notes: Mongo 27017 egress is blocked (HTTPS only), Vercel
      CLI works via `VERCEL_ACCESS_TOKEN`.
- [x] `[T27]` `SERVICE_API_TOKEN` "looked empty": the CLI had created it as
      type **sensitive** (write-only — runtime sees it, but `vercel env pull`
      and the dashboard return `""` by design). Deleted and recreated it as
      type **encrypted** with the identical value via the REST API. Verified:
      `vercel env pull --environment=production` now returns the 64-char token
      and prod still answers 200 with it. When adding secrets via
      `vercel env add`, pass `--sensitive` only when read-back is never needed.
- [x] `[T25]` **Service-token API access to prod data — live and verified.**
      `requireAuthorizedUser` accepts `Authorization: Bearer <SERVICE_API_TOKEN>`
      (timing-safe, ≥32 chars) acting as the primary allowlisted user; new
      read-only `POST /api/admin/find` (service-token only, equality-only
      filters, `$` keys rejected, limit ≤ 200, hex `_id` auto-converted).
      Identity resolves via `adminAuth.getUserByEmail`, falling back to the uid
      on stored answers (prod has no Admin credentials — discovered live, fixed
      in `3871bdc`). Token set in Vercel Production env via CLI. Verified
      against brainshare.io: 200 + real data with token (typed route + find),
      401 without/with wrong token, 400 for `$where` and unknown collections.
      14 new unit tests; `pnpm verify` green. Documented in AGENTS.md → "Prod
      Data Access (agents)". DONE 2026-06-12: user added `SERVICE_API_TOKEN`
      to the Claude environment env vars — future agent sessions can query
      prod directly with `$SERVICE_API_TOKEN`.
- [x] `[T26]` "Never wait" codified in AGENTS.md Working Agreement: deliver a
      requested plan and immediately execute it; no pausing for approval.
- [x] `[T24]` Planned token-based prod-data access over the API; concrete
      implementation steps captured as `[T25]` in Next. Key choices: reuse the
      deployed app's API (no new service), one static `SERVICE_API_TOKEN`
      recognized by `requireAuthorizedUser` that impersonates the allowlisted
      user, plus a read-only allowlisted `/api/admin/find` for ad-hoc queries.
      Rejected: Atlas Data API (deprecated 2025), separate proxy service,
      relaxing sandbox egress (user: not available).
- [x] `[T23]` Confirmed agent access: **Vercel logs ✅** (`vercel` CLI +
      `VERCEL_ACCESS_TOKEN` authenticates as `zakandrewking`; pulled live prod
      runtime logs for `brainshare-shoebill`). **Mongo shell ❌ from this
      container**: `mongosh` IS installed and `MONGO_URI` is set, DNS resolves
      the Atlas SRV/A records, but the sandbox network policy only allows
      HTTPS (443) egress — TCP 27017 (and 22) time out, so the Mongo wire
      protocol can't connect. Not an Atlas allowlist issue (0.0.0.0/0 per T04).
      Fix: relax the Claude Code environment network policy to allow port
      27017 / full network access.
- [x] `[T22]` Surface the model's reasoning / "thinking". `/api/generate` now
      streams a small NDJSON protocol (`{t:"reasoning"|"text"|"error",v}`) over
      the SDK `fullStream` instead of text-only, and requests OpenAI reasoning
      summaries (`reasoningSummary:"auto"`). The streaming card shows a live,
      collapsible "Thinking" box as the reasoning summary streams, a "Thinking…"
      header/placeholder before any output (the long high-effort gap), then flips
      to "Writing" once text arrives. Reasoning is ephemeral (not persisted).
      Mock provider emits fake reasoning+text so it's exercisable locally; new
      `ai.test.ts` asserts reasoning-precedes-text NDJSON. Build/lint/21 tests
      green. NOTE: OpenAI only returns summaries (not raw reasoning) and some
      orgs need verification for them — if absent, the "Thinking…" indicator
      still conveys when it's reasoning.
- [x] `[T21]` Fix "answer streams fully, then shows an error." Root mechanism:
      `toTextStreamResponse()` aborts the HTTP body when the model stream emits a
      late error part *after* delivering all text deltas, so the client's final
      `reader.read()` rejected and the whole answer was discarded + a toast
      shown. Fix: (a) `lib/ai.ts` adds `onError` so the real provider error is
      logged (default handler swallowed it on Vercel); (b) `answer-workspace.tsx`
      `streamGeneration` now catches a trailing stream abort and keeps the
      already-streamed text (saving what the user saw) instead of throwing —
      only erroring if zero text arrived. Covers generate + regenerate. Build +
      lint + typecheck green. NOTE: if the underlying cause is a maxDuration=120
      timeout on high-effort generations, answers may still truncate — flagged
      to user; tune reasoningEffort/maxDuration if so.
- [x] `[T20]` Philosophy / truth-seeking vibe. System prompt (`lib/ai.ts`)
      reframed as a "contemplative companion in the search for truth about the
      universe" — first-principles reasoning, fair weighing of views, honest
      uncertainty — while keeping the one-paragraph / no-headings / `[[concept]]`
      crosslink rules. Question area copy: label "What truth do you seek?",
      placeholder "Does the universe have meaning, or do we give it one?". Build
      + lint + tests green.
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

- `[T29]` `unclaimed` — **GitHub OAuth app name typo: "Brainshaire".** The
  GitHub sign-in page says "Sign in to GitHub to continue to *Brainshaire*".
  USER-ONLY fix: rename the OAuth app at github.com → Settings → Developer
  settings → OAuth Apps (client id `149293a6eb61bdb60b87`). Cosmetic; no code
  change.
