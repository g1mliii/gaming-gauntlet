# Gaming Gauntlet

Gaming Gauntlet is a Twitch-integrated match control platform for streamer-versus-streamer game challenges. It merges both chats into a live suggestion board, lets streamers and mods curate the queue in real time, and powers both an OBS browser-source overlay and a Twitch video overlay extension from the same match state.

## Stack

- **Web app**: React + Vite + React Router
- **Extension app**: React + Vite multi-page build for Twitch `video_overlay` and `config`
- **Edge backend**: Cloudflare Workers + Durable Objects + D1 + Queues
- **Shared contracts**: TypeScript + Zod
- **Testing**: Vitest + Playwright
- **Tooling**: ESLint, Prettier, Wrangler, npm workspaces

## Workspace Layout

```text
gaming-gauntlet-twitch/
  apps/
    web/        # Public site, dashboard, control room, live pages, OBS overlay
    extension/  # Twitch extension entries: video overlay + config
    edge/       # Worker API, EventSub receiver, EBS, Durable Objects, D1 migrations
  packages/
    contracts/  # Shared schemas, domain models, command parsing, mock data
    ui/         # Design tokens, layout primitives, scoreboards, suggestion board UI
  tasks/        # Task tracking, operating principles, lessons learned
```

## Getting Started

```bash
npm install
npm run dev
```

Separate dev commands:

```bash
npm run dev:web
npm run dev:extension
npm run dev:edge
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run verify
```

Build outputs:

```bash
npm run build
npm run test:e2e
```

## Twitch Setup Checklist

1. Create a Twitch application for broadcaster OAuth.
2. Create a dedicated shared bot account and authorize the required chat scopes.
3. Create a Twitch Extension with `video_overlay` and `config` views.
4. Populate `.env.example` values in local secrets or `.dev.vars`.
5. Configure EventSub webhook callback URLs to the deployed Worker and set `TWITCH_EVENTSUB_SECRET`.

## Phase 2 Local Flow

1. Configure `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, `TWITCH_EVENTSUB_SECRET`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY`.
2. Start the workspace with `npm run dev`.
3. Open `/dashboard` and sign in with Twitch.
4. Create a broadcaster invite for the opposing channel login.
5. Open the generated `/link/:inviteCode` URL with the invited broadcaster account to activate the pair.
6. Assign moderators after they have signed in once with Twitch.
7. Draft matches from the active broadcaster pair in the dashboard.

## Cloudflare Setup Checklist

1. `npx wrangler whoami`
2. Create the D1 database and update `wrangler.toml`.
3. Create the event ingest queue.
4. Set Worker secrets for `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `TWITCH_EXTENSION_SECRET` as needed.
5. Deploy the worker and Durable Object bindings.
6. Point the web and extension assets to the deployed edge origins.

## Docs

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - phased roadmap and architecture decisions
- [AGENT.md](AGENT.md) - repo workflow and engineering guardrails
- [CLAUDE.md](CLAUDE.md) - quick reference for commands, routes, and environment setup
- [tasks/operating_principles.md](tasks/operating_principles.md) - non-negotiable delivery rules

## License

[MIT](LICENSE)
