import { useRef } from "react";
import type { CSSProperties } from "react";

import { getOverlayDefinition, isTheme } from "./catalog";
import type { OverlayTheme } from "./catalog";
import { OverlayGraphic } from "./OverlayGraphics";
import type { OverlayGraphicOptions } from "./OverlayGraphics";
import { toOverlayMatch } from "./overlay-match";
import { useFitScale } from "./use-fit-scale";
import { useOverlayState } from "./use-overlay-state";

// Public, read-only browser-source page. It polls public lobby state, applies
// only sanitized query params, and renders the requested ov-* graphic inside a
// themed, scalable, transparent root. It never reads or renders any management
// affordance — forbidden URL params are already scrubbed by App.tsx.

const SCALE_MIN = 0.3;
const SCALE_MAX = 3;
const BRAND_MAX_LENGTH = 24;
// Allowlist: letters, numbers, spaces, and a small set of safe punctuation.
// Anything else (control chars, angle brackets, emoji-soup) is dropped so a
// crafted ?brand= can't inject markup or wreck the layout.
const SAFE_BRAND_CHARS = /[^\p{L}\p{N} .,'!&|/-]/gu;

type OverlayPageProps = {
  lobbyId: string;
  variant: string;
  search?: string;
};

type OverlayOptions = OverlayGraphicOptions & {
  theme: OverlayTheme;
  scale: number;
  bg: number;
  transparent: boolean;
  animation: boolean;
};

type OverlayRootStyle = CSSProperties & {
  "--ov-scale"?: number;
  "--ov-bg"?: number;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function sanitizeBrand(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = value
    .replace(SAFE_BRAND_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BRAND_MAX_LENGTH);

  return cleaned || undefined;
}

function parseOverlayOptions(search: string): OverlayOptions {
  const params = new URLSearchParams(search);

  const themeParam = params.get("theme") ?? "";
  const theme: OverlayTheme = isTheme(themeParam) ? themeParam : "default";

  // An absent or blank ?scale= must fall back to 1, not 0. Number(null) and
  // Number("") both coerce to 0, which is finite and would clamp up to
  // SCALE_MIN — silently shrinking every overlay. Only treat a real numeric
  // value as a scale override.
  const rawScale = params.get("scale");
  const scaleParam =
    rawScale === null || rawScale.trim() === "" ? NaN : Number(rawScale);
  const scale = Number.isFinite(scaleParam)
    ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, scaleParam))
    : 1;

  const animation =
    parseBool(params.get("animation"), true) && !prefersReducedMotion();

  // Panel background opacity, 0–100 in the URL → a 0–1 multiplier. Absent/blank
  // means fully solid (1), matching the designed look.
  const rawBg = params.get("bg");
  const bgParam = rawBg === null || rawBg.trim() === "" ? 100 : Number(rawBg);
  const bg = Number.isFinite(bgParam)
    ? Math.min(1, Math.max(0, bgParam / 100))
    : 1;

  return {
    theme,
    scale,
    bg,
    transparent: parseBool(params.get("transparent"), true),
    animation,
    showNext: parseBool(params.get("showNext"), false),
    brand: sanitizeBrand(params.get("brand")),
  };
}

function OverlayMessage({ children }: { children: string }) {
  return (
    <div className="gg-ov__message" role="status">
      {children}
    </div>
  );
}

export default function OverlayPage({
  lobbyId,
  variant,
  search = "",
}: OverlayPageProps) {
  const options = parseOverlayOptions(search);
  const definition = getOverlayDefinition(variant);
  const { state, notFound, error } = useOverlayState(
    lobbyId,
    Boolean(definition)
  );

  const match = state ? toOverlayMatch(state) : null;
  const showsGraphic = Boolean(
    definition && !notFound && !(error && !state) && match && match.games.length
  );

  // Auto-fit: scale the graphic to fill the OBS browser-source viewport. The
  // graphics are authored at fixed natural sizes, so without this they sit small
  // in the top-left of whatever W×H the streamer set. Only the live graphic is
  // fitted — status messages stay at natural size so "Loading…" doesn't balloon
  // to fill the screen. A manual ?scale= still multiplies on top for streamers
  // who want to nudge it.
  const stageRef = useRef<HTMLDivElement>(null);
  const fitScale = useFitScale({
    getTarget: () =>
      (stageRef.current?.firstElementChild as HTMLElement | null) ?? null,
    getBox: () => ({ width: window.innerWidth, height: window.innerHeight }),
    watchWindow: true,
    enabled: showsGraphic,
    deps: [variant, options.theme],
  });

  const rootStyle: OverlayRootStyle = {
    "--ov-scale": options.scale * fitScale,
    "--ov-bg": options.bg,
  };
  const rootClassName = `gg-ov gg-ov--${options.theme}`;

  function renderBody() {
    if (!definition) {
      return <OverlayMessage>Unknown overlay.</OverlayMessage>;
    }

    if (notFound) {
      return <OverlayMessage>Match not found.</OverlayMessage>;
    }

    if (error && !state) {
      return <OverlayMessage>Overlay unavailable.</OverlayMessage>;
    }

    if (!state || !match) {
      return <OverlayMessage>Loading…</OverlayMessage>;
    }

    if (match.games.length === 0) {
      return <OverlayMessage>Waiting for games.</OverlayMessage>;
    }

    return <OverlayGraphic m={match} options={options} slug={variant} />;
  }

  return (
    <div
      className={rootClassName}
      data-animation={options.animation ? "on" : "off"}
      data-testid="overlay-v1"
      data-transparent={options.transparent ? "on" : "off"}
      data-variant={variant}
      style={rootStyle}
    >
      <div
        className="gg-ov__stage"
        data-overlay-size={
          definition ? `${definition.w}x${definition.h}` : undefined
        }
        ref={stageRef}
      >
        {renderBody()}
      </div>
    </div>
  );
}
