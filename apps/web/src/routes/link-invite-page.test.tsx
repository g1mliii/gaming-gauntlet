import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { LinkInvitePage } from "./link-invite-page";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

describe("LinkInvitePage", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a Twitch continue CTA for signed-out invited broadcasters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authenticated: false,
        user: null,
        ownedChannel: null
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: "invite_demo",
        status: "pending",
        invitedChannelLogin: "novarune",
        ownerChannel: {
          id: "channel_1",
          twitchChannelId: "1001",
          login: "pixelriot",
          displayName: "PixelRiot"
        },
        claimedChannel: null,
        expiresAt: "2026-03-25T04:00:00.000Z"
      })
    );

    render(
      <MemoryRouter initialEntries={["/link/invite_demo"]}>
        <Routes>
          <Route path="/link/:inviteCode" element={<LinkInvitePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: /continue with twitch/i })).toBeInTheDocument();
    expect(screen.getByText(/finish twitch sign-in with the invited broadcaster account/i)).toBeInTheDocument();
  });
});
