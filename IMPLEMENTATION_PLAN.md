# Gaming Gauntlet V1 — AI Implementation Phases

This document turns the Gaming Gauntlet V1 plan into AI-agent-sized implementation phases.

The goal is to let you tell an AI coding agent things like:

> Start Phase 1 only.

Each phase includes a clear implementation goal and required regression tests before moving on.

---
## Global Instruction To Give The AI First

```text
You are implementing Gaming Gauntlet V1.

Important rules:
- Use the existing UI/design kit in `prototype/`. It is the canonical visual + structural reference (browser-runnable via `prototype/Prototype.html`). Mirror its components, classes, and screens; do not redesign from scratch. See `prototype/README.md` for the kit→production file map.
- Keep V1 simple: React + Vite + TypeScript frontend, Cloudflare Worker API, Cloudflare D1.
- Do not add Twitch OAuth, Twitch Extension support, EventSub, chat bots, accounts, billing, or WebSockets.
- Management codes must never appear in URLs, public API responses, overlays, logs, or visible UI unless the user explicitly clicks reveal/copy inside the management UI.
- Treat the match URL as the only shareable human URL. The management route may exist internally, but the UI must not ask users to copy both a public URL and a management URL.
- The match URL identifies the lobby; the management passcode authorizes write control.
- Use "management passcode" in user-facing UI. The API/internal field name may remain managementCode.
- Store only a hash of the management code.
- Write or update regression tests at the end of every phase.
- Do not move to the next phase unless lint, typecheck, build, and tests pass.
```

---

## UI Kit Reference

The canonical design kit lives in `prototype/` (added to the repo as the source
of truth). It is a browser-runnable prototype, not part of the build/lint/test
pipeline. Phases 5–9 should mirror these files:

| Kit file              | Surface                                                                                                                                              | Production target             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `kit.css` / `kit.jsx` | Tokens + primitives (`KitButton`, `KitChip`, `KitPanel`, `KitCard`, `KitNotice`, `KitTextField`, `KitTextareaField`, `PageShell`, `ScoreBug`, `Ico`) | `packages/ui`                 |
| `app.css`             | Screen/layout styles                                                                                                                                 | `apps/web/src/app.css`        |
| `screens-create.jsx`  | Create page (Phase 5)                                                                                                                                | `apps/web/src/CreatePage.tsx` |
| `screens-match.jsx`   | Single match room `/g/:lobbyId` — public view + inline unlock, scorebar, game-pool editor, wheel (Phase 6–7)                                         | match room                    |
| `wheel.jsx`           | Spin wheel: `radial` + `reel` (Phase 7)                                                                                                              | wheel component               |
| `overlays.jsx`        | On-stream overlay graphics + metadata (Phase 8)                                                                                                      | overlay routes                |
| `screens-obs.jsx`     | "Add to OBS" overlays surface: live previews + copy-URL + instructions (Phase 9)                                                                     | overlays surface              |

Key deviations the production app makes on purpose:

- **Routes, not a rail.** The prototype's `app.jsx` left nav rail is demo-only.
  Production uses real URLs; the match URL is the only shareable link.
- **Real API + auth.** `store.jsx` is an in-memory stand-in for the Worker API.
- **Secrets stay hidden.** The prototype prints the demo passcode; production
  must never leak it into URLs, overlays, logs, or public API responses.

---

# Phase 1 — Scope Cleanup + App Baseline

## Goal

Make the repo ready for the simplified V1 build.

## AI Prompt

```text
Implement Phase 1: Scope Cleanup + App Baseline.

Tasks:
1. Audit the existing app structure.
2. Remove or disable V1-blocking Twitch Extension, Twitch OAuth, EventSub, chat bot, queue, and complex realtime code if present.
3. Keep the existing UI/design kit.
4. Confirm the app has basic routes ready for:
   - /
   - /create
   - /manage/:lobbyId
   - /g/:lobbyId
   - /overlay/:lobbyId/top
5. Add placeholder pages if needed.
6. Make sure the app runs locally.
7. Do not implement full lobby logic yet.

At the end, add regression tests.
```

## Regression Tests For Phase 1

