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
import type { PublicLobbyState } from "@gaming-gauntlet/core";

import App from "../App";
import { fetchPublicLobbyState, LobbyApiError } from "../lobby-api";
import type * as LobbyApi from "../lobby-api";
import { buildOverlayShareUrl, OVERLAYS } from "./catalog";

vi.mock("../lobby-api", async (importOriginal) => {
  const actual = await importOriginal<typeof LobbyApi>();

  return { ...actual, fetchPublicLobbyState: vi.fn() };
});

const fetchPublicLobbyStateMock = vi.mocked(fetchPublicLobbyState);

const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const secondGameId = "game_def567abc234";
const managementCode = "GG-AAAA-BBBB-CCCC";
const now = "2026-05-30T12:00:00.000Z";
let clipboardWriteMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchPublicLobbyStateMock.mockReset();
  fetchPublicLobbyStateMock.mockResolvedValue({
    status: "modified",
    state: publicLobbyState(),
    etag: "etag-1",
  });

  clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteMock },
  });

  // jsdom has no ResizeObserver; OverlayPreview's scaler relies on it.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

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

function renderSurface() {
  return render(<App initialPath={`/g/${lobbyId}/obs`} />);
}

function cardFor(slug: string): HTMLElement {
  const overlay = OVERLAYS.find((entry) => entry.slug === slug);

  if (!overlay) {
    throw new Error(`Unknown overlay slug: ${slug}`);
  }

  const button = screen.getByRole("button", {
    name: `Copy ${overlay.name} URL`,
  });
  const card = button.closest(".gg-overlay-card");

  if (!(card instanceof HTMLElement)) {
    throw new Error(`No card found for ${slug}`);
  }

  return card;
}

