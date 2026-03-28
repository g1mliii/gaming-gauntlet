import React from "react";
import ReactDOM from "react-dom/client";

import type { PublicMatchOverlaySurface } from "@gaming-gauntlet/contracts";
import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";

const OVERLAY_POLL_INTERVAL_MS = 15_000;

function toFriendlyError(): string {
  return "The extension overlay feed is offline right now.";
}

export function resolveRequestedMatchKey(search = window.location.search): string | null {
  const searchParams = new URLSearchParams(search);
  return (
    searchParams.get("slug")?.trim() ??
    searchParams.get("matchId")?.trim() ??
    null
  );
}

export function VideoOverlayApp({
  matchSlug = resolveRequestedMatchKey(),
}: {
  matchSlug?: string | null;
}) {
  const { isLoading, pageError, snapshot } =
    useExtensionSnapshot<PublicMatchOverlaySurface>({
    missingPathError:
      "Add ?slug=<match slug> to the extension overlay URL to load a live match.",
    path: matchSlug
      ? `/api/public/matches/${matchSlug}/surface?view=overlay`
      : null,
    pollIntervalMs: OVERLAY_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  return (
    <main className="extension-root extension-root--overlay">
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
          {pageError ??
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
