import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { DashboardPage } from "./dashboard-page";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

describe("DashboardPage", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the signed-out Twitch auth gate", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: false, user: null, ownedChannel: null }));

    renderDashboard();

    expect(await screen.findByRole("button", { name: /sign in with twitch/i })).toBeInTheDocument();
    expect(screen.getByText(/lock the command deck to real twitch channels/i)).toBeInTheDocument();
  });

  it("shows pending invite state and validates match creation inline until a pair is active", async () => {
    mockAuthenticatedFetches(fetchMock, {
      links: [
        {
          id: "link_1",
          status: "pending",
          pairKey: null,
          createdAt: "2026-03-24T04:00:00.000Z",
          updatedAt: "2026-03-24T04:00:00.000Z",
          ownerChannel: {
            id: "channel_1",
            twitchChannelId: "1001",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          linkedChannel: null,
          invitedChannelLogin: "novarune",
          memberships: [
            {
              id: "membership_1",
              role: "owner",
              createdAt: "2026-03-24T04:00:00.000Z",
              user: {
                id: "user_1",
                twitchUserId: "1001",
                login: "pixelriot",
                displayName: "PixelRiot"
              },
              channel: {
                id: "channel_1",
                twitchChannelId: "1001",
                login: "pixelriot",
                displayName: "PixelRiot"
              }
            }
          ],
          pendingInvite: {
            code: "invite_demo",
            shareUrl: "http://localhost:5173/link/invite_demo",
            invitedChannelLogin: "novarune",
            expiresAt: "2026-03-25T04:00:00.000Z",
            claimedAt: null
          }
        }
      ],
      matches: [],
      audit: []
    });

    renderDashboard();

    expect(await screen.findByRole("button", { name: /create match draft/i })).toBeInTheDocument();
    expect(screen.getByText(/24h invite window/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create match draft/i }));
    expect(await screen.findByText(/activate a broadcaster pair before creating a match/i)).toBeInTheDocument();
  });

  it("creates a match and refreshes the draft list", async () => {
    mockAuthenticatedFetches(fetchMock, {
      links: [
        {
          id: "link_1",
          status: "active",
          pairKey: "channel_1:channel_2",
          createdAt: "2026-03-24T04:00:00.000Z",
          updatedAt: "2026-03-24T04:00:00.000Z",
          ownerChannel: {
            id: "channel_1",
            twitchChannelId: "1001",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          linkedChannel: {
            id: "channel_2",
            twitchChannelId: "1002",
            login: "novarune",
            displayName: "NovaRune"
          },
          invitedChannelLogin: "novarune",
          memberships: [],
          pendingInvite: null
        }
      ],
      matches: [],
      audit: []
    }, 1);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        match: {
          id: "match_1",
          channelLinkId: "link_1",
          slug: "gauntlet-finals",
          title: "Gauntlet Finals",
          status: "draft",
          targetWins: 5,
          players: [],
          createdAt: "2026-03-24T04:00:00.000Z",
          updatedAt: "2026-03-24T04:00:00.000Z"
        }
      }, { status: 201 })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "match_1",
            channelLinkId: "link_1",
            slug: "gauntlet-finals",
            title: "Gauntlet Finals",
            status: "draft",
            targetWins: 5,
            players: [
              {
                id: "player_1",
                displayName: "PixelRiot",
                channelId: "channel_1",
                channelLogin: "pixelriot",
                role: "streamer",
                wins: 0
              },
              {
                id: "player_2",
                displayName: "NovaRune",
                channelId: "channel_2",
                channelLogin: "novarune",
                role: "streamer",
                wins: 0
              }
            ],
            createdAt: "2026-03-24T04:00:00.000Z",
            updatedAt: "2026-03-24T04:00:00.000Z"
          }
        ]
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "audit_1",
            createdAt: "2026-03-24T04:05:00.000Z",
            action: "match.created",
            actor: {
              id: "user_1",
              login: "pixelriot",
              displayName: "PixelRiot"
            },
            channelLinkId: "link_1",
            channelPairLabel: "@pixelriot vs @novarune",
            matchId: "match_1",
            matchTitle: "Gauntlet Finals",
            payload: {
              slug: "gauntlet-finals"
            }
          }
        ]
      })
    );

    renderDashboard();

    expect(await screen.findByRole("button", { name: /create match draft/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/match title/i), {
      target: { value: "Gauntlet Finals" }
    });
    fireEvent.change(screen.getByLabelText(/target wins/i), {
      target: { value: "5" }
    });
    fireEvent.click(screen.getByRole("button", { name: /create match draft/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/matches"),
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    expect(await screen.findByText(/match created and added to the draft rail/i)).toBeInTheDocument();
    expect(screen.getByText("Gauntlet Finals")).toBeInTheDocument();
    expect(screen.getByText(/created gauntlet finals for @pixelriot vs @novarune/i)).toBeInTheDocument();
  });

  it("surfaces the signed-in moderator assignment error", async () => {
    mockAuthenticatedFetches(fetchMock, {
      links: [
        {
          id: "link_1",
          status: "active",
          pairKey: "channel_1:channel_2",
          createdAt: "2026-03-24T04:00:00.000Z",
          updatedAt: "2026-03-24T04:00:00.000Z",
          ownerChannel: {
            id: "channel_1",
            twitchChannelId: "1001",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          linkedChannel: {
            id: "channel_2",
            twitchChannelId: "1002",
            login: "novarune",
            displayName: "NovaRune"
          },
          invitedChannelLogin: "novarune",
          memberships: [],
          pendingInvite: null
        }
      ],
      matches: [],
      audit: []
    }, 1);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "moderator_not_signed_in"
        },
        { status: 404 }
      )
    );

    renderDashboard();

    expect(await screen.findByRole("button", { name: /assign mod/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/add verified moderator/i), {
      target: { value: "trustedmod" }
    });
    fireEvent.click(screen.getByRole("button", { name: /assign mod/i }));

    expect(await screen.findByText(/has not signed in with twitch yet/i)).toBeInTheDocument();
  });

  it("renders the recent activity panel when audit items are present", async () => {
    mockAuthenticatedFetches(fetchMock, {
      links: [],
      matches: [],
      audit: [
        {
          id: "audit_1",
          createdAt: "2026-03-24T04:00:00.000Z",
          action: "channel_link.created",
          actor: {
            id: "user_1",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          channelLinkId: "link_1",
          channelPairLabel: "@pixelriot vs @novarune",
          matchId: null,
          matchTitle: null,
          payload: {
            invitedChannelLogin: "novarune"
          }
        }
      ]
    });

    renderDashboard();

    expect(await screen.findByText(/phase 2 audit trail/i)).toBeInTheDocument();
    expect(screen.getByText(/created an invite for @pixelriot vs @novarune/i)).toBeInTheDocument();
  });

  it("shows inline validation and focuses the first invalid field for match creation", async () => {
    mockAuthenticatedFetches(fetchMock, {
      links: [
        {
          id: "link_1",
          status: "active",
          pairKey: "channel_1:channel_2",
          createdAt: "2026-03-24T04:00:00.000Z",
          updatedAt: "2026-03-24T04:00:00.000Z",
          ownerChannel: {
            id: "channel_1",
            twitchChannelId: "1001",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          linkedChannel: {
            id: "channel_2",
            twitchChannelId: "1002",
            login: "novarune",
            displayName: "NovaRune"
          },
          invitedChannelLogin: "novarune",
          memberships: [],
          pendingInvite: null
        }
      ],
      matches: [],
      audit: []
    });

    renderDashboard();

    expect(await screen.findByRole("button", { name: /create match draft/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create match draft/i }));

    const error = await screen.findByText(/enter a match title with at least 3 characters/i);
    expect(error.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByLabelText(/match title/i)).toHaveFocus();
  });
});

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockAuthenticatedFetches(
  fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>,
  payload: {
    links: unknown[];
    matches: unknown[];
    audit: unknown[];
  },
  rounds = 2
) {
  for (let index = 0; index < rounds; index += 1) {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authenticated: true,
        user: {
          id: "user_1",
          twitchUserId: "1001",
          login: "pixelriot",
          displayName: "PixelRiot"
        },
        ownedChannel: {
          id: "channel_1",
          twitchChannelId: "1001",
          login: "pixelriot",
          displayName: "PixelRiot"
        }
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: payload.links }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: payload.matches }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: payload.audit }));
  }
}