```text
Add tests that verify:
- The app can render the landing page.
- /create route exists.
- /manage/:lobbyId route exists.
- /overlay/:lobbyId/top route exists.
- No V1 route requires Twitch login.
- No route includes managementCode, code, token, or secret in URL params.
```

---

# Phase 2 — Shared Types, Validation, and D1 Schema

## Goal

Create the backend foundation before building UI features.

## AI Prompt

```text
Implement Phase 2: Shared Types, Validation, and D1 Schema.

Tasks:
1. Add shared TypeScript types for:
   - Lobby
   - Game
   - LobbyState
   - PublicLobbyState
   - CreateLobbyRequest
   - CreateLobbyResponse
2. Add Zod validation for all API request bodies.
3. Create Cloudflare D1 migrations for:
   - lobbies
   - games
   - lobby_secrets
4. Store only managementCodeHash, never raw managementCode.
5. Add helper functions for:
   - creating lobby IDs
   - creating management codes
   - hashing management codes
   - verifying management codes
6. Include version and updatedAt fields for polling.

Do not build the UI yet except what is needed to compile.
At the end, add regression tests.
```

## Regression Tests For Phase 2

```text
Add tests that verify:
- D1 schema/migrations are valid.
- Lobby type requires id, player names, scores, status, version, createdAt, updatedAt.
- Game type requires id, lobbyId, title, position, enabled.
- managementCodeHash exists but raw managementCode is never stored.
- Invalid create lobby payloads are rejected.
- Hash verification accepts correct code and rejects incorrect code.
```

---

# Phase 3 — Core Lobby API

## Goal

Build the backend endpoints needed for lobby creation and public state.

## AI Prompt

```text
Implement Phase 3: Core Lobby API.

Tasks:
1. Implement:
   - POST /api/lobbies
   - GET /api/lobbies/:lobbyId/state
   - POST /api/lobbies/:lobbyId/verify
2. POST /api/lobbies should accept:
   - playerOneName
   - playerTwoName
   - optional starting game list
   - optional targetScore
3. POST /api/lobbies should return:
   - lobbyId
   - managementCode
4. This is the only automatic API response that may include the raw managementCode.
5. GET /state must return only public state.
6. GET /state must never return managementCode, managementCodeHash, secret, token, or authorization data.
7. Add version and updatedAt to state responses.
8. Add proper 404 and validation error responses.

At the end, add regression tests.
```

## Regression Tests For Phase 3

```text
Add tests that verify:
- POST /api/lobbies creates a lobby.
- POST /api/lobbies returns lobbyId and managementCode.
- Created lobby has games if starting games were provided.
- GET /api/lobbies/:lobbyId/state returns public lobby state.
- GET /state never returns managementCode or managementCodeHash.
- POST /verify returns success for the correct code.
- POST /verify rejects an incorrect code.
- Unknown lobbyId returns 404.
```

---

# Phase 4 — Authenticated Lobby + Game Management API

## Goal

Add all write operations using the management code in the request header.

## AI Prompt

```text
Implement Phase 4: Authenticated Lobby + Game Management API.

Tasks:
1. Add auth middleware/helper that reads:
   Authorization: Bearer <managementCode>
2. Never accept management code from query params.
3. Implement:
   - PATCH /api/lobbies/:lobbyId
   - POST /api/lobbies/:lobbyId/games
   - PATCH /api/lobbies/:lobbyId/games/:gameId
   - DELETE /api/lobbies/:lobbyId/games/:gameId
   - POST /api/lobbies/:lobbyId/games/reorder
4. PATCH lobby should support:
   - player names
   - scores
   - target score
   - current game
   - status
5. Game endpoints should support:
   - add
   - rename
   - remove
   - enable/disable
   - reorder
6. Every successful write should increment lobby.version and update updatedAt.
7. Return safe public state after mutations.

At the end, add regression tests.
```

## Regression Tests For Phase 4

```text
Add tests that verify:
- Write endpoints reject missing Authorization header.
- Write endpoints reject wrong management code.
- Write endpoints accept correct Bearer code.
- Query param secrets like ?code=abc are ignored/rejected.
- Updating scores increments version.
- Renaming players increments version.
- Adding/editing/deleting/reordering games increments version.
- API responses after writes never include managementCode or managementCodeHash.
```

