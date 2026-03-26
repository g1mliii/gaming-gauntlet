import type { AuthSession, MatchSummary } from "@gaming-gauntlet/contracts";
import { createAuthState, createSessionCookieValue } from "./lib/auth";
import { handleRequest } from "./index";
import { hmacSha256Hex } from "./lib/crypto";
import { AppError } from "./lib/repository";

const {
  buildTwitchAuthorizeUrlMock,
  createRepositoryMock,
  exchangeAuthorizationCodeMock,
  fetchTwitchUserMock,
  normalizeScopeValueMock,
  validateAccessTokenMock,
  validateIdTokenMock,
} = vi.hoisted(() => ({
  buildTwitchAuthorizeUrlMock: vi.fn(),
  createRepositoryMock: vi.fn(),
  exchangeAuthorizationCodeMock: vi.fn(),
  fetchTwitchUserMock: vi.fn(),
  normalizeScopeValueMock: vi.fn((value: string[] | string | undefined) =>
    Array.isArray(value)
      ? value
      : typeof value === "string" && value.length > 0
        ? value.split(" ")
        : []
  ),
  validateAccessTokenMock: vi.fn(),
  validateIdTokenMock: vi.fn(),
}));

vi.mock("./lib/repository", async () => {
  const actual = await vi.importActual("./lib/repository");
  return {
    ...actual,
    createRepository: createRepositoryMock,
  };
});

vi.mock("./lib/twitch", async () => {
  const actual = await vi.importActual("./lib/twitch");
  return {
    ...actual,
    buildTwitchAuthorizeUrl: buildTwitchAuthorizeUrlMock,
    exchangeAuthorizationCode: exchangeAuthorizationCodeMock,
    fetchTwitchUser: fetchTwitchUserMock,
    normalizeScopeValue: normalizeScopeValueMock,
    validateAccessToken: validateAccessTokenMock,
    validateIdToken: validateIdTokenMock,
  };
});

type RepoMock = {
  acceptInvite: ReturnType<typeof vi.fn>;
  addModerator: ReturnType<typeof vi.fn>;
  createChannelLink: ReturnType<typeof vi.fn>;
  createMatch: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  ensureFreshTwitchToken: ReturnType<typeof vi.fn>;
  findSharedBotIdentity: ReturnType<typeof vi.fn>;
  getCompactBoardForUser: ReturnType<typeof vi.fn>;
  getInviteStatus: ReturnType<typeof vi.fn>;
  getMatchIdBySlug: ReturnType<typeof vi.fn>;
  getMatchSnapshot: ReturnType<typeof vi.fn>;
  getMatchSummaryForUser: ReturnType<typeof vi.fn>;
  getRoleForUser: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  listAuditLogForUser: ReturnType<typeof vi.fn>;
  listChannelLinksForUser: ReturnType<typeof vi.fn>;
  listMatchesForUser: ReturnType<typeof vi.fn>;
  removeModerator: ReturnType<typeof vi.fn>;
  updateMatchStatusForUser: ReturnType<typeof vi.fn>;
  upsertIdentity: ReturnType<typeof vi.fn>;
  writeAuditLog: ReturnType<typeof vi.fn>;
};

const env = {
  APP_ORIGIN: "http://localhost:5173",
  EXTENSION_ORIGIN: "http://localhost:5174",
  TWITCH_API_BASE: "https://api.twitch.tv/helix",
  TWITCH_CLIENT_ID: "client-id",
  TWITCH_CLIENT_SECRET: "client-secret",
  TWITCH_REDIRECT_URI: "http://localhost:8787/api/auth/twitch/callback",
  TWITCH_EVENTSUB_SECRET: "eventsub-secret",
  TWITCH_SHARED_BOT_LOGIN: "ggbot",
  TWITCH_BOT_ACCESS_TOKEN: "bot-access-token",
  TWITCH_BOT_REFRESH_TOKEN: "bot-refresh-token",
  SESSION_SECRET: "super-secret-session",
  TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  TWITCH_EXTENSION_SECRET: "extension-secret",
  DB: {} as D1Database,
  MATCH_COORDINATOR: {
    idFromName: vi.fn(),
    get: vi.fn(),
  } as unknown as DurableObjectNamespace,
  EVENT_INGEST_QUEUE: {} as Queue<unknown>,
};

