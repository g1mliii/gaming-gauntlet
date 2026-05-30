import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../App";
import { getManagementPasscodeStorageKey } from "../management-passcodes";

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const addedGameId = "game_ghi234jkl567";
const managementCode = "GG-AAAA-BBBB-CCCC";
const now = "2026-05-30T12:00:00.000Z";
type PublicState = ReturnType<typeof publicLobbyState>;
type PublicGame = PublicState["games"][number];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage()
  });
  window.localStorage.clear();
  window.history.pushState(null, "", "/");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Phase 6 match room", () => {
  test("renders public match state while locked and hides controls", async () => {
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    expect(await screen.findByRole("heading", { name: "Locked" })).toBeInTheDocument();
    expect(screen.getByTestId("public-score")).toHaveTextContent("NOVA 2 / 1 RIPTIDE");
    expect(screen.getByText("Now playing Rocket League")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Scoreboard" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add game title")).not.toBeInTheDocument();
    expect(screen.queryByText("GG-AAAA-BBBB-CCCC")).not.toBeInTheDocument();
  });

  test("correct passcode unlocks inline and wrong passcode shows an inline error", async () => {
    mockApiRouter();
    window.history.pushState(null, "", `/g/${lobbyId}`);

    render(<App initialPath={`/g/${lobbyId}`} />);

    await screen.findByRole("heading", { name: "Locked" });
    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: "GG-ZZZZ-ZZZZ-ZZZZ" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock controls" }));

    expect(
      await screen.findByText("Management passcode is invalid.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: managementCode }
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock controls" }));

    expect(
      await screen.findByRole("heading", { name: "Scoreboard" })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/g/${lobbyId}`);
    expect(window.localStorage.getItem(getManagementPasscodeStorageKey(lobbyId))).toBe(
      managementCode
    );
    expect(requestUrls()).not.toContain(managementCode);
    expect(requestUrls()).not.toMatch(/[?&].*(code|token|secret|management)/i);
  });

  test("stored passcode auto-unlocks without re-prompting", async () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    expect(
      await screen.findByRole("heading", { name: "Scoreboard" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Locked" })).not.toBeInTheDocument();
    expect(requestUrls()).not.toContain("/verify");
  });

  test("game add, rename, toggle, reorder, delete, and drag-outside delete use authenticated writes", async () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Games" });

    fireEvent.change(screen.getByLabelText("Add game title"), {
      target: { value: "Chess Blitz" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/lobbies/${lobbyId}/games`,
        expect.objectContaining({ method: "POST" })
      )
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(await screen.findByLabelText("Rename Rocket League"), {
      target: { value: "Rocket League 2" }
    });
    fireEvent.blur(screen.getByLabelText("Rename Rocket League"));

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "PATCH",
          url: `/api/lobbies/${lobbyId}/games/${gameId}`
        })
      )
    );

    fireEvent.click(screen.getAllByRole("switch")[1] ?? screen.getAllByRole("switch")[0]);

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          body: expect.stringContaining('"enabled":false'),
          method: "PATCH"
        })
      )
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Move Rocket League 2 down/i })
    );

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "POST",
          url: `/api/lobbies/${lobbyId}/games/reorder`
        })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete Tetris/i }));

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "DELETE",
          url: `/api/lobbies/${lobbyId}/games/${secondGameId}`
        })
      )
    );

    const gameRow = screen
      .getAllByText("Rocket League 2")
      .map((element) => element.closest("[data-game-id]"))
      .find(Boolean) as HTMLElement;

    fireEvent.pointerDown(gameRow, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window);

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "DELETE",
          url: `/api/lobbies/${lobbyId}/games/${gameId}`
        })
      )
    );

    expectWriteRequestsAreSafe();
  });

  test("new games are not editable until the API returns the canonical id", async () => {
    let releaseAddResponse: () => void = () => {};
    const addResponseGate = new Promise<void>((resolve) => {
      releaseAddResponse = resolve;
    });

    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter({ delayAddGame: () => addResponseGate });

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Games" });

    fireEvent.change(screen.getByLabelText("Add game title"), {
      target: { value: "Chess Blitz" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/lobbies/${lobbyId}/games`,
        expect.objectContaining({ method: "POST" })
      )
    );
    expect(screen.queryByText("Chess Blitz")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Delete Chess Blitz/i })
    ).not.toBeInTheDocument();

    releaseAddResponse();

    expect(await screen.findByText("Chess Blitz")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete Chess Blitz/i })
    ).toBeInTheDocument();
  });

  test("scoreboard controls send authenticated lobby patches", async () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    fireEvent.click(screen.getByRole("button", { name: /Increase NOVA score/i }));
    fireEvent.click(screen.getByRole("button", { name: /Decrease RIPTIDE score/i }));
    fireEvent.change(screen.getByLabelText("Set target score"), {
      target: { value: "7" }
    });
    fireEvent.blur(screen.getByLabelText("Set target score"));
    fireEvent.change(screen.getByLabelText("Player 1 name"), {
      target: { value: "Nova Prime" }
    });
    fireEvent.blur(screen.getByLabelText("Player 1 name"));
    fireEvent.click(screen.getByRole("button", { name: "Clear pick" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset scores" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset match" }));

    await waitFor(() => {
      const lobbyPatchCalls = requests().filter(
        (request) => request.method === "PATCH" && request.url === `/api/lobbies/${lobbyId}`
      );

      expect(lobbyPatchCalls.length).toBeGreaterThanOrEqual(7);
    });

    expect(requests()).toContainEqual(
      expect.objectContaining({ body: expect.stringContaining('"targetScore":7') })
    );
    expect(requests()).toContainEqual(
      expect.objectContaining({ body: expect.stringContaining('"playerOneName":"Nova Prime"') })
    );
    expect(requests()).toContainEqual(
      expect.objectContaining({ body: expect.stringContaining('"currentGameId":null') })
    );
    expectWriteRequestsAreSafe();
  });

  test("Add to OBS routes to the clean overlays surface", async () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    const addToObs = await screen.findByRole("link", { name: /Add to OBS/i });

    expect(addToObs).toHaveAttribute("href", `/g/${lobbyId}/obs`);
    expect(addToObs.getAttribute("href")).not.toMatch(/code|token|secret|management/i);
  });
});

function mockApiRouter(
  options: { delayAddGame?: () => Promise<void> | void } = {}
) {
  let state: PublicState = publicLobbyState();

  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://gaming-gauntlet.local");
    const method = init?.method ?? "GET";

    if (method === "GET" && url.pathname === `/api/lobbies/${lobbyId}/state`) {
      return jsonResponse(state);
    }

    if (method === "POST" && url.pathname === `/api/lobbies/${lobbyId}/verify`) {
      const body = parseBody(init);

      if (body.managementCode === managementCode) {
        return jsonResponse({ success: true });
      }

      return jsonResponse(
        {
          error: {
            code: "invalid_management_code",
            message: "Management passcode is invalid."
          }
        },
        401
      );
    }

    if (!hasBearerAuth(init)) {
      return jsonResponse({ error: { code: "unauthorized" } }, 401);
    }

    if (method === "PATCH" && url.pathname === `/api/lobbies/${lobbyId}`) {
      state = bumpState({
        ...state,
        lobby: { ...state.lobby, ...parseBody(init) } as PublicState["lobby"]
      });
      return jsonResponse(state);
    }

    if (method === "POST" && url.pathname === `/api/lobbies/${lobbyId}/games`) {
      const body = parseBody(init);

      await options.delayAddGame?.();
      state = bumpState({
        ...state,
        games: [
          ...state.games,
          {
            id: addedGameId,
            lobbyId,
            title: String(body.title),
            position: state.games.length,
            enabled: true,
            createdAt: now,
            updatedAt: now
          }
        ]
      });
      return jsonResponse(state);
    }

    if (method === "PATCH" && url.pathname.startsWith(`/api/lobbies/${lobbyId}/games/`)) {
      const gameIdToUpdate = url.pathname.split("/").at(-1);
      const body = parseBody(init);

      state = bumpState({
        ...state,
        games: state.games.map((game) =>
          game.id === gameIdToUpdate ? ({ ...game, ...body } as PublicGame) : game
        )
      });
      return jsonResponse(state);
    }

    if (method === "DELETE" && url.pathname.startsWith(`/api/lobbies/${lobbyId}/games/`)) {
      const gameIdToDelete = url.pathname.split("/").at(-1);

      state = bumpState({
        ...state,
        lobby: {
          ...state.lobby,
          currentGameId:
            state.lobby.currentGameId === gameIdToDelete
              ? null
              : state.lobby.currentGameId
        },
        games: state.games.filter((game) => game.id !== gameIdToDelete)
      });
      return jsonResponse(state);
    }

    if (method === "POST" && url.pathname === `/api/lobbies/${lobbyId}/games/reorder`) {
      const byId = new Map(state.games.map((game) => [game.id, game]));
      const orderedIds = parseBody(init).gameIds as string[];

      state = bumpState({
        ...state,
        games: orderedIds.map((id, position) => {
          const game = byId.get(id);

          if (!game) {
            throw new Error(`Unknown game id: ${id}`);
          }

          return { ...game, position };
        })
      });
      return jsonResponse(state);
    }

    return jsonResponse({ error: { code: "not_found" } }, 404);
  });
}

function expectWriteRequestsAreSafe() {
  for (const request of requests().filter((item) => item.method !== "GET")) {
    if (!request.url.endsWith("/verify")) {
      expect(request.headers.get("authorization")).toBe(`Bearer ${managementCode}`);
    }

    expect(request.url).not.toMatch(/[?&].*(code|token|secret|management)/i);
    expect(request.url).not.toContain(managementCode);
  }
}

function requests() {
  return fetchMock.mock.calls.map(([input, init]) => {
    const headers = new Headers((init as RequestInit | undefined)?.headers);

    return {
      body: String((init as RequestInit | undefined)?.body ?? ""),
      headers,
      method: (init as RequestInit | undefined)?.method ?? "GET",
      url: String(input)
    };
  });
}

function requestUrls(): string {
  return requests()
    .map((request) => request.url)
    .join("\n");
}

function hasBearerAuth(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);

  return headers.get("authorization") === `Bearer ${managementCode}`;
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

function bumpState(state: ReturnType<typeof publicLobbyState>) {
  const nextVersion = state.version + 1;

  return {
    ...state,
    lobby: {
      ...state.lobby,
      version: nextVersion,
      updatedAt: now
    },
    games: state.games.map((game, position) => ({
      ...game,
      position,
      updatedAt: now
    })),
    version: nextVersion,
    updatedAt: now
  };
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
      currentGameId: gameId as string | null,
      version: 1,
      createdAt: now,
      updatedAt: now
    },
    games: [
      {
        id: gameId,
        lobbyId,
        title: "Rocket League",
        position: 0,
        enabled: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: secondGameId,
        lobbyId,
        title: "Tetris",
        position: 1,
        enabled: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    version: 1,
    updatedAt: now
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