---

# Phase 5 — Create Page + Management Code UX

## Goal

Build the creation flow and safe management-code handling.

## AI Prompt

```text
Implement Phase 5: Create Page + Management Code UX.

Tasks:
1. Build /create using the existing UI/design kit for inspiration, shape, spacing, and color without copying old layouts or screens directly.
2. Form fields:
   - Join existing match by match URL/id plus passcode
   - Create new match
   - Player 1 name
   - Player 2 name
   - Optional starting game list
   - Optional target score
3. On submit, call POST /api/lobbies.
4. After creation, show:
   - one Match URL for sharing/opening: /g/:lobbyId
   - management passcode with hidden-by-default display
   - Manage this match action that uses the same lobby id without putting the passcode in the URL
5. Do not show or copy a separate management URL.
6. Management passcode must be hidden by default.
7. Reveal requires an explicit user click.
8. Copy passcode requires an explicit user action.
9. Never put the management passcode in the URL.
10. Store the management passcode in localStorage only after creation or successful verification.
11. After creation, prefer opening /g/:lobbyId as the primary match room. If the user clicks Manage, route to the management surface without the passcode in the URL.

At the end, add regression tests.
```

## Regression Tests For Phase 5

```text
Add tests that verify:
- User can create a lobby from /create.
- User can join an existing match by match URL/id plus passcode.
- Created flow displays exactly one shareable Match URL.
- Created flow does not display a separate management URL.
- Match URL does not include the management passcode.
- Management passcode is hidden by default.
- Reveal button reveals passcode only after click.
- localStorage stores passcode only after creation or verification.
- DOM does not expose the passcode in match or overlay links.
```

---

# Phase 6 — Match Room + Inline Management Unlock

## Goal

Build the single match room at `/g/:lobbyId` — public by default, unlockable
**inline** with the management passcode — following the kit's `screens-match.jsx`.
There is no separate "command center"; locked and unlocked states are the same
route.

## AI Prompt

```text
Implement Phase 6: Match Room + Inline Management Unlock.

Use prototype/screens-match.jsx and prototype/app.css as the structural target.

Tasks:
1. Build /g/:lobbyId as the ONLY match room. It is public by default.
2. Locked state (no verified passcode in localStorage):
   - Render the centered lock card (gg-lockscreen / gg-lockcard) with a single
     "Management passcode" field and an "Unlock controls" button.
   - Explain that viewers watch via the OBS overlays, not this page.
   - Do NOT render score/game controls while locked.
3. Verify the passcode using POST /api/lobbies/:lobbyId/verify. On success:
   - Store the passcode in localStorage.
   - Unlock INLINE — no navigation, no passcode in the URL.
   On failure show an inline "passcode didn't match" error.
4. Unlocked control room (single page, kit layout):
   - MatchHeader: inline-editable match title + an "Add to OBS" action that
     routes to the overlays surface (Phase 9).
   - ScoreboardPanel: compact horizontal ScoreBar with inline-editable player
     names, − / ＋ score steppers, a target-score input, and Reset scores /
     Clear pick / Reset match actions.
   - Spin panel: wheel stage + Radial/Reel style toggle + Spin button +
     current-pick banner (spin logic lands in Phase 7).
   - GamePoolEditor: add-game input; each row supports pointer drag-to-reorder,
     up/down buttons, an enable/disable toggle, double-click-to-rename, and
     delete; dragging a row OUTSIDE the list removes it; an enabled/total chip.
5. Every write sends: Authorization: Bearer <managementCode>.
6. Poll public state every 1–2 seconds; skip re-render when version is unchanged.
7. /manage/:lobbyId may remain an internal direct route, but is never surfaced
   as a URL users copy or share.

At the end, add regression tests.
```

## Regression Tests For Phase 6

