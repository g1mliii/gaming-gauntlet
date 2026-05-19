# Gaming Gauntlet Simplified V1 Implementation Plan

## Overview

Gaming Gauntlet is a simple Twitch streamer-vs-streamer game wheel and score tracker.

A streamer opens the site, creates a lobby, edits a shared list of games, spins a wheel, tracks scores, and uses browser-source OBS overlays to show the current game, scores, and match state on stream.

The site is designed to be leak-friendly: management access uses a private hidden code that is never placed in the URL and never shown in overlays.

## Core V1 Scope

Build a fast, simple version with:

- Editable game wheel
- Live game list management
- Spin button and selected game result
- Score tracking for two players/streamers
- Shared lobby state between multiple managers
- Hidden management code for write access
- Public read-only lobby state for overlays
- Multiple OBS browser-source overlay layouts
- Cloudflare Pages frontend
- Cloudflare Worker API
- Cloudflare D1 database

## Product Goal

The first version should be useful without Twitch OAuth, Twitch chat commands, Twitch Extension support, bots, EventSub, or complex realtime infrastructure.

The goal is:

```text
Open site → create lobby → add games → share management code with co-streamer → spin wheel → update score → use OBS overlay.
```

## User Flow

### 1. Create Lobby

User goes to Gaming Gauntlet and creates a new lobby.

They enter:

- Player 1 name
- Player 2 name
- Optional starting game list
- Optional target score

The site creates:

- A public `lobbyId`
- A private `managementCode`

The URL should only contain the public lobby ID.

Example routes:

```text
/g/abc123
/manage/abc123
/overlay/abc123/top
```

The private code is never included in the URL.

### 2. Manage Lobby

The management page asks for the hidden code if it is not already saved locally.

Once entered, the code is stored in browser local storage.

All write requests send the code in a request header, not in the URL.

Example:

```http
Authorization: Bearer <managementCode>
```

Managers can:

- Add games
- Remove games
- Rename games
- Reorder games
- Clear the list
- Spin the wheel
- Set the current selected game
- Increase/decrease scores
- Reset scores
- Rename players
- Change target score
- Reset lobby state

### 3. Share Management

The lobby owner can share:

- The lobby management URL
- The hidden management code separately

The URL is safe to leak because it does not contain the code.

The code should never appear in:

- Browser URL
- OBS overlay
- Public lobby page
- API response after initial creation, except optional manual reveal/copy inside management UI

### 4. OBS Overlay

OBS users add a browser source URL.

Overlay URLs are read-only and public.

Example overlay routes:

```text
/overlay/abc123/top
/overlay/abc123/compact-left
/overlay/abc123/compact-right
/overlay/abc123/square
/overlay/abc123/lower-third
/overlay/abc123/wheel
```

Each overlay pulls the current lobby state and renders it in a stream-friendly layout.

## Best OBS Integration Approach

The best integration for V1 is **OBS Browser Source links**.

Do not make streamers install anything. Do not require OBS WebSocket. Do not require a plugin. Do not make them log into Twitch inside OBS.

The management page should generate copyable browser-source URLs for every overlay layout.

### OBS Setup Flow For Streamers

Inside the management page, add an **OBS Overlays** panel.

Each overlay should have:

- Overlay name
- Short description
- Recommended OBS width and height
- Copy URL button
- Preview button
- Optional transparent-background note

Example UI:

```text
OBS Overlays

Top Bar
Best for the top middle of the stream.
Recommended size: 1920 × 180
[Copy OBS URL] [Preview]

Lower Third
Best for the bottom of the stream.
Recommended size: 1920 × 220
[Copy OBS URL] [Preview]

Compact Left
Best for the left side of gameplay.
Recommended size: 420 × 720
[Copy OBS URL] [Preview]

Compact Right
Best for the right side of gameplay.
Recommended size: 420 × 720
[Copy OBS URL] [Preview]

Square Card
Best for a stream corner.
Recommended size: 480 × 480
[Copy OBS URL] [Preview]

Wheel
Best when the streamer wants the wheel spin visible.
Recommended size: 900 × 900
[Copy OBS URL] [Preview]
```

