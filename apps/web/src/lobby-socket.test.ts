import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { lobbyStateSocketUrl, openLobbyStateSocket } from "./lobby-socket";

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const now = "2026-05-30T12:00:00.000Z";

function publicLobbyState(version: number) {
  return {
    lobby: {
      id: lobbyId,
      title: "Friday Night Gauntlet",
      playerOneName: "NOVA",
      playerTwoName: "RIPTIDE",
      playerOneScore: 2,
      playerTwoScore: 1,
      targetScore: 5,
      status: "ready",
      currentGameId: gameId,
      version,
      createdAt: now,
      updatedAt: now,
    },
    games: [
      {
        id: gameId,
        lobbyId,
        title: "Rocket League",
        position: 0,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    version,
    updatedAt: now,
  };
}

// Minimal stand-in for the browser WebSocket the client constructs. Captures
// listeners so the test can drive the lifecycle (open/message/close).
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)?.add(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  emit(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("lobbyStateSocketUrl", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  test("builds a wss URL on https origins", () => {
    (globalThis as { window?: unknown }).window = {
      location: { protocol: "https:", host: "gaming-gauntlet.com" },
    };

    expect(lobbyStateSocketUrl(lobbyId)).toBe(
      `wss://gaming-gauntlet.com/api/lobbies/${lobbyId}/socket`
    );
  });

  test("builds a ws URL on http origins", () => {
    (globalThis as { window?: unknown }).window = {
      location: { protocol: "http:", host: "localhost:5173" },
    };

    expect(lobbyStateSocketUrl(lobbyId)).toBe(
      `ws://localhost:5173/api/lobbies/${lobbyId}/socket`
    );
  });
});

describe("openLobbyStateSocket", () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as { window?: unknown }).window = {
      location: { protocol: "https:", host: "gaming-gauntlet.com" },
    };
    (globalThis as { WebSocket?: unknown }).WebSocket =
      MockWebSocket as unknown;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }

    if (originalWebSocket === undefined) {
      Reflect.deleteProperty(globalThis, "WebSocket");
    } else {
      (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    }
  });

  test("delivers parsed state and ignores keepalive pongs", () => {
    const onState = vi.fn();
    const onOpen = vi.fn();
    openLobbyStateSocket(lobbyId, { onState, onDeleted: vi.fn(), onOpen });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws?.emit("open", {});
    expect(onOpen).toHaveBeenCalledTimes(1);

    ws?.emit("message", { data: "pong" });
    expect(onState).not.toHaveBeenCalled();

    ws?.emit("message", {
      data: JSON.stringify({ type: "state", state: publicLobbyState(7) }),
    });

    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls[0]?.[0].version).toBe(7);
  });

  test("invokes onDeleted for a deleted message", () => {
    const onDeleted = vi.fn();
    openLobbyStateSocket(lobbyId, { onState: vi.fn(), onDeleted });

    MockWebSocket.instances[0]?.emit("message", {
      data: JSON.stringify({ type: "deleted" }),
    });

    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  test("ignores malformed state without throwing", () => {
    const onState = vi.fn();
    openLobbyStateSocket(lobbyId, { onState, onDeleted: vi.fn() });

    MockWebSocket.instances[0]?.emit("message", {
      data: JSON.stringify({ type: "state", state: { lobby: "nope" } }),
    });
    MockWebSocket.instances[0]?.emit("message", { data: "{not json" });

    expect(onState).not.toHaveBeenCalled();
  });

  test("close() suppresses the onClose callback", () => {
    const onClose = vi.fn();
    const handle = openLobbyStateSocket(lobbyId, {
      onState: vi.fn(),
      onDeleted: vi.fn(),
      onClose,
    });

    handle.close();

    expect(MockWebSocket.instances[0]?.closed).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
