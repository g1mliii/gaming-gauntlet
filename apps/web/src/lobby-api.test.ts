import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fetchPublicLobbyState } from "./lobby-api";

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const now = "2026-05-30T12:00:00.000Z";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchPublicLobbyState ETag handling", () => {
  test("returns the parsed state and server ETag on a 200", async () => {
    fetchMock.mockResolvedValue(stateResponse());

    const result = await fetchPublicLobbyState(lobbyId);

    expect(result).toEqual({
      status: "modified",
      state: expect.objectContaining({ version: 1 }),
      etag: '"v1"',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("if-none-match")).toBeNull();
  });

  test("forwards a known ETag as If-None-Match and surfaces a 304", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"v1"' } })
    );

    const result = await fetchPublicLobbyState(lobbyId, { etag: '"v1"' });

    expect(result).toEqual({ status: "not-modified", etag: '"v1"' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("if-none-match")).toBe('"v1"');
  });
});

function stateResponse(): Response {
  return new Response(JSON.stringify(publicLobbyState()), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"v1"' },
  });
}

function publicLobbyState() {
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
      version: 1,
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
    version: 1,
    updatedAt: now,
  };
}