### OBS Instructions To Show In The App

Add this short instruction block directly inside the management page:

```text
How to add this to OBS:

1. Copy the overlay URL.
2. In OBS, go to Sources.
3. Click +.
4. Choose Browser.
5. Paste the URL.
6. Set the recommended width and height.
7. Click OK.
8. Drag the overlay where you want it on stream.
```

### Recommended Overlay Sizes

| Overlay | Best Use | OBS Width | OBS Height |
|---|---:|---:|---:|
| Top Bar | Top center of stream | 1920 | 180 |
| Lower Third | Bottom of stream | 1920 | 220 |
| Compact Left | Left side vertical layout | 420 | 720 |
| Compact Right | Right side vertical layout | 420 | 720 |
| Square Card | Corner card | 480 | 480 |
| Wheel | Visible spin scene/source | 900 | 900 |
| Fullscreen Showcase | Intermission or intro scene | 1920 | 1080 |

### Overlay URL Design

Overlay URLs should be clean and safe:

```text
https://gaminggauntlet.com/overlay/:lobbyId/top
https://gaminggauntlet.com/overlay/:lobbyId/lower-third
https://gaminggauntlet.com/overlay/:lobbyId/compact-left
https://gaminggauntlet.com/overlay/:lobbyId/compact-right
https://gaminggauntlet.com/overlay/:lobbyId/square
https://gaminggauntlet.com/overlay/:lobbyId/wheel
```

Do not include the management code in query params.

Avoid this:

```text
/overlay/abc123/top?code=secret
```

Use only public, read-only lobby state for overlays.

### Optional Overlay Customization

For V1, keep customization simple.

Optional query params are fine because they are not secret:

```text
/overlay/abc123/top?theme=neon
/overlay/abc123/top?showNext=true
/overlay/abc123/top?scale=1.2
/overlay/abc123/square?brand=false
```

Safe query params:

- `theme`
- `scale`
- `showNext`
- `brand`
- `transparent`
- `animation`

Unsafe query params:

- `code`
- `token`
- `secret`
- `managementCode`

### Best User Experience

The easiest experience is:

1. Streamer creates lobby.
2. Streamer opens management room.
3. Streamer clicks `Copy OBS URL`.
4. Streamer pastes URL into OBS Browser Source.
5. Overlay updates automatically as they manage the match.

No account required. No install required. No Twitch setup required.

### OBS Troubleshooting Notes

Add a small help section:

```text
Overlay not showing?
- Make sure the OBS source type is Browser.
- Make sure the URL is pasted correctly.
- Make sure width and height match the recommended size.
- Right-click the source and choose Transform → Fit to Screen if needed.
- Refresh the browser source.
- Make sure the lobby still exists.
```

## Overlay Layouts

V1 should include these overlay formats.

### Top Bar

For top-middle of the stream.

Shows:

- Player names
- Scores
- Current game
- Target score if set

### Lower Third

For bottom of stream.

Shows:

- Current game
- Scores
- Optional next games

### Compact Left

Small vertical overlay for left side.

Shows:

- Current game
- Player 1 score
- Player 2 score

### Compact Right

Same as compact left, aligned for right side.

### Square Card

Good for corner placement.

Shows:

- Current selected game
- Score block
- Small Gaming Gauntlet branding

### Wheel Overlay

Optional browser source that shows the wheel itself.

Useful if streamers want the spin visible on stream.

### Fullscreen Showcase

Useful for intro, intermission, or "next game" scenes.

Shows:

- Big current game
- Large score
- Player names
- Optional wheel result animation

## Pages And Routes