```text
Add tests that verify:
- /g/:lobbyId renders public match state without a passcode.
- With no verified passcode in localStorage, the room shows the lock card and no
  score/game controls.
- A correct passcode unlocks the controls INLINE (URL unchanged, passcode never
  in the URL); a wrong passcode shows the invalid-passcode state.
- A stored/verified passcode auto-unlocks without re-prompting.
- Add / rename / delete / enable-disable / reorder game each work.
- Dragging a game outside the list removes it.
- − / ＋ score steppers, reset scores, target score, rename players, clear pick,
  and reset match each work.
- All write requests use the Authorization: Bearer header.
- No write request sends code/token/secret in the URL or query params.
- The UI shows no separate management URL; "Add to OBS" routes to the overlays
  surface.
```

---

# Phase 7 — Wheel Logic + Spin Flow

## Goal

Make the core game mechanic work.

## AI Prompt

```text
Implement Phase 7: Wheel Logic + Spin Flow.

Use prototype/wheel.jsx as the structural target.

Tasks:
1. Add the wheel component from the kit with TWO styles, switchable from the
   Spin panel toggle:
   - "radial" — conic-gradient pie wheel with a pointer + hub.
   - "reel" — horizontal scrolling strip with a center marker.
2. Add POST /api/lobbies/:lobbyId/spin. It must:
   - require the Authorization: Bearer header
   - select from ENABLED games only
   - reject the spin (no-enabled-games error) when none are enabled
   - set currentGameId, increment version, update updatedAt
3. The wheel takes the server-selected winner, then animates TO it (pick first,
   animate second) — easeOutQuint, ~4.4–5.1s, with a safety timeout so the
   result always resolves even if requestAnimationFrame is throttled.
4. Add the Spin button; disable it while spinning or when no games are enabled.
5. Respect prefers-reduced-motion: do not depend on the long animation to reveal
   the result — when reduced motion is requested, settle on the selected game
   immediately / with minimal motion.
6. Empty state: show the kit "No games enabled" panel and disable Spin when the
   pool has no enabled games.
7. After the spin, show the selected game in the current-pick banner; overlays
   pick it up via public-state polling.

At the end, add regression tests.
```

## Regression Tests For Phase 7

```text
Add tests that verify:
- Spin requires the Authorization header.
- Spin rejects a wrong passcode.
- Spin selects only enabled games.
- Spin rejects when there are no enabled games.
- Spin updates currentGameId and increments version.
- Both wheel styles (radial and reel) render.
- The unlocked surface shows the selected game after a spin.
- Reduced-motion mode resolves the result without relying on the long animation.
```

---

# Phase 8 — OBS Overlay Routes

## Goal

Build all read-only browser-source overlays.

## AI Prompt

```text
Implement Phase 8: OBS Overlay Routes.

Use prototype/overlays.jsx for the graphics and prototype/app.css (ov-* classes)
for styling. The kit's overlay set replaces the old compact-left/compact-right
pair with a single "compact" card plus a vertical "rail".

Tasks:
1. Build these overlay routes (recommended OBS size in parentheses):
   - /overlay/:lobbyId/top          (1280 × 90)   — slim header bar
   - /overlay/:lobbyId/lower-third  (900 × 180)   — broadcast lower third
   - /overlay/:lobbyId/compact      (320 × 200)   — stacked score card
   - /overlay/:lobbyId/rail         (240 × 560)   — tall vertical strip
   - /overlay/:lobbyId/square       (360 × 360)   — square score card
   - /overlay/:lobbyId/wheel                       — wheel + current pick
   - /overlay/:lobbyId/full         (1920 × 1080) — fullscreen showcase
2. Each overlay must:
   - be public and read-only
   - poll GET /api/lobbies/:lobbyId/state every 1–2 seconds
   - use a transparent background
   - be readable on stream
   - show only public state
   - never show management controls or the management code
3. Add loading, invalid-lobby, and empty-state displays.
4. Use the kit ov-* styling.
5. Allow safe optional query params only:
   - theme, scale, showNext, brand, transparent, animation
6. Reject or ignore unsafe query params:
   - code, token, secret, managementCode

At the end, add regression tests.
```

## Regression Tests For Phase 8

