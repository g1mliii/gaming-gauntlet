import type { MatchSnapshot, MatchSummary } from "@gaming-gauntlet/contracts";
import {
  PageShell,
  QueueList,
  ScoreBug,
  SuggestionBoard,
} from "@gaming-gauntlet/ui";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";

import { buildEdgeUrl, EdgeError, edgeSendJson } from "../lib/edge";

const SNAPSHOT_POLL_INTERVAL_MS = 60_000;

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The edge worker is offline. Start the worker on port 8787 to load the control room.";
  }

  if (!(error instanceof EdgeError)) {
    return "The control room failed to sync. Try again.";
  }

  switch (error.code) {
    case "match_not_found":
      return "That match could not be found for the signed-in broadcaster.";
    case "live_match_exists":
      return "Another match already owns chat ingestion for this broadcaster pair.";
    default:
      return error.code.replaceAll("_", " ");
  }
}

export function ControlRoomPage() {
  const { matchId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const loadSnapshot = useEffectEvent(async (signal?: AbortSignal) => {
    const headers: HeadersInit = {};

    if (etagRef.current) {
      headers["If-None-Match"] = etagRef.current;
    }

    const response = await fetch(
      buildEdgeUrl(`/api/matches/${matchId}/snapshot`),
      {
        credentials: "include",
        headers,
        signal,
      }
    );

    if (response.status === 304) {
      return;
    }

    const text = await response.text();
    const payload = text
      ? (JSON.parse(text) as
          | MatchSnapshot
          | { error: string; details?: unknown })
      : null;

    if (!response.ok) {
      const errorPayload =
        payload && typeof payload === "object" && "error" in payload
          ? payload
          : { error: "request_failed" };
      throw new EdgeError(
        response.status,
        errorPayload.error,
        errorPayload.details
      );
    }

    etagRef.current = response.headers.get("ETag");
    startTransition(() => {
      setSnapshot(payload as MatchSnapshot);
    });
  });

  useEffect(() => {
    if (!matchId) {
      setIsLoading(false);
      setPageError("No match id was provided.");
      return;
    }

    const abortController = new AbortController();
    pollAbortRef.current = abortController;
    setIsLoading(true);
    setPageError(null);

    void (async () => {
      try {
        await loadSnapshot(abortController.signal);
        setIsLoading(false);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setPageError(toFriendlyError(error));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [matchId]);

  useEffect(() => {
    if (!matchId) {
      return;
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      pollAbortRef.current?.abort();
      const abortController = new AbortController();
      pollAbortRef.current = abortController;

      void loadSnapshot(abortController.signal).catch((error) => {
        if (!abortController.signal.aborted) {
          setPageError(toFriendlyError(error));
        }
      });
    };

    pollTimerRef.current = window.setInterval(tick, SNAPSHOT_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pollAbortRef.current?.abort();
    };
  }, [matchId]);

  async function handleStatusChange(status: MatchSummary["status"]) {
    setIsUpdating(true);
    setPageError(null);

    try {
      await edgeSendJson<{ match: MatchSummary }>(
        `/api/matches/${matchId}/status`,
        { status },
        { method: "PATCH" }
      );
      etagRef.current = null;
      await loadSnapshot();
    } catch (error) {
      setPageError(toFriendlyError(error));
    }

    setIsUpdating(false);
  }

  if (isLoading) {
    return (
      <PageShell
        eyebrow="Control room"
        title="Syncing the chat board"
        deck="Loading the canonical match snapshot and chat-ingestion state."
      >
        <div className="dashboard-skeleton">
          <div className="dashboard-skeleton__bar" />
          <div className="dashboard-skeleton__grid">
            <div className="dashboard-skeleton__panel" />
            <div className="dashboard-skeleton__panel" />
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <div className="two-column">
      <PageShell
        eyebrow="Control room"
        title={snapshot?.title ?? "Match control room"}
        deck="Phase 3 keeps board rendering client-side and polls only while the tab is visible, so large chats stay cheap on the edge."
        actions={
          snapshot ? (
            <div className="dashboard-header-actions">
              <span className="gg-chip">chat {snapshot.chatState}</span>
              <span className="gg-chip gg-chip--soft">
                subs {snapshot.subscriptionHealth}
              </span>
            </div>
          ) : undefined
        }
      >
        {pageError ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {pageError}
          </p>
        ) : null}

        {snapshot ? <ScoreBug match={snapshot} /> : null}

        <div className="control-grid control-grid--spaced">
          <button
            className="control-button control-button--utility"
            type="button"
            disabled={isUpdating}
            onClick={() => void handleStatusChange("live")}
          >
            Route chat live
          </button>
          <button
            className="control-button control-button--utility"
            type="button"
            disabled={isUpdating}
            onClick={() => void handleStatusChange("paused")}
          >
            Pause with grace
          </button>
          <button
            className="control-button control-button--utility"
            type="button"
            disabled={isUpdating}
            onClick={() => void handleStatusChange("complete")}
          >
            Complete match
          </button>
        </div>
      </PageShell>
      <div className="match-support-grid">
        <SuggestionBoard
          suggestions={snapshot?.suggestions ?? []}
          title="Compact chat board"
        />
        <QueueList
          items={snapshot?.queue ?? []}
          title="Queue lands in Phase 4"
          transparent
        />
      </div>
    </div>
  );
}
