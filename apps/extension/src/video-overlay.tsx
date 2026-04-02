import React from "react";
import ReactDOM from "react-dom/client";

import type { PublicMatchOverlaySurface } from "@gaming-gauntlet/contracts";
import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";
import { useTwitchExtensionState } from "./twitch";

const BASE_OVERLAY_POLL_INTERVAL_MS = 30_000;
const HIGHLIGHTED_OVERLAY_POLL_INTERVAL_MS = 15_000;

function toFriendlyError(): string {
  return "The extension overlay feed is offline right now.";
}

export function VideoOverlayApp() {
  const runtime = useTwitchExtensionState();
  const matchSlug =
    runtime.broadcasterConfig?.matchSlug ?? runtime.query.slugFallback;
  const pollIntervalMs =
    runtime.isVisible && !runtime.context?.isPaused
      ? runtime.isHighlighted
        ? HIGHLIGHTED_OVERLAY_POLL_INTERVAL_MS
        : BASE_OVERLAY_POLL_INTERVAL_MS
      : null;
  const { isLoading, pageError, snapshot } =
    useExtensionSnapshot<PublicMatchOverlaySurface>({
      missingPathError:
        "Save a broadcaster config or add ?slug=<match slug> to preview the overlay.",
      path: matchSlug
        ? `/api/public/matches/${matchSlug}/surface?view=overlay`
        : null,
      pollIntervalMs,
      stopPollingOnComplete: true,
      toFriendlyError,
    });

  if (!runtime.isVisible) {
    return null;
  }

  return (
    <main
      className={`extension-root extension-root--overlay${
        runtime.isHighlighted ? " extension-root--highlighted" : ""
      }`}
    >
      {snapshot ? <ScoreBug match={snapshot} transparent /> : null}
      {snapshot ? (
        <QueueList
          items={snapshot.upcomingQueue}
          title="Approved queue"
          transparent
          emptyLabel="No games are queued after this round."
        />
      ) : null}
      {!snapshot ? (
        <p className="dashboard-message dashboard-message--warning">
          {runtime.pageError ??
            pageError ??
            (isLoading ? "Loading live overlay…" : "Overlay unavailable.")}
        </p>
      ) : null}
    </main>
  );
}

export function bootstrapVideoOverlay(): void {
  const root = document.getElementById("overlay-root");

  if (!root) {
    return;
  }

  document.documentElement.classList.add("gg-doc--overlay");
  document.body.classList.add("gg-body--overlay");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <VideoOverlayApp />
    </React.StrictMode>
  );
}

bootstrapVideoOverlay();
