# Brainshare Agent Guide

## Working Agreement

- Work autonomously from diagnosis through implementation and verification.
- You are authorized to create focused commits and push them often. Do not ask
  for permission before committing or pushing coherent changes.
- **Always push to `main`.** When work is committed and verified, fast-forward
  (or merge) it onto `main` and push so it deploys to production — no need to
  ask each time. Vercel autodeploys `main`.
- **Always advance the backlog.** When you finish an item, immediately claim and
  start the next ready one in `TODOS.md` (top of **Now**, otherwise the first
  actionable item in **Next**, skipping items another agent has claimed). Keep
  going on your own — do not stop to ask which item to do next or whether to
  continue. A fresh user request takes priority over the backlog; capture it,
  do it, then resume advancing. Only pause for a genuine blocker (a decision
  that's the user's to make, or missing access/secrets).
- Never commit secrets, `.env.local`, Firebase service accounts, API keys, or
  production database credentials.
- Preserve user changes in a dirty worktree. Do not reset or revert unrelated
  work.
- Prefer small, reviewable changes over unrelated refactors.

## Backlog (TODOS.md)

**`TODOS.md` is the single source of truth for what we are working on.
Everything goes here.** It is the durable memory across sessions — agents do
not retain a task list on their own.

- **Capture every single request — no exceptions.** The moment the user makes
  an ask, log it in `TODOS.md` *before* you act on it. This includes small,
  quick, or one-line requests, mid-task interruptions, and asks that arrive
  while you are working on something else. Never let a request go unrecorded;
  if several land at once, add them all. Missing a request is a process failure.
- **ALL feedback is a request — capture it too.** "Feedback" is not limited to
  explicit "please do X" asks. It includes corrections ("that's wrong"),
  reactions ("hmm, too big"), regrets/"oops" notes, stated preferences, offhand
  remarks, "next time…" wishes, and anything that implies work or a change of
  direction — even if phrased as a comment rather than a command. When in doubt,
  log it. If the user reacts to something you just shipped, that reaction is a
  new `TODOS.md` item (in **Next** or **Ideas** unless they want it now), logged
  before you respond — do not let it live only in chat.
- Also capture every idea, follow-up, or blocker you discover while working.
- **Keep it live during the dev loop.** As you work, continuously update it:
  add new items the moment they come up, mark items in progress, and check off
  or delete them the moment they ship. It should always reflect the true
  current state of the work.
- At the start of a session, read `TODOS.md` first to pick up outstanding work.
- Sections: **Now** (actively in progress), **Next** (ready to pick up), and
  **Ideas** (unscheduled; promote to Next when ready). Keep entries concrete
  and verifiable.
- `TODOS.md` is **committed** — keep it up to date and commit/push changes so
  alternative clients can pick up and improve the work. When editing it, never
  drop an item: move finished work to "Recently shipped" rather than deleting.
- This is the coarse, human-readable backlog. Use the in-session task tool for
  fine-grained, ephemeral steps within a single task.

## Multi-agent locking protocol

`TODOS.md` may be edited by multiple agents/clients at once. Use git itself as
the lock — no extra infra:

- **Stable ids.** Every open item carries a `[T##]` id. Never reuse one. The
  "Next free id" note at the top of `TODOS.md` is the counter — bump it whenever
  you add an item.
- **Status lifecycle.** `unclaimed` → `claimed:<agent>@<UTC>` (about to start) →
  `wip:<agent>@<UTC>` (actively working) → moved to "Recently shipped" (done).
  `<UTC>` comes from `date -u +%Y-%m-%dT%H:%MZ`.
- **Handles must be unique per instance** — `<agent>` is `<model>/<short-id>`,
  e.g. `claude-opus-4.8/ae44`, never just the model name. Two concurrent clients
  of the same model would otherwise be indistinguishable, making ownership and
  stale-claim takeover ambiguous. Pick a short id once per session (e.g. the
  first 4 chars of your session/run id) and reuse it for every claim.
- **Claim = commit + push, before working.** `git pull --rebase`, set the item's
  status to your handle, commit `claim T##: <title>`, and push. The git ref
  update is atomic: if your push is rejected, another agent claimed first —
  `git pull --rebase`, recheck the item, and if it is now someone else's, pick
  another.
- **Stale claims.** A `claimed`/`wip` item with no new commits for >30 min may
  be reclaimed by any agent; note the takeover on the item.
- **Release.** On completion, move the item to "Recently shipped" with a
  one-line result, commit, and push.

## Product

Brainshare is a private AI-assisted writing app. A signed-in user asks a
question, receives a streamed answer, edits it, and sees which current text is
retained from the AI baseline versus written by the user.

