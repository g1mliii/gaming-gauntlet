import type { MatchSnapshot } from "@gaming-gauntlet/contracts";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { buildEdgeUrl, EdgeError } from "./edge";

const MIN_VISIBILITY_REFRESH_GAP_MS = 5_000;

type UseLiveSnapshotOptions = {
  credentials?: RequestCredentials;
  missingPathError: string;
  path: string | null;
  pollIntervalMs: number;
  toFriendlyError: (error: unknown) => string;
};

export function useLiveSnapshot({
  credentials = "omit",
  missingPathError,
  path,
  pollIntervalMs,
  toFriendlyError,
}: UseLiveSnapshotOptions) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);

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
        credentials,
        headers,
        signal,
      });

      if (response.status === 304) {
        lastLoadedAtRef.current = Date.now();
        return;
      }

      const text = await response.text();
      const payload = text
        ? ((JSON.parse(text) as MatchSnapshot | { error: string; details?: unknown }))
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
      lastLoadedAtRef.current = Date.now();
      startTransition(() => {
        setSnapshot(payload as MatchSnapshot);
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
          setPageError(toFriendlyError(error));
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
  }, [loadSnapshot, missingPathError, path, toFriendlyError]);

  useEffect(() => {
    if (!path) {
      return;
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (fetchInFlightRef.current) {
        return;
      }

      if (Date.now() - lastLoadedAtRef.current < MIN_VISIBILITY_REFRESH_GAP_MS) {
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
  }, [loadSnapshot, path, pollIntervalMs, toFriendlyError]);

  return {
    isLoading,
    pageError,
    snapshot,
  };
}
