import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createDemoMatchSnapshot,
  createPublicMatchOverlaySurface,
} from "@gaming-gauntlet/contracts";

import { VideoOverlayApp } from "./video-overlay";

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the cheap overlay surface contract", async () => {
    const surface = createPublicMatchOverlaySurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    render(<VideoOverlayApp matchSlug="gauntlet-finals" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/gauntlet-finals/surface?view=overlay"
        ),
        expect.any(Object)
      );
    });
  });

  it("shows the overlay unavailable state on request failure", async () => {
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

    render(<VideoOverlayApp matchSlug="gauntlet-finals" />);

    await waitFor(() => {
      expect(
        screen.getByText(/the extension overlay feed is offline right now/i)
      ).toBeInTheDocument();
    });
  });
});
