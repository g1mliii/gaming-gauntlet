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

import App from "./App";
import { getManagementPasscodeStorageKey } from "./management-passcodes";
import { navigateTo } from "./navigation";
import { FORBIDDEN_URL_PARAM_NAMES, V1_ROUTE_DEFINITIONS } from "./routes";

vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));

const lobbyId = "lob_abc234def567";
const oldLobbyId = "lob_old234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const managementCode = "GG-AAAA-BBBB-CCCC";
const oldManagementCode = "GG-ZZZZ-ZZZZ-ZZZZ";
const now = "2026-05-30T12:00:00.000Z";
let fetchMock: ReturnType<typeof vi.fn>;
let clipboardWriteMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteMock,
    },
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(navigateTo).mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Phase 1 V1 routes", () => {
  test("renders the create page at the root URL", () => {
    render(<App initialPath="/" />);

    expect(screen.getByTestId("create-v1")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Create lobby" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Player 1 name")).toBeInTheDocument();
  });

  test.each([
    ["/", "create-v1", "Create lobby"],
    ["/create", "create-v1", "Create lobby"],
    [`/manage/${lobbyId}`, "manage-v1", "Locked"],
    [`/g/${lobbyId}`, "game-v1", "Locked"],
    [`/g/${lobbyId}/obs`, "overlay-hub-v1", "Add to OBS"],
  ])(
    "renders %s without a Twitch login gate",
    async (path, routeId, heading) => {
      fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

      const { container } = render(<App initialPath={path} />);

      expect(screen.getByTestId(routeId)).toBeInTheDocument();
      expect(
        await screen.findByRole("heading", { name: heading })
      ).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/twitch|oauth|login/i);
    }
  );

  test("renders the OBS overlay route from live state without a login gate", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(
      <App initialPath={`/overlay/${lobbyId}/top`} />
    );

    expect(screen.getByTestId("overlay-v1")).toBeInTheDocument();
    expect(await screen.findByText("Rocket League")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/twitch|oauth|login/i);
  });

  test("uses only safe route params for V1 paths", () => {
    const forbidden = new Set<string>(FORBIDDEN_URL_PARAM_NAMES);

    for (const route of V1_ROUTE_DEFINITIONS) {
      expect(route.paramNames.some((name) => forbidden.has(name))).toBe(false);
      expect(
        FORBIDDEN_URL_PARAM_NAMES.some((name) =>
          route.pattern.toLowerCase().includes(`:${name.toLowerCase()}`)
        )
      ).toBe(false);
    }
  });

  test("does not show route shortcuts in the top navigation", () => {
    render(<App initialPath="/create" />);

    const primaryNav = screen.getByRole("navigation", { name: "Primary" });

    expect(
      within(primaryNav).getByRole("link", { name: "Gaming Gauntlet" })
    ).toHaveAttribute("href", "/");
    expect(
      within(primaryNav).queryByRole("link", { name: "Create" })
    ).not.toBeInTheDocument();
    expect(
      within(primaryNav).queryByRole("link", { name: "Match" })
    ).not.toBeInTheDocument();
    expect(
      within(primaryNav).queryByRole("link", { name: "Overlay" })
    ).not.toBeInTheDocument();
  });

  test("does not render the retired route-shortcut landing screen", () => {
    const { container } = render(<App initialPath="/" />);

    expect(
      screen.queryByRole("link", { name: "/g/:lobbyId" })
    ).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("V1 baseline");
    expect(container).not.toHaveTextContent("App shell");
    expect(container).not.toHaveTextContent("/manage/:lobbyId");
  });

  test("match room does not surface a separate management URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(<App initialPath={`/g/${lobbyId}`} />);

    expect(
      await screen.findByRole("heading", { name: "Locked" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Manage this match" })
    ).not.toBeInTheDocument();

    for (const link of Array.from(container.querySelectorAll("a"))) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/\/manage\//);
      expect(link.getAttribute("href") ?? "").not.toMatch(/code|token|secret/i);
    }
  });

  test("ignores unsafe query parameters in route rendering", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(
      <App
        initialPath={`/manage/${lobbyId}?managementCode=abc123&token=secret456`}
      />
    );

    expect(screen.getByTestId("manage-v1")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Locked" })
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("abc123");
    expect(container).not.toHaveTextContent("secret456");
  });

  test("scrubs unsafe query parameters from the live browser URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));
    window.history.pushState(
      null,
      "",
      `/g/${lobbyId}?managementCode=abc123&token=secret456&view=mod#room`
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Locked" })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/g/${lobbyId}`);
    expect(window.location.search).toBe("?view=mod");
    expect(window.location.hash).toBe("#room");
  });
});

