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
- Use the existing UI/design kit. Do not redesign the app from scratch.
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

# Phase 6 — Match Room + Management Unlock UI

## Goal

Build the main match room with an unlockable streamer control surface.

## AI Prompt

```text
Implement Phase 6: Match Room + Management Unlock UI.

Tasks:
1. Build /g/:lobbyId as the primary match room.
2. Show public match state on /g/:lobbyId without requiring a passcode.
3. Add a Manage this match action on /g/:lobbyId.
4. If no local verified management passcode exists, show a passcode entry form.
5. Verify the passcode using POST /api/lobbies/:lobbyId/verify.
6. After verification, store passcode in localStorage.
7. Build management UI using the existing UI/design kit:
   - Wheel area
   - Editable game list
   - Add game input
   - Rename game
   - Delete game
   - Enable/disable game
   - Reorder game using drag-and-drop or up/down buttons
   - Score controls for both players
   - Reset scores
   - Rename players
   - Target score editor
   - Current game display
   - Clear current game
   - Reset match
8. All write requests must send:
   Authorization: Bearer <managementCode>
9. Poll public state every 1–2 seconds.
10. Avoid rerendering if version has not changed.
11. /manage/:lobbyId may remain as an internal direct route, but the UI must not present it as a URL users need to copy/share.

At the end, add regression tests.
```

## Regression Tests For Phase 6

```text
Add tests that verify:
- /g/:lobbyId renders public match state without a passcode.
- /g/:lobbyId Manage action asks for passcode when localStorage has no verified passcode.
- Correct passcode unlocks management UI.
- Wrong passcode shows invalid passcode state.
- Add game works.
- Rename game works.
- Delete game works.
- Enable/disable game works.
- Reorder game works.
- +1 and -1 score controls work.
- Reset score works.
- Player rename works.
- Target score update works.
- All write requests use Authorization header.
- No write request sends code in URL or query params.
- UI does not show a separate management URL.
```

---

# Phase 7 — Wheel Logic + Spin Flow

## Goal

Make the core game mechanic work.

## AI Prompt

```text
Implement Phase 7: Wheel Logic + Spin Flow.

Tasks:
1. Add wheel component using the existing UI/design kit.
2. Add POST /api/lobbies/:lobbyId/spin.
3. Spin endpoint must:
   - require Authorization header
   - select from enabled games only
   - reject spin if no enabled games exist
   - set currentGameId
   - increment version
   - update updatedAt
4. Add frontend spin button.
5. Add spin animation.
6. Respect prefers-reduced-motion.
7. After spin completes, show the selected game clearly.
8. Make sure overlays receive the selected game via public state polling.

At the end, add regression tests.
```

## Regression Tests For Phase 7

```text
Add tests that verify:
- Spin requires Authorization header.
- Spin rejects wrong passcode.
- Spin selects only enabled games.
- Spin rejects when there are no enabled games.
- Spin updates currentGameId.
- Spin increments version.
- Unlocked management surface shows selected game after spin.
- Reduced-motion mode does not rely on long animation to update state.
```

---

# Phase 8 — OBS Overlay Routes

## Goal

Build all read-only browser-source overlays.

## AI Prompt

```text
Implement Phase 8: OBS Overlay Routes.

Tasks:
1. Build these overlay routes:
   - /overlay/:lobbyId/top
   - /overlay/:lobbyId/lower-third
   - /overlay/:lobbyId/compact-left
   - /overlay/:lobbyId/compact-right
   - /overlay/:lobbyId/square
   - /overlay/:lobbyId/wheel
   - /overlay/:lobbyId/full
2. Each overlay must:
   - be public and read-only
   - poll GET /api/lobbies/:lobbyId/state every 1–2 seconds
   - use transparent background where appropriate
   - be readable on stream
   - show only public state
   - never show management controls
   - never show management code
3. Add loading, invalid lobby, and empty state displays.
4. Use the existing design kit styling.
5. Add safe optional query params only:
   - theme
   - scale
   - showNext
   - brand
   - transparent
   - animation
6. Reject or ignore unsafe query params:
   - code
   - token
   - secret
   - managementCode

At the end, add regression tests.
```

## Regression Tests For Phase 8

```text
Add tests that verify:
- All overlay routes render.
- Overlays call only public state endpoint.
- Overlays do not render management controls.
- Overlays do not expose managementCode, code, token, secret, or managementCodeHash.
- Overlay URLs generated by the app never include secrets.
- Invalid lobby overlay shows safe error state.
- Safe query params work.
- Unsafe query params are ignored or rejected.
```

---

# Phase 9 — OBS URL Panel in Unlocked Management Surface

## Goal

Make it easy for streamers to copy overlay links into OBS.

## AI Prompt

