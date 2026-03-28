import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createDemoMatchSnapshot,
  createPublicMatchPageSurface,
} from "@gaming-gauntlet/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { MatchPage } from "./match-page";

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

describe("MatchPage", () => {
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

  it("loads the broadcast-first page surface from the slim public route", async () => {
    const surface = createPublicMatchPageSurface(
      createDemoMatchSnapshot({ slug: "gauntlet-finals" })
    );

    fetchMock.mockImplementation(async () => jsonResponse(surface));

    renderMatchPage("/matches/gauntlet-finals");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/public/matches/gauntlet-finals/surface?view=page"
        ),
        expect.objectContaining({
          credentials: "omit",
        })
      );
    });
  });

  it("shows the public error state when the page surface cannot be loaded", async () => {
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

    renderMatchPage("/matches/gauntlet-finals");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /live match unavailable/i })
      ).toBeInTheDocument();
      expect(
        screen.getByText(/that match could not be found/i)
      ).toBeInTheDocument();
    });
  });
});

function renderMatchPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/matches/:slug" element={<MatchPage />} />
      </Routes>
    </MemoryRouter>
  );
}
