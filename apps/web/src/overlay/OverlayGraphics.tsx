import type { CSSProperties, ReactElement } from "react";

import type { OverlaySlug } from "./catalog";
import {
  currentGameTitle,
  nextPooledGameTitle,
} from "./overlay-match";
import type { OverlayMatch } from "./overlay-match";

// TypeScript port of prototype/overlays.jsx plus the four production-only
// layouts (vs-intro, ticker, corner, banner). Every graphic is read-only and
// renders only public state. Styling lives in apps/web/src/app.css (ov-* rules
// + theme blocks); these components carry only the markup + team-color vars.

export type OverlayGraphicOptions = {
  showNext?: boolean;
  brand?: string;
};

type TeamColorStyle = CSSProperties & {
  "--team-color"?: string;
};

function teamColor(team: "alpha" | "bravo"): TeamColorStyle {
  return { "--team-color": `var(--gg-team-${team})` };
}

function initialOf(player: OverlayMatch["players"][number] | undefined): string {
  return (player?.displayName ?? "?").trim().charAt(0).toUpperCase() || "?";
}

// The match format line. A match with a target score is "First to N"; a match
// with no fixed number (open / target cleared mid-stream) reads "Open match".
function matchFormatLabel(m: OverlayMatch): string {
  return m.targetWins ? `First to ${m.targetWins}` : "Open match";
}

// Series pips: `total` dots, the first `filled` lit. Only shown when the match
// has a target score; an open match (no fixed number) renders no pips.
function SeriesPips({ total, filled }: { total: number | null; filled: number }) {
  if (!total || total > 9) {
    return null;
  }

  return (
    <span aria-hidden="true" className="ov-series__pips">
      {Array.from({ length: total }).map((_, index) => (
        <span
          className={`ov-series__pip${index < Math.min(filled, total) ? " is-on" : ""}`}
          key={index}
        />
      ))}
    </span>
  );
}

function OvTop({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-top">
      <div className="ov-top__team" style={teamColor("alpha")}>
        <span className="ov-top__name">{a?.displayName}</span>
        <span className="ov-top__score">{a?.wins}</span>
      </div>
      <div className="ov-top__center">
        <span className="ov-top__game">{currentGameTitle(m)}</span>
        {m.targetWins ? (
          <span className="ov-top__meta">{matchFormatLabel(m)}</span>
        ) : null}
      </div>
      <div
        className="ov-top__team ov-top__team--right"
        style={teamColor("bravo")}
      >
        <span className="ov-top__name">{b?.displayName}</span>
        <span className="ov-top__score">{b?.wins}</span>
      </div>
    </div>
  );
}

function OvLower({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-lower">
      <div className="ov-lower__row">
        <span className="ov-lower__eyebrow">{m.title}</span>
        <span className="ov-lower__game">{currentGameTitle(m)}</span>
      </div>
      <div className="ov-lower__teams">
        <span className="ov-lower__t1">
          {a?.displayName} {a?.wins}
        </span>
        <span className="ov-lower__vs">vs</span>
        <span className="ov-lower__t2">
          {b?.wins} {b?.displayName}
        </span>
      </div>
    </div>
  );
}

function OvCompact({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-compact">
      <div className="ov-compact__row" style={teamColor("alpha")}>
        <span className="ov-compact__name">{a?.displayName}</span>
        <span className="ov-compact__score">{a?.wins}</span>
      </div>
      <div className="ov-compact__row" style={teamColor("bravo")}>
        <span className="ov-compact__name">{b?.displayName}</span>
        <span className="ov-compact__score">{b?.wins}</span>
      </div>
      <div className="ov-compact__foot">{currentGameTitle(m)}</div>
    </div>
  );
}

function OvRail({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-rail">
      <div className="ov-rail__lead">
        <span className="ov-rail__lead-label">Now playing</span>
        <span className="ov-rail__lead-game">{currentGameTitle(m)}</span>
      </div>
      <div className="ov-rail__team" style={teamColor("alpha")}>
        <span className="ov-rail__name">{a?.displayName}</span>
        <span className="ov-rail__score">{a?.wins}</span>
      </div>
      <div className="ov-rail__vs">VS</div>
      <div className="ov-rail__team" style={teamColor("bravo")}>
        <span className="ov-rail__name">{b?.displayName}</span>
        <span className="ov-rail__score">{b?.wins}</span>
      </div>
      <div className="ov-rail__foot">
        <span className="ov-rail__game">{m.title}</span>
      </div>
    </div>
  );
}

