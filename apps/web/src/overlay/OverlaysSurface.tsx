import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Ico,
  KitButton,
  KitButtonLink,
  KitNotice,
  KitPanel,
  PageShell,
} from "@gaming-gauntlet/ui";

import {
  buildOverlayShareUrl,
  isTheme,
  OVERLAY_GROUPS,
  OVERLAYS,
  THEME_OPTIONS,
} from "./catalog";
import type { OverlayDefinition, OverlayTheme } from "./catalog";
import { OverlayGraphic } from "./OverlayGraphics";
import { toOverlayMatch } from "./overlay-match";
import type { OverlayMatch } from "./overlay-match";
import { useFitScale } from "./use-fit-scale";
import { useOverlayState } from "./use-overlay-state";
import { buildMatchUrl } from "../management-passcodes";
import { themeClassName, useOverlayTheme } from "../overlay-theme";

// Phase 9 "Add to OBS" surface. A public, read-only gallery: every catalog
// overlay shows a live, themed, auto-scaled preview, its recommended OBS size,
// and a Copy URL button, with setup + troubleshooting beneath. This is a thin
// wrapper over the Phase 8 overlay module — it polls public state once here and
// shares one view model across every preview, and the copied URL never carries
// the management passcode (OBS sizes from the listed W×H, not the link).

type OverlaysSurfaceProps = {
  lobbyId: string;
};

const COPIED_RESET_MS = 1600;
// Let small overlays (corner, square, compact) grow to fill the card instead of
// sitting tiny at their natural size — the previews read much better zoomed in.
// 2.4 lets the smallest graphics (the 220px corner bug) blow up to nearly the
// full card width; useFitScale still contain-fits, so nothing ever overflows.
const MAX_PREVIEW_SCALE = 2.4;

// Per-shape preview heights so tall/large layouts get room without dwarfing the
// slim bars. Bumped up from the prototype values: the previews were too small
// relative to their cards to read comfortably.
function previewMaxHeight(overlay: OverlayDefinition): number {
  if (overlay.slug === "rail") {
    return 320;
  }

  if (overlay.slug === "square") {
    return 300;
  }

  if (overlay.group === "fullscreen") {
    return 260;
  }

  return 190;
}

// Live, themed preview of one overlay. Ported scaler from
// prototype/screens-obs.jsx, but it now measures the card's available width
// (not a fixed cap) and scales the graphic to fill it — shrinking big layouts
// and modestly enlarging small ones — so every preview fills its stage. When
// public state is not ready yet, the stage shows a status message instead.
const OverlayPreview = memo(function OverlayPreview({
  overlay,
  match,
  theme,
  message,
  bg = 1,
}: {
  overlay: OverlayDefinition;
  match: OverlayMatch | null;
  theme: OverlayTheme;
  message: string | null;
  bg?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const graphicRef = useRef<HTMLDivElement>(null);
  const maxHeight = previewMaxHeight(overlay);
  // Re-run the measurement only when the graphic mounts/unmounts, not on every
  // poll re-render — `match` is a fresh object each render, so depending on it
  // directly would churn the ResizeObserver. Once the graphic is mounted the
  // observer handles all later size changes (scores, theme, fonts, and the card
  // resizing on viewport changes). The box width is the real space the card
  // gives us, so previews fill the card and never overflow it on narrow
  // two-column layouts.
  const hasMatch = match !== null;
  const scale = useFitScale({
    getTarget: () => graphicRef.current,
    getBox: () => {
      const box = boxRef.current;

      return box ? { width: box.clientWidth, height: maxHeight } : null;
    },
    getObserved: () => [boxRef.current],
    maxScale: MAX_PREVIEW_SCALE,
    enabled: hasMatch,
    deps: [maxHeight],
  });

  if (!match) {
    return (
      <div
        className="gg-overlay-card__placeholder"
        role="status"
        style={{ width: "100%", height: maxHeight }}
      >
        {message ?? "Loading…"}
      </div>
    );
  }

  // No max-width cap: the box takes the full card stage so wide bars (top bar,
  // ticker) render as large as the card allows instead of squeezing into a
  // fixed 480px column.
  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        width: "100%",
        height: maxHeight,
        margin: "0 auto",
        overflow: "hidden",
      }}
    >
      <div
        className={`gg-ov gg-ov--${theme}`}
        ref={graphicRef}
        style={
          {
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
            "--ov-bg": bg,
          } as CSSProperties
        }
      >
        <OverlayGraphic slug={overlay.slug} m={match} options={{}} />
      </div>
    </div>
  );
});

type CopyStatus = "idle" | "copied" | "failed";

function copyLabel(status: CopyStatus): string {
  if (status === "copied") {
    return "Copied!";
  }

  if (status === "failed") {
    return "Copy failed";
  }

  return "Copy URL";
}

function copyAnnouncement(
  copyResult: { slug: string; ok: boolean } | null
): string {
  if (!copyResult) {
    return "";
  }

  const overlay = OVERLAYS.find((entry) => entry.slug === copyResult.slug);
  const name = overlay?.name ?? "Overlay";

  return copyResult.ok
    ? `${name} URL copied.`
    : `${name} URL could not be copied.`;
}

