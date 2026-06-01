// Single source of truth for the OBS overlay routes. Reused by the overlay
// pages (Phase 8) and the "Add to OBS" gallery (Phase 9). Each entry's `slug`
// is the URL segment in /overlay/:lobbyId/:variant and the recommended OBS
// browser-source size is `w` × `h`.

import { buildPublicUrl } from "../public-urls";

// Gallery sections for the Phase 9 "Add to OBS" surface. The catalog carries
// the group so new overlays appear under the right heading automatically — the
// surface never hardcodes the overlay list.
export type OverlayGroupId = "top-bars" | "score-cards" | "fullscreen";

export type OverlayDefinition = {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  slug: string;
  group: OverlayGroupId;
};

export const OVERLAYS = [
  {
    id: "top",
    name: "Top Bar",
    desc: "Slim header bar with both scores + current game.",
    w: 1280,
    h: 90,
    slug: "top",
    group: "top-bars",
  },
  {
    id: "arena-bar",
    name: "Arena Bar",
    desc: "Angled top scoreboard with both scores and the current game.",
    w: 960,
    h: 96,
    slug: "arena-bar",
    group: "top-bars",
  },
  {
    id: "shield-bar",
    name: "Shield Bar",
    desc: "Top bar with team badges and a center game block.",
    w: 1000,
    h: 96,
    slug: "shield-bar",
    group: "top-bars",
  },
  {
    id: "broadcast",
    name: "Broadcast Scoreboard",
    desc: "Light broadcast scoreboard with the match title above.",
    w: 1040,
    h: 150,
    slug: "broadcast",
    group: "top-bars",
  },
  {
    id: "series-bar",
    name: "Series Bar",
    desc: "Bold scoreboard with oversized scores and a series tracker.",
    w: 1080,
    h: 120,
    slug: "series-bar",
    group: "top-bars",
  },
  {
    id: "lower-third",
    name: "Lower Third",
    desc: "Broadcast lower-third for intros and transitions.",
    w: 900,
    h: 180,
    slug: "lower-third",
    group: "score-cards",
  },
  {
    id: "compact",
    name: "Compact Card",
    desc: "Small stacked score card for any corner.",
    w: 320,
    h: 200,
    slug: "compact",
    group: "score-cards",
  },
  {
    id: "rail",
    name: "Vertical Rail",
    desc: "Tall portrait strip for a screen edge or beside a facecam.",
    w: 240,
    h: 560,
    slug: "rail",
    group: "score-cards",
  },
  {
    id: "square",
    name: "Square Card",
    desc: "Balanced square score card for any corner.",
    w: 360,
    h: 360,
    slug: "square",
    group: "score-cards",
  },
  {
    id: "full",
    name: "Fullscreen Showcase",
    desc: "Between-rounds full-frame card with the current pick.",
    w: 1920,
    h: 1080,
    slug: "full",
    group: "fullscreen",
  },
  {
    id: "vs-intro",
    name: "VS Intro",
    desc: "Full-frame matchup screen for the start of a series.",
    w: 1920,
    h: 1080,
    slug: "vs-intro",
    group: "fullscreen",
  },
  {
    id: "ticker",
    name: "Standings Ticker",
    desc: "Slim bottom ticker bar with both scores + current game.",
    w: 1920,
    h: 70,
    slug: "ticker",
    group: "top-bars",
  },
  {
    id: "corner",
    name: "Corner Bug",
    desc: "Minimal corner bug with both scores.",
    w: 220,
    h: 64,
    slug: "corner",
    group: "score-cards",
  },
  {
    id: "banner",
    name: "Break / Sponsor Banner",
    desc: "Break or sponsor card for between-segment screens.",
    w: 1280,
    h: 300,
    slug: "banner",
    group: "fullscreen",
  },
] as const satisfies readonly OverlayDefinition[];

// The set of valid overlay slugs, narrowed to a literal union so the graphics
// map (OverlayGraphics.tsx) is checked exhaustively against the catalog.
export type OverlaySlug = (typeof OVERLAYS)[number]["slug"];

export const OVERLAY_SLUGS: ReadonlySet<string> = new Set(
  OVERLAYS.map((overlay) => overlay.slug)
);

export function isOverlaySlug(value: string): boolean {
  return OVERLAY_SLUGS.has(value);
}

export function getOverlayDefinition(
  slug: string
): OverlayDefinition | undefined {
  return OVERLAYS.find((overlay) => overlay.slug === slug);
}

export const THEMES = ["default", "iem", "blast", "pgl", "arena"] as const;

export type OverlayTheme = (typeof THEMES)[number];

const THEME_SET: ReadonlySet<string> = new Set(THEMES);

export function isTheme(value: string): value is OverlayTheme {
  return THEME_SET.has(value);
}

// Picker labels are palette-descriptive (no tournament/brand names in the UI);
// the `value` is the key used in ?theme= and the gg-theme-/gg-ov-- classes.
export const THEME_OPTIONS: ReadonlyArray<{
  value: OverlayTheme;
  label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "iem", label: "Ice" },
  { value: "blast", label: "Neon" },
  { value: "pgl", label: "Sunset" },
  { value: "arena", label: "Arena" },
];

// Ordered gallery sections for the "Add to OBS" surface. The order here drives
// the heading order; cards are pulled from OVERLAYS by matching `group`.
export const OVERLAY_GROUPS: ReadonlyArray<{
  id: OverlayGroupId;
  label: string;
}> = [
  { id: "top-bars", label: "Top bars" },
  { id: "score-cards", label: "Score cards" },
  { id: "fullscreen", label: "Fullscreen" },
];

// The shareable overlay URL for an OBS browser source. Path segments are
// encoded, and ?theme= is appended only for a non-default theme so default
// links stay clean. No management passcode or other forbidden param is ever
// added — OBS browser sources cannot be sized from the URL, so size lives in
// the UI, not the link.
export function buildOverlayShareUrl(
  lobbyId: string,
  slug: string,
  theme: OverlayTheme
): string {
  const path = `/overlay/${encodeURIComponent(lobbyId)}/${encodeURIComponent(slug)}`;
  const base = buildPublicUrl(path);

  return theme === "default"
    ? base
    : `${base}?theme=${encodeURIComponent(theme)}`;
}
