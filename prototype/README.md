# Gaming Gauntlet — UI Kit Prototype

This folder is the **canonical design reference** for Gaming Gauntlet V1. It is a
self-contained, browser-runnable prototype of every V1 surface (Create, Match
room, Overlays) built with plain JSX + Babel-in-the-browser. It is **not** part
of the build, lint, typecheck, or test pipeline — it exists so the production
code in `packages/ui` and `apps/web` has a precise visual + structural target.

When a phase says "use the existing UI/design kit," this is that kit.

## Run it

Open `Prototype.html` in a browser (or serve the folder). React, ReactDOM, and
Babel are loaded from a CDN; the `text/babel` scripts are transpiled on the fly.

## File map

| File | Role | Maps to (production) |
| --- | --- | --- |
| `kit.css` | Design tokens + primitive component styles | `packages/ui/src/styles/index.css` |
| `app.css` | Screen/layout styles (rail, create, scorebar, game pool, wheel, overlays) | `apps/web/src/app.css` |
| `kit.jsx` | Primitives: `KitButton`, `KitChip`, `KitPanel`, `KitCard`, `KitNotice`, `KitTextField`, `KitTextareaField`, `PageShell`, `ScoreBug`, `Ico` | `packages/ui/src/components/*` |
| `store.jsx` | Mock lobby state + actions — mirrors the lobby API contract | `apps/web/src/lobby-api.ts` + D1 |
| `screens-create.jsx` | Create page + management-passcode UX (Phase 5) | `apps/web/src/CreatePage.tsx` |
| `screens-match.jsx` | Single match room `/g/:lobbyId`: public view + inline unlock, scorebar, editable game pool, wheel (Phase 6–7) | `apps/web` match room |
| `wheel.jsx` | Spin-to-pick wheel: `radial` + `reel` styles, easing, reduced-motion safety net (Phase 7) | wheel component |
| `overlays.jsx` | The read-only on-stream overlay graphics + their metadata (Phase 8) | overlay routes |
| `screens-obs.jsx` | OBS overlay gallery: live transparent previews + copy-URL + setup/troubleshooting (Phase 9) | management OBS panel |
| `app.jsx` | Prototype shell: nav rail + screen routing + Tweaks panel | _prototype only_ — real app uses URL routes, no rail |
| `tweaks-panel.jsx` | Dev-only live theming panel | _prototype only_ |
| `screenshots/` | Reference captures of the intended look | — |

## Things the production app does differently on purpose

- **Routing, not a rail.** `app.jsx` uses a left nav rail to switch screens for
  demo convenience. The real app uses real URLs (`/create`, `/g/:lobbyId`,
  `/overlay/:lobbyId/*`); the match URL is the only shareable link. Ignore the
  rail; port the screens.
- **Real API + auth.** `store.jsx` is an in-memory stand-in. Production wires the
  same action shape to the Worker API with `Authorization: Bearer <managementCode>`
  and polls public state.
- **Secrets.** The prototype prints the demo passcode for convenience. Production
  must keep the management passcode out of URLs, overlays, logs, and public API
  responses, revealed only on explicit user action.

## Overlay set (source of truth)

`top`, `lower-third`, `compact`, `rail`, `square`, `wheel`, `full` — see
`overlays.jsx` (graphics) and `screens-obs.jsx` (gallery + recommended sizes).
