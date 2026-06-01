import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";

import { Ico } from "./icons";

// Adapted from prototype/wheel.jsx. Two production deviations from the kit:
//  1. The winner is chosen on the server and fed in via `winnerGameId`; the
//     wheel only animates to it (the kit picked client-side with Math.random).
//  2. The spin runs on a transform-only ref written straight to the DOM inside
//     the rAF loop, so we don't re-render ~60x/s for ~5s. React state is never
//     touched per frame; the resting transform lives in a ref that a layout
//     effect re-applies after any parent re-render (the 1.5s state poll), which
//     keeps the spin on the compositor and avoids a mid-spin jump.

const WHEEL_PALETTE = [
  "var(--gg-team-alpha)",
  "var(--gg-team-bravo)",
  "var(--gg-accent)",
  "var(--gg-accent-2)",
  "var(--gg-team-alpha-soft)",
  "var(--gg-team-bravo-soft)",
];

const REEL_CELL = 150;
// easeOutCubic gives a long, visible deceleration (like a real wheel coasting on
// friction). The previous quint curve front-loaded the motion so hard the spin
// looked like it stopped abruptly after the first second.
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export type WheelStyle = "radial" | "reel";

export type WheelGame = {
  id: string;
  title: string;
  enabled: boolean;
};

export type WheelProps = {
  games: WheelGame[];
  style?: WheelStyle;
  /** Bump to trigger a spin. */
  spinSignal: number;
  /** Server-selected target; the wheel animates to this game. */
  winnerGameId: string | null;
  onResult?: (gameId: string) => void;
  /** Smaller reel viewport (overlay). */
  compact?: boolean;
};

function paletteColor(index: number): string {
  return WHEEL_PALETTE[index % WHEEL_PALETTE.length] ?? "var(--gg-accent)";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Bounds the reel strip so a large game pool can't build an oversized DOM strip
// (the kit hard-coded 8 reps). We keep enough lead-in repeats for a satisfying
// scroll while capping total cells; the winner lands one rep before the end so
// trailing cells still fill the right half of the viewport.
function reelLayout(
  poolSize: number,
  winnerIdx: number,
  compact: boolean
): { reps: number; targetIndex: number } {
  const n = Math.max(1, poolSize);
  const maxCells = compact ? 160 : 220;
  const reps = Math.max(3, Math.min(8, Math.floor(maxCells / n)));
  const winnerRep = Math.max(0, reps - 2);

  return { reps, targetIndex: winnerRep * n + winnerIdx };
}

function clearSpinTimers(
  rafRef: { current: number | null },
  safetyRef: { current: ReturnType<typeof setTimeout> | null }
): void {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  if (safetyRef.current !== null) {
    clearTimeout(safetyRef.current);
    safetyRef.current = null;
  }
}

function gamesEqual(a: WheelGame[], b: WheelGame[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];

    if (!left || !right || left.id !== right.id || left.title !== right.title) {
      return false;
    }
  }

  return true;
}

type SubWheelProps = {
  games: WheelGame[];
  spinElRef: RefObject<HTMLDivElement | null>;
};

const RadialWheel = memo(
  function RadialWheel({ games, spinElRef }: SubWheelProps) {
    const seg = 360 / games.length;
    const background = useMemo(() => {
      const bands = games
        .map(
          (game, index) =>
            `${paletteColor(index)} ${index * seg}deg ${(index + 1) * seg}deg`
        )
        .join(", ");

      return `conic-gradient(from 0deg, ${bands})`;
    }, [games, seg]);

    return (
      <div className="gg-wheel-wrap">
        <div className="gg-wheel__pointer" />
        <div
          className="gg-wheel"
          ref={spinElRef}
          style={{ background, transition: "none", willChange: "transform" }}
        >
          {games.map((game, index) => {
            const center = index * seg + seg / 2;

            return (
              <div
                className="gg-wheel__label"
                key={game.id}
                style={{
                  width: "44%",
                  transform: `rotate(${center - 90}deg)`,
                  textAlign: "right",
                  paddingRight: "14px",
                }}
              >
                {game.title}
              </div>
            );
          })}
        </div>
        <div className="gg-wheel__hub">GG</div>
      </div>
    );
  },
  (prev, next) =>
    prev.spinElRef === next.spinElRef && gamesEqual(prev.games, next.games)
);

