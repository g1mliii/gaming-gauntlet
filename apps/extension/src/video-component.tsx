import React from "react";
import ReactDOM from "react-dom/client";

import type { PublicMatchComponentSurface } from "@gaming-gauntlet/contracts";
import { ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";
import { useTwitchExtensionState } from "./twitch";

const BASE_COMPONENT_POLL_INTERVAL_MS = 30_000;
const HIGHLIGHTED_COMPONENT_POLL_INTERVAL_MS = 15_000;

function toFriendlyError(): string {
  return "The component overlay feed is offline right now.";
}

export function VideoComponentApp() {
  const runtime = useTwitchExtensionState();
  const matchSlug =
    runtime.broadcasterConfig?.matchSlug ?? runtime.query.slugFallback;
  const pollIntervalMs =
    runtime.isVisible && !runtime.context?.isPaused
      ? runtime.isHighlighted
        ? HIGHLIGHTED_COMPONENT_POLL_INTERVAL_MS
        : BASE_COMPONENT_POLL_INTERVAL_MS
      : null;
  const { isLoading, pageError, snapshot } =
    useExtensionSnapshot<PublicMatchComponentSurface>({
      missingPathError:
        "Save a broadcaster config or add ?slug=<match slug> to preview the component.",
      path: matchSlug
        ? `/api/public/matches/${matchSlug}/surface?view=component`
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
      className={`extension-root extension-root--component${
        runtime.isHighlighted ? " extension-root--highlighted" : ""
      }`}
    >
      {snapshot ? <ScoreBug match={snapshot} transparent /> : null}
      {snapshot ? (
        <section className="extension-component-card">
          <p className="extension-component-card__label">Current game</p>
          <strong className="extension-component-card__value">
            {snapshot.currentGame?.title ?? "Waiting for round start"}
          </strong>
          <div className="extension-status-chips">
            <span className="gg-chip gg-chip--soft">{snapshot.status}</span>
            <span className="gg-chip gg-chip--soft">
              queue {snapshot.upcomingQueueCount}
            </span>
          </div>
        </section>
      ) : (
        <p className="dashboard-message dashboard-message--warning">
          {runtime.pageError ??
            pageError ??
            (isLoading ? "Loading component…" : "Component unavailable.")}
        </p>
      )}
    </main>
  );
}

export function bootstrapVideoComponent(): void {
  const root = document.getElementById("component-root");

  if (!root) {
    return;
  }

  document.documentElement.classList.add("gg-doc--overlay");
  document.body.classList.add("gg-body--overlay");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <VideoComponentApp />
    </React.StrictMode>
  );
}

bootstrapVideoComponent();
