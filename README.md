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
npm run security:deps
npm run lint
npm run typecheck
npm run test
npm run verify
```

Dependency safety:

- `npm run security:deps` fails the build if known-blocked package versions appear in any manifest or in `package-lock.json`.
- Root `overrides` pin known bad publishes away from compromised versions during install.

Build outputs:

```bash
npm run build
npm run test:e2e
```

## Twitch Setup Checklist

1. Create a Twitch application for broadcaster OAuth.
2. Create a dedicated shared bot account and set `TWITCH_SHARED_BOT_LOGIN` to its Twitch login.
3. Use the dashboard's `Connect shared bot` action once to authorize `user:bot`, `user:read:chat`, and `user:write:chat` for that account.
4. Create a Twitch Extension with `video_overlay` and `config` views.
5. Populate `.env.example` values in local secrets or `.dev.vars`.
6. Configure EventSub webhook callback URLs to the deployed Worker and set `TWITCH_EVENTSUB_SECRET`.

## Phase 2 Local Flow

1. Configure `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, `TWITCH_EVENTSUB_SECRET`, `TWITCH_SHARED_BOT_LOGIN`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY`.
2. Start the workspace with `npm run dev`.
3. Open `/dashboard` and sign in with Twitch.
4. Use `Connect shared bot` in the dashboard to store the shared bot refresh token in D1.
5. Create a broadcaster invite for the opposing channel login.
6. Open the generated `/link/:inviteCode` URL with the invited broadcaster account to activate the pair.
7. Assign moderators after they have signed in once with Twitch.
8. Draft matches from the active broadcaster pair in the dashboard.

## Cloudflare Setup Checklist

1. `npx wrangler whoami`
2. Create the D1 database and update `wrangler.toml`.
3. Create the event ingest queue.
4. Set Worker secrets for `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `TWITCH_EXTENSION_SECRET`.
5. Optional shared-bot secrets for the same environment: `TWITCH_BOT_ACCESS_TOKEN` and `TWITCH_BOT_REFRESH_TOKEN`.
6. Deploy the worker and Durable Object bindings.
7. Point the web and extension assets to the deployed edge origins.

Required Wrangler secret commands:

```bash
npx wrangler secret put TWITCH_CLIENT_SECRET --config wrangler.toml
npx wrangler secret put TWITCH_EVENTSUB_SECRET --config wrangler.toml
npx wrangler secret put SESSION_SECRET --config wrangler.toml
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config wrangler.toml
npx wrangler secret put TWITCH_EXTENSION_SECRET --config wrangler.toml
```

Optional shared-bot secrets:

```bash
npx wrangler secret put TWITCH_BOT_ACCESS_TOKEN --config wrangler.toml
npx wrangler secret put TWITCH_BOT_REFRESH_TOKEN --config wrangler.toml
```

Local dev secrets go in `.dev.vars` for `wrangler.local.toml`.

## Twitch Extension Local Test

Local Test settings should match the current extension build outputs:

- Root URI / Testing Base URI: `http://localhost:5174/`
- Video - Fullscreen Viewer Path: `video_overlay.html`
- Video - Component Viewer Path: `video_component.html`
- Config Path: `config.html`
- Live Config Path: `live_config.html`
- Configuration source: `Extension Configuration Service`

Recommended type scope:

- Enable `Video - Fullscreen`
- Enable `Video - Component`
- Disable `Panel`
- Disable `Mobile`

Recommended `connect-src` allowlist entries:

- `http://localhost:8787`
- `https://api.gaming-gauntlet.com`
- `https://gaming-gauntlet-edge.pressplay-subai.workers.dev`

Local test flow:

1. Run `npm run dev:extension`
2. Run `npm run dev:edge`
3. Open the extension in Twitch Local Test
4. Use `config.html` to save the broadcaster match slug
5. Verify `live_config.html`, `video_overlay.html`, and `video_component.html`

Hosted test flow after local verification:

1. Run `npm run build --workspace @gaming-gauntlet/extension`
2. Upload the generated `apps/extension/dist` assets in the Twitch `Files` tab
3. Switch the version from Local Test to Hosted Test
4. Update non-local URIs only after Hosted Test is confirmed

## Wrangler Config Split

- `wrangler.toml` is the production/deploy config and should match the live hosted domains.
- `wrangler.local.toml` is the localhost dev config used by `npm run dev:edge`.
- Local OAuth callback: `http://localhost:8787/api/auth/twitch/callback`
- Production OAuth callback: `https://api.gaming-gauntlet.com/api/auth/twitch/callback`

## Docs

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - phased roadmap and architecture decisions
- [AGENT.md](AGENT.md) - repo workflow and engineering guardrails
- [CLAUDE.md](CLAUDE.md) - quick reference for commands, routes, and environment setup
- [tasks/operating_principles.md](tasks/operating_principles.md) - non-negotiable delivery rules

## License

[MIT](LICENSE)