const ReelWheel = memo(
  function ReelWheel({
    compact,
    games,
    spinElRef,
  }: SubWheelProps & { compact: boolean }) {
    const { reps } = reelLayout(games.length, 0, compact);
    const strip = useMemo(() => {
      const cells: Array<{ color: string; key: string; title: string }> = [];

      for (let rep = 0; rep < reps; rep += 1) {
        games.forEach((game, index) => {
          cells.push({
            color: paletteColor(index),
            key: `${rep}-${game.id}`,
            title: game.title,
          });
        });
      }

      return cells;
    }, [games, reps]);

    return (
      <div className="gg-reel" style={compact ? { maxWidth: 360 } : undefined}>
        <div className="gg-reel__viewport">
          <div className="gg-reel__fade" />
          <div className="gg-reel__marker" />
          <div
            className="gg-reel__track"
            ref={spinElRef}
            style={{ transition: "none", willChange: "transform" }}
          >
            {strip.map((cell) => (
              <div
                className="gg-reel__cell"
                key={cell.key}
                style={{ color: cell.color }}
              >
                {cell.title}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.spinElRef === next.spinElRef &&
    prev.compact === next.compact &&
    gamesEqual(prev.games, next.games)
);

export function Wheel({
  games,
  style = "radial",
  spinSignal,
  winnerGameId,
  onResult,
  compact = false,
}: WheelProps) {
  const enabled = useMemo(() => games.filter((game) => game.enabled), [games]);

  const spinElRef = useRef<HTMLDivElement | null>(null);
  const rotationRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignalRef = useRef(spinSignal);

  // Latest props read by the spin effect without widening its dependencies — the
  // effect must fire on `spinSignal` alone, or the 1.5s state poll (which gives
  // `enabled` a fresh identity) would re-run it and cancel an in-flight spin.
  const enabledRef = useRef(enabled);
  const styleRef = useRef(style);
  const winnerRef = useRef(winnerGameId);
  const compactRef = useRef(compact);
  const onResultRef = useRef(onResult);

  enabledRef.current = enabled;
  styleRef.current = style;
  winnerRef.current = winnerGameId;
  compactRef.current = compact;
  onResultRef.current = onResult;

  // Re-apply the live transform from the ref after every render so a parent
  // re-render mid-spin (or a style switch at rest) never resets the wheel.
  useLayoutEffect(() => {
    const node = spinElRef.current;

    if (!node) {
      return;
    }

    node.style.transform =
      style === "radial"
        ? `rotate(${rotationRef.current}deg)`
        : `translateX(${offsetRef.current}px)`;
  });

  // Cancel any in-flight spin on unmount.
  useEffect(
    () => () => {
      clearSpinTimers(rafRef, safetyRef);
    },
    []
  );

  useEffect(() => {
    if (spinSignal === lastSignalRef.current) {
      return;
    }

    lastSignalRef.current = spinSignal;

    const pool = enabledRef.current;

    if (pool.length === 0) {
      return;
    }

    const winnerIdx = winnerRef.current
      ? pool.findIndex((game) => game.id === winnerRef.current)
      : -1;
    const resolvedIdx = winnerIdx >= 0 ? winnerIdx : 0;
    const winner = pool[resolvedIdx];

    if (!winner) {
      return;
    }

    const isRadial = styleRef.current === "radial";
    const node = spinElRef.current;

    // The spin is the showpiece, so we always animate — but motion-sensitive
    // viewers get a shorter, calmer spin (fewer turns, brief duration) rather
    // than the snap-to-result jump that honoring reduced-motion outright caused.
    const reduced = prefersReducedMotion();

    let from: number;
    let to: number;

    if (isRadial) {
      const seg = 360 / pool.length;
      const center = resolvedIdx * seg + seg / 2;
      const spins = reduced ? 2 : 7 + Math.floor(Math.random() * 3);
      from = rotationRef.current;
      const base = from - (from % 360);
      to = base + 360 * spins - center;
    } else {
      // Measure the live viewport so the winner lands under the centre marker
      // even when the reel renders narrower than the nominal width.
      const viewport =
        node?.parentElement?.offsetWidth ?? (compactRef.current ? 360 : 520);
      const center = viewport / 2 - REEL_CELL / 2;
      const { reps } = reelLayout(pool.length, resolvedIdx, compactRef.current);
      const poolWidth = pool.length * REEL_CELL;
      const jitter = (Math.random() - 0.5) * (REEL_CELL * 0.4);

      // The winner's aligned offset within a single pool repeat — the residue we
      // must land on (mod one pool width) for it to sit under the marker.
      const aligned = -(resolvedIdx * REEL_CELL) + center - jitter;
      // Normalize the start into the first pool repeat. The strip repeats every
      // `poolWidth`, so snapping `from` by whole pools is visually a no-op — but
      // it gives every spin the same long runway. Without this, the 2nd+ spin
      // started a few px from its absolute target and crawled instead of spun.
      from = offsetRef.current % poolWidth;
      // Land several pools deep so the reel scrolls hard through the options,
      // keeping at least one trailing repeat to fill the right of the viewport.
      const landRep = reduced ? Math.min(2, reps - 2) : reps - 2;
      to = aligned - landRep * poolWidth;
    }

    const apply = (value: number) => {
      if (isRadial) {
        rotationRef.current = value;
      } else {
        offsetRef.current = value;
      }

      if (node) {
        node.style.transform = isRadial
          ? `rotate(${value}deg)`
          : `translateX(${value}px)`;
      }
    };

    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;

      clearSpinTimers(rafRef, safetyRef);
      apply(to);
      onResultRef.current?.(winner.id);
    };

    const duration = reduced ? 1500 : 6000 + Math.random() * 800;
    const start = performance.now();
    const delta = to - from;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      apply(from + delta * easeOutCubic(progress));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(tick);
    // Safety net: if rAF is throttled (backgrounded tab) the spin still resolves.
    safetyRef.current = setTimeout(finish, duration + 500);

    return () => {
      clearSpinTimers(rafRef, safetyRef);
    };
  }, [spinSignal]);

  if (enabled.length === 0) {
    return (
      <div className="gg-wheel-empty">
        <Ico className="gg-lock-ico" name="wheel" />
        <strong
          style={{
            fontFamily: "var(--gg-font-display)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          No games enabled
        </strong>
        <span>Add or enable a game to spin the gauntlet.</span>
      </div>
    );
  }

  return style === "radial" ? (
    <RadialWheel games={enabled} spinElRef={spinElRef} />
  ) : (
    <ReelWheel compact={compact} games={enabled} spinElRef={spinElRef} />
  );
}