describe("Phase 9 Add to OBS surface", () => {
  test("is reached from /g/:lobbyId/obs and renders the gallery, not the placeholder", async () => {
    renderSurface();

    expect(await screen.findByText("Add to OBS")).toBeInTheDocument();
    // The Phase 8 placeholder advertised the unbuilt surface; it must be gone.
    expect(
      screen.queryByText(/Overlays surface arrives in Phase 9/i)
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("overlay-hub-v1")).toBeInTheDocument();
  });

  test("offers a back link to the match room", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    const backLink = screen.getByRole("link", { name: /Back to match/i });

    expect(backLink).toHaveAttribute("href", `/g/${lobbyId}`);
  });

  test("renders a live preview + Copy URL button for every catalog overlay", async () => {
    const { container } = renderSurface();

    await screen.findByText("Add to OBS");

    for (const overlay of OVERLAYS) {
      const card = cardFor(overlay.slug);

      // The live preview reuses the overlay root with the active theme class.
      expect(card.querySelector(".gg-ov")).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: `Copy ${overlay.name} URL` })
      ).toBeInTheDocument();
    }

    // One card per catalog entry — new overlays are covered automatically.
    expect(container.querySelectorAll(".gg-overlay-card")).toHaveLength(
      OVERLAYS.length
    );
  });

  test("shows the recommended W × H on each card", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    for (const overlay of OVERLAYS) {
      const card = cardFor(overlay.slug);

      expect(
        within(card).getByText(`${overlay.w} × ${overlay.h}`)
      ).toBeInTheDocument();
    }
  });

  test("copies a theme-free /overlay URL with no secret for the default theme", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    fireEvent.click(screen.getByRole("button", { name: "Copy Top Bar URL" }));

    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalledTimes(1));

    const copied = clipboardWriteMock.mock.calls[0]?.[0] as string;

    expect(copied).toBe(`https://gaming-gauntlet.com/overlay/${lobbyId}/top`);
    expect(copied).not.toContain("theme=");
    expect(copied).not.toMatch(/managementCode|code=|token|secret/i);
  });

  test("bakes the selected theme into the copied URL and re-skins the previews", async () => {
    const { container } = renderSurface();

    await screen.findByText("Add to OBS");

    fireEvent.change(screen.getByLabelText("Overlay theme"), {
      target: { value: "blast" },
    });

    await waitFor(() =>
      expect(container.querySelector(".gg-ov--blast")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Top Bar URL" }));

    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalled());

    const copied = clipboardWriteMock.mock.calls.at(-1)?.[0] as string;

    expect(copied).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top?theme=blast`
    );
    expect(copied).toContain("theme=blast");
    expect(copied).not.toMatch(/managementCode|code=|token|secret/i);
  });

  test("bakes the selected background opacity into the copied URL", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    fireEvent.change(screen.getByLabelText("Overlay background opacity"), {
      target: { value: "65" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy Top Bar URL" }));

    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalled());

    const copied = clipboardWriteMock.mock.calls.at(-1)?.[0] as string;

    expect(copied).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top?bg=65`
    );
    expect(copied).not.toMatch(/managementCode|code=|token|secret/i);
  });

  test("shows a transient Copied! state on the clicked card only", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    const button = screen.getByRole("button", { name: "Copy Top Bar URL" });

    fireEvent.click(button);

    await screen.findByText("Copied!");
    expect(await screen.findByText("Top Bar URL copied.")).toBeInTheDocument();
    // A different card keeps its default label.
    expect(
      screen.getByRole("button", { name: "Copy Corner Bug URL" })
    ).toHaveTextContent("Copy URL");
  });

  test("surfaces a Copy failed state when the clipboard write rejects", async () => {
    clipboardWriteMock.mockRejectedValue(new Error("blocked"));

    renderSurface();

    await screen.findByText("Add to OBS");

    fireEvent.click(screen.getByRole("button", { name: "Copy Top Bar URL" }));

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(
      await screen.findByText("Top Bar URL could not be copied.")
    ).toBeInTheDocument();
  });

  test("renders no management controls and never leaks a passcode or secret", async () => {
    const { container } = renderSurface();

    await screen.findByText("Add to OBS");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(managementCode);
    expect(container.innerHTML).not.toMatch(
      /managementCode|managementCodeHash|secret|token/i
    );
  });

  test("renders setup and troubleshooting instructions", async () => {
    renderSurface();

    await screen.findByText("Add to OBS");

    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Troubleshooting")).toBeInTheDocument();
    expect(screen.getByText(/Right-click the source/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Remove any color source behind it/i)
    ).toBeInTheDocument();
  });

  test("shows a not-found notice but still renders the gallery shell", async () => {
    fetchPublicLobbyStateMock.mockRejectedValue(
      new LobbyApiError("Lobby not found.", 404)
    );

    const { container } = renderSurface();

    // The status shows in the top notice and in every preview placeholder.
    await waitFor(() =>
      expect(container.querySelector(".gg-notice")).toHaveTextContent(
        "Match not found."
      )
    );
    // The gallery + instructions still render so the page stays usable.
    expect(screen.getByText("Add to OBS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Top Bar URL" })
    ).toBeInTheDocument();
  });
});

describe("buildOverlayShareUrl", () => {
  test("omits the theme param for the default theme", () => {
    expect(buildOverlayShareUrl(lobbyId, "top", "default")).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top`
    );
  });

  test("appends ?theme= for a non-default theme", () => {
    expect(buildOverlayShareUrl(lobbyId, "top", "blast")).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top?theme=blast`
    );
  });

  test("appends ?bg= when background opacity is not default", () => {
    expect(buildOverlayShareUrl(lobbyId, "top", "default", 65)).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top?bg=65`
    );
    expect(buildOverlayShareUrl(lobbyId, "top", "blast", 65)).toBe(
      `https://gaming-gauntlet.com/overlay/${lobbyId}/top?theme=blast&bg=65`
    );
  });

  test("encodes path segments", () => {
    const url = buildOverlayShareUrl("lob a/b", "vs intro", "default");

    expect(url).toBe(
      "https://gaming-gauntlet.com/overlay/lob%20a%2Fb/vs%20intro"
    );
  });
});

function publicLobbyState(): PublicLobbyState {
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
  } as PublicLobbyState;
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
