import { useEffect, useState } from "react";
import type { PublicLobbyState } from "@gaming-gauntlet/core";

import { fetchPublicLobbyState, isAbortError, LobbyApiError } from "../lobby-api";
import { openLobbyStateSocket } from "../lobby-socket";
import type { LobbyStateSocket } from "../lobby-socket";

// Read-only public-state subscriber for OBS overlays and spectators. It prefers
// the live WebSocket (LobbyHub Durable Object): one connection per viewer, and
// the server pushes new state only when the streamer mutates the lobby, so an
// idle herd generates no traffic. Polling is kept as a fallback/safety net —
// while the socket is connected the poll drops to a slow reconciliation cadence;
// if the socket can't connect or drops, polling speeds back up so the overlay
// never goes stale. Deliberately simpler than useMatchRoom: no auth, no writes,
// no optimistic state.

const VISIBLE_POLL_INTERVAL_MS = 1500;
const HIDDEN_POLL_INTERVAL_MS = 5000;
// Slow reconciliation poll while the live socket is connected: it catches any
// broadcast the socket might have missed without re-creating the polling load.
const SOCKET_RECONCILE_INTERVAL_MS = 30000;
// How long to wait before retrying the socket after it closes/fails.
const SOCKET_RECONNECT_DELAY_MS = 5000;

export type OverlayStateModel = {
  state: PublicLobbyState | null;
  isLoading: boolean;
  notFound: boolean;
  error: string | null;
};

export function useOverlayState(
  lobbyId: string,
  enabled = true
): OverlayStateModel {
  const [state, setState] = useState<PublicLobbyState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      setIsLoading(false);
      setNotFound(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();
    let isActive = true;
    let isPolling = false;
    let pollTimeoutId: number | null = null;
    let currentEtag: string | null = null;
    // Highest version applied from either transport, so a slow reconciliation
    // poll never clobbers a newer state already pushed over the socket.
    let lastVersion = 0;

    let socket: LobbyStateSocket | null = null;
    let socketConnected = false;
    let socketReconnectId: number | null = null;

    setState(null);
    setIsLoading(true);
    setNotFound(false);
    setError(null);

    const getInterval = () => {
      if (socketConnected) {
        return SOCKET_RECONCILE_INTERVAL_MS;
      }

      return document.visibilityState === "hidden"
        ? HIDDEN_POLL_INTERVAL_MS
        : VISIBLE_POLL_INTERVAL_MS;
    };

    const clearScheduled = () => {
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
    };

    // Always replace any pending timer so there is at most one outstanding poll
    // in the chain at a time.
    const scheduleNext = (delayMs = getInterval()) => {
      if (!isActive) {
        return;
      }

      clearScheduled();
      pollTimeoutId = window.setTimeout(() => {
        pollTimeoutId = null;
        void runPoll();
      }, delayMs);
    };

    // Single place both transports funnel new state through. Dedupes by version
    // so out-of-order arrivals (a reconciliation poll racing a push) can't move
    // the overlay backward.
    const applyState = (next: PublicLobbyState) => {
      if (!isActive || next.version <= lastVersion) {
        return;
      }

      lastVersion = next.version;
      setNotFound(false);
      setError(null);
      setState(next);
    };

    const poll = async () => {
      try {
        const result = await fetchPublicLobbyState(lobbyId, {
          signal: abortController.signal,
          etag: currentEtag,
        });

        if (!isActive) {
          return;
        }

        setNotFound(false);
        setError(null);

        // A 304 means nothing changed, so skip the state update (and re-render).
        if (result.status === "modified") {
          currentEtag = result.etag;
          applyState(result.state);
        }
      } catch (pollError) {
        if (!isActive || isAbortError(pollError)) {
          return;
        }

        if (pollError instanceof LobbyApiError && pollError.status === 404) {
          setNotFound(true);
          setState(null);
          currentEtag = null;
          lastVersion = 0;
          return;
        }

        setError(
          pollError instanceof Error
            ? pollError.message
            : "Overlay state could not be loaded."
        );
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    // Single entry point for the poll loop: the reentrancy guard means an
    // immediate poll (e.g. on tab focus) can never overlap an in-flight one, and
    // each run reschedules itself exactly once.
    const runPoll = async () => {
      if (!isActive || isPolling) {
        return;
      }

      isPolling = true;
      try {
        await poll();
      } finally {
        isPolling = false;
        scheduleNext();
      }
    };

    const clearSocketReconnect = () => {
      if (socketReconnectId !== null) {
        window.clearTimeout(socketReconnectId);
        socketReconnectId = null;
      }
    };

    const connectSocket = () => {
      if (!isActive) {
        return;
      }

      socket = openLobbyStateSocket(lobbyId, {
        onState(next) {
          applyState(next);
        },
        onDeleted() {
          if (!isActive) {
            return;
          }

          setNotFound(true);
          setState(null);
          currentEtag = null;
          lastVersion = 0;
        },
        onOpen() {
          if (!isActive) {
            return;
          }

          socketConnected = true;
          // Drop to the slow reconciliation cadence now that pushes drive us.
          scheduleNext();
        },
        onClose() {
          if (!isActive) {
            return;
          }

          socketConnected = false;
          socket = null;
          // Reconcile immediately, then resume the fast fallback poll while the
          // socket is down, and retry the socket shortly.
          clearScheduled();
          void runPoll();
          clearSocketReconnect();
          socketReconnectId = window.setTimeout(
            connectSocket,
            SOCKET_RECONNECT_DELAY_MS
          );
        },
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        scheduleNext();
      } else {
        clearScheduled();
        void runPoll();
      }
    };

    void runPoll();
    connectSocket();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isActive = false;
      abortController.abort();
      clearScheduled();
      clearSocketReconnect();
      socket?.close();
      socket = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, lobbyId]);

  return { state, isLoading, notFound, error };
}
