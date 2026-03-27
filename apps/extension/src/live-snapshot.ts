import type { MatchSnapshot } from "@gaming-gauntlet/contracts";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

const EDGE_BASE_URL =
  import.meta.env.VITE_EDGE_BASE_URL ?? "http://localhost:8787";
const MIN_VISIBILITY_REFRESH_GAP_MS = 5_000;

function buildEdgeUrl(path: string): string {
  return new URL(path, EDGE_BASE_URL).toString();
}

type ExtensionError = {
  details?: unknown;
  error?: string;
};

type UseExtensionSnapshotOptions = {
  snapshotKey: string | null;
  missingSnapshotError: string;
  pathPrefix: string;
  pollIntervalMs: number | null;
  stopPollingOnComplete?: boolean;
  toFriendlyError: (error: unknown) => string;
};

function buildSnapshotEtag(snapshot: {
  boardRevision: number;
  matchId: string;
  updatedAt: string;
}): string {
  return `W/"${snapshot.matchId}:${snapshot.updatedAt}:${snapshot.boardRevision}"`;
}

export function useExtensionSnapshot({
  snapshotKey,
  missingSnapshotError,
  pathPrefix,
  pollIntervalMs,
  stopPollingOnComplete = false,
  toFriendlyError,
}: UseExtensionSnapshotOptions) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const getFriendlyError = useEffectEvent((error: unknown) =>
    toFriendlyError(error)
  );

  const loadSnapshot = useEffectEvent(async (signal?: AbortSignal) => {
    if (!snapshotKey) {
      return;
    }

    fetchInFlightRef.current = true;
    const headers: HeadersInit = {};

    if (etagRef.current) {
      headers["If-None-Match"] = etagRef.current;
    }

    try {
      const response = await fetch(
        buildEdgeUrl(`${pathPrefix}/${snapshotKey}/snapshot`),
        {
          headers,
          signal,
        }
      );

      if (response.status === 304) {
        lastLoadedAtRef.current = Date.now();
        return;
      }

      const text = await response.text();
      const payload = text
        ? (JSON.parse(text) as MatchSnapshot | ExtensionError)
        : null;

      if (!response.ok) {
        const errorPayload =
          payload && typeof payload === "object" && "error" in payload
            ? payload
            : { error: "request_failed" };
        throw new Error(String(errorPayload.error ?? "request_failed"));
      }

      const nextSnapshot = payload as MatchSnapshot;
      etagRef.current =
        response.headers.get("ETag") ?? buildSnapshotEtag(nextSnapshot);
      lastLoadedAtRef.current = Date.now();
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
      setPageError(null);
    } finally {
      fetchInFlightRef.current = false;
    }
  });

  useEffect(() => {
    pollAbortRef.current?.abort();
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    etagRef.current = null;
    fetchInFlightRef.current = false;
    lastLoadedAtRef.current = 0;

    if (!snapshotKey) {
      setSnapshot(null);
      setPageError(missingSnapshotError);
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();
    pollAbortRef.current = abortController;
    setPageError(null);
    setIsLoading(true);

    void loadSnapshot(abortController.signal)
      .catch((error) => {
        if (!abortController.signal.aborted) {
          setPageError(getFriendlyError(error));
          setSnapshot(null);
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [loadSnapshot, missingSnapshotError, snapshotKey]);

  useEffect(() => {
    if (
      !snapshotKey ||
      !pollIntervalMs ||
      pollIntervalMs <= 0 ||
      (stopPollingOnComplete && snapshot?.status === "complete")
    ) {
      return;
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (fetchInFlightRef.current) {
        return;
      }

      if (
        Date.now() - lastLoadedAtRef.current <
        MIN_VISIBILITY_REFRESH_GAP_MS
      ) {
        return;
      }

      pollAbortRef.current?.abort();
      const abortController = new AbortController();
      pollAbortRef.current = abortController;

      void loadSnapshot(abortController.signal).catch((error) => {
        if (!abortController.signal.aborted) {
          setPageError(getFriendlyError(error));
        }
      });
    };

    pollTimerRef.current = window.setInterval(tick, pollIntervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pollAbortRef.current?.abort();
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [
    loadSnapshot,
    snapshotKey,
    pollIntervalMs,
    snapshot?.status,
    stopPollingOnComplete,
  ]);

  return {
    isLoading,
    pageError,
    snapshot,
  };
}
