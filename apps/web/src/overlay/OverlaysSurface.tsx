import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

// Match the prototype's per-shape preview heights so tall/large layouts get
// room without dwarfing the slim bars.
function previewMaxHeight(overlay: OverlayDefinition): number {
  if (overlay.slug === "rail") {
    return 250;
  }

  if (overlay.slug === "square") {
    return 230;
  }

  if (overlay.group === "fullscreen") {
    return 200;
  }

  return 150;
}

// Live, themed preview of one overlay. Ported scaler from
// prototype/screens-obs.jsx: measure the untransformed natural size and shrink
// uniformly to fit the card (never blow it up past 1). When public state is not
// ready yet, the stage shows a status message instead of the graphic.
function OverlayPreview({
  overlay,
  match,
  theme,
  message,
  maxWidth = 360,
}: {
  overlay: OverlayDefinition;
  match: OverlayMatch | null;
  theme: OverlayTheme;
  message: string | null;
  maxWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const maxHeight = previewMaxHeight(overlay);
  // Re-run the measurement only when the graphic mounts/unmounts, not on every
  // poll re-render — `match` is a fresh object each render, so depending on it
  // directly would churn the ResizeObserver. Once the graphic is mounted the
  // observer below handles all later size changes (scores, theme, fonts).
  const hasMatch = match !== null;

  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    // offsetWidth/offsetHeight report the UNTRANSFORMED layout size, so
    // measuring is independent of the scale we apply — no feedback loop.
    const fit = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;

      if (w && h) {
        setScale(Math.min(maxWidth / w, maxHeight / h, 1));
      }
    };

    fit();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(fit);
    observer.observe(el);

    return () => observer.disconnect();
  }, [maxWidth, maxHeight, hasMatch]);

  if (!match) {
    return (
      <div
        className="gg-overlay-card__placeholder"
        role="status"
        style={{ width: maxWidth, height: maxHeight }}
      >
        {message ?? "Loading…"}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: maxWidth,
        height: maxHeight,
        overflow: "hidden",
      }}
    >
      <div
        className={`gg-ov gg-ov--${theme}`}
        ref={ref}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        <OverlayGraphic slug={overlay.slug} m={match} options={{}} />
      </div>
    </div>
  );
}

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
  message,
  shareUrl,
  status,
  onCopy,
}: {
  overlay: OverlayDefinition;
  match: OverlayMatch | null;
  theme: OverlayTheme;
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
    const url = buildOverlayShareUrl(lobbyId, slug, theme);
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
                    key={overlay.slug}
                    match={previewMatch}
                    message={statusMessage}
                    onCopy={() => copyShareUrl(overlay.slug)}
                    overlay={overlay}
                    shareUrl={buildOverlayShareUrl(
                      lobbyId,
                      overlay.slug,
                      theme
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