function OvSquare({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-square">
      <span className="ov-square__title">{m.title}</span>
      <div className="ov-square__teams">
        <div>
          <div className="ov-square__score ov-square__score--alpha">
            {a?.wins}
          </div>
          <div className="ov-square__nm ov-square__nm--alpha">
            {a?.displayName}
          </div>
        </div>
        <div className="ov-square__versus">vs</div>
        <div>
          <div className="ov-square__score ov-square__score--bravo">
            {b?.wins}
          </div>
          <div className="ov-square__nm ov-square__nm--bravo">
            {b?.displayName}
          </div>
        </div>
      </div>
      <div className="ov-square__game">{currentGameTitle(m)}</div>
    </div>
  );
}

// Angled top scoreboard: name → colored score box → center game/meta → score
// box → name.
function OvArenaBar({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-arena">
      <div className="ov-arena__side ov-arena__side--alpha" style={teamColor("alpha")}>
        <span className="ov-arena__name">{a?.displayName}</span>
        <span className="ov-arena__score">{a?.wins}</span>
      </div>
      <div className="ov-arena__center">
        <span className="ov-arena__game">{currentGameTitle(m)}</span>
        <span className="ov-arena__meta">{matchFormatLabel(m)}</span>
      </div>
      <div className="ov-arena__side ov-arena__side--bravo" style={teamColor("bravo")}>
        <span className="ov-arena__score">{b?.wins}</span>
        <span className="ov-arena__name">{b?.displayName}</span>
      </div>
    </div>
  );
}

// Light broadcast scoreboard: the match title sits above a light score row with
// team badges and team-tinted scores.
function OvBroadcastBar({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-broadcast">
      <div className="ov-broadcast__title">{m.title}</div>
      <div className="ov-broadcast__row">
        <div
          className="ov-broadcast__team ov-broadcast__team--alpha"
          style={teamColor("alpha")}
        >
          <span className="ov-broadcast__badge">{initialOf(a)}</span>
          <span className="ov-broadcast__name">{a?.displayName}</span>
          <span className="ov-broadcast__score">{a?.wins}</span>
        </div>
        <div className="ov-broadcast__center">
          <span className="ov-broadcast__game">{currentGameTitle(m)}</span>
          <span className="ov-broadcast__meta">{matchFormatLabel(m)}</span>
        </div>
        <div
          className="ov-broadcast__team ov-broadcast__team--bravo"
          style={teamColor("bravo")}
        >
          <span className="ov-broadcast__score">{b?.wins}</span>
          <span className="ov-broadcast__name">{b?.displayName}</span>
          <span className="ov-broadcast__badge">{initialOf(b)}</span>
        </div>
      </div>
    </div>
  );
}

// Bold scoreboard with a colored under-strip, oversized scores, and a series-pip
// tracker under each team (pips only appear when the match has a target score).
function OvSeriesBar({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-series">
      <div
        className="ov-series__team ov-series__team--alpha"
        style={teamColor("alpha")}
      >
        <div className="ov-series__head">
          <span className="ov-series__name">{a?.displayName}</span>
          <span className="ov-series__badge">{initialOf(a)}</span>
        </div>
        <SeriesPips filled={a?.wins ?? 0} total={m.targetWins} />
      </div>
      <span
        className="ov-series__score ov-series__score--alpha"
        style={teamColor("alpha")}
      >
        {a?.wins}
      </span>
      <div className="ov-series__center">
        <span className="ov-series__game">{currentGameTitle(m)}</span>
        <span className="ov-series__meta">{matchFormatLabel(m)}</span>
      </div>
      <span
        className="ov-series__score ov-series__score--bravo"
        style={teamColor("bravo")}
      >
        {b?.wins}
      </span>
      <div
        className="ov-series__team ov-series__team--bravo"
        style={teamColor("bravo")}
      >
        <div className="ov-series__head">
          <span className="ov-series__badge">{initialOf(b)}</span>
          <span className="ov-series__name">{b?.displayName}</span>
        </div>
        <SeriesPips filled={b?.wins ?? 0} total={m.targetWins} />
      </div>
    </div>
  );
}

function OvFull({ m }: { m: OverlayMatch }) {
  return (
    <div className="ov-full">
      <span className="ov-square__title">{m.title}</span>
      <div className="gg-pick__label ov-full__label">Now playing</div>
      <div className="gg-pick__title ov-full__title">{currentGameTitle(m)}</div>
      <OvTop m={m} />
    </div>
  );
}

