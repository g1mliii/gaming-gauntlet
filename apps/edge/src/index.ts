import {
  type AuthChannel,
  type AuthUser,
  addChannelLinkMemberRequestSchema,
  authIntentSchema,
  createChannelLinkRequestSchema,
  createDemoMatchSnapshot,
  createMatchRequestSchema,
  canCreateMatches,
  canManageModerators,
  extensionBootstrapRequestSchema
} from "@gaming-gauntlet/contracts";
import { CompactSign } from "jose";

import type { Env } from "./env";
import { createAuthState, createNonce, createSessionCookieValue, buildExpiredSessionCookie, buildSessionCookie, readAuthState, readSessionIdFromRequest } from "./lib/auth";
import { MatchCoordinator } from "./durable-objects/match-coordinator";
import { AppError, createRepository } from "./lib/repository";
import { corsPreflight, json, methodNotAllowed, noContent, plainText, redirect, withCors, withSetCookie } from "./lib/response";
import {
  buildTwitchAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchTwitchUser,
  normalizeScopeValue,
  TwitchAuthError,
  validateAccessToken,
  validateIdToken,
  verifyEventSubRequest
} from "./lib/twitch";

export { MatchCoordinator };

type AuthenticatedSession = {
  sessionId: string;
  user: AuthUser;
  ownedChannel: AuthChannel;
};

function appJson(request: Request, env: Env, payload: unknown, init?: ResponseInit): Response {
  return withCors(request, env, json(payload, init));
}

function assertAppOrigin(request: Request, env: Env): void {
  if (request.headers.get("Origin") !== env.APP_ORIGIN) {
    throw new AppError(403, "invalid_origin");
  }
}