describe("Phase 5 create and join flow", () => {
  test("creates a lobby, stores the passcode, and redirects into the match room", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lobbyId,
        managementCode,
      })
    );

    const { container } = render(<App initialPath="/" />);
    const storageKey = getManagementPasscodeStorageKey(lobbyId);
    const oldStorageKey = getManagementPasscodeStorageKey(oldLobbyId);

    window.localStorage.setItem(oldStorageKey, oldManagementCode);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    fireEvent.change(screen.getByLabelText("Player 1 name"), {
      target: { value: "  Alice  " },
    });
    fireEvent.change(screen.getByLabelText("Player 2 name"), {
      target: { value: "Bob" },
    });
    fireEvent.change(screen.getByLabelText("Starting games (optional)"), {
      target: { value: " Rocket League \n\n Tetris \n Chess " },
    });
    fireEvent.change(screen.getByLabelText("Target score (optional)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create match" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("/api/lobbies");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris", "Chess"],
      targetScore: 5,
    });
    expect(window.localStorage.getItem(storageKey)).toBe(managementCode);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(window.localStorage.getItem(oldStorageKey)).toBeNull();
    // No interstitial — the create page hands off straight to the match room
    // and never paints the passcode itself.
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(`/g/${lobbyId}`)
    );
    expect(container).not.toHaveTextContent(managementCode);
  });

  test("omits optional starting games and target score when they are blank", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lobbyId,
        managementCode,
      })
    );

    render(<App initialPath="/create" />);

    fireEvent.change(screen.getByLabelText("Player 1 name"), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByLabelText("Player 2 name"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create match" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(String(options.body))).toEqual({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });
    expect(
      window.localStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBe(managementCode);
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(`/g/${lobbyId}`)
    );
  });

  test.each([
    ["raw lobby id", lobbyId],
    ["relative match URL", `/g/${lobbyId}`],
    ["full match URL", `https://gaming-gauntlet.com/g/${lobbyId}?code=ignored`],
  ])("joins an existing match from a %s", async (_label, matchReference) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<App initialPath="/create" />);
    const storageKey = getManagementPasscodeStorageKey(lobbyId);
    const oldStorageKey = getManagementPasscodeStorageKey(oldLobbyId);

    window.localStorage.setItem(oldStorageKey, oldManagementCode);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    fireEvent.change(screen.getByLabelText("Match URL or ID"), {
      target: { value: matchReference },
    });
    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: managementCode },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify passcode" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(`/api/lobbies/${lobbyId}/verify`);
    expect(url).not.toMatch(/[?&].*(code|token|secret|management)/i);
    expect(JSON.parse(String(options.body))).toEqual({ managementCode });
    expect(window.localStorage.getItem(storageKey)).toBe(managementCode);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(window.localStorage.getItem(oldStorageKey)).toBeNull();
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(`/g/${lobbyId}`)
    );
  });

  test("failed join verification does not store the passcode or redirect", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "invalid_management_code",
            message: "Management passcode is invalid.",
          },
        },
        401
      )
    );

    render(<App initialPath="/create" />);

    fireEvent.change(screen.getByLabelText("Match URL or ID"), {
      target: { value: `/g/${lobbyId}` },
    });
    fireEvent.change(screen.getByLabelText("Management passcode"), {
      target: { value: managementCode },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify passcode" }));

    expect(
      await screen.findByText("Management passcode is invalid.")
    ).toBeInTheDocument();
    expect(
      window.localStorage.getItem(getManagementPasscodeStorageKey(lobbyId))
    ).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test("shows a resume banner linking to the active match when a passcode is stored", () => {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );

    render(<App initialPath="/" />);

    const resumeLink = screen.getByRole("link", { name: "Resume match" });

    expect(resumeLink).toHaveAttribute("href", `/g/${lobbyId}`);
    expect(resumeLink.getAttribute("href")).not.toMatch(
      /code|token|secret|management/i
    );
  });

  test("shows no resume banner when no passcode is stored", () => {
    render(<App initialPath="/" />);

    expect(
      screen.queryByRole("link", { name: "Resume match" })
    ).not.toBeInTheDocument();
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
