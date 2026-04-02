import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createDemoMatchSnapshot,
  type ExtensionMatchSummary,
  createPublicMatchPageSurface,
} from "@gaming-gauntlet/contracts";

import { ConfigApp } from "./config";
import { LiveConfigApp } from "./live-config";
import { installTwitchHelperMock } from "./twitch.test-support";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ETag: 'W/"gauntlet-finals:2026-03-24T04:00:00.000Z:1"',
    },
    ...init,
  });
}

describe("ConfigApp", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    window.history.replaceState({}, "", "/config.html?mode=config");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the page surface preview for broadcaster config", async () => {
    const surface = createPublicMatchPageSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );
    const matches: ExtensionMatchSummary[] = [
      {
        id: "match_1",
        slug: "gauntlet-finals",
        title: "Gauntlet Finals",
        status: "live",
        boardRevision: 3,
        subscriptionHealth: "ready",
        targetWins: 3,
        players: [
          {
            id: "player_1",
            displayName: "PixelRiot",
            wins: 2,
          },
          {
            id: "player_2",
            displayName: "NovaRune",
            wins: 1,
          },
        ],
        updatedAt: "2026-03-24T04:00:00.000Z",
      },
    ];
    const twitch = installTwitchHelperMock();

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/api/extension/matches")) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            "x-extension-jwt": expect.any(String),
          })
        );
        return jsonResponse({ items: matches });
      }

      return jsonResponse(surface);
    });

    render(<ConfigApp />);
    act(() => {
      twitch.authorize();
    });

    expect(
      await screen.findByRole("heading", { name: /wire the extension/i })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/public/matches/gauntlet-finals/surface?view=page"),
        expect.any(Object)
      );
    });
  });

  it("saves broadcaster config through the twitch configuration service", async () => {
    const surface = createPublicMatchPageSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );
    const twitch = installTwitchHelperMock();

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/api/extension/matches")) {
        return jsonResponse({
          items: [
            {
              id: "match_1",
              slug: "gauntlet-finals",
              title: "Gauntlet Finals",
              status: "live",
              boardRevision: 3,
              subscriptionHealth: "ready",
              targetWins: 3,
              players: [
                {
                  id: "player_1",
                  displayName: "PixelRiot",
                  wins: 2,
                },
                {
                  id: "player_2",
                  displayName: "NovaRune",
                  wins: 1,
                },
              ],
              updatedAt: "2026-03-24T04:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse(surface);
    });

    render(<ConfigApp />);
    act(() => {
      twitch.authorize();
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /save broadcaster config/i })
    );

    await waitFor(() => {
      expect(twitch.configurationSetSpy).toHaveBeenCalledWith(
        "broadcaster",
        "1",
        JSON.stringify({
          version: 1,
          matchSlug: "gauntlet-finals",
        })
      );
    });
  });

  it("renders the live config entrypoint separately", async () => {
    const surface = createPublicMatchPageSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );
    const twitch = installTwitchHelperMock();
    window.history.replaceState(
      {},
      "",
      "/live_config.html?mode=dashboard"
    );

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/api/extension/matches")) {
        return jsonResponse({
          items: [
            {
              id: "match_1",
              slug: "gauntlet-finals",
              title: "Gauntlet Finals",
              status: "live",
              boardRevision: 3,
              subscriptionHealth: "ready",
              targetWins: 3,
              players: [
                {
                  id: "player_1",
                  displayName: "PixelRiot",
                  wins: 2,
                },
                {
                  id: "player_2",
                  displayName: "NovaRune",
                  wins: 1,
                },
              ],
              updatedAt: "2026-03-24T04:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse(surface);
    });

    render(<LiveConfigApp />);
    act(() => {
      twitch.authorize();
    });

    expect(
      await screen.findByRole("heading", { name: /tune the live extension/i })
    ).toBeInTheDocument();
  });
});