function buildDashboardRedirect(env: Env, params: Record<string, string | null | undefined> = {}): string {
  const url = new URL("/dashboard", env.APP_ORIGIN);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function buildInviteRedirect(
  env: Env,
  inviteCode: string,
  params: Record<string, string | null | undefined> = {}
): string {
  const url = new URL(`/link/${inviteCode}`, env.APP_ORIGIN);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function requireAuthenticatedSession(
  request: Request,
  env: Env,
  repo: ReturnType<typeof createRepository>
): Promise<AuthenticatedSession> {
  const sessionId = await readSessionIdFromRequest(request, env);

  if (!sessionId) {
    throw new AppError(401, "auth_required");
  }

  const session = await repo.getSession(sessionId);

  if (!session?.authenticated || !session.user || !session.ownedChannel) {
    throw new AppError(401, "auth_required");
  }

  return {
    sessionId,
    user: session.user,
    ownedChannel: session.ownedChannel
  };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
  if (error instanceof AppError) {
    return appJson(
      request,
      env,
      {
        error: error.code,
        details: error.details ?? null
      },
      { status: error.status }
    );
  }

  if (error instanceof TwitchAuthError) {
    return appJson(
      request,
      env,
      {
        error: error.code,
        details: null
      },
      { status: error.status }
    );
  }

  console.error(error);
  return appJson(request, env, { error: "internal_error" }, { status: 500 });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const repo = createRepository(env);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return corsPreflight(request, env);
  }

  try {
    if (url.pathname === "/") {
      return appJson(request, env, {
        ok: true,
        service: "gaming-gauntlet-edge",
        routes: [
          "/api/health",
          "/api/demo/match",
          "/api/auth/session",
          "/api/auth/twitch/login",
          "/api/auth/twitch/callback",
          "/api/channel-links",
          "/api/channel-links/invites/:inviteCode",
          "/api/matches",
          "/api/twitch/eventsub",
          "/api/extension/jwt",
          "/ws/matches/:matchId"
        ]
      });
    }

    if (url.pathname === "/api/health") {
      return appJson(request, env, {
        ok: true,
        service: "gaming-gauntlet-edge",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/demo/match") {
      return appJson(request, env, createDemoMatchSnapshot());
    }

    if (url.pathname === "/api/auth/session") {
      const sessionId = await readSessionIdFromRequest(request, env);

      if (!sessionId) {
        return appJson(request, env, {
          authenticated: false,
          user: null,
          ownedChannel: null
        });
      }

      const session = await repo.getSession(sessionId);

      if (!session) {
        return withCors(
          request,
          env,
          withSetCookie(
            json({
              authenticated: false,
              user: null,
              ownedChannel: null
            }),
            buildExpiredSessionCookie(request)
          )
        );
      }

      return appJson(request, env, session);
    }

    if (url.pathname === "/api/auth/twitch/login") {
      const intent = authIntentSchema.safeParse(url.searchParams.get("intent") ?? "dashboard");

      if (!intent.success) {
        return appJson(request, env, { error: "invalid_auth_intent" }, { status: 400 });
      }

      const inviteCode = url.searchParams.get("inviteCode") ?? undefined;

      if (intent.data === "invite" && !inviteCode) {
        return appJson(request, env, { error: "invite_code_required" }, { status: 400 });
      }

      const nonce = createNonce();
      const state = await createAuthState(env, {
        intent: intent.data,
        inviteCode,
        nonce
      });

      return redirect(buildTwitchAuthorizeUrl(env, state, nonce));
    }

    if (url.pathname === "/api/auth/twitch/callback") {
      const state = await readAuthState(env, url.searchParams.get("state"));

      if (!state) {
        return redirect(buildDashboardRedirect(env, { authError: "invalid_state" }));
      }

      const authError = url.searchParams.get("error");

      if (authError) {
        return redirect(
          state.intent === "invite" && state.inviteCode
            ? buildInviteRedirect(env, state.inviteCode, { inviteError: authError })
            : buildDashboardRedirect(env, { authError })
        );
      }

      const code = url.searchParams.get("code");

      if (!code) {
        return redirect(
          state.intent === "invite" && state.inviteCode
            ? buildInviteRedirect(env, state.inviteCode, { inviteError: "missing_code" })
            : buildDashboardRedirect(env, { authError: "missing_code" })
        );
      }

      try {
        const tokenPayload = await exchangeAuthorizationCode(env, code);

        if (!tokenPayload.id_token) {
          throw new AppError(502, "missing_id_token");
        }

        const validatedIdToken = await validateIdToken(env, tokenPayload.id_token, state.nonce);
        const validatedAccessToken = await validateAccessToken(tokenPayload.access_token);
        const profile = await fetchTwitchUser(env, tokenPayload.access_token);

        if (
          validatedAccessToken.user_id !== profile.id ||
          validatedIdToken.sub !== profile.id ||
          validatedAccessToken.client_id !== env.TWITCH_CLIENT_ID
        ) {
          throw new AppError(401, "invalid_twitch_identity");
        }

        const identity = await repo.upsertIdentity(
          profile,
          {
            accessToken: tokenPayload.access_token,
            refreshToken: tokenPayload.refresh_token ?? null,
            expiresIn: tokenPayload.expires_in,
            scopes: normalizeScopeValue(tokenPayload.scope),
            tokenType: tokenPayload.token_type
          },
          validatedAccessToken
        );

        const session = await repo.createSession(identity.user.id);
        await repo.writeAuditLog({
          action: "auth.login",
          actorUserId: identity.user.id,
          payload: {
            login: identity.user.login
          }
        });

        let location = buildDashboardRedirect(env, { auth: "connected" });

        if (state.intent === "invite" && state.inviteCode) {
          try {
            await repo.acceptInvite(
              {
                id: identity.user.id,
                channel: identity.ownedChannel
              },
              state.inviteCode
            );
            location = buildInviteRedirect(env, state.inviteCode, { invite: "accepted" });
          } catch (error) {
            const code = error instanceof AppError ? error.code : "invite_accept_failed";
            location = buildInviteRedirect(env, state.inviteCode, { inviteError: code });
          }
        }

        const sessionCookie = await createSessionCookieValue(session.id, env);
        return withSetCookie(redirect(location), buildSessionCookie(sessionCookie, request));
      } catch (error) {
        const code =
          error instanceof AppError || error instanceof TwitchAuthError ? error.code : "oauth_callback_failed";
        return redirect(
          state.intent === "invite" && state.inviteCode
            ? buildInviteRedirect(env, state.inviteCode, { inviteError: code })
            : buildDashboardRedirect(env, { authError: code })
        );
      }
    }

    if (url.pathname === "/api/auth/logout") {
      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["POST"]));
      }

      assertAppOrigin(request, env);
      const sessionId = await readSessionIdFromRequest(request, env);

      if (sessionId) {
        const session = await repo.getSession(sessionId);

        if (session?.user) {
          await repo.writeAuditLog({
            action: "auth.logout",
            actorUserId: session.user.id,
            payload: {
              login: session.user.login
            }
          });
        }

        await repo.deleteSession(sessionId);
      }

      return withCors(request, env, withSetCookie(noContent(), buildExpiredSessionCookie(request)));
    }

    if (url.pathname.startsWith("/api/channel-links/invites/")) {
      const inviteCode = url.pathname.split("/").at(-1);

      if (!inviteCode) {
        return appJson(request, env, { error: "invite_code_required" }, { status: 400 });
      }

      return appJson(request, env, await repo.getInviteStatus(inviteCode));
    }

    if (url.pathname === "/api/channel-links") {
      const session = await requireAuthenticatedSession(request, env, repo);

      if (request.method === "GET") {
        return appJson(request, env, {
          items: await repo.listChannelLinksForUser(session.user.id)
        });
      }

      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["GET", "POST"]));
      }

      assertAppOrigin(request, env);
      const body = await request.json();
      const result = createChannelLinkRequestSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_channel_link_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      return appJson(
        request,
        env,
        {
          ok: true,
          ...await repo.createChannelLink(
            {
              id: session.user.id,
              channel: session.ownedChannel
            },
            result.data.invitedChannelLogin
          )
        },
        { status: 201 }
      );
    }

    if (url.pathname.startsWith("/api/channel-links/") && url.pathname.endsWith("/members")) {
      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["POST"]));
      }

      assertAppOrigin(request, env);
      const channelLinkId = url.pathname.split("/")[3];
      const session = await requireAuthenticatedSession(request, env, repo);
      const role = await repo.getRoleForUser(session.user.id, channelLinkId);

      if (!role || !canManageModerators(role)) {
        throw new AppError(403, "insufficient_permissions");
      }

      const body = await request.json();
      const result = addChannelLinkMemberRequestSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_membership_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      await repo.addModerator(session.user.id, channelLinkId, result.data.login);
      return appJson(request, env, { ok: true });
    }

    if (url.pathname.startsWith("/api/channel-links/") && url.pathname.includes("/members/")) {
      if (request.method !== "DELETE") {
        return withCors(request, env, methodNotAllowed(["DELETE"]));
      }

      assertAppOrigin(request, env);
      const segments = url.pathname.split("/");
      const channelLinkId = segments[3];
      const membershipId = segments[5];
      const session = await requireAuthenticatedSession(request, env, repo);
      const role = await repo.getRoleForUser(session.user.id, channelLinkId);

      if (!role || !canManageModerators(role)) {
        throw new AppError(403, "insufficient_permissions");
      }

      await repo.removeModerator(session.user.id, channelLinkId, membershipId);
      return withCors(request, env, noContent());
    }

    if (url.pathname === "/api/matches") {
      const session = await requireAuthenticatedSession(request, env, repo);

      if (request.method === "GET") {
        return appJson(request, env, {
          items: await repo.listMatchesForUser(session.user.id)
        });
      }

      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["GET", "POST"]));
      }

      assertAppOrigin(request, env);
      const body = await request.json();
      const result = createMatchRequestSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_match_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      const role = await repo.getRoleForUser(session.user.id, result.data.channelLinkId);

      if (!role || !canCreateMatches(role)) {
        throw new AppError(403, "insufficient_permissions");
      }

      return appJson(
        request,
        env,
        {
          ok: true,
          match: await repo.createMatch(session.user.id, result.data)
        },
        { status: 201 }
      );
    }

    if (url.pathname === "/api/twitch/eventsub") {
      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["POST"]));
      }

      const bodyText = await request.text();
      await verifyEventSubRequest(env, request.headers, bodyText);

      let body: Record<string, unknown>;

      try {
        body = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        throw new AppError(400, "invalid_eventsub_payload");
      }

      const messageType = request.headers.get("Twitch-Eventsub-Message-Type");

      if (messageType === "webhook_callback_verification") {
        return plainText(String(body.challenge ?? ""));
      }

      return appJson(request, env, {
        ok: true,
        accepted: true,
        messageType: messageType ?? "notification",
        note: "EventSub payload received. Queue ingestion lands in Phase 3."
      });
    }

    if (url.pathname === "/api/extension/jwt") {
      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["POST"]));
      }

      assertAppOrigin(request, env);
      const session = await requireAuthenticatedSession(request, env, repo);
      const body = await request.json();
      const result = extensionBootstrapRequestSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_extension_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      if (!env.TWITCH_EXTENSION_SECRET) {
        return appJson(
          request,
          env,
          {
            error: "extension_secret_not_configured",
            note: "Set TWITCH_EXTENSION_SECRET before using the EBS token endpoint."
          },
          { status: 501 }
        );
      }

      if (result.data.channelId !== session.ownedChannel.twitchChannelId) {
        throw new AppError(403, "channel_access_denied");
      }

      const secret = new TextEncoder().encode(env.TWITCH_EXTENSION_SECRET);
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = await new CompactSign(
        new TextEncoder().encode(
          JSON.stringify({
            iat: issuedAt,
            exp: issuedAt + 60 * 5,
            channel_id: session.ownedChannel.twitchChannelId,
            role: "broadcaster",
            user_id: session.user.twitchUserId
          })
        )
      )
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .sign(secret);

      return appJson(request, env, { ok: true, token });
    }

    if (url.pathname.startsWith("/ws/matches/")) {
      const matchId = url.pathname.split("/").at(-1);

      if (!matchId) {
        return appJson(request, env, { error: "match_id_required" }, { status: 400 });
      }

      const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
      const coordinator = env.MATCH_COORDINATOR.get(coordinatorId);
      const targetUrl = new URL(request.url);
      targetUrl.pathname = "/ws";
      targetUrl.searchParams.set("matchId", matchId);

      return coordinator.fetch(new Request(targetUrl, request));
    }

    if (url.pathname.startsWith("/api/matches/") && url.pathname.endsWith("/snapshot")) {
      const matchId = url.pathname.split("/")[3];
      const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
      const coordinator = env.MATCH_COORDINATOR.get(coordinatorId);
      const targetUrl = new URL(request.url);
      targetUrl.pathname = "/snapshot";
      targetUrl.searchParams.set("matchId", matchId);
      return coordinator.fetch(targetUrl.toString());
    }

    return appJson(request, env, { error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(request, env, error);
  }
}

export default {
  fetch: handleRequest,

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) {
      console.log("queue message received", message.body);
    }
  }
} satisfies ExportedHandler<Env>;
