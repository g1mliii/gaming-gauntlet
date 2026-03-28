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
const MAX_ERROR_BACKOFF_MS = 60_000;

type LiveSurfaceSnapshot = {
  status: string;
};

function buildEdgeUrl(path: string): string {
  return new URL(path, EDGE_BASE_URL).toString();
}

type ExtensionError = {
  details?: unknown;
  error?: string;
};

type UseExtensionSnapshotOptions = {
  missingPathError: string;
  path: string | null;
  pollIntervalMs: number | null;
  stopPollingOnComplete?: boolean;
  toFriendlyError: (error: unknown) => string;
};

export function useExtensionSnapshot<T extends LiveSurfaceSnapshot>({
  missingPathError,
  path,
  pollIntervalMs,
  stopPollingOnComplete = false,
  toFriendlyError,
}: UseExtensionSnapshotOptions) {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const nextRetryAtRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const getFriendlyError = useEffectEvent((error: unknown) =>
    toFriendlyError(error)
  );

  const loadSnapshot = useEffectEvent(async (signal?: AbortSignal) => {
    if (!path) {
      return;
    }

    fetchInFlightRef.current = true;
    const headers: HeadersInit = {};

    if (etagRef.current) {
      headers["If-None-Match"] = etagRef.current;
    }

    try {
      const response = await fetch(buildEdgeUrl(path), {
        headers,
        signal,
      });

      if (response.status === 304) {
        retryAttemptRef.current = 0;
        nextRetryAtRef.current = 0;
        lastLoadedAtRef.current = Date.now();
        return;
      }

      const text = await response.text();
      const payload = text
        ? (JSON.parse(text) as T | ExtensionError)
        : null;

      if (!response.ok) {
        const errorPayload =
          payload && typeof payload === "object" && "error" in payload
            ? payload
            : { error: "request_failed" };
        throw new Error(String(errorPayload.error ?? "request_failed"));
      }

      const nextSnapshot = payload as T;
      etagRef.current = response.headers.get("ETag");
      retryAttemptRef.current = 0;
      nextRetryAtRef.current = 0;
      lastLoadedAtRef.current = Date.now();
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
      setPageError(null);
    } catch (error) {
      if (!signal?.aborted) {
        const baseDelay = Math.max(
          pollIntervalMs ?? MIN_VISIBILITY_REFRESH_GAP_MS,
          MIN_VISIBILITY_REFRESH_GAP_MS
        );
        const delay = Math.min(
          baseDelay * 2 ** retryAttemptRef.current,
          MAX_ERROR_BACKOFF_MS
        );

        retryAttemptRef.current += 1;
        nextRetryAtRef.current = Date.now() + delay;
        lastLoadedAtRef.current = Date.now();
      }

      throw error;
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
    nextRetryAtRef.current = 0;
    retryAttemptRef.current = 0;

    if (!path) {
      setSnapshot(null);
      setPageError(missingPathError);
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
  }, [loadSnapshot, missingPathError, path]);

  useEffect(() => {
    if (
      !path ||
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

      if (Date.now() < nextRetryAtRef.current) {
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
    path,
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