function OvVsIntro({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-vs">
      <span className="ov-vs__title">{m.title}</span>
      <div className="ov-vs__grid">
        <div className="ov-vs__team ov-vs__team--alpha" style={teamColor("alpha")}>
          <span className="ov-vs__name">{a?.displayName}</span>
          <span className="ov-vs__score">{a?.wins}</span>
        </div>
        <div className="ov-vs__center">VS</div>
        <div className="ov-vs__team ov-vs__team--bravo" style={teamColor("bravo")}>
          <span className="ov-vs__name">{b?.displayName}</span>
          <span className="ov-vs__score">{b?.wins}</span>
        </div>
      </div>
      <div className="ov-vs__foot">
        <span className="ov-vs__game">{currentGameTitle(m)}</span>
        {m.targetWins ? (
          <span className="ov-vs__meta">{matchFormatLabel(m)}</span>
        ) : null}
      </div>
    </div>
  );
}

function OvTicker({
  m,
  options,
}: {
  m: OverlayMatch;
  options: OverlayGraphicOptions;
}) {
  const [a, b] = m.players;
  const nextTitle = options.showNext ? nextPooledGameTitle(m) : null;

  return (
    <div className="ov-ticker">
      {options.brand ? (
        <span className="ov-ticker__brand">{options.brand}</span>
      ) : null}
      <span className="ov-ticker__team" style={teamColor("alpha")}>
        <span className="ov-ticker__name">{a?.displayName}</span>
        <span className="ov-ticker__score">{a?.wins}</span>
      </span>
      <span className="ov-ticker__game">{currentGameTitle(m)}</span>
      <span className="ov-ticker__team" style={teamColor("bravo")}>
        <span className="ov-ticker__score">{b?.wins}</span>
        <span className="ov-ticker__name">{b?.displayName}</span>
      </span>
      {nextTitle ? (
        <span className="ov-ticker__next">Next: {nextTitle}</span>
      ) : null}
    </div>
  );
}

function OvCorner({ m }: { m: OverlayMatch }) {
  const [a, b] = m.players;

  return (
    <div className="ov-corner">
      <span className="ov-corner__team" style={teamColor("alpha")}>
        <span className="ov-corner__name">{a?.displayName}</span>
        <span className="ov-corner__score">{a?.wins}</span>
      </span>
      <span className="ov-corner__vs">·</span>
      <span className="ov-corner__team" style={teamColor("bravo")}>
        <span className="ov-corner__score">{b?.wins}</span>
        <span className="ov-corner__name">{b?.displayName}</span>
      </span>
    </div>
  );
}

function OvBanner({
  m,
  options,
}: {
  m: OverlayMatch;
  options: OverlayGraphicOptions;
}) {
  const nextTitle = options.showNext ? nextPooledGameTitle(m) : null;

  return (
    <div className="ov-banner">
      <span className="ov-banner__eyebrow">{options.brand ?? m.title}</span>
      <span className="ov-banner__title">{currentGameTitle(m)}</span>
      {nextTitle ? (
        <span className="ov-banner__next">Up next · {nextTitle}</span>
      ) : (
        <span className="ov-banner__meta">
          {m.players[0]?.displayName} {m.players[0]?.wins} —{" "}
          {m.players[1]?.wins} {m.players[1]?.displayName}
        </span>
      )}
    </div>
  );
}

// Slug → renderer. Typed as Record<OverlaySlug, …> so adding a catalog overlay
// without a matching graphic here is a compile error (rather than a silently
// blank overlay).
const GRAPHICS: Record<
  OverlaySlug,
  (m: OverlayMatch, options: OverlayGraphicOptions) => ReactElement
> = {
  top: (m) => <OvTop m={m} />,
  "lower-third": (m) => <OvLower m={m} />,
  compact: (m) => <OvCompact m={m} />,
  rail: (m) => <OvRail m={m} />,
  square: (m) => <OvSquare m={m} />,
  "arena-bar": (m) => <OvArenaBar m={m} />,
  broadcast: (m) => <OvBroadcastBar m={m} />,
  "series-bar": (m) => <OvSeriesBar m={m} />,
  full: (m) => <OvFull m={m} />,
  "vs-intro": (m) => <OvVsIntro m={m} />,
  ticker: (m, options) => <OvTicker m={m} options={options} />,
  corner: (m) => <OvCorner m={m} />,
  banner: (m, options) => <OvBanner m={m} options={options} />,
};

export function OverlayGraphic({
  slug,
  m,
  options = {},
}: {
  slug: string;
  m: OverlayMatch;
  options?: OverlayGraphicOptions;
}) {
  const render = GRAPHICS[slug as OverlaySlug];

  return render ? render(m, options) : null;
}
