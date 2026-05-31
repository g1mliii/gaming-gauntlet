import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../App";
import { getManagementPasscodeStorageKey } from "../management-passcodes";
import { getOverlayThemeStorageKey } from "../overlay-theme";

const lobbyId = "lob_abc234def567";
const oldLobbyId = "lob_old234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const addedGameId = "game_ghi234jkl567";
const managementCode = "GG-AAAA-BBBB-CCCC";
const oldManagementCode = "GG-ZZZZ-ZZZZ-ZZZZ";
const now = "2026-05-30T12:00:00.000Z";
type PublicState = ReturnType<typeof publicLobbyState>;
type PublicGame = PublicState["games"][number];
let fetchMock: ReturnType<typeof vi.fn>;
let clipboardWriteMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteMock },
  });
  setMatchMedia(false);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState(null, "", "/");
});

function setMatchMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The share bar repeats "Copy" across its URL and passcode rows, so scope
// button lookups to the field carrying a given label.
function field(label: string): HTMLElement {
  const node = screen.getByText(label).closest(".gg-sharebar__field");

  if (!(node instanceof HTMLElement)) {
    throw new Error(`share bar field "${label}" not found`);
  }

  return node;
}

describe("Phase 6 match room", () => {
  test("renders public match state while locked and hides controls", async () => {
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    expect(
      await screen.findByRole("heading", { name: "Locked" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("public-score")).toHaveTextContent(
      "NOVA 2 / 1 RIPTIDE"
    );
    expect(screen.getByText("Now playing Rocket League")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Scoreboard" })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add game title")).not.toBeInTheDocument();
    expect(screen.queryByText("GG-AAAA-BBBB-CCCC")).not.toBeInTheDocument();
  });

  test("correct passcode unlocks inline and wrong passcode shows an inline error", async () => {
    mockApiRouter();
    window.history.pushState(null, "", `/g/${lobbyId}`);
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(oldLobbyId),
      oldManagementCode
    );

    render(<App initialPath={`/g/${lobbyId}`} />);

    await screen.findByRole("heading", { name: "Locked" });
    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: "GG-ZZZZ-ZZZZ-ZZZZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock controls" }));

    expect(
      await screen.findByText("Management passcode is invalid.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: managementCode },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock controls" }));

    expect(
      await screen.findByRole("heading", { name: "Scoreboard" })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/g/${lobbyId}`);
    expect(
      window.sessionStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBe(managementCode);
    expect(
      window.localStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBeNull();
    expect(
      window.localStorage.getItem(getManagementPasscodeStorageKey(oldLobbyId))
    ).toBeNull();
    expect(requestUrls()).not.toContain(managementCode);
    expect(requestUrls()).not.toMatch(/[?&].*(code|token|secret|management)/i);
  });

  test("stored passcode auto-unlocks without re-prompting", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    expect(
      await screen.findByRole("heading", { name: "Scoreboard" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Locked" })
    ).not.toBeInTheDocument();
    expect(requestUrls()).not.toContain("/verify");
  });

  test("legacy localStorage passcodes are migrated for the session and scrubbed", async () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    expect(
      await screen.findByRole("heading", { name: "Scoreboard" })
    ).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBe(managementCode);
    expect(
      window.localStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBeNull();
    expect(requestUrls()).not.toContain("/verify");
  });

  test("share bar copies the match URL without exposing the passcode", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    const urlField = field("Match URL");

    fireEvent.click(within(urlField).getByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalledTimes(1));
    expect(clipboardWriteMock.mock.calls[0]?.[0]).toMatch(
      new RegExp(`/g/${lobbyId}$`)
    );
    expect(clipboardWriteMock).not.toHaveBeenCalledWith(managementCode);
  });

  test("passcode stays masked until the reveal is confirmed, then copies", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    // Masked on arrival — the passcode must never sit on screen unprompted.
    expect(screen.queryByText(managementCode)).not.toBeInTheDocument();

    const passcodeField = field("Passcode");

    fireEvent.click(
      within(passcodeField).getByRole("button", { name: /Reveal/i })
    );

    // Confirmation gate: still hidden until the streamer confirms they're safe.
    expect(screen.queryByText(managementCode)).not.toBeInTheDocument();
    expect(
      screen.getByText(/make sure you’re not live/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, reveal" }));

    expect(screen.getByText(managementCode)).toBeInTheDocument();

    fireEvent.click(
      within(field("Passcode")).getByRole("button", { name: /Copy/i })
    );

    await waitFor(() =>
      expect(clipboardWriteMock).toHaveBeenCalledWith(managementCode)
    );
  });

  test("share uses the native share sheet with an absolute match URL", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    fireEvent.click(
      within(field("Match URL")).getByRole("button", { name: /Share/i })
    );

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(shareMock.mock.calls[0]?.[0]?.url).toMatch(
      new RegExp(`^https?://.+/g/${lobbyId}$`)
    );
    expect(clipboardWriteMock).not.toHaveBeenCalled();
  });

  test("theme picker recolors the room and persists the choice locally", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    const { container } = render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    const themeSelect = screen.getByLabelText("Overlay theme");

    expect(themeSelect).toHaveValue("default");
    expect(container.querySelector(".gg-theme--blast")).toBeNull();

    fireEvent.change(themeSelect, { target: { value: "blast" } });

    expect(themeSelect).toHaveValue("blast");
    expect(container.querySelector(".gg-theme--blast")).not.toBeNull();
    expect(
      window.localStorage.getItem(getOverlayThemeStorageKey(lobbyId))
    ).toBe("blast");
  });

  test("game add, rename, toggle, reorder, delete, and drag-outside delete use authenticated writes", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Games" });

    fireEvent.change(screen.getByLabelText("Add game title"), {
      target: { value: "Chess Blitz" },
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
      target: { value: "Rocket League 2" },
    });
    fireEvent.blur(screen.getByLabelText("Rename Rocket League"));

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "PATCH",
          url: `/api/lobbies/${lobbyId}/games/${gameId}`,
        })
      )
    );

    fireEvent.click(
      screen.getAllByRole("switch")[1] ?? screen.getAllByRole("switch")[0]
    );

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          body: expect.stringContaining('"enabled":false'),
          method: "PATCH",
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
          url: `/api/lobbies/${lobbyId}/games/reorder`,
        })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete Tetris/i }));

    await waitFor(() =>
      expect(requests()).toContainEqual(
        expect.objectContaining({
          method: "DELETE",
          url: `/api/lobbies/${lobbyId}/games/${secondGameId}`,
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
          url: `/api/lobbies/${lobbyId}/games/${gameId}`,
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

    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter({ delayAddGame: () => addResponseGate });

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Games" });

    fireEvent.change(screen.getByLabelText("Add game title"), {
      target: { value: "Chess Blitz" },
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

    // The title now also renders as a wheel label, so await its appearance via
    // the unique per-row delete control rather than the (non-unique) text.
    expect(
      await screen.findByRole("button", { name: /Delete Chess Blitz/i })
    ).toBeInTheDocument();
  });

  test("scoreboard controls send authenticated lobby patches", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Scoreboard" });

    fireEvent.click(
      screen.getByRole("button", { name: /Increase NOVA score/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Decrease RIPTIDE score/i })
    );
    fireEvent.change(screen.getByLabelText("Set target score"), {
      target: { value: "7" },
    });
    fireEvent.blur(screen.getByLabelText("Set target score"));
    fireEvent.change(screen.getByLabelText("Player 1 name"), {
      target: { value: "Nova Prime" },
    });
    fireEvent.blur(screen.getByLabelText("Player 1 name"));
    fireEvent.click(screen.getByRole("button", { name: "Clear pick" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset scores" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset match" }));

    await waitFor(() => {
      const lobbyPatchCalls = requests().filter(
        (request) =>
          request.method === "PATCH" &&
          request.url === `/api/lobbies/${lobbyId}`
      );

      expect(lobbyPatchCalls.length).toBeGreaterThanOrEqual(7);
    });

    expect(requests()).toContainEqual(
      expect.objectContaining({
        body: expect.stringContaining('"targetScore":7'),
      })
    );
    expect(requests()).toContainEqual(
      expect.objectContaining({
        body: expect.stringContaining('"playerOneName":"Nova Prime"'),
      })
    );
    expect(requests()).toContainEqual(
      expect.objectContaining({
        body: expect.stringContaining('"currentGameId":null'),
      })
    );
    expectWriteRequestsAreSafe();
  });

  test("Add to OBS routes to the clean overlays surface", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);

    const addToObs = await screen.findByRole("link", { name: /Add to OBS/i });

    expect(addToObs).toHaveAttribute("href", `/g/${lobbyId}/obs`);
    expect(addToObs.getAttribute("href")).not.toMatch(
      /code|token|secret|management/i
    );
  });
});

