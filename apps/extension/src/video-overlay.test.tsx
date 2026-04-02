import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  createPublicMatchOverlaySurface,
  createDemoMatchSnapshot,
} from "@gaming-gauntlet/contracts";

import { VideoOverlayApp } from "./video-overlay";
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

describe("VideoOverlayApp", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    window.__GG_TWITCH_RUNTIME__ = undefined;
    window.history.replaceState({}, "", "/video_overlay.html");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the cheap overlay surface contract from broadcaster config", async () => {
    const surface = createPublicMatchOverlaySurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );
    const twitch = installTwitchHelperMock();

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    render(<VideoOverlayApp />);
    act(() => {
      twitch.authorize();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/gauntlet-finals/surface?view=overlay"
        ),
        expect.any(Object)
      );
    });
  });

  it("falls back to query-string preview outside twitch helper", async () => {
    const surface = createPublicMatchOverlaySurface(
      createDemoMatchSnapshot({ slug: "query-preview" })
    );
    window.history.replaceState(
      {},
      "",
      "/video_overlay.html?slug=query-preview"
    );
    fetchMock.mockImplementation(async () => jsonResponse(surface));

    render(<VideoOverlayApp />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/query-preview/surface?view=overlay"
        ),
        expect.any(Object)
      );
    });
  });

  it("shows the overlay unavailable state on request failure", async () => {
    const twitch = installTwitchHelperMock();
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        {
          error: "match_not_found",
        },
        {
          status: 404,
        }
      )
    );

    render(<VideoOverlayApp />);
    act(() => {
      twitch.authorize();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/the extension overlay feed is offline right now/i)
      ).toBeInTheDocument();
    });
  });
});