```text
Implement Phase 9: OBS Overlay URL Panel.

Tasks:
1. Add an OBS Overlays panel to the unlocked management surface.
2. Include these overlays:
   - Top Bar
   - Lower Third
   - Compact Left
   - Compact Right
   - Square Card
   - Wheel
   - Fullscreen Showcase
3. For each overlay show:
   - name
   - short description
   - recommended OBS width
   - recommended OBS height
   - Copy OBS URL button
   - Preview button
4. Add OBS instructions:
   1. Copy the overlay URL.
   2. In OBS, go to Sources.
   3. Click +.
   4. Choose Browser.
   5. Paste the URL.
   6. Set the recommended width and height.
   7. Click OK.
   8. Drag the overlay where you want it on stream.
5. Add troubleshooting notes.
6. Generated overlay URLs must never include management code.

At the end, add regression tests.
```

## Regression Tests For Phase 9

```text
Add tests that verify:
- OBS panel renders after management unlock.
- Every overlay has a copy URL button.
- Every overlay has a preview button.
- Recommended sizes are shown.
- Copied URLs do not include management code.
- Copied URLs do not include unsafe query params.
- OBS instructions render.
- Troubleshooting notes render.
```

---

# Phase 10 — Abuse Protection + Cloudflare Hardening

## Goal

Add protection for streamer URLs and public endpoints.

## AI Prompt

```text
Implement Phase 10: Abuse Protection + Cloudflare Hardening.

Tasks:
1. Add reasonable rate limiting for public read endpoints.
2. Add stricter rate limiting for write endpoints.
3. Add stricter rate limiting for verify endpoint to prevent passcode guessing.
4. Add CORS rules appropriate for the deployed frontend.
5. Add security headers.
6. Add request size limits.
7. Add validation to reject malformed lobby IDs and game IDs.
8. Add caching strategy where safe:
   - Do not cache authenticated write responses.
   - Public state can be short-cache or no-cache depending on polling behavior.
9. Add Cloudflare-oriented notes/config for:
   - WAF rules
   - bot fight mode / managed challenge where appropriate
   - rate limiting rules
   - DDoS protection
10. Make sure overlays still work smoothly in OBS.

At the end, add regression tests.
```

## Regression Tests For Phase 10

```text
Add tests that verify:
- Verify endpoint rate limit exists.
- Public state endpoint has abuse protection.
- Write endpoints have stricter abuse protection.
- Malformed lobby IDs are rejected.
- Oversized request bodies are rejected.
- Security headers are present.
- CORS does not allow unsafe broad access for authenticated writes.
- OBS overlay polling is not broken by protection rules.
```

---

# Phase 11 — Polish + Deployment

## Goal

Make V1 shippable.

## AI Prompt

```text
Implement Phase 11: Polish + Deployment.

Tasks:
1. Add loading states.
2. Add empty game list state.
3. Add invalid lobby state.
4. Add invalid management passcode state.
5. Add copied-to-clipboard feedback.
6. Add basic mobile responsiveness for the match room and unlocked management surface.
7. Add deployment config for:
   - Cloudflare Pages frontend
   - Cloudflare Worker API
   - Cloudflare D1 migrations
8. Add environment variable documentation.
9. Add README setup instructions.
10. Add deployment checklist for gaminggauntlet.com.
11. Run full regression suite.

At the end, add final regression tests.
```

## Regression Tests For Phase 11

```text
Add tests that verify:
- App builds successfully.
- Worker builds successfully.
- D1 migrations run successfully.
- Landing page works.
- Create lobby flow works.
- Match management unlock flow works.
- Spin flow works.
- Score update flow works.
- Match page works.
- All overlay routes work.
- No public route leaks management passcode or management code fields.
- No API response leaks managementCodeHash.
- Deployment config references correct Cloudflare bindings.
```

---

# Final AI Instruction After Every Phase

Give this to the AI at the end of each phase:

```text
Before finishing this phase:

1. Add or update regression tests for everything changed in this phase.
2. Run:
   - lint
   - typecheck
   - unit tests
   - integration/API tests
   - relevant e2e tests
   - production build
3. Fix all failures.
4. Confirm no management code appears in:
   - URLs
   - overlay pages
   - match page unless explicitly revealed inside the unlocked management surface
   - public API responses
   - logs
   - generated OBS URLs
5. Summarize:
   - what changed
   - which tests were added
   - which commands passed
   - any known limitations
```

---

# Best First Command To Give The AI

```text
Start Phase 1 only.

Use the existing UI/design kit. Do not build new major features yet. Clean up the V1 scope, confirm local app startup, add placeholder routes, and add regression tests proving the simplified V1 routes exist and do not require Twitch or expose secrets.
```
