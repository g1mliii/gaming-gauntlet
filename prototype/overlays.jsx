// overlays.jsx — the 7 read-only on-stream overlay graphics + their metadata.
// These are public, show only public state, and never render management controls.

const OVERLAYS = [
  { id: "top", name: "Top Bar", desc: "Slim header bar with both scores + current game.", w: 1280, h: 90, slug: "top" },
  { id: "lower-third", name: "Lower Third", desc: "Broadcast lower-third for intros and transitions.", w: 900, h: 180, slug: "lower-third" },
  { id: "compact", name: "Compact Card", desc: "Small stacked score card for any corner.", w: 320, h: 200, slug: "compact" },
  { id: "rail", name: "Vertical Rail", desc: "Tall portrait strip for a screen edge or beside a facecam.", w: 240, h: 560, slug: "rail" },
  { id: "square", name: "Square Card", desc: "Balanced square score card for any corner.", w: 360, h: 360, slug: "square" },
  { id: "full", name: "Fullscreen Showcase", desc: "Between-rounds full-frame card with the current pick.", w: 1920, h: 1080, slug: "full" },
];

function OvTop({ m }) {
  const [a, b] = m.players;
  return (
    <div className="ov-top">
      <div className="ov-top__team" style={{ "--team-color": "var(--gg-team-alpha)" }}>
        <span className="ov-top__name">{a.displayName}</span>
        <span className="ov-top__score">{a.wins}</span>
      </div>
      <div className="ov-top__center">
        <span className="ov-top__game">{currentGameTitle(m)}</span>
        {m.targetWins ? <span className="ov-top__meta">First to {m.targetWins}</span> : null}
      </div>
      <div className="ov-top__team ov-top__team--right" style={{ "--team-color": "var(--gg-team-bravo)" }}>
        <span className="ov-top__name">{b.displayName}</span>
        <span className="ov-top__score">{b.wins}</span>
      </div>
    </div>
  );
}

function OvLower({ m }) {
  const [a, b] = m.players;
  return (
    <div className="ov-lower">
      <div className="ov-lower__row">
        <span className="ov-lower__eyebrow">{m.title}</span>
        <span className="ov-lower__game">{currentGameTitle(m)}</span>
      </div>
      <div className="ov-lower__teams">
        <span className="ov-lower__t1">{a.displayName} {a.wins}</span>
        <span className="ov-lower__vs">vs</span>
        <span className="ov-lower__t2">{b.wins} {b.displayName}</span>
      </div>
    </div>
  );
}

function OvCompact({ m }) {
  const [a, b] = m.players;
  return (
    <div className="ov-compact">
      <div className="ov-compact__row" style={{ "--team-color": "var(--gg-team-alpha)" }}>
        <span className="ov-compact__name">{a.displayName}</span>
        <span className="ov-compact__score">{a.wins}</span>
      </div>
      <div className="ov-compact__row" style={{ "--team-color": "var(--gg-team-bravo)" }}>
        <span className="ov-compact__name">{b.displayName}</span>
        <span className="ov-compact__score">{b.wins}</span>
      </div>
      <div className="ov-compact__foot">{currentGameTitle(m)}</div>
    </div>
  );
}

function OvRail({ m }) {
  const [a, b] = m.players;
  return (
    <div className="ov-rail">
      <div className="ov-rail__lead">
        <span className="ov-rail__lead-label">Now playing</span>
        <span className="ov-rail__lead-game">{currentGameTitle(m)}</span>
      </div>
      <div className="ov-rail__team" style={{ "--team-color": "var(--gg-team-alpha)" }}>
        <span className="ov-rail__name">{a.displayName}</span>
        <span className="ov-rail__score">{a.wins}</span>
      </div>
      <div className="ov-rail__vs">VS</div>
      <div className="ov-rail__team" style={{ "--team-color": "var(--gg-team-bravo)" }}>
        <span className="ov-rail__name">{b.displayName}</span>
        <span className="ov-rail__score">{b.wins}</span>
      </div>
      <div className="ov-rail__foot">
        <span className="ov-rail__game">{m.title}</span>
      </div>
    </div>
  );
}

function OvSquare({ m }) {
  const [a, b] = m.players;
  return (
    <div className="ov-square">
      <span className="ov-square__title">{m.title}</span>
      <div className="ov-square__teams">
        <div>
          <div className="ov-square__score" style={{ color: "color-mix(in oklab, var(--gg-team-alpha) 82%, white)" }}>{a.wins}</div>
          <div className="ov-square__nm" style={{ color: "color-mix(in oklab, var(--gg-team-alpha) 55%, white)" }}>{a.displayName}</div>
        </div>
        <div className="gg-scorebug__versus" style={{ fontSize: "0.8rem" }}>vs</div>
        <div>
          <div className="ov-square__score" style={{ color: "color-mix(in oklab, var(--gg-team-bravo) 82%, white)" }}>{b.wins}</div>
          <div className="ov-square__nm" style={{ color: "color-mix(in oklab, var(--gg-team-bravo) 55%, white)" }}>{b.displayName}</div>
        </div>
      </div>
      <div className="ov-square__game">{currentGameTitle(m)}</div>
    </div>
  );
}

// Renders the requested overlay graphic by slug.
function OverlayGraphic({ slug, m, wheelStyle }) {
  switch (slug) {
    case "top": return <OvTop m={m} />;
    case "lower-third": return <OvLower m={m} />;
    case "compact": return <OvCompact m={m} />;
    case "rail": return <OvRail m={m} />;
    case "square": return <OvSquare m={m} />;
    case "wheel":
      return (
        <div style={{ display: "grid", gap: "0.8rem", justifyItems: "center" }}>
          <Wheel games={m.games} style={wheelStyle} spinSignal={0} compact />
          <div className="ov-square__game" style={{ borderTop: 0, padding: 0 }}>{currentGameTitle(m)}</div>
        </div>
      );
    case "full":
      return (
        <div style={{ width: 900, maxWidth: "100%", display: "grid", gap: "1.2rem", justifyItems: "center", textAlign: "center", padding: "1.6rem 2rem" }}>
          <span className="ov-square__title">{m.title}</span>
          <div className="gg-pick__label" style={{ margin: 0 }}>Now playing</div>
          <div className="gg-pick__title" style={{ maxWidth: "100%", textWrap: "balance", lineHeight: 0.95 }}>{currentGameTitle(m)}</div>
          <OvTop m={m} />
        </div>
      );
    default: return null;
  }
}

Object.assign(window, { OVERLAYS, OverlayGraphic, OvTop, OvLower, OvCompact, OvRail, OvSquare });