```text
Add tests that verify:
- All overlay routes render (top, lower-third, compact, rail, square, wheel, full).
- Overlays call only the public state endpoint.
- Overlays do not render management controls.
- Overlays do not expose managementCode, code, token, secret, or managementCodeHash.
- Overlay URLs generated by the app never include secrets.
- Invalid lobby overlay shows a safe error state.
- Safe query params work.
- Unsafe query params are ignored or rejected.
```

---

# Phase 9 — "Add to OBS" Overlays Surface

## Goal

Give streamers one Overlays surface — live previews + copy-URL + instructions —
reached from the match room's "Add to OBS" action. The kit merges the old
preview gallery and copy-URL panel into a single screen (`screens-obs.jsx`).

## Context (what Phase 8 already shipped — reuse, don't rebuild)

Phase 8 built the overlay system this surface sits on top of. Phase 9 is mostly a
gallery + copy-URL + instructions wrapper around it.

- **Catalog is the single source of truth.** `apps/web/src/overlay/catalog.ts`
  exports `OVERLAYS` ({ id, name, desc, w, h, slug }) — currently **14**
  overlays, not the kit's 7. Drive the gallery off this array; never hardcode a
  list (then new overlays appear automatically). It also exports `THEMES`,
  `THEME_OPTIONS` (palette-descriptive labels), and `isTheme()`.
- **Live graphic** is `OverlayGraphic({ slug, m, options })` in
  `overlay/OverlayGraphics.tsx`; build its view model with
  `toOverlayMatch(state)` from `overlay/overlay-match.ts`; poll public state with
  `useOverlayState(lobbyId)` from `overlay/use-overlay-state.ts`. A single shared
  poll can feed every preview.
- **Overlay route** is generic: `/overlay/:lobbyId/:variant` (the `:variant` is
  the catalog `slug`). The surface itself is the `overlayHub` route
  (`/g/:lobbyId/obs`), already linked from the match room's "Add to OBS" button.
- **Themes** are real and must flow through here. `overlay-theme.ts` stores the
  streamer's chosen theme per-lobby in localStorage (`readStoredTheme`,
  `useOverlayTheme`, `themeClassName`). The match room already has a theme picker;
  copied overlay URLs MUST carry that choice as `?theme=<theme>` so OBS matches
  the room. Previews must render in the selected theme too (wrap each preview in
  `themeClassName(theme)` / `gg-ov--<theme>`).
- **Names are generic** (Arena Bar, Shield Bar, Broadcast Scoreboard, Series Bar,
  etc.) — no tournament/brand names in any visible text.

## AI Prompt

```text
Implement Phase 9: "Add to OBS" Overlays Surface.

Use prototype/screens-obs.jsx as the structural target. Reach it from the match
room's "Add to OBS" button (the existing /g/:lobbyId/obs route — not a separate
copyable management URL). Reuse the Phase 8 overlay module (see Context above);
do not duplicate graphics, catalog, or polling.

Tasks:
1. Build a responsive overlay gallery driven by the OVERLAYS catalog (render a
   card per entry so it stays in sync as the catalog grows). Each card shows:
   - a LIVE, transparent, auto-scaled preview of the real overlay graphic
     (OverlayGraphic from public state, in the selected theme, on a checkerboard
     backdrop), fit to the card via a scale transform
   - the overlay name (from catalog)
   - the recommended OBS width × height (from catalog w × h)
   - the short description (from catalog)
   - a Copy URL button
   Consider grouping cards (e.g. top bars / score cards / fullscreen) since there
   are now ~14 overlays.
2. Add a theme selector on the surface that mirrors the match room (THEME_OPTIONS,
   stored via overlay-theme). Changing it re-skins every preview AND changes the
   theme baked into copied URLs. Default to the lobby's stored theme.
3. Copy URL builds an absolute overlay URL: <origin>/overlay/:lobbyId/:slug and
   appends ?theme=<selected theme> (omit when "default"). It must NEVER include
   the management code or any unsafe param (code, token, secret, managementCode).
   Other safe params (scale, brand, showNext, transparent, animation) are optional
   and out of scope unless trivial.
4. Add a compact instructions block:
   - Setup: copy the overlay URL → OBS Sources → + → Browser → paste the URL →
     set the listed width & height → OK → drag into place.
   - Troubleshooting: blank → re-copy the full link / confirm the match exists;
     not updating → right-click the source → Refresh; not transparent → remove
     any color source behind it.
5. The surface is public/read-only and shows no management controls or passcode.

At the end, add regression tests.
```