```text
/                         Landing page
/create                   Create lobby
/manage/:lobbyId          Management room
/g/:lobbyId               Public lobby view
/overlay/:lobbyId/top     OBS top bar overlay
/overlay/:lobbyId/lower   OBS lower-third overlay
/overlay/:lobbyId/left    OBS compact left overlay
/overlay/:lobbyId/right   OBS compact right overlay
/overlay/:lobbyId/square  OBS square overlay
/overlay/:lobbyId/wheel   OBS wheel overlay
/overlay/:lobbyId/full    Fullscreen showcase overlay
```

## Tech Stack

Use the simple Cloudflare stack:

```text
Frontend:
- React
- Vite
- TypeScript
- Existing UI kit
- Cloudflare Pages

Backend:
- Cloudflare Worker
- Cloudflare D1
- Zod for validation
```

Do not use Twitch Extension, Twitch OAuth, EventSub, Queues, or chat bot infrastructure in V1.

Durable Objects are optional and should be avoided unless truly needed.

## Realtime Strategy

For V1, use simple polling instead of WebSockets or Durable Objects.

Management page and overlays can poll:

```http
GET /api/lobbies/:lobbyId/state
```

Poll every 1–2 seconds.

Each state response includes:

```ts
updatedAt: number
version: number
```

Clients can avoid unnecessary rerenders if the version has not changed.

This is cheaper, simpler, and good enough for OBS overlays.

## Basic Data Model

### Lobby

```ts
type Lobby = {
  id: string
  playerOneName: string
  playerTwoName: string
  playerOneScore: number
  playerTwoScore: number
  targetScore: number | null
  currentGameId: string | null
  status: "active" | "finished"
  version: number
  createdAt: number
  updatedAt: number
}
```

### Game

```ts
type Game = {
  id: string
  lobbyId: string
  title: string
  position: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}
```

### Management Access

```ts
type LobbySecret = {
  lobbyId: string
  managementCodeHash: string
  createdAt: number
}
```

Store only a hash of the management code.

Do not store the raw code.

## API Endpoints

### Public Read

```http
GET /api/lobbies/:lobbyId/state
```

Returns public lobby state for the management page, public page, and overlays.

Should never return the management code.

### Create Lobby

```http
POST /api/lobbies
```

Creates a lobby and returns:

```ts
{
  lobbyId: string
  managementCode: string
}
```

This is the only time the raw management code is automatically returned.

### Verify Management Code

```http
POST /api/lobbies/:lobbyId/verify
```

Checks whether a management code is valid.

### Update Lobby

```http
PATCH /api/lobbies/:lobbyId
```

Requires management code.

Can update:

- Player names
- Scores
- Target score
- Current game
- Status

### Manage Games

```http
POST /api/lobbies/:lobbyId/games
PATCH /api/lobbies/:lobbyId/games/:gameId
DELETE /api/lobbies/:lobbyId/games/:gameId
POST /api/lobbies/:lobbyId/games/reorder
```

Requires management code.

### Spin Wheel

```http
POST /api/lobbies/:lobbyId/spin
```

Requires management code.

Server chooses the selected game from enabled games and updates `currentGameId`.

## UI Requirements

### Management Page

Main layout:

- Large wheel on the left
- Editable game list on the right
- Score controls below or beside the wheel
- Current selected game clearly visible
- Overlay URL copy buttons
- Hidden code management section

Right-side game editor:

- Add game input
- Inline rename
- Delete button
- Enable/disable toggle
- Drag reorder if easy, otherwise up/down buttons for V1

Score controls:

- `+1` and `-1` for each player
- Reset score
- Optional target score
- Clear current game
- Reset match

### Overlay Settings

Management page should provide copy buttons for each overlay type:

```text
Top Bar
Lower Third
Compact Left
Compact Right
Square
Wheel
Fullscreen Showcase
```

Each copied URL should be safe for OBS and should not include the management code.

## Deployment

Use:

```text
Cloudflare Pages
Cloudflare Worker
Cloudflare D1
```

Suggested structure:

```text
apps/
  web/
  worker/
packages/
  ui/
  shared/
```

