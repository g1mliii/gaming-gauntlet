import { DurableObject } from "cloudflare:workers";
import type { PublicLobbyState } from "@gaming-gauntlet/core";

// One LobbyHub Durable Object exists per lobby (addressed by name = lobbyId).
// It is a pure publish/subscribe fan-out: viewers and OBS overlays open a
// single hibernatable WebSocket and the hub pushes new public state to all of
// them whenever the streamer mutates the lobby. Between events the DO
// hibernates, so thousands of idle viewers on one lobby cost ~no compute and
// generate zero request traffic — the lever that replaces per-viewer polling.
//
// The hub deliberately never touches D1. The REST `GET /state` endpoint (edge
// cached) remains the source of truth and the way a client loads its initial
// snapshot; the socket only carries *updates*. The hub keeps a copy of the
// most recent broadcast in DO storage purely so a client that connects in the
// gap between its REST snapshot and the next write still converges quickly.

type ServerMessage =
  | { type: "state"; state: PublicLobbyState }
  | { type: "deleted" };

const LATEST_MESSAGE_KEY = "latest";
const LATEST_VERSION_KEY = "version";

// A client may send "ping"; the runtime answers "pong" without waking the DO.
const KEEPALIVE_REQUEST = "ping";
const KEEPALIVE_RESPONSE = "pong";

export class LobbyHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);

    // Auto-respond to keepalive pings at the edge so a heartbeat never wakes
    // the object from hibernation.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(KEEPALIVE_REQUEST, KEEPALIVE_RESPONSE)
    );
  }

  // WebSocket upgrade entry point. The Worker forwards the viewer's request
  // here after validating the lobby id, origin, and rate limit.
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    // Hibernation accept: the socket survives the object hibernating, and the
    // webSocket* handlers below are re-invoked on wake without us holding the
    // connection open in memory.
    this.ctx.acceptWebSocket(server);

    // Hand the freshly connected client the last broadcast so it converges
    // immediately even if the streamer's most recent write landed between the
    // client's REST snapshot and this connection. The client dedupes by
    // version, so a redundant snapshot is harmless.
    const latest = await this.ctx.storage.get<string>(LATEST_MESSAGE_KEY);

    if (latest) {
      trySend(server, latest);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // RPC, called by the Worker (via waitUntil) after a successful mutation.
  async publish(state: PublicLobbyState): Promise<void> {
    const lastVersion =
      (await this.ctx.storage.get<number>(LATEST_VERSION_KEY)) ?? 0;

    // Writes are serialized through the Worker and each bumps version, but
    // best-effort waitUntil notifications can still race; never let an older
    // snapshot overwrite a newer one or flap connected viewers backward.
    if (state.version <= lastVersion) {
      return;
    }

    const message = serialize({ type: "state", state });

    await this.ctx.storage.put({
      [LATEST_MESSAGE_KEY]: message,
      [LATEST_VERSION_KEY]: state.version,
    });

    this.broadcast(message);
  }

  // RPC, called by the Worker after the lobby is torn down (end match /
  // retention). Tells every viewer the lobby is gone and drops the sockets.
  async publishDeleted(): Promise<void> {
    await this.ctx.storage.deleteAll();

    const message = serialize({ type: "deleted" });

    for (const ws of this.ctx.getWebSockets()) {
      trySend(ws, message);

      try {
        ws.close(1000, "lobby deleted");
      } catch {
        // Already closing; nothing to do.
      }
    }
  }

  webSocketMessage(): void {
    // Pings are handled by the auto-response pair; the client never sends
    // anything else, so any other inbound frame is ignored.
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      // 1006 (abnormal) is not a valid code to echo back; normalize it.
      ws.close(code === 1006 ? 1000 : code);
    } catch {
      // Socket already closed.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "socket error");
    } catch {
      // Socket already closed.
    }
  }

  private broadcast(message: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      trySend(ws, message);
    }
  }
}

function serialize(message: ServerMessage): string {
  return JSON.stringify(message);
}

function trySend(ws: WebSocket, message: string): void {
  try {
    ws.send(message);
  } catch {
    // A dead socket throws; it will be cleaned up by its close event.
  }
}
