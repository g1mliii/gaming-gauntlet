import { useEffect, useState } from "react";
import type { PublicLobbyState } from "@gaming-gauntlet/core";

import { fetchPublicLobbyState, isAbortError, LobbyApiError } from "../lobby-api";

// Read-only public-state poller for OBS overlays. Deliberately simpler than
// useMatchRoom: no auth, no writes, no optimistic state. It fetches public
// state every ~1.5s, sends the last ETag so unchanged polls come back as a
// cheap 304 (no re-render, no body), backs off while the tab is hidden, and
// aborts in flight on unmount.

const VISIBLE_POLL_INTERVAL_MS = 1500;
const HIDDEN_POLL_INTERVAL_MS = 5000;

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

    setState(null);
    setIsLoading(true);
    setNotFound(false);
    setError(null);

    const getInterval = () =>
      document.visibilityState === "hidden"
        ? HIDDEN_POLL_INTERVAL_MS
        : VISIBLE_POLL_INTERVAL_MS;

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
          setState(result.state);
        }
      } catch (pollError) {
        if (!isActive || isAbortError(pollError)) {
          return;
        }

        if (pollError instanceof LobbyApiError && pollError.status === 404) {
          setNotFound(true);
          setState(null);
          currentEtag = null;
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        scheduleNext();
      } else {
        clearScheduled();
        void runPoll();
      }
    };

    void runPoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isActive = false;
      abortController.abort();
      clearScheduled();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, lobbyId]);

  return { state, isLoading, notFound, error };
}
