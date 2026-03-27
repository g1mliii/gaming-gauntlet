import React from "react";
import ReactDOM from "react-dom/client";

import { PageShell, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";

const CONFIG_POLL_INTERVAL_MS = 30_000;
const searchParams = new URLSearchParams(window.location.search);
const matchSlug =
  searchParams.get("slug")?.trim() ?? searchParams.get("matchId")?.trim() ?? null;

function toFriendlyError(): string {
  return "The extension config preview could not load the live match.";
}

function ConfigApp() {
  const { isLoading, pageError, snapshot } = useExtensionSnapshot({
    snapshotKey: matchSlug,
    missingSnapshotError:
      "Add ?slug=<match slug> to preview the broadcaster config against a live match.",
    pathPrefix: "/api/public/matches",
    pollIntervalMs: CONFIG_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  return (
    <main className="extension-config">
      <PageShell
        eyebrow="Broadcaster config"
        title="Wire the overlay"
        deck="This page previews the broadcaster-facing extension surface against the same cheap HTTP snapshot path used by the public overlay."
        actions={<span className="gg-chip">Config view</span>}
      >
        <div className="extension-config__grid">
          <div className="extension-list">
            <article>
              <strong>1. Link the live match</strong>
              <p>
                Match slug: {snapshot?.slug ?? matchSlug ?? "Add ?slug=..."}
              </p>
            </article>
            <article>
              <strong>2. Share the OBS URL</strong>
              <p>
                {snapshot
                  ? `/overlay/${snapshot.slug}`
                  : "Overlay URL appears once a match is selected."}
              </p>
            </article>
            <article>
              <strong>3. Validate extension feed</strong>
              <p>
                This preview pulls the same cacheable match snapshot the
                extension overlay should use in production.
              </p>
            </article>
          </div>
          {snapshot ? <ScoreBug match={snapshot} /> : null}
        </div>
        {!snapshot ? (
          <p className="dashboard-message dashboard-message--warning">
            {pageError ??
              (isLoading
                ? "Loading live config preview…"
                : "Config preview unavailable.")}
          </p>
        ) : null}
        {snapshot ? (
          <div className="extension-config__board">
            <SuggestionBoard
              suggestions={snapshot.suggestions}
              title="Current ranked board"
            />
          </div>
        ) : null}
      </PageShell>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("config-root")!).render(
  <React.StrictMode>
    <ConfigApp />
  </React.StrictMode>
);