function OverlayCard({
  overlay,
  match,
  theme,
  bg,
  message,
  shareUrl,
  status,
  onCopy,
}: {
  overlay: OverlayDefinition;
  match: OverlayMatch | null;
  theme: OverlayTheme;
  bg: number;
  message: string | null;
  shareUrl: string;
  status: CopyStatus;
  onCopy: () => void;
}) {
  return (
    <div className="gg-overlay-card">
      <div className="gg-overlay-card__bar">
        <span className="gg-overlay-card__name">{overlay.name}</span>
        <span className="gg-overlay-card__dim">
          {overlay.w} × {overlay.h}
        </span>
      </div>
      <div className="gg-overlay-card__stage gg-checker">
        <OverlayPreview
          bg={bg}
          match={match}
          message={message}
          overlay={overlay}
          theme={theme}
        />
      </div>
      <div className="gg-overlay-card__foot">
        <span
          className="gg-overlay-card__desc"
          style={{ border: 0, padding: 0 }}
        >
          {overlay.desc}
        </span>
        <div className="gg-obs-item__actions">
          <KitButton
            aria-label={`Copy ${overlay.name} URL`}
            data-overlay-share-url={shareUrl}
            onClick={onCopy}
            size="sm"
            type="button"
          >
            <Ico name="copy" /> {copyLabel(status)}
          </KitButton>
        </div>
      </div>
    </div>
  );
}

export default function OverlaysSurface({ lobbyId }: OverlaysSurfaceProps) {
  const { state, notFound, error } = useOverlayState(lobbyId);
  const [theme, setTheme] = useOverlayTheme(lobbyId);
  const [bgPercent, setBgPercent] = useState(100);
  const previewBgPercent = useDeferredValue(bgPercent);
  const [copyResult, setCopyResult] = useState<{
    slug: string;
    ok: boolean;
  } | null>(null);
  const copyResetRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    []
  );

  const match = state ? toOverlayMatch(state) : null;

  // Mirror OverlayPage's state machine, but as a single status line the gallery
  // can show in every preview stage while the shell stays usable.
  let statusMessage: string | null = null;

  if (notFound) {
    statusMessage = "Match not found.";
  } else if (error && !state) {
    statusMessage = "Overlay unavailable.";
  } else if (!state) {
    statusMessage = "Loading…";
  } else if (match && match.games.length === 0) {
    statusMessage = "Waiting for games.";
  }

  const previewMatch = statusMessage ? null : match;
  const copyStatusAnnouncement = copyAnnouncement(copyResult);

  async function copyShareUrl(slug: string) {
    const url = buildOverlayShareUrl(lobbyId, slug, theme, bgPercent);
    let ok = true;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be blocked (no permission / insecure context, or the API
      // is absent). Surface a "Copy failed" state so the streamer knows to
      // retry rather than pasting nothing.
      ok = false;
    }

    setCopyResult({ slug, ok });

    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
    }

    copyResetRef.current = window.setTimeout(() => {
      setCopyResult((current) => (current?.slug === slug ? null : current));
      copyResetRef.current = null;
    }, COPIED_RESET_MS);
  }

  return (
    <div className={themeClassName(theme)}>
      <nav aria-label="Match" className="gg-obs-topbar">
        <KitButtonLink href={buildMatchUrl(lobbyId)} variant="ghost">
          <Ico name="back" /> Back to match
        </KitButtonLink>
      </nav>
      <PageShell
        actions={
          <>
            <label className="gg-theme-pick">
              <span>Theme</span>
              <select
                aria-label="Overlay theme"
                onChange={(event) => {
                  if (isTheme(event.target.value)) {
                    setTheme(event.target.value);
                  }
                }}
                value={theme}
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="gg-theme-pick gg-bg-pick">
              <span>Background {bgPercent}%</span>
              <input
                aria-label="Overlay background opacity"
                max={100}
                min={0}
                onChange={(event) => setBgPercent(Number(event.target.value))}
                step={5}
                type="range"
                value={bgPercent}
              />
            </label>
          </>
        }
        deck="Copy any overlay URL into an OBS browser source. These links are public and read-only — your management passcode never leaves this device."
        emphasis="section"
        eyebrow="On stream · OBS overlays"
        title="Add to OBS"
      >
        <span
          aria-atomic="true"
          aria-live="polite"
          className="gg-sr-only"
          role="status"
        >
          {copyStatusAnnouncement}
        </span>

        {statusMessage ? (
          <KitNotice
            aria-live="polite"
            role="status"
            tone={notFound || error ? "warning" : "default"}
          >
            {statusMessage}
          </KitNotice>
        ) : null}

        <KitPanel className="gg-obs-help" transparent>
          <p className="gg-obs-help__row">
            <span className="gg-obs-help__tag">Setup</span>
            Copy a URL below, add a <b>Browser</b> source in OBS, paste it, and
            set the source size to the card’s <b>W × H</b>.
          </p>
          <p className="gg-obs-help__row">
            <span className="gg-obs-help__tag">Troubleshooting</span>
            Blank or stale? Re-copy the link, or right-click the source →{" "}
            <b>Refresh</b>. Not transparent? Remove any color source behind it.
          </p>
        </KitPanel>

        {OVERLAY_GROUPS.map((group) => {
          const overlays = OVERLAYS.filter(
            (overlay) => overlay.group === group.id
          );

          if (overlays.length === 0) {
            return null;
          }

          return (
            <section className="gg-ov-section" key={group.id}>
              <h3 className="gg-ov-section__head">{group.label}</h3>
              <div className="gg-grid-2">
                {overlays.map((overlay) => (
                  <OverlayCard
                    bg={previewBgPercent / 100}
                    key={overlay.slug}
                    match={previewMatch}
                    message={statusMessage}
                    onCopy={() => copyShareUrl(overlay.slug)}
                    overlay={overlay}
                    shareUrl={buildOverlayShareUrl(
                      lobbyId,
                      overlay.slug,
                      theme,
                      bgPercent
                    )}
                    status={
                      copyResult?.slug === overlay.slug
                        ? copyResult.ok
                          ? "copied"
                          : "failed"
                        : "idle"
                    }
                    theme={theme}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </PageShell>
    </div>
  );
}
