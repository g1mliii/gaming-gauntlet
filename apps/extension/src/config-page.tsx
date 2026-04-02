import type {
  ExtensionBroadcasterConfig,
  ExtensionMatchSummary,
  PublicMatchPageSurface,
} from "@gaming-gauntlet/contracts";
import { PageShell, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import { useEffect, useState } from "react";

import { ExtensionEdgeError, extensionFetchJson } from "./edge";
import { useExtensionSnapshot } from "./live-snapshot";
import { useTwitchExtensionState } from "./twitch";

type ExtensionConfigPageProps = {
  surface: "config" | "live_config";
};

type ExtensionMatchesPayload = {
  items: ExtensionMatchSummary[];
};

type ExtensionMatchPayload = {
  item: ExtensionMatchSummary;
};

const CONFIG_PREVIEW_POLL_INTERVAL_MS = 60_000;

function toFriendlyPreviewError(): string {
  return "The extension config preview could not load the live match.";
}

function toFriendlyConfigError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The extension backend is offline. Start the Worker on port 8787.";
  }

  if (!(error instanceof ExtensionEdgeError)) {
    return "The extension config failed to load.";
  }

  switch (error.code) {
    case "extension_auth_required":
      return "Twitch helper auth is missing for this config page.";
    case "extension_role_not_allowed":
      return "Only the broadcaster can manage this extension config.";
    case "match_not_found":
      return "That configured match no longer exists for this channel.";
    case "extension_secret_not_configured":
      return "Set TWITCH_EXTENSION_SECRET on the Worker before using Twitch config pages.";
    default:
      return error.code.replaceAll("_", " ");
  }
}

function getPageCopy(surface: ExtensionConfigPageProps["surface"]) {
  if (surface === "live_config") {
    return {
      deck: "Live dashboard controls for the active video extension. Switch the match slug without leaving Twitch Creator Dashboard.",
      eyebrow: "Live config",
      title: "Tune the live extension",
    };
  }

  return {
    deck: "Install-time setup for the video extension. Pick which match the component and fullscreen surfaces should render.",
    eyebrow: "Broadcaster config",
    title: "Wire the extension",
  };
}

function formatMatchLabel(match: ExtensionMatchSummary): string {
  return `${match.title} (${match.status})`;
}

function getDefaultDraftSlug(
  matches: ExtensionMatchSummary[],
  config: ExtensionBroadcasterConfig | null,
  currentDraftSlug: string,
  fallbackSlug: string | null
): string {
  if (config?.matchSlug) {
    return config.matchSlug;
  }

  if (currentDraftSlug) {
    return currentDraftSlug;
  }

  if (fallbackSlug) {
    return fallbackSlug;
  }

  return matches[0]?.slug ?? "";
}

