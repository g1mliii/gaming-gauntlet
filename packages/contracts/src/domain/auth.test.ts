import {
  addChannelLinkMemberRequestSchema,
  authSessionSchema,
  canCreateBroadcasterInvite,
  canCreateMatches,
  canManageModerators,
  channelLinkSummarySchema,
  inviteStatusSchema
} from "./auth";

describe("auth contracts", () => {
  it("parses an authenticated session payload", () => {
    const session = authSessionSchema.parse({
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
    });

    expect(session.authenticated).toBe(true);
    expect(session.user?.login).toBe("pixelriot");
  });

  it("parses channel links with memberships and pending invites", () => {
    const link = channelLinkSummarySchema.parse({
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
      },
      chatIntegration: {
        ownerAuthorized: true,
        linkedAuthorized: false,
        status: "needs_consent"
      }
    });

    expect(link.pendingInvite?.invitedChannelLogin).toBe("novarune");
    expect(link.memberships).toHaveLength(1);
  });

  it("requires moderator assignments to target signed-in logins", () => {
    expect(() =>
      addChannelLinkMemberRequestSchema.parse({
        login: "Not Valid",
        role: "mod"
      })
    ).toThrow();
  });

  it("parses invite statuses", () => {
    const invite = inviteStatusSchema.parse({
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
    });

    expect(invite.status).toBe("pending");
  });

  it("encodes the phase-2 permission model", () => {
    expect(canCreateBroadcasterInvite("owner")).toBe(true);
    expect(canCreateBroadcasterInvite("streamer")).toBe(false);
    expect(canManageModerators("owner")).toBe(true);
    expect(canManageModerators("streamer")).toBe(true);
    expect(canManageModerators("mod")).toBe(false);
    expect(canCreateMatches("owner")).toBe(true);
    expect(canCreateMatches("streamer")).toBe(true);
    expect(canCreateMatches("mod")).toBe(true);
  });
});
