import React from "react";
import ReactDOM from "react-dom/client";

import type { PublicMatchPageSurface } from "@gaming-gauntlet/contracts";
import { PageShell, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { useExtensionSnapshot } from "./live-snapshot";
import { resolveRequestedMatchKey } from "./video-overlay";

const CONFIG_POLL_INTERVAL_MS = 60_000;

function toFriendlyError(): string {
  return "The extension config preview could not load the live match.";
}

export function ConfigApp({
  matchSlug = resolveRequestedMatchKey(),
}: {
  matchSlug?: string | null;
}) {
  const { isLoading, pageError, snapshot } =
    useExtensionSnapshot<PublicMatchPageSurface>({
    missingPathError:
      "Add ?slug=<match slug> to preview the broadcaster config against a live match.",
    path: matchSlug
      ? `/api/public/matches/${matchSlug}/surface?view=page`
      : null,
    pollIntervalMs: CONFIG_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  return (
    <main className="extension-config">
      <PageShell
        eyebrow="Broadcaster config"
        title="Wire the overlay"
        deck="This page previews the broadcaster-facing extension surface against the same cheap HTTP viewer surface used by the public page."
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
                This preview pulls the same cacheable match surface the
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
              suggestions={snapshot.topBoard}
              title="Current ranked board"
              trackedCount={snapshot.topBoard.length}
              emptyLabel="No chat picks are active right now."
            />
          </div>
        ) : null}
      </PageShell>
    </main>
  );
}

export function bootstrapConfig(): void {
  const root = document.getElementById("config-root");

  if (!root) {
    return;
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ConfigApp />
    </React.StrictMode>
  );
}

bootstrapConfig();