Access is currently restricted to `zaking17@gmail.com`. Enforce this on the
server in addition to any client-side messaging.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- shadcn/ui components with `next-themes`
- Firebase Authentication with GitHub OAuth
- Production Firebase project: `brainshare-a67c5`
- Firebase Admin token verification in route handlers
- MongoDB Atlas in production and Atlas Local via Docker for development
- Production MongoDB Atlas project: `6a2a2fac94fa5609d018973c`
- Vercel AI SDK with OpenAI by default
- `gpt-5.5` with `reasoningEffort: "high"` as the default model
- Streamdown for streamed and static Markdown rendering
- Vitest for focused unit tests

## Repository Map

- `src/app/`: pages, layout, and API route handlers
- `src/components/`: product UI and generated shadcn components
- `src/lib/ai.ts`: provider/model configuration and streaming
- `src/lib/auth.ts`: server authorization and email allowlist
- `src/lib/firebase/`: Firebase browser and Admin setup
- `src/lib/answers.ts`: answer persistence
- `src/lib/attribution.ts`: AI/user text attribution
- `docker-compose.yml`: local Atlas-compatible MongoDB
- `firebase.json`: local Auth Emulator configuration

## Commands

- `pnpm dev:local`: start Atlas Local, Firebase Auth Emulator, and Next.js
- `pnpm dev:mock`: same local stack with a deterministic no-cost model
- `pnpm dev:down`: stop local MongoDB
- `pnpm lint`: ESLint
- `pnpm test`: Vitest
- `pnpm typecheck`: TypeScript
- `pnpm build`: production build
- `pnpm verify`: full verification

## Implementation Rules

- Use Server Components by default. Add `"use client"` only where browser
  state, Firebase client auth, or interactive UI requires it.
- Keep all secrets and AI calls server-side.
- Verify Firebase ID tokens and the allowed email on every protected API route.
- Validate request bodies with Zod.
- Keep the AI provider and model configurable through environment variables.
- Use Vercel AI SDK abstractions instead of provider-specific fetch calls.
- Stream generated text to the browser. Persist only the completed AI baseline.
- Derive attribution from `aiText` and `currentText`; do not mutate the original
  AI baseline after it is stored.
- Reuse shadcn components and existing design tokens before adding UI
  dependencies.
- Include loading, empty, error, unauthorized, and mobile states for user-facing
  workflows.

## Verification Loop

After meaningful UI changes:

1. Run focused checks, then `pnpm verify` before considering the work complete.
2. For agent-browser inspection, drive a **production build**, not `next dev`:
   `pnpm build && pnpm start` (or the deployed preview / `brainshare.io`). The
   `next dev` server's Turbopack HMR / React Refresh stalls client hydration
   under agent-browser's CDP-controlled Chrome — the page sticks on the loading
   skeleton and no effects run (reproduced headed and headless). A production
   build hydrates normally. Use `pnpm dev:local` / `pnpm dev:mock` for everyday
   hand testing in your own browser.
3. Use [agent-browser](https://github.com/vercel-labs/agent-browser) to inspect
   and operate the real UI.
4. Check desktop and mobile widths, light and dark themes, browser console
   errors, and failed network requests.
5. Exercise sign-in, streaming, editing, attribution, saving, and sign-out.
6. Capture a screenshot when visual review is useful.

Prefer accessibility-tree refs from `agent-browser snapshot` over brittle CSS
selectors. Re-snapshot after navigation or major state changes.

## Agent Guidance

- Give coding agents a goal, relevant context, constraints, and a concrete
  definition of done.
- Keep this file concise and factual. Add instructions after repeated friction,
  not speculative preferences.
- Use nested `AGENTS.md` files only when a subtree genuinely needs different
  commands or conventions.
- Claude Code reads `CLAUDE.md`, so keep the root `CLAUDE.md` as an import of
  this file instead of duplicating instructions.
- Avoid simultaneous agents editing the same files.

## Skills

Do not create a repo-specific skill yet. The current workflows are direct and
well covered by this guide plus the installed `agent-browser` skill. Create a
focused skill only when a multi-step process repeats, needs scripts or reference
material, or is too detailed to load into every session.

## Reference Sources

- [Codex best practices](https://developers.openai.com/codex/learn/best-practices)
- [Codex AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md)
- [Claude Code project memory](https://code.claude.com/docs/en/memory)
- [Next.js AI coding agents](https://nextjs.org/docs/app/guides/ai-coding-agents)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Streamdown](https://github.com/vercel/streamdown)
- [Firebase Auth Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth)
- [MongoDB Atlas Local](https://www.mongodb.com/docs/atlas/cli/current/atlas-cli-deploy-docker/)