Or, if the repo is already simpler, keep it simpler:

```text
src/
worker/
shared/
```

Do not spend time restructuring unless it directly speeds up development.

## Delivery Phases

### Phase 1 — Simplify Existing App

- Remove Twitch Extension scope from V1
- Remove chat command scope from V1
- Remove EventSub and bot scope from V1
- Keep only website, management page, Worker API, D1, and OBS overlays
- Confirm the app runs locally

### Phase 2 — Lobby And State API

- Create D1 schema
- Add lobby creation endpoint
- Add public lobby state endpoint
- Add management-code verification
- Add authenticated update endpoints
- Store management code as a hash

### Phase 3 — Management UI

- Build `/create`
- Build `/manage/:lobbyId`
- Add wheel component
- Add editable game list
- Add score controls
- Add current game display
- Add overlay URL copy section

### Phase 4 — Wheel Logic

- Add spin animation
- Pick enabled game
- Save selected game to lobby state
- Sync selected game to overlays
- Add reset/clear selected game

### Phase 5 — OBS Overlays

Build overlay routes:

- Top bar
- Lower third
- Compact left
- Compact right
- Square
- Wheel
- Fullscreen showcase

Each overlay should:

- Use transparent background where appropriate
- Be readable on stream
- Poll lobby state
- Hide all management controls
- Never expose the management code

### Phase 6 — Polish And Deploy

- Add loading states
- Add empty game list state
- Add invalid lobby state
- Add invalid code state
- Add copied-to-clipboard feedback
- Add basic mobile responsiveness for management
- Deploy to Cloudflare Pages and Worker
- Connect domain `gaminggauntlet.com`

## Out Of Scope For V1

Do not build these yet:

- Twitch Extension
- Twitch OAuth
- Twitch chat commands
- Viewer voting
- EventSub
- Shared bot account
- Cloudflare Queues
- Complex moderation system
- Public account system
- Billing
- Team management
- Automated game result ingestion
- Heavy realtime WebSocket infrastructure

These can be added later if the basic wheel product works well.

## V1 Acceptance Criteria

The first version is complete when:

- A user can create a lobby
- A user can copy a management URL and hidden code
- Another person can join management using the code
- The code never appears in the URL
- Games can be added, edited, removed, and reordered
- The wheel can be spun
- The selected game updates for everyone
- Scores can be updated manually
- OBS overlay URLs work as browser sources
- At least six overlay layouts exist
- Overlay pages never show management controls or secret codes
- App deploys successfully on Cloudflare Pages
- API runs through Cloudflare Worker
- State persists in D1

## Recommended First Build Target

Build this first:

```text
/create
/manage/:lobbyId
/overlay/:lobbyId/top
/api/lobbies
/api/lobbies/:lobbyId/state
```

Once that works, add the other overlay formats and polish the management UI.

## Implementation Notes

### Keep The Secret Out Of URLs

Correct:

```http
PATCH /api/lobbies/abc123
Authorization: Bearer <managementCode>
```

Incorrect:

```http
PATCH /api/lobbies/abc123?code=<managementCode>
```

### Overlay Polling Example

```ts
async function fetchLobbyState(lobbyId: string) {
  const response = await fetch(`/api/lobbies/${lobbyId}/state`, {
    headers: {
      "Accept": "application/json",
    },
  })

  if (!response.ok) {
    throw new Error("Failed to load lobby state")
  }

  return response.json()
}
```

### Copy OBS URL Example

```ts
function getOverlayUrl(origin: string, lobbyId: string, overlay: string) {
  return `${origin}/overlay/${lobbyId}/${overlay}`
}
```

### Recommended Overlay Rendering Rules

- Use transparent page backgrounds for overlays.
- Avoid tiny text.
- Keep score and current game readable at a glance.
- Use CSS text shadows or strong panels for readability over gameplay.
- Respect `prefers-reduced-motion`.
- Keep all overlays read-only.
- Use route-level overlay layouts instead of one layout with too many settings.
