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
import { FORBIDDEN_URL_PARAM_NAMES, V1_ROUTE_DEFINITIONS } from "./routes";

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const managementCode = "GG-AAAA-BBBB-CCCC";
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
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteMock,
    },
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
    [`/overlay/${lobbyId}/top`, "overlay-top-v1", lobbyId],
  ])("renders %s without a Twitch login gate", async (path, routeId, heading) => {
    fetchMock.mockResolvedValue(jsonResponse(publicLobbyState()));

    const { container } = render(<App initialPath={path} />);

    expect(screen.getByTestId(routeId)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: heading })
    ).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Locked" })).toBeInTheDocument();
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
      <App initialPath={`/manage/${lobbyId}?managementCode=abc123&token=secret456`} />
    );

    expect(screen.getByTestId("manage-v1")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Locked" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Locked" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/g/${lobbyId}`);
    expect(window.location.search).toBe("?view=mod");
    expect(window.location.hash).toBe("#room");
  });
});

describe("Phase 5 create and join flow", () => {
  test("creates a lobby, stores the returned passcode, and shows one clean match URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lobbyId,
        managementCode,
      })
    );

    const { container } = render(<App initialPath="/" />);
    const storageKey = getManagementPasscodeStorageKey(lobbyId);

    expect(window.localStorage.getItem(storageKey)).toBeNull();

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
    expect(screen.getAllByDisplayValue(`/g/${lobbyId}`)).toHaveLength(1);
    expect(container).not.toHaveTextContent(`/manage/${lobbyId}`);
    expect(container).not.toHaveTextContent(managementCode);

    const openMatchLink = screen.getByRole("link", { name: "Open match room" });
    const manageLink = screen.getByRole("link", { name: "Manage this match" });

    expect(openMatchLink).toHaveAttribute("href", `/g/${lobbyId}`);
    expect(manageLink).toHaveAttribute("href", `/g/${lobbyId}`);
    expect(cleanHref(openMatchLink)).not.toMatch(
      /code|token|secret|management/i
    );
    expect(cleanHref(manageLink)).not.toMatch(/code|token|secret|management/i);
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
  });

  test("reveals and copies the created passcode only after explicit clicks", async () => {
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

    await screen.findByDisplayValue(`/g/${lobbyId}`);

    expect(screen.queryByText(managementCode)).not.toBeInTheDocument();
    expect(clipboardWriteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    // Confirmation gate: passcode stays hidden until the streamer confirms.
    expect(screen.queryByText(managementCode)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy passcode" })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, reveal" }));

    expect(screen.getByText(managementCode)).toBeInTheDocument();
    expect(clipboardWriteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy passcode" }));

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith(managementCode);
    });
  });

  test("keeps the passcode hidden when the reveal confirmation is cancelled", async () => {
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

    await screen.findByDisplayValue(`/g/${lobbyId}`);

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(managementCode)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy passcode" })
    ).toBeDisabled();
  });

  test.each([
    ["raw lobby id", lobbyId],
    ["relative match URL", `/g/${lobbyId}`],
    ["full match URL", `https://gaminggauntlet.com/g/${lobbyId}?code=ignored`],
  ])("joins an existing match from a %s", async (_label, matchReference) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<App initialPath="/create" />);
    const storageKey = getManagementPasscodeStorageKey(lobbyId);

    expect(window.localStorage.getItem(storageKey)).toBeNull();

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
    expect(screen.getByText("Passcode verified.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open match room" })
    ).toHaveAttribute("href", `/g/${lobbyId}`);
    expect(
      screen.getByRole("link", { name: "Manage this match" })
    ).toHaveAttribute("href", `/g/${lobbyId}`);
  });

  test("copies the clean match URL from the share field", async () => {
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

    await screen.findByDisplayValue(`/g/${lobbyId}`);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith(`/g/${lobbyId}`);
    });
    expect(clipboardWriteMock).not.toHaveBeenCalledWith(managementCode);
  });

  test("failed join verification does not store the passcode", async () => {
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
  });

  test("result links never expose the management passcode", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lobbyId,
        managementCode,
      })
    );

    const { container } = render(<App initialPath="/create" />);

    fireEvent.change(screen.getByLabelText("Player 1 name"), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByLabelText("Player 2 name"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create match" }));

    await screen.findByDisplayValue(`/g/${lobbyId}`);

    for (const link of Array.from(container.querySelectorAll("a"))) {
      expect(link.getAttribute("href") ?? "").not.toContain(managementCode);
      expect(link.getAttribute("href") ?? "").not.toMatch(
        /code|token|secret|managementCode/i
      );
    }
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

function cleanHref(link: HTMLElement): string {
  return link.getAttribute("href") ?? "";
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