describe("Phase 7 wheel + spin", () => {
  test("renders the radial wheel and switches to the reel style", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Spin to pick" });

    expect(document.querySelector(".gg-wheel")).toBeInTheDocument();
    expect(document.querySelector(".gg-reel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reel" }));

    expect(document.querySelector(".gg-reel")).toBeInTheDocument();
    expect(document.querySelector(".gg-reel__marker")).toBeInTheDocument();
    expect(document.querySelector(".gg-wheel")).not.toBeInTheDocument();
  });

  test("clicking Spin lands on the server-selected game in the pick banner", async () => {
    setMatchMedia(true);
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Spin to pick" });

    expect(document.querySelector(".gg-pick__title")).toHaveTextContent(
      "Rocket League"
    );

    fireEvent.click(screen.getByRole("button", { name: /Spin the gauntlet/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/lobbies/${lobbyId}/spin`,
        expect.objectContaining({ method: "POST" })
      )
    );
    await waitFor(() =>
      expect(document.querySelector(".gg-pick__title")).toHaveTextContent(
        "Tetris"
      )
    );

    expectWriteRequestsAreSafe();
  });

  test("reduced motion resolves the pick without waiting on the long animation", async () => {
    setMatchMedia(true);
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter();

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Spin to pick" });

    fireEvent.click(screen.getByRole("button", { name: /Spin the gauntlet/i }));

    // No fake-timer advancement: under reduced motion the result must resolve
    // promptly and the button must return to its idle label.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Spin the gauntlet/i })
      ).toBeEnabled()
    );
    expect(document.querySelector(".gg-pick__title")).toHaveTextContent(
      "Tetris"
    );
  });

  test("the Spin button is disabled when no games are enabled", async () => {
    window.sessionStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    mockApiRouter({ disableAllGames: true });

    render(<App initialPath={`/g/${lobbyId}`} />);
    await screen.findByRole("heading", { name: "Spin to pick" });

    expect(
      screen.getByRole("button", { name: /Spin the gauntlet/i })
    ).toBeDisabled();
    expect(screen.getByText("No games enabled")).toBeInTheDocument();
  });
});

function mockApiRouter(
  options: {
    delayAddGame?: () => Promise<void> | void;
    disableAllGames?: boolean;
  } = {}
) {
  let state: PublicState = publicLobbyState();

  if (options.disableAllGames) {
    state = {
      ...state,
      lobby: { ...state.lobby, currentGameId: null },
      games: state.games.map((game) => ({ ...game, enabled: false })),
    };
  }

  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://gaming-gauntlet.local");
      const method = init?.method ?? "GET";

      if (
        method === "GET" &&
        url.pathname === `/api/lobbies/${lobbyId}/state`
      ) {
        return jsonResponse(state);
      }

      if (
        method === "POST" &&
        url.pathname === `/api/lobbies/${lobbyId}/verify`
      ) {
        const body = parseBody(init);

        if (body.managementCode === managementCode) {
          return jsonResponse({ success: true });
        }

        return jsonResponse(
          {
            error: {
              code: "invalid_management_code",
              message: "Management passcode is invalid.",
            },
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
          lobby: { ...state.lobby, ...parseBody(init) } as PublicState["lobby"],
        });
        return jsonResponse(state);
      }

      if (
        method === "POST" &&
        url.pathname === `/api/lobbies/${lobbyId}/spin`
      ) {
        const enabledGames = state.games.filter((game) => game.enabled);

        if (enabledGames.length === 0) {
          return jsonResponse(
            {
              error: {
                code: "no_enabled_games",
                message: "Enable at least one game before spinning.",
              },
            },
            400
          );
        }

        // Deterministic pick (last enabled game) so the test can assert a winner
        // distinct from the lobby's starting pick.
        const winner = enabledGames[enabledGames.length - 1];

        state = bumpState({
          ...state,
          lobby: { ...state.lobby, currentGameId: winner.id },
        });
        return jsonResponse(state);
      }

      if (
        method === "POST" &&
        url.pathname === `/api/lobbies/${lobbyId}/games`
      ) {
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
              updatedAt: now,
            },
          ],
        });
        return jsonResponse(state);
      }

      if (
        method === "PATCH" &&
        url.pathname.startsWith(`/api/lobbies/${lobbyId}/games/`)
      ) {
        const gameIdToUpdate = url.pathname.split("/").at(-1);
        const body = parseBody(init);

        state = bumpState({
          ...state,
          games: state.games.map((game) =>
            game.id === gameIdToUpdate
              ? ({ ...game, ...body } as PublicGame)
              : game
          ),
        });
        return jsonResponse(state);
      }

      if (
        method === "DELETE" &&
        url.pathname.startsWith(`/api/lobbies/${lobbyId}/games/`)
      ) {
        const gameIdToDelete = url.pathname.split("/").at(-1);

        state = bumpState({
          ...state,
          lobby: {
            ...state.lobby,
            currentGameId:
              state.lobby.currentGameId === gameIdToDelete
                ? null
                : state.lobby.currentGameId,
          },
          games: state.games.filter((game) => game.id !== gameIdToDelete),
        });
        return jsonResponse(state);
      }

      if (
        method === "POST" &&
        url.pathname === `/api/lobbies/${lobbyId}/games/reorder`
      ) {
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
          }),
        });
        return jsonResponse(state);
      }

      return jsonResponse({ error: { code: "not_found" } }, 404);
    }
  );
}

function expectWriteRequestsAreSafe() {
  for (const request of requests().filter((item) => item.method !== "GET")) {
    if (!request.url.endsWith("/verify")) {
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${managementCode}`
      );
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
      url: String(input),
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
      updatedAt: now,
    },
    games: state.games.map((game, position) => ({
      ...game,
      position,
      updatedAt: now,
    })),
    version: nextVersion,
    updatedAt: now,
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
      {
        id: secondGameId,
        lobbyId,
        title: "Tetris",
        position: 1,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    version: 1,
    updatedAt: now,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
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
