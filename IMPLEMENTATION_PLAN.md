# Gaming Gauntlet Implementation Plan

## Overview

Gaming Gauntlet is a Twitch-native challenge board for streamer-vs-streamer events. It merges both chats into one live game queue, lets streamers and mods curate suggestions in real time, and keeps the website, OBS overlay, and Twitch Extension aligned from one authoritative match state.

## Product Guardrails

- **Chat-first v1**: viewers interact through Twitch chat commands, not the website.
- **Dual overlays**: every live match state must render cleanly in both OBS and the Twitch video overlay extension.
- **Streamer override wins**: chat suggestions guide the show, but moderators and streamers always have the final call.
- **Cloudflare-first runtime**: Worker APIs, Durable Objects for live sessions, D1 for durable data, Queues for webhook processing.
- **Multi-tenant from day one**: all persistent data and routes must be safe for multiple broadcaster pairs.
- **Keep bootstrapping honest**: Phase 1 should leave the repo buildable, documented, and ready for Phase 2 implementation.

## Design Direction

- **Primary audience**: viewers watching the live match, with streamers/mods as the operating users.
- **Brand personality**: playful, animated, intense.
- **Theme**: dark-only. Do not allocate implementation time to light mode.
- **Visual goal**: bold, broadcast-grade versus presentation with strong hierarchy, large score surfaces, and fast readability.
- **Watchability first**: the score, current game, queue order, and match momentum must be understandable at a glance on stream.
- **Shared surface language**: web pages, OBS overlays, and Twitch Extension overlays should feel like one live show across different containers.
- **Accessibility defaults**: treat WCAG AA as the baseline, respect `prefers-reduced-motion`, and keep competitive states distinguishable for common color-vision deficiencies.

## Recommended Stack

- **Apps**: React 19 + Vite + TypeScript
- **Routing**: React Router for the web app; multi-page Vite build for the extension
- **API runtime**: Cloudflare Workers
- **Realtime**: Durable Objects + WebSockets
- **Persistence**: D1
- **Background ingestion**: Cloudflare Queues
- **Validation**: Zod
- **Testing**: Vitest + Playwright

## Domain Decisions

### Roles

- `owner`
- `streamer`
- `mod`

### Chat Commands

- `!gg suggest <game title>`
- `!gg vote <board id>`
- `!gg board`
- `!gg help`

### Match Rules

- One match links two Twitch channels
- Both chats feed a shared suggestion board
- Suggestions normalize into a canonical title key
- Duplicate suggestions merge automatically when normalization confidence is high
- Streamers/mods can merge, split, approve, reorder, randomize, and manually add queue entries
- `targetWins` is nullable
- Results are entered manually in v1

## Workspace Layout

```text
apps/
  web/
  extension/
  edge/
packages/
  contracts/
  ui/
tasks/
```

## Delivery Phases

### Phase 1 - Repo Bootstrap

- Create the npm workspace and all app/package shells
- Add root docs, repo conventions, and task tracking files
- Add shared contracts for roles, chat commands, match snapshots, and score state
- Add design tokens and shared UI primitives
- Add web and extension shells with all core routes/views
- Add Worker skeleton with Durable Object, D1 migration, and placeholder API endpoints
- Add lint, typecheck, test, build, and Playwright scaffolding
- Bake the dark-only, broadcast-first design direction into the base tokens and shell layouts

### Phase 2 - Auth And Match Creation

- Twitch OAuth flow for broadcasters
- Channel linking and role assignment
- D1-backed match creation and listing
- Audit log and base permissions model

### Phase 3 - EventSub And Suggestion Board

- EventSub verification endpoint
- Shared bot + broadcaster authorization flow
- Chat command parsing and validation
- Suggestion normalization, duplicate merging, and vote aggregation
- Queue producer and retry handling

### Phase 4 - Control Room

- Approve and manage suggestions
- Queue reordering and randomization
- Manual add / remove flows
- Start round, record winner, close round

### Phase 5 - Live Match Surfaces

- Public match pagei think this is alerayd done somewhat just cehck
- OBS/browser-source overlay same with this
- Realtime websocket sync via Durable Object snapshots and deltas not sure if we still use this as its extremly expensive i think we chose a diff solution already Tune the live surfaces for watchability first: score clarity, current game emphasis, and legible queue state

### Phase 6 - Twitch Extension

- Video overlay entry
- Broadcaster config view
- Extension JWT issuance
- Local rig support and extension packaging guidance
- Preserve the same visual language as the OBS overlay while respecting Twitch iframe constraints

### Phase 7 - Hardening

- Moderation tools
- Reconnect and idempotency logic
- Error states and empty states
- Deployment runbooks and smoke tests

## Acceptance Criteria For Bootstrap

- `npm install` completes successfully
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` pass
- Every planned workspace exists and compiles
- Shared contracts can power both web and extension demo surfaces
- The Worker responds to a health route and exposes a Durable Object websocket entrypoint
- D1 migration exists for the core match schema
- Repo docs explain local setup and external prerequisites

## Verification Story

- Automated:
  - ESLint on the whole workspace
  - TypeScript project references
  - Vitest for shared domain logic
  - App builds for web, extension, and edge
- Manual:
  - Run the web landing page and inspect all route shells
  - Run the extension pages locally
  - Hit the Worker demo endpoints and websocket route in local dev

## Defaults And Assumptions

- MIT license
- Cloudflare-first deployment
- Shared bot account across channels
- No automated game-result ingestion in v1
- No billing, marketplace, or public team management in v1
