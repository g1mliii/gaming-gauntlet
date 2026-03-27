import React from "react";
import ReactDOM from "react-dom/client";

import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";

const OVERLAY_POLL_INTERVAL_MS = 15_000;
const searchParams = new URLSearchParams(window.location.search);
const matchSlug =
  searchParams.get("slug")?.trim() ?? searchParams.get("matchId")?.trim() ?? null;

function toFriendlyError(): string {
  return "The extension overlay feed is offline right now.";
}

function VideoOverlayApp() {
  const { isLoading, pageError, snapshot } = useExtensionSnapshot({
    snapshotKey: matchSlug,
    missingSnapshotError:
      "Add ?slug=<match slug> to the extension overlay URL to load a live match.",
    pathPrefix: "/api/public/matches",
    pollIntervalMs: OVERLAY_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  return (
    <main className="extension-root extension-root--overlay">
      {snapshot ? <ScoreBug match={snapshot} transparent /> : null}
      {snapshot ? (
        <QueueList items={snapshot.queue} title="Approved queue" transparent />
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

document.documentElement.classList.add("gg-doc--overlay");
document.body.classList.add("gg-body--overlay");

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <React.StrictMode>
    <VideoOverlayApp />
  </React.StrictMode>
);
