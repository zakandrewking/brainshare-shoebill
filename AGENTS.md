# Brainshare Agent Guide

## Working Agreement

- Work autonomously from diagnosis through implementation and verification.
- You are authorized to create focused commits and push them often. Do not ask
  for permission before committing or pushing coherent changes.
- Never commit secrets, `.env.local`, Firebase service accounts, API keys, or
  production database credentials.
- Preserve user changes in a dirty worktree. Do not reset or revert unrelated
  work.
- Prefer small, reviewable changes over unrelated refactors.

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
2. Start the app with `pnpm dev:local` or `pnpm dev:mock`.
3. Use [agent-browser](https://github.com/vercel-labs/agent-browser) to inspect
   and operate the real local UI.
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
