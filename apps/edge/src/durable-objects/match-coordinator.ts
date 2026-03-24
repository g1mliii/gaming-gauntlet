import { createDemoMatchSnapshot, createWebsocketEnvelope, type MatchSnapshot } from "@gaming-gauntlet/contracts";

import { json } from "../lib/response";

const STORAGE_KEY = "snapshot";

export class MatchCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: unknown
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId") ?? "match_demo_01";

    if (url.pathname === "/snapshot") {
      return json(await this.getSnapshot(matchId));
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.state.acceptWebSocket(server);
      await this.sendSnapshot(server, matchId);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return json({ ok: true, service: "match-coordinator", matchId });
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const payload = safeParseJson(text);

    if (payload?.type === "request.snapshot") {
      const matchId = typeof payload.matchId === "string" ? payload.matchId : "match_demo_01";
      await this.sendSnapshot(webSocket, matchId);
      return;
    }

    if (payload?.type === "ping") {
      webSocket.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(webSocket: WebSocket): void {
    webSocket.close(1000, "closed");
  }

  private async getSnapshot(matchId: string): Promise<MatchSnapshot> {
    const storageKey = `${STORAGE_KEY}:${matchId}`;
    const stored = await this.state.storage.get<MatchSnapshot>(storageKey);

    if (stored) {
      return stored;
    }

    const snapshot = createDemoMatchSnapshot({ matchId });
    await this.state.storage.put(storageKey, snapshot);
    return snapshot;
  }

  private async sendSnapshot(webSocket: WebSocket, matchId: string): Promise<void> {
    const snapshot = await this.getSnapshot(matchId);
    const envelope = createWebsocketEnvelope("match.snapshot", matchId, snapshot);
    webSocket.send(JSON.stringify(envelope));
  }
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