## Regression Tests For Phase 9

```text
Add tests that verify:
- The overlays surface is reached from the match room's "Add to OBS" action
  (the /g/:lobbyId/obs route).
- The gallery renders a live preview + Copy URL button for EVERY overlay in the
  OVERLAYS catalog (iterate the catalog so new overlays are covered automatically).
- Recommended OBS sizes (catalog w × h) are shown per card.
- A copied URL points at /overlay/:lobbyId/:slug and carries the selected
  ?theme=, and never includes managementCode/code/token/secret.
- Changing the theme selector updates the copied URL's ?theme= and the previews'
  theme class; the default theme produces a URL with no theme param.
- The surface renders no management controls and exposes no passcode/secret.
- Setup instructions render.
- Troubleshooting notes render.
```

---

# Phase 10 — Streamer IP Protection + Abuse Hardening

## Summary

Phase 10 prioritizes streamer safety first: no streamer IP or viewer IP should
be exposed by the app, URLs, overlays, API responses, client storage, D1 rows,
or app-owned limiter keys. Cloudflare can still process source IPs internally
for DDoS, WAF, bot checks, and rate limiting, but the app must not persist,
display, return, or log raw IP addresses.

## Key Changes

- Add an explicit Streamer IP Protection + Anonymity hardening layer:
  - Keep public, OBS, and share URLs on `https://gaming-gauntlet.com`; never
    expose local, origin, streamer-machine, tunnel, or peer-to-peer addresses.
  - Never include IPs in public lobby state, overlay links, copied URLs, errors,
    validation messages, analytics-style payloads, D1 rows, or browser storage.
  - Use Cloudflare request IP only inside the Worker for abuse controls, then
    hash it with `RATE_LIMIT_KEY_SALT` before using it in limiter keys.
  - Add tests proving raw IPs are not returned or passed into app-owned limiter
    keys.
- Keep abuse protection privacy-preserving:
  - Public state remains protected for high-viewer streams without breaking OBS
    polling.
  - Verify gets the strictest protection because passcode guessing is the main
    threat.
  - Writes stay authenticated with `Authorization: Bearer <managementCode>`.
  - Request size limits, malformed ID rejection, ETags/304s, no-store for
    authenticated writes, and API security headers remain required.
- Add explicit CORS and cache behavior:
  - Allow only `https://gaming-gauntlet.com` and
    `https://www.gaming-gauntlet.com`.
  - No wildcard CORS, especially on authenticated writes.
  - Public state can use short safe caching and ETags; authenticated writes are
    never cached.

## Live Cloudflare Changes

- Apply live Cloudflare hardening after credentials allow WAF/ruleset edits.
- Add only rules named with `GG Phase 10` so unrelated account rules are
  preserved.
- Configure:
  - strict verify/passcode rate limiting,
  - public API abuse limits,
  - bot/browser integrity protection where safe,
  - explicit OBS-safe exclusions for `/overlay/*` and `/g/*/obs`.
- If the account plan or token blocks WAF edits, finish repo hardening and
  Worker dry-run validation, then report the live-rule blocker clearly.

## Regression Tests For Phase 10

Add or keep tests that verify:

- No raw IP in responses, errors, state, or limiter keys.
- Salted hashed rate-limit keys.
- Verify/state/write rate-limit routing.
- Unsafe CORS rejection and no wildcard CORS.
- Security headers on success/error/304/429.
- Malformed lobby/game IDs.
- Oversized bodies.
- OBS overlay polling still works with 304/rate protections.

## Implementation Status

- [x] Repo hardening: Worker limiter keys use salted IP hashes instead of raw
      `cf-connecting-ip`.
- [x] Repo hardening: API CORS only allows the two production origins and never
      emits wildcard CORS.
- [x] Repo hardening: public state keeps ETag/304 behavior with short safe
      caching; authenticated writes stay `no-store`.
