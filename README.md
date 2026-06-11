# Brainshare

Private AI-assisted answer writing with streamed generation and explicit
AI-versus-user text attribution.

## Local Development

Requirements:

- Node.js 20.9 or newer
- pnpm
- Docker Desktop
- Java 17 or newer for Firebase Emulator Suite

Install dependencies:

```bash
pnpm install
```

Create `.env.local` from `.env.local.example`. For the default OpenAI path,
configure:

```dotenv
OPENAI_API_KEY=...
AI_PROVIDER=openai
AI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
```

Start Atlas Local, Firebase Auth Emulator, and Next.js:

```bash
pnpm dev:local
```

Use a deterministic model without API calls:

```bash
pnpm dev:mock
```

Local URLs:

- App: http://localhost:3000
- Firebase Emulator UI: http://localhost:4000
- Firebase Auth Emulator: `127.0.0.1:9099`
- MongoDB Atlas Local: `127.0.0.1:27018`

The Auth Emulator intercepts GitHub sign-in locally and lets you enter a test
identity. Use `zaking17@gmail.com` because the same allowlist is enforced by
the server. Emulator auth data is exported under `.firebase/` when it exits.

Stop MongoDB with `pnpm dev:down`. Named Docker volumes preserve local data.

## Production Setup

### Firebase

1. Register a Web app in the Firebase project and copy its browser config into
   the `NEXT_PUBLIC_FIREBASE_*` variables.
2. Enable GitHub under Authentication > Sign-in method.
3. Create a GitHub OAuth app. Its callback URL is:
   `https://brainshare-a67c5.firebaseapp.com/__/auth/handler`
4. Add `localhost`, the Vercel domains, and the custom domain to Firebase
   Authentication authorized domains.
5. Set `FIREBASE_PROJECT_ID=brainshare-a67c5` in Vercel. The server only
   verifies ID-token signatures, so it does not require a service-account key.

### MongoDB

Use Atlas project `6a2a2fac94fa5609d018973c`. Set `MONGODB_URI` to that
project's cluster connection string and `MONGODB_DB=brainshare`. Allow network
access from Vercel. For an early-stage project this is commonly `0.0.0.0/0`
with a strong database user password; narrow it when the deployment
architecture supports stable egress.

### AI

The server uses Vercel AI SDK. Defaults:

```dotenv
AI_PROVIDER=openai
AI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
```

`AI_PROVIDER=anthropic` is also supported when `ANTHROPIC_API_KEY` and a valid
Anthropic model ID are configured. `AI_PROVIDER=mock` is local-only behavior.

### Vercel

Add every variable from `.env.local.example` to the Vercel project, attach the
custom domain, and deploy. Never prefix server secrets with `NEXT_PUBLIC_`.

## Verification

```bash
pnpm verify
```

For UI changes, run the local stack and use
[agent-browser](https://github.com/vercel-labs/agent-browser):

```bash
agent-browser open http://localhost:3000
agent-browser snapshot
agent-browser screenshot /tmp/brainshare.png
agent-browser console
agent-browser errors
```