function createRepoMock(): RepoMock {
  return {
    acceptInvite: vi.fn(),
    addModerator: vi.fn(),
    createChannelLink: vi.fn(),
    createMatch: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    ensureFreshTwitchToken: vi.fn(),
    findSharedBotIdentity: vi.fn(),
    getCompactBoardForUser: vi.fn(),
    getInviteStatus: vi.fn(),
    getMatchIdBySlug: vi.fn(),
    getMatchSnapshot: vi.fn(),
    getMatchSummaryForUser: vi.fn(),
    getRoleForUser: vi.fn(),
    getSession: vi.fn(),
    listAuditLogForUser: vi.fn(),
    listChannelLinksForUser: vi.fn(),
    listMatchesForUser: vi.fn(),
    removeModerator: vi.fn(),
    updateMatchStatusForUser: vi.fn(),
    upsertIdentity: vi.fn(),
    writeAuditLog: vi.fn(),
  };
}

function buildMatchSummary(
  overrides: Partial<MatchSummary> = {}
): MatchSummary {
  return {
    id: "match_1",
    channelLinkId: "link_1",
    slug: "gauntlet-finals",
    title: "Gauntlet Finals",
    status: "draft",
    chatState: "idle",
    chatEnabledUntil: null,
    boardRevision: 0,
    subscriptionHealth: "idle",
    targetWins: 3,
    players: [],
    createdAt: "2026-03-24T04:00:00.000Z",
    updatedAt: "2026-03-24T04:00:00.000Z",
    ...overrides,
  };
}

function signedInSession(): AuthSession {
  return {
    authenticated: true,
    user: {
      id: "user_1",
      twitchUserId: "1001",
      login: "pixelriot",
      displayName: "PixelRiot",
    },
    ownedChannel: {
      id: "channel_1",
      twitchChannelId: "1001",
      login: "pixelriot",
      displayName: "PixelRiot",
    },
  };
}

async function createSignedSessionCookie(sessionId: string): Promise<string> {
  const cookieValue = await createSessionCookieValue(sessionId, env);
  return `gg_session=${encodeURIComponent(cookieValue)}`;
}

async function createEventSubHeaders(
  bodyText: string
): Promise<Record<string, string>> {
  const messageId = "eventsub-message-1";
  const timestamp = new Date().toISOString();
  const signature = `sha256=${await hmacSha256Hex(`${messageId}${timestamp}${bodyText}`, env.TWITCH_EVENTSUB_SECRET)}`;

  return {
    "content-type": "application/json",
    "Twitch-Eventsub-Message-Id": messageId,
    "Twitch-Eventsub-Message-Timestamp": timestamp,
    "Twitch-Eventsub-Message-Signature": signature,
  };
}