- [x] Repo hardening: share and OBS URLs are generated on
      `https://gaming-gauntlet.com`, not the current local/browser origin.
- [x] Regression coverage: raw-IP non-leakage, salted limiter keys, route
      limiter selection, CORS, security headers, malformed IDs, oversized
      bodies, and OBS conditional polling.
- [x] Live deploy: API Worker and Pages frontend deployed after verification.
- [x] Live sanity: production API CORS/security headers verified, static Pages
      wildcard CORS detached, and `/g/:lobbyId/obs` plus `/overlay/:lobbyId/top`
      stay reachable and `noindex`.
- [ ] Live Cloudflare WAF/ruleset changes named `GG Phase 10`: blocked by the
      current Cloudflare API permission/plan path (`request is not authorized`
      for Rulesets entrypoints; legacy zone rate-limit API returns an
      authentication error).

---

# Phase 11 — Polish + Deployment

## Goal

Finish V1 with accessible final UI states, repeatable Cloudflare deployment,
documented production setup, and regression coverage for the complete
create-to-overlay workflow.

## Status

- [x] Loading, invalid lobby, invalid management passcode, empty game pool, and
      clipboard success/failure states are covered with live regions, disabled
      states, retry/recovery actions, and accessible error copy.
- [x] Match room, unlocked management controls, share bar, scoreboard, wheel,
      and game editor layouts are tightened for narrow viewports. Mobile OBS
      gallery polish is intentionally out of scope for Phase 11.
- [x] No public interface changes: API routes, response shapes, route params,
      schema, and the one-match-URL model remain unchanged.
- [x] `wrangler.api.toml` remains the Worker API config for
      `gaming-gauntlet-api`, `DB = gaming-gauntlet-v1`, rate-limit bindings,
      routes, cron, and observability.
- [x] Pages config is added at `apps/web/wrangler.toml` for project
      `gaming-gauntlet` with `pages_build_output_dir = "dist"`.
- [x] Root npm scripts cover API deploy, Pages deploy, D1 migration list/apply,
      config validation, and deploy dry-run validation.
- [x] Wrangler is pinned as a dev dependency (`4.95.0`).
- [x] Deployment requirements are captured in the checked config and root npm
      scripts for account/project names, domains, D1 binding, rate-limit
      bindings, deploy order, and live sanity checks.
- [x] Regression tests cover loading, invalid lobby, invalid passcode, empty
      game pool, copy failure, hidden passcode handling, spin, score, game
      editor, OBS, and overlay routes.
- [x] Deployment config validation proves the expected Pages project, Worker
      name, D1 binding/database, migrations directory, routes, observability,
      and rate-limit bindings.
- [x] Final local gate passed: `npm run verify`.
- [x] Cloudflare preflight passed: `npm run deploy:api:dry-run`,
      `npm run deploy:d1:list`, and `npx wrangler whoami`.
- [x] Production deploy completed:
      - Worker API version `425c6339-0d25-4556-af3f-c273974cbb7c`.
      - Pages deployment `https://83529f4c.gaming-gauntlet.pages.dev`.
- [x] Live sanity passed on `https://gaming-gauntlet.com`: created lobby
      `lob_m92fbrdc9ada`, unlocked management after create, spun to
      `Street Fighter 6`, updated score to `1-0`, opened `/g/:lobbyId/obs`,
      and browser-rendered every catalog overlay route without passcode text.
- [ ] Phase 10 WAF/ruleset changes remain separate and blocked by current
      Cloudflare ruleset/rate-limit API authorization or plan access.

## Regression Tests For Phase 11

```text
Verified:
- App and Worker build successfully through `npm run verify`.
- Remote D1 has no pending migrations.
- Landing page works.
- Create lobby flow works.
- Match management unlock flow works.
- Spin flow works.
- Score update flow works.
- Match page works.
- OBS setup page works.
- All catalog overlay routes work.
- No public route leaks the management passcode or management code fields.
- No public API state response leaks `managementCode` or
  `managementCodeHash`.
- Deployment config references the correct Cloudflare bindings and projects.
```

---
