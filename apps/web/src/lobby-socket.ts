import { PublicLobbyStateSchema } from "@gaming-gauntlet/core";
import type { PublicLobbyState } from "@gaming-gauntlet/core";

// Thin client for the lobby's live-update WebSocket (GET /api/lobbies/:id/socket
// -> LobbyHub Durable Object). It only carries *updates*: callers still load
// their initial snapshot from the REST /state endpoint and keep a slow
// reconciliation poll, so a socket that never opens degrades to plain polling.
//
// Reconnection is intentionally NOT handled here — the consuming hook owns the
// retry cadence (and the fast-poll fallback while disconnected), so this stays a
// single-connection primitive that is easy to reason about and test.

export type LobbyStateSocketEvents = {
  onState: (state: PublicLobbyState) => void;
  onDeleted: () => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export type LobbyStateSocket = {
  close: () => void;
};

// Client heartbeat. The Durable Object auto-responds "pong" without waking from
// hibernation, which keeps intermediaries from reaping an otherwise idle socket.
const PING_INTERVAL_MS = 25000;
const KEEPALIVE_REQUEST = "ping";
const KEEPALIVE_RESPONSE = "pong";

export function lobbyStateSocketUrl(lobbyId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";

  return `${wsProtocol}//${host}/api/lobbies/${encodeURIComponent(
    lobbyId
  )}/socket`;
}

export function openLobbyStateSocket(
  lobbyId: string,
  events: LobbyStateSocketEvents
): LobbyStateSocket {
  const url = lobbyStateSocketUrl(lobbyId);

  if (!url || typeof WebSocket === "undefined") {
    // No socket transport available (SSR / unsupported runtime). Report a close
    // on the next tick so the caller falls back to polling without special-casing.
    queueMicrotask(() => events.onClose?.());
    return { close: () => {} };
  }

  let socket: WebSocket;

  try {
    socket = new WebSocket(url);
  } catch {
    queueMicrotask(() => events.onClose?.());
    return { close: () => {} };
  }

  let closedByCaller = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const clearPing = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  socket.addEventListener("open", () => {
    if (closedByCaller) {
      return;
    }

    events.onOpen?.();
    pingTimer = setInterval(() => {
      try {
        socket.send(KEEPALIVE_REQUEST);
      } catch {
        // Send on a dying socket throws; the close handler will clean up.
      }
    }, PING_INTERVAL_MS);
  });

  socket.addEventListener("message", (event: MessageEvent) => {
    if (closedByCaller || typeof event.data !== "string") {
      return;
    }

    if (event.data === KEEPALIVE_RESPONSE) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    const message = parsed as { type?: unknown; state?: unknown };

    if (message.type === "deleted") {
      events.onDeleted();
      return;
    }

    if (message.type === "state") {
      const result = PublicLobbyStateSchema.safeParse(message.state);

      if (result.success) {
        events.onState(result.data);
      }
    }
  });

  const handleClose = () => {
    clearPing();

    if (!closedByCaller) {
      events.onClose?.();
    }
  };

  socket.addEventListener("close", handleClose);
  // An error is always followed by a close event, so let handleClose do the work.
  socket.addEventListener("error", () => {});

  return {
    close() {
      closedByCaller = true;
      clearPing();

      try {
        socket.close();
      } catch {
        // Already closed.
      }
    },
  };
}