export function ExtensionConfigPage({
  surface,
}: ExtensionConfigPageProps) {
  const copy = getPageCopy(surface);
  const runtime = useTwitchExtensionState();
  const [matches, setMatches] = useState<ExtensionMatchSummary[]>([]);
  const [resolvedMatch, setResolvedMatch] = useState<ExtensionMatchSummary | null>(
    null
  );
  const [draftSlug, setDraftSlug] = useState("");
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftSlug((current) =>
      getDefaultDraftSlug(
        matches,
        runtime.broadcasterConfig,
        current,
        runtime.query.slugFallback
      )
    );
  }, [matches, runtime.broadcasterConfig, runtime.query.slugFallback]);

  useEffect(() => {
    const authToken = runtime.auth?.token;

    if (!authToken) {
      if (runtime.usingTwitchHelper) {
        return;
      }

      setMatches([]);
      setIsLoadingMatches(false);
      setPageError(
        "Open this page inside Twitch to browse matches. For local preview outside Twitch, add ?slug=<match slug>."
      );
      return;
    }

    const abortController = new AbortController();
    setIsLoadingMatches(true);
    setPageError(null);

    void extensionFetchJson<ExtensionMatchesPayload>("/api/extension/matches", {
      headers: {
        "x-extension-jwt": authToken,
      },
      signal: abortController.signal,
    })
      .then((payload) => {
        if (abortController.signal.aborted) {
          return;
        }

        setMatches(payload.items);
        setPageError(null);
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }

        setMatches([]);
        setPageError(toFriendlyConfigError(error));
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoadingMatches(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [runtime.auth?.token, runtime.usingTwitchHelper]);

  useEffect(() => {
    const authToken = runtime.auth?.token;

    if (!authToken || !draftSlug) {
      setResolvedMatch(null);
      return;
    }

    const knownMatch =
      matches.find((match) => match.slug === draftSlug) ?? null;

    if (knownMatch) {
      setResolvedMatch(knownMatch);
      return;
    }

    const abortController = new AbortController();

    void extensionFetchJson<ExtensionMatchPayload>(
      `/api/extension/matches/${encodeURIComponent(draftSlug)}`,
      {
        headers: {
          "x-extension-jwt": authToken,
        },
        signal: abortController.signal,
      }
    )
      .then((payload) => {
        if (abortController.signal.aborted) {
          return;
        }

        setResolvedMatch(payload.item);
        setPageError(null);
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }

        setResolvedMatch(null);
        setPageError(toFriendlyConfigError(error));
      });

    return () => {
      abortController.abort();
    };
  }, [draftSlug, matches, runtime.auth?.token]);

  const previewSlug = draftSlug || runtime.query.slugFallback;
  const preview = useExtensionSnapshot<PublicMatchPageSurface>({
    missingPathError: "Pick a match slug to preview the extension.",
    path: previewSlug
      ? `/api/public/matches/${previewSlug}/surface?view=page`
      : null,
    pollIntervalMs: runtime.isVisible ? CONFIG_PREVIEW_POLL_INTERVAL_MS : null,
    stopPollingOnComplete: true,
    toFriendlyError: toFriendlyPreviewError,
  });

  const selectedMatch =
    matches.find((match) => match.slug === draftSlug) ?? resolvedMatch;

  async function handleSaveConfig() {
    setNotice(null);
    setIsSaving(true);

    try {
      runtime.saveBroadcasterConfig({
        version: 1,
        matchSlug: draftSlug || null,
      });
      setNotice(
        surface === "live_config"
          ? "Live config updated."
          : "Broadcaster config saved."
      );
      setPageError(null);
    } catch (error) {
      setPageError(toFriendlyConfigError(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="extension-config">
      <PageShell
        eyebrow={copy.eyebrow}
        title={copy.title}
        deck={copy.deck}
        actions={
          <div className="extension-status-chips">
            <span className="gg-chip">
              {runtime.query.mode ?? (surface === "live_config" ? "dashboard" : "config")}
            </span>
            <span className="gg-chip gg-chip--soft">
              {runtime.query.anchor ?? "setup"}
            </span>
          </div>
        }
      >
        <div className="extension-config__grid">
          <section className="extension-list extension-list--stacked">
            <article>
              <strong>Active match slug</strong>
              <p>
                {runtime.broadcasterConfig?.matchSlug ??
                  runtime.query.slugFallback ??
                  "No broadcaster config saved yet."}
              </p>
            </article>
            <article>
              <strong>Runtime</strong>
              <p>
                {runtime.usingTwitchHelper
                  ? "Twitch helper detected."
                  : "Local preview mode outside Twitch helper."}
              </p>
            </article>
            <label className="extension-field">
              <span>Select match</span>
              <select
                value={draftSlug}
                onChange={(event) => {
                  setDraftSlug(event.currentTarget.value);
                  setNotice(null);
                  setPageError(null);
                }}
                disabled={isLoadingMatches || matches.length === 0}
              >
                {matches.length === 0 ? (
                  <option value="">
                    {isLoadingMatches ? "Loading matches…" : "No matches found"}
                  </option>
                ) : null}
                {matches.map((match) => (
                  <option key={match.id} value={match.slug}>
                    {formatMatchLabel(match)}
                  </option>
                ))}
              </select>
            </label>
            <div className="extension-actions">
              <button
                className="dashboard-button dashboard-button--primary"
                type="button"
                disabled={isSaving || !runtime.usingTwitchHelper}
                onClick={() => void handleSaveConfig()}
              >
                {isSaving ? "Saving…" : "Save broadcaster config"}
              </button>
            </div>
          </section>
          <section className="extension-config__summary">
            {selectedMatch ? (
              <article className="extension-summary-card">
                <p className="extension-summary-card__eyebrow">Selected match</p>
                <h2>{selectedMatch.title}</h2>
                <p>
                  {selectedMatch.players
                    .map((player) => player.displayName)
                    .join(" vs ")}
                </p>
                <div className="extension-status-chips">
                  <span className="gg-chip gg-chip--soft">
                    {selectedMatch.status}
                  </span>
                  <span className="gg-chip gg-chip--soft">
                    board {selectedMatch.boardRevision}
                  </span>
                  <span className="gg-chip gg-chip--soft">
                    subs {selectedMatch.subscriptionHealth}
                  </span>
                </div>
              </article>
            ) : (
              <article className="extension-summary-card extension-summary-card--empty">
                <p className="extension-summary-card__eyebrow">Selected match</p>
                <h2>No match selected</h2>
                <p>Save a broadcaster config to drive the viewer surfaces.</p>
              </article>
            )}
            {preview.snapshot ? <ScoreBug match={preview.snapshot} /> : null}
          </section>
        </div>
        {pageError || runtime.pageError || notice ? (
          <p className="dashboard-message dashboard-message--warning">
            {pageError ?? runtime.pageError ?? notice}
          </p>
        ) : null}
        {preview.snapshot ? (
          <div className="extension-config__board">
            <SuggestionBoard
              suggestions={preview.snapshot.topBoard}
              title="Current ranked board"
              trackedCount={preview.snapshot.topBoard.length}
              emptyLabel="No chat picks are active right now."
            />
          </div>
        ) : null}
      </PageShell>
    </main>
  );
}
