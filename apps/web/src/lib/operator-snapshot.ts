import type { MatchSnapshot } from "@gaming-gauntlet/contracts";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { buildEdgeUrl, buildEdgeWebSocketUrl, EdgeError } from "./edge";

const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_FETCH_RETRY_DELAY_MS = 60_000;

type UseOperatorSnapshotOptions = {
  matchId: string | null;
  missingMatchError: string;
  toFriendlyError: (error: unknown) => string;
};

type MatchSnapshotEnvelope = {
  payload?: MatchSnapshot;
  type?: string;
};

function buildSnapshotEtag(snapshot: {
  boardRevision: number;
  matchId: string;
  updatedAt: string;
}): string {
  return `W/"${snapshot.matchId}:${snapshot.updatedAt}:${snapshot.boardRevision}"`;
}

export function useOperatorSnapshot({
  matchId,
  missingMatchError,
  toFriendlyError,
}: UseOperatorSnapshotOptions) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const fetchRetryAttemptRef = useRef(0);
  const reconnectSuspendedRef = useRef(false);
  const snapshotStatusRef = useRef<MatchSnapshot["status"] | null>(null);
  const getFriendlyError = useEffectEvent((error: unknown) =>
    toFriendlyError(error)
  );

  function replaceSnapshot(nextSnapshot: MatchSnapshot) {
    snapshotStatusRef.current = nextSnapshot.status;
    etagRef.current = buildSnapshotEtag(nextSnapshot);
    startTransition(() => {
      setSnapshot(nextSnapshot);
    });
    setPageError(null);
  }

  useEffect(() => {
    let disposed = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function closeSocket(suspendReconnect = false) {
      reconnectSuspendedRef.current = suspendReconnect;
      clearReconnectTimer();

      const socket = socketRef.current;

      if (!socket) {
        return;
      }

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
    }

    async function loadSnapshot(signal?: AbortSignal) {
      if (!matchId) {
        return;
      }

      const headers: HeadersInit = {};

      if (etagRef.current) {
        headers["If-None-Match"] = etagRef.current;
      }

      const response = await fetch(
        buildEdgeUrl(`/api/control/matches/${matchId}/snapshot`),
        {
          credentials: "include",
          headers,
          signal,
        }
      );

      if (response.status === 304) {
        fetchRetryAttemptRef.current = 0;
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

      if (!disposed) {
        const nextSnapshot = payload as MatchSnapshot;
        etagRef.current =
          response.headers.get("ETag") ?? buildSnapshotEtag(nextSnapshot);
        snapshotStatusRef.current = nextSnapshot.status;
        fetchRetryAttemptRef.current = 0;
        startTransition(() => {
          setSnapshot(nextSnapshot);
        });
        setPageError(null);
      }
    }

    function scheduleSnapshotRetry() {
      if (
        disposed ||
        reconnectSuspendedRef.current ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const delay = Math.min(
        1_000 * 2 ** fetchRetryAttemptRef.current,
        MAX_FETCH_RETRY_DELAY_MS
      );

      fetchRetryAttemptRef.current += 1;
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        void refetchAndConnect(false);
      }, delay);
    }

    function connectSocket() {
      if (
        !matchId ||
        document.visibilityState !== "visible" ||
        disposed ||
        snapshotStatusRef.current === "complete"
      ) {
        return;
      }

      closeSocket();
      reconnectSuspendedRef.current = false;

      const socket = new WebSocket(
        buildEdgeWebSocketUrl(`/ws/control/matches/${matchId}`)
      );

      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;

        if (!disposed) {
          setPageError(null);
        }
      };

      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as MatchSnapshotEnvelope;

        if (!disposed && payload.type === "match.snapshot" && payload.payload) {
          const nextSnapshot = payload.payload;
          snapshotStatusRef.current = nextSnapshot.status;
          etagRef.current = buildSnapshotEtag(nextSnapshot);
          startTransition(() => {
            setSnapshot(nextSnapshot);
          });
          setPageError(null);

          if (nextSnapshot.status === "complete") {
            reconnectSuspendedRef.current = true;
            socket.close();
          }
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;

        if (
          disposed ||
          reconnectSuspendedRef.current ||
          document.visibilityState !== "visible"
        ) {
          return;
        }

        const delay = Math.min(
          1_000 * 2 ** reconnectAttemptRef.current,
          MAX_RECONNECT_DELAY_MS
        );

        reconnectAttemptRef.current += 1;
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          void refetchAndConnect(false);
        }, delay);
      };
    }

    async function refetchAndConnect(clearSnapshotOnError: boolean) {
      fetchAbortRef.current?.abort();
      const abortController = new AbortController();
      fetchAbortRef.current = abortController;

      try {
        await loadSnapshot(abortController.signal);
      } catch (error) {
        if (!abortController.signal.aborted && !disposed) {
          if (clearSnapshotOnError) {
            setSnapshot(null);
          }
          setPageError(getFriendlyError(error));
          scheduleSnapshotRetry();
        }
        return;
      }

      if (!abortController.signal.aborted && !disposed) {
        connectSocket();
      }
    }

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    etagRef.current = null;
    reconnectAttemptRef.current = 0;
    fetchRetryAttemptRef.current = 0;
    reconnectSuspendedRef.current = false;
    clearReconnectTimer();
    closeSocket(true);

    if (!matchId) {
      snapshotStatusRef.current = null;
      setSnapshot(null);
      setPageError(missingMatchError);
      setIsLoading(false);
      return;
    }

    snapshotStatusRef.current = null;
    setSnapshot(null);
    setIsLoading(true);
    setPageError(null);

    void refetchAndConnect(true).finally(() => {
      if (!disposed) {
        setIsLoading(false);
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        closeSocket(true);
        return;
      }

      reconnectAttemptRef.current = 0;
      fetchRetryAttemptRef.current = 0;
      reconnectSuspendedRef.current = false;
      fetchAbortRef.current?.abort();
      void refetchAndConnect(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      fetchAbortRef.current?.abort();
      closeSocket(true);
      clearReconnectTimer();
    };
  }, [matchId, missingMatchError]);

  return {
    isLoading,
    pageError,
    replaceSnapshot,
    snapshot,
  };
}
