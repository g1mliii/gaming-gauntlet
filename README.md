<p align="center">
  <a href="https://gaming-gauntlet.com/"><img src="docs/icon.svg" width="96" height="96" alt="Gaming Gauntlet" /></a>
</p>

<h1 align="center">Gaming Gauntlet</h1>

<p align="center">
  <b>Two players, one wheel, a live scoreboard on stream.</b><br />
  Spin up a match lobby, share one link, and drop the overlays straight into OBS.
</p>

<p align="center">
  <a href="https://gaming-gauntlet.com/"><img src="https://img.shields.io/badge/Start_a_match-gaming--gauntlet.com-e5bd55?style=for-the-badge&labelColor=1d2636" alt="Start a match at gaming-gauntlet.com" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OBS-browser_source_overlays-1d2636?style=flat-square&logo=obsstudio&logoColor=white" alt="OBS overlays" />
  <img src="https://img.shields.io/badge/React-19-1d2636?style=flat-square&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers_%2B_D1-1d2636?style=flat-square&logo=cloudflare&logoColor=F38020" alt="Cloudflare Workers and D1" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/g1mliii/gaming-gauntlet?style=flat-square&color=1d2636" alt="Licence" /></a>
</p>

---

## What it does

- **One link for the match.** Create a lobby and share a single public match URL with your
  opponent and your viewers.
- **Controls stay yours.** Scores and the wheel only unlock with a private management passcode,
  which never appears in a URL, an overlay or anything on screen.
- **Spin the game wheel** to pick what you play next, and keep a live scoreboard as the match goes.
- **Ready-made OBS overlays.** Copy a browser-source URL for each overlay and add it to your scene.

**[Start a match &rarr;](https://gaming-gauntlet.com/)**

---

## For developers

Gaming Gauntlet is a lightweight two-player stream match tool. A streamer creates a lobby, shares one public match URL, keeps write controls behind a private management passcode, spins a game wheel, updates scores, and copies OBS browser-source overlays for the live broadcast.

The V1 stack is intentionally small:

- React 19, Vite, and TypeScript for the web app.
- Cloudflare Pages for the static frontend.
- Cloudflare Worker API for lobby state and writes.
- Cloudflare D1 for lobbies, games, and hashed management passcodes.
- npm workspaces for shared UI and core schemas.

## Repository Layout

```text
apps/web/        React/Vite site, routes, match room, OBS overlay surfaces
apps/api/        Cloudflare Worker API and scheduled retention sweep
packages/core/   Shared Zod schemas, TypeScript types, ID/passcode helpers
packages/ui/     Shared Gaming Gauntlet UI kit and wheel component
migrations/      D1 schema migrations
prototype/       Browser-runnable design reference, not part of the build
scripts/         Deployment config guardrails
```

## Requirements

- Node.js with npm. The repo pins `packageManager` to `npm@11.6.2`.
- A Cloudflare account and Wrangler auth for D1, Worker, and Pages deployment.
- The Worker secret `RATE_LIMIT_KEY_SALT` configured in Cloudflare before using rate-limit bindings:

```sh
npx wrangler secret put RATE_LIMIT_KEY_SALT --config wrangler.api.toml
```

## Local Development

Install dependencies:

```sh
npm install
```

Apply D1 migrations to the local Wrangler database:

```sh
npx wrangler d1 migrations apply gaming-gauntlet-v1 --config wrangler.api.toml --local
```

Start the API Worker in one terminal:

```sh
npx wrangler dev --config wrangler.api.toml
```

Start the web app in another terminal:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite dev server proxies `/api` to Wrangler on `http://127.0.0.1:8787`.

## Main Routes

| Route                        | Purpose                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `/` and `/create`            | Create a new two-player lobby or rejoin a match with a passcode.                                  |
| `/g/:lobbyId`                | Match room. Public score state is visible, but controls unlock only with the management passcode. |
| `/manage/:lobbyId`           | Internal management route that opens the same match room surface.                                 |
| `/g/:lobbyId/obs`            | OBS overlay gallery with copyable browser-source URLs.                                            |
| `/overlay/:lobbyId/:variant` | Individual OBS overlay surface. Variants are defined in `apps/web/src/overlay/catalog.ts`.        |

The match URL is the only shareable human URL. Management passcodes must not be placed in URLs, public API responses, overlays, logs, or scanner-visible UI.

## API Routes

All write routes require `Authorization: Bearer <managementCode>`.

| Method and path                              | Purpose                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/lobbies`                          | Create a lobby and return `{ lobbyId, managementCode }`.              |
| `GET /api/lobbies/:lobbyId/state`            | Return public lobby state with ETag support.                          |
| `POST /api/lobbies/:lobbyId/verify`          | Verify a management passcode.                                         |
| `PATCH /api/lobbies/:lobbyId`                | Update lobby metadata, scores, target score, status, or current game. |
| `DELETE /api/lobbies/:lobbyId`               | End and delete a lobby, games, and secret.                            |
| `POST /api/lobbies/:lobbyId/spin`            | Pick a random enabled game.                                           |
| `POST /api/lobbies/:lobbyId/games`           | Add a game.                                                           |
| `PATCH /api/lobbies/:lobbyId/games/:gameId`  | Rename or enable/disable a game.                                      |
| `DELETE /api/lobbies/:lobbyId/games/:gameId` | Delete a game.                                                        |
| `POST /api/lobbies/:lobbyId/games/reorder`   | Persist game order.                                                   |

The API also runs a daily scheduled retention sweep at 04:00 UTC and deletes lobbies that have been inactive for 30 days.

## Scripts

```sh
npm run dev              # Start the Vite frontend
npm run lint             # ESLint with zero warnings
npm run typecheck        # TypeScript checks for every workspace
npm run test             # Vitest suites for core, api, and web
npm run build            # Build all workspaces
npm run verify           # Deployment config check, lint, typecheck, tests, build
```

Deployment helpers:

```sh
npm run deploy:check     # Assert Cloudflare resource names and scripts have not drifted
npm run deploy:dry-run   # Deployment checks, API dry run, and web build
npm run deploy:d1:list   # List remote D1 migrations
npm run deploy:d1:apply  # Apply remote D1 migrations
npm run deploy:api       # Deploy the Worker API
npm run deploy:pages     # Build and deploy Cloudflare Pages
```

## Cloudflare Resources

The checked-in config expects these Cloudflare resources:

- Pages project: `gaming-gauntlet`
- Worker: `gaming-gauntlet-api`
- D1 database: `gaming-gauntlet-v1`
- API routes:
  - `gaming-gauntlet.com/api/*`
  - `www.gaming-gauntlet.com/api/*`

`scripts/verify-deploy-config.mjs` is part of `npm run verify` and fails if the critical deploy names, D1 binding, migration directory, rate-limit bindings, or Wrangler version drift.

## Production Notes

- The frontend is served by Cloudflare Pages from `apps/web/dist`.
- SPA fallback is allow-listed in `apps/web/public/_redirects`; unknown scanner paths should return a real 404 instead of the app shell.
- Static security headers live in `apps/web/public/_headers`.
- Public match and overlay pages are marked `noindex`.
- Public state responses use short cache/ETag behavior for high-frequency OBS and viewer polling.
- Raw management passcodes are never stored server-side. D1 stores only `sha256:` hashes in `lobby_secrets`.

## Design Reference

`prototype/` is the canonical visual reference for V1 screens and components. It is browser-runnable through `prototype/Prototype.html`, but it is not included in the build, lint, or test pipeline. Production code mirrors the relevant kit pieces in `packages/ui` and app surfaces under `apps/web/src`.
