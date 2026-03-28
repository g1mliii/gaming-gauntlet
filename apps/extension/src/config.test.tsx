import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createDemoMatchSnapshot,
  createPublicMatchPageSurface,
} from "@gaming-gauntlet/contracts";

import { ConfigApp } from "./config";

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the page surface preview for broadcaster config", async () => {
    const surface = createPublicMatchPageSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    render(<ConfigApp matchSlug="gauntlet-finals" />);

    expect(
      await screen.findByRole("heading", { name: /wire the overlay/i })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/public/matches/gauntlet-finals/surface?view=page"),
        expect.any(Object)
      );
    });
  });
});
