import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createDemoMatchSnapshot,
  createPublicMatchOverlaySurface,
} from "@gaming-gauntlet/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { OverlayPage } from "./overlay-page";

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

describe("OverlayPage", () => {
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

  it("loads the slim overlay route and cleans up overlay classes on unmount", async () => {
    const surface = createPublicMatchOverlaySurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    const view = renderOverlayPage("/overlay/gauntlet-finals");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/gauntlet-finals/surface?view=overlay"
        ),
        expect.objectContaining({
          credentials: "omit",
        })
      );
    });
    expect(document.documentElement.classList.contains("gg-doc--overlay")).toBe(
      true
    );
    expect(document.body.classList.contains("gg-body--overlay")).toBe(true);

    view.unmount();

    expect(document.documentElement.classList.contains("gg-doc--overlay")).toBe(
      false
    );
    expect(document.body.classList.contains("gg-body--overlay")).toBe(false);
  });

  it("shows overlay errors inline", async () => {
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

    renderOverlayPage("/overlay/gauntlet-finals");

    await waitFor(() => {
      expect(
        screen.getByText(/that overlay match could not be found/i)
      ).toBeInTheDocument();
    });
  });
});

function renderOverlayPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/overlay/:slug" element={<OverlayPage />} />
      </Routes>
    </MemoryRouter>
  );
}
