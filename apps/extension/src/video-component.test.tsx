import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import {
  createPublicMatchComponentSurface,
  createDemoMatchSnapshot,
} from "@gaming-gauntlet/contracts";

import { VideoComponentApp } from "./video-component";

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

describe("VideoComponentApp", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    window.__GG_TWITCH_RUNTIME__ = undefined;
    window.history.replaceState({}, "", "/video_component.html");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the read-only component surface", async () => {
    const surface = createPublicMatchComponentSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );
    window.history.replaceState(
      {},
      "",
      "/video_component.html?slug=gauntlet-finals"
    );

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    render(<VideoComponentApp />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/gauntlet-finals/surface?view=component"
        ),
        expect.any(Object)
      );
    });
  });
});
