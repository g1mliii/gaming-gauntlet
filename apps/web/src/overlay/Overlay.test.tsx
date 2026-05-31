import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../App";
import { OVERLAYS } from "./catalog";

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const managementCode = "GG-AAAA-BBBB-CCCC";
const now = "2026-05-30T12:00:00.000Z";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setMatchMedia(false);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
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

describe("Phase 8 OBS overlays", () => {
  test.each(OVERLAYS.map((overlay) => overlay.slug))(
    "renders the %s overlay from live public state",
    async (slug) => {
      fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

      render(<App initialPath={`/overlay/${lobbyId}/${slug}`} />);

      const root = await screen.findByTestId("overlay-v1");

      expect(root).toHaveAttribute("data-variant", slug);
      await waitFor(() =>
        expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
      );
    }
  );

  test("polls only the public state endpoint (no writes or verifies)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    render(<App initialPath={`/overlay/${lobbyId}/top`} />);

    await screen.findByText("Rocket League");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    for (const call of fetchMock.mock.calls) {
      const [url, options] = call as [string, RequestInit | undefined];

      expect(url).toBe(`/api/lobbies/${lobbyId}/state`);
      expect(options?.method ?? "GET").toBe("GET");
      const authHeader = new Headers(options?.headers).get("authorization");

      expect(authHeader).toBeNull();
    }
  });

  test("renders no management controls and never leaks secrets", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(
      <App initialPath={`/overlay/${lobbyId}/full`} />
    );

    await screen.findByText("Friday Night Gauntlet");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(managementCode);
    expect(container.innerHTML).not.toMatch(
      /managementCode|managementCodeHash|secret|token/i
    );
  });

  test("shows a safe error state for an unknown lobby (404)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "lobby_not_found", message: "Lobby not found." } },
        404
      )
    );

    render(<App initialPath="/overlay/lob_doesnotexist0/top" />);

    expect(await screen.findByText("Match not found.")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-v1")).toBeInTheDocument();
  });

  test("shows an empty state when the game pool is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse(emptyLobbyState()));

    render(<App initialPath={`/overlay/${lobbyId}/square`} />);

    expect(await screen.findByText("Waiting for games.")).toBeInTheDocument();
  });

  test("shows an unknown-overlay state for an invalid variant", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    render(<App initialPath={`/overlay/${lobbyId}/not-a-real-overlay`} />);

    expect(await screen.findByText("Unknown overlay.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("applies the theme skin and scale from safe query params", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    render(
      <App initialPath={`/overlay/${lobbyId}/top?theme=blast&scale=1.5`} />
    );

    const root = await screen.findByTestId("overlay-v1");

    expect(root).toHaveClass("gg-ov--blast");
    expect(root.style.getPropertyValue("--ov-scale")).toBe("1.5");
  });

  test("defaults to full scale when no scale param is present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    render(<App initialPath={`/overlay/${lobbyId}/top`} />);

    const root = await screen.findByTestId("overlay-v1");

    expect(root.style.getPropertyValue("--ov-scale")).toBe("1");
  });

  test("renders the series bar layout with a series tracker and the arena theme", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(
      <App initialPath={`/overlay/${lobbyId}/series-bar?theme=arena`} />
    );

    const root = await screen.findByTestId("overlay-v1");

    expect(root).toHaveClass("gg-ov--arena");
    expect(root).toHaveAttribute("data-variant", "series-bar");
    await screen.findByText("Rocket League");
    // targetScore is 5 → a 5-pip series tracker per team renders.
    expect(container.querySelectorAll(".ov-series__pip")).toHaveLength(10);
  });

  test("series bar shows no pips and an open-match label when there is no target", async () => {
    fetchMock.mockResolvedValue(jsonResponse(openLobbyState()));

    const { container } = render(
      <App initialPath={`/overlay/${lobbyId}/series-bar`} />
    );

    await screen.findByText("Rocket League");
    expect(screen.getByText("Open match")).toBeInTheDocument();
    expect(container.querySelectorAll(".ov-series__pip")).toHaveLength(0);
  });

  test("clamps an out-of-range scale and ignores an unknown theme", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    render(
      <App initialPath={`/overlay/${lobbyId}/top?theme=bogus&scale=99`} />
    );

    const root = await screen.findByTestId("overlay-v1");

    expect(root).toHaveClass("gg-ov--default");
    expect(root.style.getPropertyValue("--ov-scale")).toBe("3");
  });

  test("ignores unsafe query params without leaking them into the DOM", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(
      <App
        initialPath={`/overlay/${lobbyId}/top?token=secret123&managementCode=leakme&theme=iem`}
      />
    );

    const root = await screen.findByTestId("overlay-v1");

    // The safe param still applies; the unsafe ones never reach the DOM.
    expect(root).toHaveClass("gg-ov--iem");
    expect(container).not.toHaveTextContent("secret123");
    expect(container).not.toHaveTextContent("leakme");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
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

function openLobbyState() {
  return {
    ...publicLobbyState(),
    lobby: {
      ...publicLobbyState().lobby,
      targetScore: null,
    },
  };
}

function emptyLobbyState() {
  return {
    lobby: {
      id: lobbyId,
      title: "Friday Night Gauntlet",
      playerOneName: "NOVA",
      playerTwoName: "RIPTIDE",
      playerOneScore: 0,
      playerTwoScore: 0,
      targetScore: null,
      status: "ready",
      currentGameId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    games: [],
    version: 1,
    updatedAt: now,
  };
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
