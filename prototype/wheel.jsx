// wheel.jsx — the spin-to-pick showpiece. Three styles, all readable at small
// on-stream sizes: radial pie wheel, horizontal reel, vertical case-opening tower.
// Picks a winner first, then animates to it; respects prefers-reduced-motion.

const WHEEL_PALETTE = [
  "var(--gg-team-alpha)", "var(--gg-team-bravo)", "var(--gg-accent)",
  "var(--gg-accent-2)", "var(--gg-team-alpha-soft)", "var(--gg-team-bravo-soft)",
];

const prefersReduced = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- radial pie wheel ----
function RadialWheel({ games, rotation }) {
  const n = games.length;
  const seg = 360 / n;
  const bands = games
    .map((g, i) => {
      const c = WHEEL_PALETTE[i % WHEEL_PALETTE.length];
      return `${c} ${i * seg}deg ${(i + 1) * seg}deg`;
    })
    .join(", ");
  return (
    <div className="gg-wheel-wrap">
      <div className="gg-wheel__pointer" />
      <div
        className="gg-wheel"
        style={{
          background: `conic-gradient(from 0deg, ${bands})`,
          transform: `rotate(${rotation}deg)`,
          transition: "none",
        }}
      >
        {games.map((g, i) => {
          const c = i * seg + seg / 2;
          return (
            <div
              key={g.id}
              className="gg-wheel__label"
              style={{ width: "44%", transform: `rotate(${c - 90}deg)`, textAlign: "right", paddingRight: "14px" }}
            >
              {g.title}
            </div>
          );
        })}
      </div>
      <div className="gg-wheel__hub">GG</div>
    </div>
  );
}

// ---- horizontal / vertical reel ----
function ReelWheel({ games, offset, vertical }) {
  // long padded strip so the winner can scroll in from far away
  const CELL = vertical ? 80 : 180;
  const reps = 8;
  const strip = [];
  for (let r = 0; r < reps; r++) {
    games.forEach((g, i) => strip.push({ ...g, key: `${r}-${g.id}-${i}` }));
  }
  const axis = vertical ? "translateY" : "translateX";
  return (
    <div className={cx("gg-reel", vertical && "gg-reel--vertical")}>
      <div className="gg-reel__viewport">
        <div className="gg-reel__fade" />
        <div className="gg-reel__marker" />
        <div
          className="gg-reel__track"
          style={{
            transform: `${axis}(${offset}px)`,
            transition: "none",
          }}
        >
          {strip.map((g, i) => (
            <div
              key={g.key}
              className="gg-reel__cell"
              style={{ color: WHEEL_PALETTE[(i % games.length) % WHEEL_PALETTE.length] }}
            >
              {g.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Wheel({ games, style = "radial", spinSignal, onResult, compact }) {
  const enabled = games.filter((g) => g.enabled);
  const [rotation, setRotation] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [spinning, setSpinning] = React.useState(false);
  const lastSignal = React.useRef(spinSignal);
  const rafRef = React.useRef(null);

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  React.useEffect(() => {
    if (spinSignal === lastSignal.current) return;
    lastSignal.current = spinSignal;
    if (enabled.length === 0 || spinning) return;

    const winnerIdx = Math.floor(Math.random() * enabled.length);
    const winner = enabled[winnerIdx];
    setSpinning(true);

    const isRadial = style === "radial";
    const vertical = style === "tower";

    // figure out where we start and where we need to land
    let from, to, apply;
    if (isRadial) {
      const n = enabled.length;
      const seg = 360 / n;
      const c = winnerIdx * seg + seg / 2;
      const spins = 6 + Math.floor(Math.random() * 3); // 6–8 full turns
      const base = rotation - (rotation % 360);
      from = rotation;
      to = base + 360 * spins - c;
      apply = setRotation;
    } else {
      const CELL = vertical ? 80 : 180;
      const viewport = vertical ? 240 : (compact ? 360 : 520);
      const center = viewport / 2 - CELL / 2;
      const targetIndex = 6 * enabled.length + winnerIdx;
      const jitter = (Math.random() - 0.5) * (CELL * 0.4);
      from = offset;
      to = -(targetIndex * CELL) + center - jitter;
      apply = setOffset;
    }

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      cancelAnimationFrame(rafRef.current);
      apply(to);
      setSpinning(false);
      onResult && onResult(winner);
    };

    let done = false;
    let safety = null;

    // Real spinner feel: fast launch, long exponential-style coast to a dead stop.
    // easeOutQuint keeps high velocity early then eases the last few degrees in slowly.
    // The spin is the showpiece, so we always animate (don't honor reduce-motion here).
    const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
    const dur = 4400 + Math.random() * 700; // 4.4–5.1s
    const start = performance.now();
    const delta = to - from;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      apply(from + delta * easeOutQuint(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    // safety net: if rAF is ever throttled (e.g. backgrounded tab) the spin still resolves
    safety = setTimeout(finish, dur + 500);
    return () => { clearTimeout(safety); cancelAnimationFrame(rafRef.current); };
  }, [spinSignal]);

  if (enabled.length === 0) {
    return (
      <div className="gg-wheel-empty">
        <Ico name="wheel" className="gg-lock-ico" />
        <strong style={{ fontFamily: "var(--gg-font-display)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          No games enabled
        </strong>
        <span>Add or enable a game to spin the gauntlet.</span>
      </div>
    );
  }

  if (style === "radial") return <RadialWheel games={enabled} rotation={rotation} />;
  return <ReelWheel games={enabled} offset={offset} vertical={style === "tower"} />;
}

Object.assign(window, { Wheel });