describe("handleRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects invalid callback state back to the dashboard", async () => {
    createRepositoryMock.mockReturnValue(createRepoMock());

    const response = await handleRequest(
      new Request(
        "http://localhost:8787/api/auth/twitch/callback?code=demo&state=bad-state"
      ),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/dashboard?authError=invalid_state"
    );
  });

  it("starts shared bot auth with the bot-specific Twitch scopes", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    buildTwitchAuthorizeUrlMock.mockReturnValue(
      "https://id.twitch.tv/oauth2/authorize?client_id=client-id"
    );
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());

    const response = await handleRequest(
      new Request("http://localhost:8787/api/auth/twitch/login?intent=bot", {
        headers: {
          Cookie: cookie,
        },
      }),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://id.twitch.tv/oauth2/authorize?client_id=client-id"
    );
    expect(buildTwitchAuthorizeUrlMock).toHaveBeenCalledWith(
      env,
      expect.any(String),
      expect.any(String),
      ["openid", "user:bot", "user:read:chat", "user:write:chat"]
    );
  });

  it("completes Twitch login, creates a session cookie, and records auth.login", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const state = await createAuthState(env, {
      intent: "dashboard",
      nonce: "dashboard-nonce",
    });

    exchangeAuthorizationCodeMock.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_in: 3600,
      scope: ["openid"],
      token_type: "bearer",
    });
    validateIdTokenMock.mockResolvedValue({
      sub: "1001",
      nonce: "dashboard-nonce",
    });
    validateAccessTokenMock.mockResolvedValue({
      client_id: "client-id",
      login: "pixelriot",
      scopes: ["openid"],
      user_id: "1001",
      expires_in: 3600,
    });
    fetchTwitchUserMock.mockResolvedValue({
      id: "1001",
      login: "pixelriot",
      display_name: "PixelRiot",
    });
    repo.upsertIdentity.mockResolvedValue({
      user: signedInSession().user,
      ownedChannel: signedInSession().ownedChannel,
    });
    repo.createSession.mockResolvedValue({
      id: "session_1",
      expiresAt: "2026-04-24T04:00:00.000Z",
    });

    const response = await handleRequest(
      new Request(
        `http://localhost:8787/api/auth/twitch/callback?code=demo&state=${encodeURIComponent(state)}`
      ),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/dashboard?auth=connected"
    );
    expect(response.headers.get("Set-Cookie")).toContain("gg_session=");
    expect(repo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.login",
        actorUserId: "user_1",
      })
    );
  });

  it("completes shared bot auth without replacing the broadcaster session", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    const state = await createAuthState(env, {
      intent: "bot",
      actorUserId: "user_1",
      nonce: "bot-nonce",
    });

    exchangeAuthorizationCodeMock.mockResolvedValue({
      access_token: "bot-access-token",
      refresh_token: "bot-refresh-token",
      id_token: "bot-id-token",
      expires_in: 3600,
      scope: ["openid", "user:bot", "user:read:chat", "user:write:chat"],
      token_type: "bearer",
    });
    validateIdTokenMock.mockResolvedValue({
      sub: "2002",
      nonce: "bot-nonce",
    });
    validateAccessTokenMock.mockResolvedValue({
      client_id: "client-id",
      login: "ggbot",
      scopes: ["openid", "user:bot", "user:read:chat", "user:write:chat"],
      user_id: "2002",
      expires_in: 3600,
    });
    fetchTwitchUserMock.mockResolvedValue({
      id: "2002",
      login: "ggbot",
      display_name: "GGBot",
    });
    repo.upsertIdentity.mockResolvedValue({
      user: {
        id: "user_bot",
        twitchUserId: "2002",
        login: "ggbot",
        displayName: "GGBot",
      },
      ownedChannel: {
        id: "channel_bot",
        twitchChannelId: "2002",
        login: "ggbot",
        displayName: "GGBot",
      },
    });
    repo.getSession.mockResolvedValue(signedInSession());

    const response = await handleRequest(
      new Request(
        `http://localhost:8787/api/auth/twitch/callback?code=demo&state=${encodeURIComponent(state)}`,
        {
          headers: {
            Cookie: cookie,
          },
        }
      ),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/dashboard?botAuth=connected"
    );
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(repo.createSession).not.toHaveBeenCalled();
    expect(repo.writeAuditLog).not.toHaveBeenCalled();
  });

  it("redirects invite callbacks with the invite-specific error when the nonce check fails", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const state = await createAuthState(env, {
      intent: "invite",
      inviteCode: "invite_demo",
      nonce: "invite-nonce",
    });

    exchangeAuthorizationCodeMock.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_in: 3600,
      scope: ["openid"],
      token_type: "bearer",
    });
    validateIdTokenMock.mockRejectedValue(new AppError(401, "invalid_nonce"));

    const response = await handleRequest(
      new Request(
        `http://localhost:8787/api/auth/twitch/callback?code=demo&state=${encodeURIComponent(state)}`
      ),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/link/invite_demo?inviteError=invalid_nonce"
    );
  });

  it("redirects invite callbacks when the invite is expired", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const state = await createAuthState(env, {
      intent: "invite",
      inviteCode: "invite_demo",
      nonce: "invite-nonce",
    });

    exchangeAuthorizationCodeMock.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_in: 3600,
      scope: ["openid"],
      token_type: "bearer",
    });
    validateIdTokenMock.mockResolvedValue({
      sub: "1001",
      nonce: "invite-nonce",
    });
    validateAccessTokenMock.mockResolvedValue({
      client_id: "client-id",
      login: "pixelriot",
      scopes: ["openid"],
      user_id: "1001",
      expires_in: 3600,
    });
    fetchTwitchUserMock.mockResolvedValue({
      id: "1001",
      login: "pixelriot",
      display_name: "PixelRiot",
    });
    repo.upsertIdentity.mockResolvedValue({
      user: signedInSession().user,
      ownedChannel: signedInSession().ownedChannel,
    });
    repo.createSession.mockResolvedValue({
      id: "session_1",
      expiresAt: "2026-04-24T04:00:00.000Z",
    });
    repo.acceptInvite.mockRejectedValue(new AppError(410, "invite_expired"));

    const response = await handleRequest(
      new Request(
        `http://localhost:8787/api/auth/twitch/callback?code=demo&state=${encodeURIComponent(state)}`
      ),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/link/invite_demo?inviteError=invite_expired"
    );
    expect(response.headers.get("Set-Cookie")).toContain("gg_session=");
  });

  it("rejects moderator assignment when the caller lacks permissions", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());
    repo.getRoleForUser.mockResolvedValue("mod");

    const response = await handleRequest(
      new Request("http://localhost:8787/api/channel-links/link_1/members", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          login: "trustedmod",
          role: "mod",
        }),
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "insufficient_permissions",
      details: null,
    });
  });

  it("rejects unsigned EventSub notifications", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/twitch/eventsub", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Twitch-Eventsub-Message-Type": "notification",
        },
        body: JSON.stringify({ subscription: { type: "channel.follow" } }),
      }),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "invalid_eventsub_signature",
      details: null,
    });
  });

  it("accepts signed EventSub verification callbacks", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const bodyText = JSON.stringify({ challenge: "challenge-token" });
    const headers = await createEventSubHeaders(bodyText);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/twitch/eventsub", {
        method: "POST",
        headers: {
          ...headers,
          "Twitch-Eventsub-Message-Type": "webhook_callback_verification",
        },
        body: bodyText,
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-token");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'"
    );
  });

  it("rejects extension bootstrap requests without an authenticated broadcaster session", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/extension/jwt", {
        method: "POST",
        headers: {
          Origin: env.APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelId: "1001",
          role: "viewer",
          opaqueUserId: "U-demo",
        }),
      }),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "auth_required",
      details: null,
    });
  });

  it("rejects extension bootstrap requests for a different broadcaster channel", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());

    const response = await handleRequest(
      new Request("http://localhost:8787/api/extension/jwt", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelId: "9999",
          role: "viewer",
          opaqueUserId: "U-demo",
        }),
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "channel_access_denied",
      details: null,
    });
  });

  it("creates matches for authorized roles", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    const match: MatchSummary = buildMatchSummary();

    repo.getSession.mockResolvedValue(signedInSession());
    repo.getRoleForUser.mockResolvedValue("owner");
    repo.createMatch.mockResolvedValue(match);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/matches", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelLinkId: "link_1",
          title: "Gauntlet Finals",
          slug: "gauntlet-finals",
          targetWins: 3,
        }),
      }),
      env
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      match,
    });
  });

  it("lists matches for authenticated members", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());
    repo.listMatchesForUser.mockResolvedValue([buildMatchSummary()]);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/matches", {
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [buildMatchSummary()],
    });
  });

  it("resolves public snapshots by slug without loading the full snapshot from the repository", async () => {
    const repo = createRepoMock();
    const coordinatorFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ matchId: "match_public" }), {
        headers: {
          "content-type": "application/json",
          ETag: 'W/"match_public:2026-03-24T04:00:00.000Z:1"',
        },
      })
    );

    createRepositoryMock.mockReturnValue(repo);
    repo.getMatchIdBySlug.mockResolvedValue("match_public");
    vi.mocked(env.MATCH_COORDINATOR.idFromName).mockReturnValue(
      "durable-id" as unknown as DurableObjectId
    );
    vi.mocked(env.MATCH_COORDINATOR.get).mockReturnValue({
      fetch: coordinatorFetch,
    } as unknown as DurableObjectStub);

    const response = await handleRequest(
      new Request(
        "http://localhost:8787/api/public/matches/gauntlet-finals/snapshot"
      ),
      env
    );

    expect(response.status).toBe(200);
    expect(repo.getMatchIdBySlug).toHaveBeenCalledWith("gauntlet-finals");
    expect(repo.getMatchSnapshot).not.toHaveBeenCalled();
    expect(coordinatorFetch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ matchId: "match_public" });
  });

  it("decodes encoded public match slugs before resolving snapshots", async () => {
    const repo = createRepoMock();
    const coordinatorFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ matchId: "match_public" }), {
        headers: {
          "content-type": "application/json",
          ETag: 'W/"match_public:2026-03-24T04:00:00.000Z:1"',
        },
      })
    );

    createRepositoryMock.mockReturnValue(repo);
    repo.getMatchIdBySlug.mockResolvedValue("match_public");
    vi.mocked(env.MATCH_COORDINATOR.idFromName).mockReturnValue(
      "durable-id" as unknown as DurableObjectId
    );
    vi.mocked(env.MATCH_COORDINATOR.get).mockReturnValue({
      fetch: coordinatorFetch,
    } as unknown as DurableObjectStub);

    const response = await handleRequest(
      new Request(
        "http://localhost:8787/api/public/matches/grand%20finals/snapshot"
      ),
      env
    );

    expect(response.status).toBe(200);
    expect(repo.getMatchIdBySlug).toHaveBeenCalledWith("grand finals");
    expect(await response.json()).toEqual({ matchId: "match_public" });
  });

  it("returns audit log items for authenticated members", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());
    repo.listAuditLogForUser.mockResolvedValue([
      {
        id: "audit_1",
        createdAt: "2026-03-24T04:00:00.000Z",
        action: "match.created",
        actor: {
          id: "user_1",
          login: "pixelriot",
          displayName: "PixelRiot",
        },
        channelLinkId: "link_1",
        channelPairLabel: "@pixelriot vs @novarune",
        matchId: "match_1",
        matchTitle: "Gauntlet Finals",
        payload: {
          slug: "gauntlet-finals",
        },
      },
    ]);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/audit-log?limit=50", {
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(repo.listAuditLogForUser).toHaveBeenCalledWith("user_1", {
      channelLinkId: undefined,
      limit: 50,
    });
    expect(await response.json()).toEqual({
      items: [
        {
          id: "audit_1",
          createdAt: "2026-03-24T04:00:00.000Z",
          action: "match.created",
          actor: {
            id: "user_1",
            login: "pixelriot",
            displayName: "PixelRiot",
          },
          channelLinkId: "link_1",
          channelPairLabel: "@pixelriot vs @novarune",
          matchId: "match_1",
          matchTitle: "Gauntlet Finals",
          payload: {
            slug: "gauntlet-finals",
          },
        },
      ],
    });
  });

  it("requires authentication for the audit log endpoint", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/audit-log"),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "auth_required",
      details: null,
    });
  });

  it("rejects audit log filters for inaccessible channel links", async () => {
    const repo = createRepoMock();
    createRepositoryMock.mockReturnValue(repo);
    const cookie = await createSignedSessionCookie("session_1");

    repo.getSession.mockResolvedValue(signedInSession());
    repo.getRoleForUser.mockResolvedValue(null);

    const response = await handleRequest(
      new Request("http://localhost:8787/api/audit-log?channelLinkId=link_2", {
        headers: {
          Cookie: cookie,
          Origin: env.APP_ORIGIN,
        },
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "insufficient_permissions",
      details: null,
    });
    expect(repo.listAuditLogForUser).not.toHaveBeenCalled();
  });
});
