import {
  type MatchSnapshot,
  type MatchSummary,
  type ChatCommandQueueMessage,
  type EdgeQueueMessage,
  type AuthChannel,
  type AuthUser,
  addChannelLinkMemberRequestSchema,
  authIntentSchema,
  createChannelLinkRequestSchema,
  createDemoMatchSnapshot,
  createMatchRequestSchema,
  edgeQueueMessageSchema,
  canCreateMatches,
  canManageModerators,
  extensionBootstrapRequestSchema,
  matchControlActionSchema,
  parseChatCommand,
  publicSurfaceViewSchema,
  type ChatCommand,
  type PublicSurfaceView,
  updateMatchStatusRequestSchema,
} from "@gaming-gauntlet/contracts";
import { CompactSign } from "jose";

import type { Env } from "./env";
import {
  createAuthState,
  createNonce,
  createSessionCookieValue,
  buildExpiredSessionCookie,
  buildSessionCookie,
  readAuthState,
  readSessionIdFromRequest,
} from "./lib/auth";
import {
  MatchCoordinator,
  type SnapshotEnvelope,
  type SurfaceEnvelope,
} from "./durable-objects/match-coordinator";
import { AppError, createRepository } from "./lib/repository";
import { createChatStore, type ResolvedChatTarget } from "./lib/chat-store";
import {
  corsPreflight,
  getTrustedLocalDevOrigins,
  isAllowedOrigin,
  json,
  methodNotAllowed,
  noContent,
  plainText,
  redirect,
  withCors,
  withSetCookie,
} from "./lib/response";
import {
  BROADCASTER_CHAT_AUTH_SCOPES,
  buildTwitchAuthorizeUrl,
  createEventSubChatMessageSubscription,
  deleteEventSubSubscription,
  exchangeAuthorizationCode,
  fetchTwitchUser,
  getAppAccessToken,
  normalizeScopeValue,
  refreshAccessToken,
  sendChatMessage,
  SHARED_BOT_AUTH_SCOPES,
  TwitchAuthError,
  validateAccessToken,
  validateIdToken,
  verifyEventSubRequest,
} from "./lib/twitch";

export { MatchCoordinator };

type AuthenticatedSession = {
  sessionId: string;
  user: AuthUser;
  ownedChannel: AuthChannel;
};

type QueueReplyPayload = {
  broadcasterId: string;
  message: string;
  replyParentMessageId: string | null;
};

type AppExecutionContext = Pick<ExecutionContext, "waitUntil">;

type QueueReplySender = (payload: QueueReplyPayload) => Promise<void>;

type QueuedChatCommand = {
  message: Message<unknown>;
  payload: ChatCommandQueueMessage;
  command: ReturnType<typeof parseChatCommand>;
};

type RoutedChatCommand = QueuedChatCommand & {
  target: ResolvedChatTarget;
};

const VIEWER_SNAPSHOT_CACHE_TTL_SECONDS = 10;
const VIEWER_SNAPSHOT_STALE_SECONDS = 30;
const PUBLIC_MATCH_PAGE_CACHE_TTL_SECONDS = 30;
const PUBLIC_MATCH_PAGE_STALE_SECONDS = 90;
const PUBLIC_MATCH_OVERLAY_CACHE_TTL_SECONDS = 15;
const PUBLIC_MATCH_OVERLAY_STALE_SECONDS = 45;
const VIEWER_CACHE_MATCH_ID_HEADER = "x-gg-cache-match-id";
const VIEWER_CACHE_STORED_AT_HEADER = "x-gg-cache-stored-at";
const VIEWER_CACHE_TTL_HEADER = "x-gg-cache-ttl";
const VIEWER_CACHE_STALE_HEADER = "x-gg-cache-stale";
const QUEUE_REPLY_COOLDOWN_PRUNE_INTERVAL_MS = 60_000;
const REQUIRED_SHARED_BOT_SCOPES = [
  "user:bot",
  "user:read:chat",
  "user:write:chat",
] as const;
let lastQueueReplyCooldownPruneAt = 0;

function hasDesiredEventSubSubscriptions(
  existing: Array<{
    source_twitch_channel_id: string;
    status: string;
  }>,
  activeSourceChannelIds: string[]
): boolean {
  if (existing.length !== activeSourceChannelIds.length) {
    return false;
  }

  const desiredSources = new Set(activeSourceChannelIds);

  if (desiredSources.size !== activeSourceChannelIds.length) {
    return false;
  }

  return existing.every(
    (subscription) =>
      subscription.status === "enabled" &&
      desiredSources.has(subscription.source_twitch_channel_id)
  );
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function getMissingSharedBotScopes(scopes: string[]): string[] {
  const grantedScopes = new Set(scopes);

  return REQUIRED_SHARED_BOT_SCOPES.filter(
    (scope) => !grantedScopes.has(scope)
  );
}

function assertSharedBotScopes(scopes: string[]): void {
  const missingScopes = getMissingSharedBotScopes(scopes);

  if (missingScopes.length > 0) {
    throw new AppError(400, "invalid_shared_bot_scopes", {
      missingScopes,
    });
  }
}

function assertSharedBotLogin(env: Env, login: string): void {
  if (!env.TWITCH_SHARED_BOT_LOGIN) {
    throw new AppError(503, "shared_bot_login_not_configured");
  }

  if (normalizeLogin(env.TWITCH_SHARED_BOT_LOGIN) !== normalizeLogin(login)) {
    throw new AppError(403, "shared_bot_login_mismatch");
  }
}

function buildBoardEtag(matchId: string, boardRevision: number): string {
  return `W/"${matchId}:${boardRevision}"`;
}

function redactViewerSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return {
    ...snapshot,
    suggestions: snapshot.suggestions.map((suggestion) => ({
      ...suggestion,
      sourceChannelId: null,
      suggestedBy: null,
    })),
  };
}

function decodeExtensionSecret(secret: string): Uint8Array {
  try {
    return Uint8Array.from(atob(secret), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    throw new AppError(500, "invalid_extension_secret");
  }
}

function buildViewerCacheControl(
  cacheTtlSeconds: number,
  staleSeconds: number
): string {
  return `public, max-age=${cacheTtlSeconds}, s-maxage=${cacheTtlSeconds}, stale-while-revalidate=${staleSeconds}`;
}

type ViewerProjectionCacheContext = {
  allowedViewerOrigins: string[];
  cache: Cache;
  cacheKey: Request;
  cacheTtlSeconds: number;
  staleSeconds: number;
};

type ViewerProjectionPayload<T> = {
  etag: string;
  matchId: string;
  payload: T;
};

type MatchCoordinatorStub = DurableObjectStub & {
  getSnapshotEnvelope: MatchCoordinator["getSnapshotEnvelope"];
  getSurfaceEnvelope: MatchCoordinator["getSurfaceEnvelope"];
  processCommandsRpc: MatchCoordinator["processCommandsRpc"];
  syncSnapshotMetaRpc: MatchCoordinator["syncSnapshotMetaRpc"];
  applyControlActionRpc: MatchCoordinator["applyControlActionRpc"];
};

function getViewerProjectionCacheContext(
  request: Request,
  env: Env,
  cacheTtlSeconds: number,
  staleSeconds: number
): ViewerProjectionCacheContext | null {
  if (
    request.method !== "GET" ||
    cacheTtlSeconds <= 0 ||
    request.headers.get("Cookie")
  ) {
    return null;
  }

  const cache = (
    globalThis.caches as (CacheStorage & { default?: Cache }) | undefined
  )?.default;

  if (!cache) {
    return null;
  }

  return {
    allowedViewerOrigins: [env.APP_ORIGIN, env.EXTENSION_ORIGIN].filter(
      (origin): origin is string => Boolean(origin)
    ),
    cache,
    cacheKey: new Request(request.url, {
      method: "GET",
    }),
    cacheTtlSeconds,
    staleSeconds,
  };
}

function withViewerCacheHeaders(
  response: Response,
  matchId: string,
  cacheTtlSeconds: number,
  staleSeconds: number,
  storedAt = Date.now()
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    buildViewerCacheControl(cacheTtlSeconds, staleSeconds)
  );
  headers.set(VIEWER_CACHE_MATCH_ID_HEADER, matchId);
  headers.set(VIEWER_CACHE_STORED_AT_HEADER, String(storedAt));
  headers.set(VIEWER_CACHE_TTL_HEADER, String(cacheTtlSeconds));
  headers.set(VIEWER_CACHE_STALE_HEADER, String(staleSeconds));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildViewerProjectionResponse<T>(
  projection: ViewerProjectionPayload<T>,
  cacheTtlSeconds: number,
  staleSeconds: number
): Response {
  return withViewerCacheHeaders(
    json(projection.payload, {
      headers: {
        ETag: projection.etag,
      },
    }),
    projection.matchId,
    cacheTtlSeconds,
    staleSeconds
  );
}

function readViewerCacheLifetime(response: Response): {
  matchId: string;
  ttlMs: number;
  staleMs: number;
  storedAtMs: number;
} | null {
  const matchId = response.headers.get(VIEWER_CACHE_MATCH_ID_HEADER);
  const storedAtMs = Number(
    response.headers.get(VIEWER_CACHE_STORED_AT_HEADER)
  );
  const ttlMs = Number(response.headers.get(VIEWER_CACHE_TTL_HEADER)) * 1000;
  const staleMs =
    Number(response.headers.get(VIEWER_CACHE_STALE_HEADER)) * 1000;

  if (
    !matchId ||
    !Number.isFinite(storedAtMs) ||
    !Number.isFinite(ttlMs) ||
    !Number.isFinite(staleMs)
  ) {
    return null;
  }

  return {
    matchId,
    storedAtMs,
    staleMs,
    ttlMs,
  };
}

async function tryRespondFromViewerProjectionCache(
  request: Request,
  env: Env,
  cacheContext: ViewerProjectionCacheContext | null,
  refreshCachedProjection?: (matchId: string) => Promise<void>,
  ctx?: AppExecutionContext
): Promise<Response | null> {
  if (!cacheContext) {
    return null;
  }

  const cachedResponse = await cacheContext.cache.match(cacheContext.cacheKey);

  if (!cachedResponse) {
    return null;
  }

  const cacheLifetime = readViewerCacheLifetime(cachedResponse);

  if (!cacheLifetime) {
    return null;
  }

  const ageMs = Date.now() - cacheLifetime.storedAtMs;

  if (ageMs > cacheLifetime.ttlMs + cacheLifetime.staleMs) {
    return null;
  }

  if (ageMs > cacheLifetime.ttlMs && refreshCachedProjection && ctx) {
    ctx.waitUntil(
      refreshCachedProjection(cacheLifetime.matchId).catch((error) => {
        console.error("viewer cache revalidation failed", error);
      })
    );
  }

  const cachedEtag = cachedResponse.headers.get("ETag");

  if (cachedEtag && request.headers.get("If-None-Match") === cachedEtag) {
    return withCors(
      request,
      env,
      new Response(null, {
        status: 304,
        headers: {
          ETag: cachedEtag,
          "Cache-Control": buildViewerCacheControl(
            cacheLifetime.ttlMs / 1000,
            cacheLifetime.staleMs / 1000
          ),
        },
      }),
      {
        allowCredentials: false,
        allowedOrigins: cacheContext.allowedViewerOrigins,
      }
    );
  }

  return withCors(request, env, cachedResponse, {
    allowCredentials: false,
    allowedOrigins: cacheContext.allowedViewerOrigins,
  });
}

async function writeViewerProjectionCache(
  cacheContext: ViewerProjectionCacheContext | null,
  response: Response,
  ctx?: AppExecutionContext
): Promise<void> {
  if (!cacheContext) {
    return;
  }

  const cacheWrite = cacheContext.cache.put(
    cacheContext.cacheKey,
    response.clone()
  );

  if (ctx) {
    ctx.waitUntil(cacheWrite);
  } else {
    await cacheWrite;
  }
}

function getMatchCoordinator(env: Env, matchId: string) {
  const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
  return env.MATCH_COORDINATOR.get(coordinatorId) as MatchCoordinatorStub;
}

async function getSnapshotEnvelopeFromCoordinator(
  env: Env,
  matchId: string
): Promise<SnapshotEnvelope> {
  return getMatchCoordinator(env, matchId).getSnapshotEnvelope(matchId);
}

async function getSurfaceEnvelopeFromCoordinator(
  env: Env,
  matchId: string,
  view: PublicSurfaceView
): Promise<SurfaceEnvelope> {
  return getMatchCoordinator(env, matchId).getSurfaceEnvelope(matchId, view);
}

async function processCommandBatchWithCoordinator(
  env: Env,
  matchId: string,
  commands: Array<{
    command: ReturnType<typeof parseChatCommand>;
    messageId: string;
    sentAt: string;
    sourceChannelId: string;
    sourceTwitchChannelId: string;
    viewerId: string;
    replyParentId: string | null;
  }>
): Promise<Array<QueueReplyPayload | null>> {
  return getMatchCoordinator(env, matchId).processCommandsRpc(
    matchId,
    commands
  );
}

async function syncMatchMetaWithCoordinator(
  env: Env,
  matchId: string,
  match: MatchSummary
): Promise<MatchSnapshot> {
  return getMatchCoordinator(env, matchId).syncSnapshotMetaRpc(matchId, match);
}

async function applyControlActionWithCoordinator(
  env: Env,
  matchId: string,
  action: Parameters<MatchCoordinator["applyControlActionRpc"]>[1]
): Promise<MatchSnapshot> {
  return getMatchCoordinator(env, matchId).applyControlActionRpc(
    matchId,
    action
  );
}

async function fetchViewerProjectionResponse<T>(
  request: Request,
  env: Env,
  matchId: string,
  options: {
    cacheContext?: ViewerProjectionCacheContext | null;
    cacheTtlSeconds?: number;
    loadProjection: (matchId: string) => Promise<ViewerProjectionPayload<T>>;
    skipCacheLookup?: boolean;
    staleSeconds?: number;
  },
  ctx?: AppExecutionContext
): Promise<Response> {
  const cacheTtlSeconds = options.cacheTtlSeconds ?? 0;
  const staleSeconds = options.staleSeconds ?? VIEWER_SNAPSHOT_STALE_SECONDS;
  const cacheContext =
    options.cacheContext ??
    getViewerProjectionCacheContext(
      request,
      env,
      cacheTtlSeconds,
      staleSeconds
    );
  const allowedViewerOrigins =
    cacheContext?.allowedViewerOrigins ??
    [env.APP_ORIGIN, env.EXTENSION_ORIGIN].filter((origin): origin is string =>
      Boolean(origin)
    );

  if (!options.skipCacheLookup) {
    const cachedResponse = await tryRespondFromViewerProjectionCache(
      request,
      env,
      cacheContext,
      async (cachedMatchId) => {
        const refreshedResponse = buildViewerProjectionResponse(
          await options.loadProjection(cachedMatchId),
          cacheTtlSeconds,
          staleSeconds
        );
        await writeViewerProjectionCache(cacheContext, refreshedResponse);
      },
      ctx
    );

    if (cachedResponse) {
      return cachedResponse;
    }
  }

  const projection = await options.loadProjection(matchId);
  const viewerResponse = buildViewerProjectionResponse(
    projection,
    cacheTtlSeconds,
    staleSeconds
  );

  if (viewerResponse.status === 200 && viewerResponse.ok) {
    await writeViewerProjectionCache(cacheContext, viewerResponse, ctx);
  }

  if (request.headers.get("If-None-Match") === projection.etag) {
    return withCors(
      request,
      env,
      new Response(null, {
        status: 304,
        headers: {
          ETag: projection.etag,
          "Cache-Control": buildViewerCacheControl(
            cacheTtlSeconds,
            staleSeconds
          ),
        },
      }),
      {
        allowCredentials: false,
        allowedOrigins: allowedViewerOrigins,
      }
    );
  }

  return withCors(request, env, viewerResponse, {
    allowCredentials: false,
    allowedOrigins: allowedViewerOrigins,
  });
}

async function requireControlRoomMatchAccess(
  request: Request,
  env: Env,
  repo: ReturnType<typeof createRepository>,
  matchId: string
): Promise<MatchSummary> {
  const session = await requireAuthenticatedSession(request, env, repo);
  const match = await repo.getMatchSummaryForUser(session.user.id, matchId);

  if (!match) {
    throw new AppError(404, "match_not_found");
  }

  const role = await repo.getRoleForUser(session.user.id, match.channelLinkId);

  if (!role || !canCreateMatches(role)) {
    throw new AppError(403, "insufficient_permissions");
  }

  return match;
}

function appJson(
  request: Request,
  env: Env,
  payload: unknown,
  init?: ResponseInit
): Response {
  return withCors(request, env, json(payload, init));
}

function assertAppOrigin(request: Request, env: Env): void {
  if (
    !isAllowedOrigin(request.headers.get("Origin"), [
      env.APP_ORIGIN,
      ...getTrustedLocalDevOrigins(env),
    ])
  ) {
    throw new AppError(403, "invalid_origin");
  }
}

function buildDashboardRedirect(
  env: Env,
  params: Record<string, string | null | undefined> = {}
): string {
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
    ownedChannel: session.ownedChannel,
  };
}

async function ensureSharedBotIdentity(
  env: Env,
  repo: ReturnType<typeof createRepository>
): Promise<{ senderId: string }> {
  const stored = await repo.findSharedBotIdentity();

  if (stored) {
    assertSharedBotLogin(env, stored.login);
    const token = await repo.ensureFreshTwitchToken(stored.user_id);
    assertSharedBotScopes(token.scopes);
    return {
      senderId: stored.twitch_user_id,
    };
  }

  if (!env.TWITCH_BOT_ACCESS_TOKEN || !env.TWITCH_BOT_REFRESH_TOKEN) {
    throw new AppError(503, "shared_bot_not_configured");
  }

  let accessToken = env.TWITCH_BOT_ACCESS_TOKEN;
  let refreshToken = env.TWITCH_BOT_REFRESH_TOKEN;
  let validatedToken;

  try {
    validatedToken = await validateAccessToken(accessToken);
  } catch {
    const refreshed = await refreshAccessToken(env, refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token ?? refreshToken;
    validatedToken = await validateAccessToken(accessToken);
  }

  assertSharedBotScopes(validatedToken.scopes);

  const profile = await fetchTwitchUser(env, accessToken);
  if (env.TWITCH_SHARED_BOT_LOGIN) {
    assertSharedBotLogin(env, profile.login);
  }
  const identity = await repo.upsertIdentity(
    profile,
    {
      accessToken,
      refreshToken,
      expiresIn: validatedToken.expires_in,
      scopes: validatedToken.scopes,
      tokenType: "bearer",
    },
    validatedToken
  );

  return {
    senderId: identity.user.twitchUserId,
  };
}

function createQueueReplySender(
  env: Env,
  repo: ReturnType<typeof createRepository>
): QueueReplySender {
  let senderIdPromise: Promise<string> | null = null;

  return async (payload: QueueReplyPayload): Promise<void> => {
    senderIdPromise ??= ensureSharedBotIdentity(env, repo)
      .then((bot) => bot.senderId)
      .catch((error) => {
        senderIdPromise = null;
        throw error;
      });

    const [senderId, appAccessToken] = await Promise.all([
      senderIdPromise,
      getAppAccessToken(env),
    ]);

    await sendChatMessage(env, appAccessToken, {
      broadcasterId: payload.broadcasterId,
      senderId,
      message: payload.message,
      replyParentMessageId: payload.replyParentMessageId,
      forSourceOnly: true,
    });
  };
}

async function enqueueEdgeQueueMessages(
  env: Env,
  messages: EdgeQueueMessage[]
): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  if (messages.length === 1) {
    await env.EVENT_INGEST_QUEUE.send(messages[0]);
    return;
  }

  await env.EVENT_INGEST_QUEUE.sendBatch(
    messages.map((message) => ({ body: message }))
  );
}

async function reconcileEventSubSubscriptions(
  env: Env,
  repo: ReturnType<typeof createRepository>,
  chatStore: ReturnType<typeof createChatStore>,
  channelLinkId: string
): Promise<void> {
  const existing = await chatStore.listEventSubSubscriptions(channelLinkId);
  const plan = await chatStore.getSubscriptionPlan(channelLinkId);

  if (
    !plan ||
    !plan.ownerAuthorized ||
    !plan.linkedAuthorized ||
    plan.activeSourceChannelIds.length === 0
  ) {
    if (existing.length === 0) {
      return;
    }

    const appAccessToken = await getAppAccessToken(env);

    for (const subscription of existing) {
      await deleteEventSubSubscription(
        env,
        appAccessToken,
        subscription.subscription_id
      );
    }

    await chatStore.deleteEventSubSubscriptions(channelLinkId);
    return;
  }

  if (hasDesiredEventSubSubscriptions(existing, plan.activeSourceChannelIds)) {
    return;
  }

  const appAccessToken = await getAppAccessToken(env);

  for (const subscription of existing) {
    await deleteEventSubSubscription(
      env,
      appAccessToken,
      subscription.subscription_id
    );
  }

  await chatStore.deleteEventSubSubscriptions(channelLinkId);
  const bot = await ensureSharedBotIdentity(env, repo);

  for (const sourceChannelId of plan.activeSourceChannelIds) {
    const subscription = await createEventSubChatMessageSubscription(
      env,
      appAccessToken,
      {
        broadcasterUserId: sourceChannelId,
        userId: bot.senderId,
      }
    );

    await chatStore.upsertEventSubSubscription({
      channelLinkId,
      subscriptionId: subscription.id,
      sourceTwitchChannelId: sourceChannelId,
      broadcasterTwitchChannelId: sourceChannelId,
      status: subscription.status,
    });
  }
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
  if (error instanceof AppError) {
    return appJson(
      request,
      env,
      {
        error: error.code,
        details: error.details ?? null,
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
        details: null,
      },
      { status: error.status }
    );
  }

  console.error(error);
  return appJson(request, env, { error: "internal_error" }, { status: 500 });
}

function buildHelpReply(
  sourceChannelId: string,
  replyParentMessageId: string | null
): QueueReplyPayload {
  return {
    broadcasterId: sourceChannelId,
    message: "GG help: !gg suggest <title> | !gg vote <board id> | !gg board",
    replyParentMessageId,
  };
}

async function safelySendQueueReply(
  sendReply: QueueReplySender,
  message: Message<unknown>,
  payload: QueueReplyPayload
): Promise<void> {
  try {
    await sendReply(payload);
    message.ack();
  } catch (error) {
    console.error("queue reply failed", error);
    message.retry();
  }
}

async function maybePruneQueueReplyCooldowns(
  chatStore: ReturnType<typeof createChatStore>
): Promise<void> {
  const now = Date.now();

  if (
    now - lastQueueReplyCooldownPruneAt <
    QUEUE_REPLY_COOLDOWN_PRUNE_INTERVAL_MS
  ) {
    return;
  }

  lastQueueReplyCooldownPruneAt = now;
  await chatStore.pruneExpiredQueueReplyCooldowns();
}

async function takeQueueReplyCooldownOncePerBatch(
  chatStore: ReturnType<typeof createChatStore>,
  handledKeys: Set<string>,
  key: string,
  durationMs: number
): Promise<boolean> {
  if (handledKeys.has(key)) {
    return false;
  }

  handledKeys.add(key);
  return chatStore.takeQueueReplyCooldown(key, durationMs);
}

async function handleChatCommandQueueBatch(
  env: Env,
  chatStore: ReturnType<typeof createChatStore>,
  queuedCommands: QueuedChatCommand[],
  sendReply: QueueReplySender
): Promise<void> {
  await maybePruneQueueReplyCooldowns(chatStore);
  const actionableCommands: QueuedChatCommand[] = [];
  const handledReplyCooldownKeys = new Set<string>();

  for (const queuedCommand of queuedCommands) {
    const { command, message, payload } = queuedCommand;

    if (command.kind === "help") {
      if (
        await takeQueueReplyCooldownOncePerBatch(
          chatStore,
          handledReplyCooldownKeys,
          `help:${payload.sourceChannelId}`,
          60_000
        )
      ) {
        await safelySendQueueReply(
          sendReply,
          message,
          buildHelpReply(payload.sourceChannelId, payload.replyParentId)
        );
      } else {
        message.ack();
      }

      continue;
    }

    if (command.kind === "unknown") {
      if (
        await takeQueueReplyCooldownOncePerBatch(
          chatStore,
          handledReplyCooldownKeys,
          `unknown:${payload.sourceChannelId}`,
          15_000
        )
      ) {
        await safelySendQueueReply(sendReply, message, {
          broadcasterId: payload.sourceChannelId,
          message: "Unknown GG command. Try !gg help.",
          replyParentMessageId: payload.replyParentId,
        });
      } else {
        message.ack();
      }

      continue;
    }

    actionableCommands.push(queuedCommand);
  }

  if (actionableCommands.length === 0) {
    return;
  }

  const targetsBySourceChannelId = await chatStore.resolveChatCommandTargets(
    actionableCommands.map(
      (queuedCommand) => queuedCommand.payload.sourceChannelId
    )
  );
  const routedCommandsByMatchId = new Map<string, RoutedChatCommand[]>();

  for (const queuedCommand of actionableCommands) {
    const target = targetsBySourceChannelId.get(
      queuedCommand.payload.sourceChannelId
    );

    if (target) {
      const existing = routedCommandsByMatchId.get(target.matchId);

      if (existing) {
        existing.push({
          ...queuedCommand,
          target,
        });
      } else {
        routedCommandsByMatchId.set(target.matchId, [
          {
            ...queuedCommand,
            target,
          },
        ]);
      }

      continue;
    }

    if (
      await takeQueueReplyCooldownOncePerBatch(
        chatStore,
        handledReplyCooldownKeys,
        `missing-target:${queuedCommand.payload.sourceChannelId}`,
        15_000
      )
    ) {
      await safelySendQueueReply(sendReply, queuedCommand.message, {
        broadcasterId: queuedCommand.payload.sourceChannelId,
        message:
          "Gaming Gauntlet is not accepting chat picks for this channel right now.",
        replyParentMessageId: queuedCommand.payload.replyParentId,
      });
    } else {
      queuedCommand.message.ack();
    }
  }

  await Promise.all(
    [...routedCommandsByMatchId.entries()].map(
      async ([matchId, routedCommands]): Promise<void> => {
        try {
          const replies = await processCommandBatchWithCoordinator(
            env,
            matchId,
            routedCommands.map((routedCommand) => ({
              command: routedCommand.command as ChatCommand,
              messageId: routedCommand.payload.messageId,
              sentAt: routedCommand.payload.sentAt,
              sourceChannelId: routedCommand.target.internalSourceChannelId,
              sourceTwitchChannelId: routedCommand.payload.sourceChannelId,
              viewerId: routedCommand.payload.viewerId,
              replyParentId: routedCommand.payload.replyParentId,
            }))
          );

          if (replies.length !== routedCommands.length) {
            throw new Error(
              `match command batch reply mismatch for ${matchId}: expected ${routedCommands.length}, received ${replies.length}`
            );
          }

          for (let index = 0; index < routedCommands.length; index += 1) {
            const reply = replies[index];

            if (reply) {
              await sendReply(reply);
            }

            routedCommands[index].message.ack();
          }
        } catch (error) {
          console.error("chat command batch failed", {
            error,
            matchId,
            count: routedCommands.length,
          });

          for (const routedCommand of routedCommands) {
            routedCommand.message.retry();
          }
        }
      }
    )
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: AppExecutionContext
): Promise<Response> {
  const repo = createRepository(env);
  const chatStore = createChatStore(env);
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
          "/api/matches/:matchId/status",
          "/api/matches/:matchId/board",
          "/api/audit-log",
          "/api/twitch/eventsub",
          "/api/extension/jwt",
        ],
      });
    }

    if (url.pathname === "/api/health") {
      return appJson(request, env, {
        ok: true,
        service: "gaming-gauntlet-edge",
        timestamp: new Date().toISOString(),
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
          ownedChannel: null,
          sharedBotConnected: false,
        });
      }

      const session = await repo.getSession(sessionId, {
        includeSharedBotConnected: true,
      });

      if (!session) {
        return withCors(
          request,
          env,
          withSetCookie(
            json({
              authenticated: false,
              user: null,
              ownedChannel: null,
              sharedBotConnected: false,
            }),
            buildExpiredSessionCookie(request, env)
          )
        );
      }

      return appJson(request, env, session);
    }

    if (url.pathname === "/api/auth/twitch/login") {
      const intent = authIntentSchema.safeParse(
        url.searchParams.get("intent") ?? "dashboard"
      );

      if (!intent.success) {
        return appJson(
          request,
          env,
          { error: "invalid_auth_intent" },
          { status: 400 }
        );
      }

      const inviteCode = url.searchParams.get("inviteCode") ?? undefined;

      if (intent.data === "invite" && !inviteCode) {
        return appJson(
          request,
          env,
          { error: "invite_code_required" },
          { status: 400 }
        );
      }

      let actorUserId: string | undefined;
      let scopes: readonly string[] = BROADCASTER_CHAT_AUTH_SCOPES;

      if (intent.data === "bot") {
        const session = await requireAuthenticatedSession(request, env, repo);
        actorUserId = session.user.id;
        scopes = SHARED_BOT_AUTH_SCOPES;
      }

      const nonce = createNonce();
      const state = await createAuthState(env, {
        intent: intent.data,
        inviteCode,
        actorUserId,
        nonce,
      });

      return redirect(buildTwitchAuthorizeUrl(env, state, nonce, scopes));
    }

    if (url.pathname === "/api/auth/twitch/callback") {
      const state = await readAuthState(env, url.searchParams.get("state"));

      if (!state) {
        return redirect(
          buildDashboardRedirect(env, { authError: "invalid_state" })
        );
      }

      const authError = url.searchParams.get("error");

      if (authError) {
        return redirect(
          state.intent === "invite" && state.inviteCode
            ? buildInviteRedirect(env, state.inviteCode, {
                inviteError: authError,
              })
            : buildDashboardRedirect(env, { authError })
        );
      }

      const code = url.searchParams.get("code");

      if (!code) {
        return redirect(
          state.intent === "invite" && state.inviteCode
            ? buildInviteRedirect(env, state.inviteCode, {
                inviteError: "missing_code",
              })
            : buildDashboardRedirect(env, { authError: "missing_code" })
        );
      }

      try {
        const tokenPayload = await exchangeAuthorizationCode(env, code);

        if (!tokenPayload.id_token) {
          throw new AppError(502, "missing_id_token");
        }

        const validatedIdToken = await validateIdToken(
          env,
          tokenPayload.id_token,
          state.nonce
        );
        const validatedAccessToken = await validateAccessToken(
          tokenPayload.access_token
        );
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
            tokenType: tokenPayload.token_type,
          },
          validatedAccessToken
        );

        if (state.intent === "bot") {
          const existingSession = await requireAuthenticatedSession(
            request,
            env,
            repo
          );

          if (
            state.actorUserId &&
            existingSession.user.id !== state.actorUserId
          ) {
            throw new AppError(401, "auth_state_user_mismatch");
          }

          assertSharedBotLogin(env, identity.user.login);
          assertSharedBotScopes(normalizeScopeValue(tokenPayload.scope));

          return redirect(
            buildDashboardRedirect(env, { botAuth: "connected" })
          );
        }

        const session = await repo.createSession(identity.user.id);
        await repo.writeAuditLog({
          action: "auth.login",
          actorUserId: identity.user.id,
          payload: {
            login: identity.user.login,
          },
        });

        let location =
          state.intent === "chat"
            ? buildDashboardRedirect(env, { chatAuth: "connected" })
            : buildDashboardRedirect(env, { auth: "connected" });

        if (state.intent === "invite" && state.inviteCode) {
          try {
            await repo.acceptInvite(
              {
                id: identity.user.id,
                channel: identity.ownedChannel,
              },
              state.inviteCode
            );
            location = buildInviteRedirect(env, state.inviteCode, {
              invite: "accepted",
            });
          } catch (error) {
            const code =
              error instanceof AppError ? error.code : "invite_accept_failed";
            location = buildInviteRedirect(env, state.inviteCode, {
              inviteError: code,
            });
          }
        }

        if (state.intent === "chat") {
          const links = await repo.listChannelLinksForUser(identity.user.id);

          await enqueueEdgeQueueMessages(
            env,
            links
              .filter((link) => link.status === "active")
              .map((link) => ({
                type: "subscription_reconcile" as const,
                channelLinkId: link.id,
                reason: "chat_auth" as const,
              }))
          );
        }

        const sessionCookie = await createSessionCookieValue(session.id, env);
        return withSetCookie(
          redirect(location),
          buildSessionCookie(sessionCookie, request, env)
        );
      } catch (error) {
        const code =
          error instanceof AppError || error instanceof TwitchAuthError
            ? error.code
            : "oauth_callback_failed";
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
        const session = await repo.getSession(sessionId, {
          touchLastSeen: false,
        });

        if (session?.user) {
          await repo.writeAuditLog({
            action: "auth.logout",
            actorUserId: session.user.id,
            payload: {
              login: session.user.login,
            },
          });
        }

        await repo.deleteSession(sessionId);
      }

      return withCors(
        request,
        env,
        withSetCookie(noContent(), buildExpiredSessionCookie(request, env))
      );
    }

    if (url.pathname.startsWith("/api/channel-links/invites/")) {
      const inviteCode = url.pathname.split("/").at(-1);

      if (!inviteCode) {
        return appJson(
          request,
          env,
          { error: "invite_code_required" },
          { status: 400 }
        );
      }

      return appJson(request, env, await repo.getInviteStatus(inviteCode));
    }

    if (url.pathname === "/api/channel-links") {
      const session = await requireAuthenticatedSession(request, env, repo);

      if (request.method === "GET") {
        return appJson(request, env, {
          items: await repo.listChannelLinksForUser(session.user.id),
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
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      return appJson(
        request,
        env,
        {
          ok: true,
          ...(await repo.createChannelLink(
            {
              id: session.user.id,
              channel: session.ownedChannel,
            },
            result.data.invitedChannelLogin
          )),
        },
        { status: 201 }
      );
    }

    if (
      url.pathname.startsWith("/api/channel-links/") &&
      url.pathname.endsWith("/members")
    ) {
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
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      await repo.addModerator(
        session.user.id,
        channelLinkId,
        result.data.login
      );
      return appJson(request, env, { ok: true });
    }

    if (
      url.pathname.startsWith("/api/channel-links/") &&
      url.pathname.includes("/members/")
    ) {
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
          items: await repo.listMatchesForUser(session.user.id),
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
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      const role = await repo.getRoleForUser(
        session.user.id,
        result.data.channelLinkId
      );

      if (!role || !canCreateMatches(role)) {
        throw new AppError(403, "insufficient_permissions");
      }

      return appJson(
        request,
        env,
        {
          ok: true,
          match: await repo.createMatch(session.user.id, result.data),
        },
        { status: 201 }
      );
    }

    if (
      url.pathname.startsWith("/api/matches/") &&
      url.pathname.endsWith("/status")
    ) {
      if (request.method !== "PATCH") {
        return withCors(request, env, methodNotAllowed(["PATCH"]));
      }

      assertAppOrigin(request, env);
      const session = await requireAuthenticatedSession(request, env, repo);
      const matchId = url.pathname.split("/")[3];
      const body = await request.json();
      const result = updateMatchStatusRequestSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_match_status_request",
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      const match = await repo.updateMatchStatusForUser(
        session.user.id,
        matchId,
        result.data.status
      );

      await syncMatchMetaWithCoordinator(env, matchId, match);

      await enqueueEdgeQueueMessages(env, [
        {
          type: "subscription_reconcile",
          channelLinkId: match.channelLinkId,
          reason: "match_status",
        },
      ]);

      return appJson(request, env, {
        ok: true,
        match,
      });
    }

    if (
      url.pathname.startsWith("/api/matches/") &&
      url.pathname.endsWith("/control/actions")
    ) {
      if (request.method !== "POST") {
        return withCors(request, env, methodNotAllowed(["POST"]));
      }

      assertAppOrigin(request, env);
      const matchId = url.pathname.split("/")[3];
      await requireControlRoomMatchAccess(request, env, repo, matchId);

      const body = await request.json();
      const result = matchControlActionSchema.safeParse(body);

      if (!result.success) {
        return appJson(
          request,
          env,
          {
            error: "invalid_match_control_action",
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      const snapshot = await applyControlActionWithCoordinator(
        env,
        matchId,
        result.data
      );
      return appJson(request, env, {
        ok: true,
        snapshot,
      });
    }

    if (
      url.pathname.startsWith("/api/control/matches/") &&
      url.pathname.endsWith("/snapshot")
    ) {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      const matchId = url.pathname.split("/")[4];
      await requireControlRoomMatchAccess(request, env, repo, matchId);

      const snapshotResponse = await getSnapshotEnvelopeFromCoordinator(
        env,
        matchId
      );

      if (request.headers.get("If-None-Match") === snapshotResponse.etag) {
        return withCors(
          request,
          env,
          new Response(null, {
            status: 304,
            headers: {
              ETag: snapshotResponse.etag,
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          })
        );
      }

      const headers = new Headers({
        ETag: snapshotResponse.etag,
        "content-type": "application/json; charset=utf-8",
      });
      headers.set("Cache-Control", "private, max-age=0, must-revalidate");

      return withCors(
        request,
        env,
        new Response(JSON.stringify(snapshotResponse.snapshot), {
          status: 200,
          headers,
        })
      );
    }

    if (
      url.pathname.startsWith("/api/matches/") &&
      url.pathname.endsWith("/board")
    ) {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      const session = await requireAuthenticatedSession(request, env, repo);
      const matchId = url.pathname.split("/")[3];
      const board = await repo.getCompactBoardForUser(session.user.id, matchId);
      const etag = buildBoardEtag(board.matchId, board.boardRevision);

      if (request.headers.get("If-None-Match") === etag) {
        return withCors(
          request,
          env,
          new Response(null, {
            status: 304,
            headers: {
              ETag: etag,
            },
          })
        );
      }

      return appJson(request, env, board, {
        headers: {
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    if (url.pathname === "/api/audit-log") {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      const session = await requireAuthenticatedSession(request, env, repo);
      const channelLinkId = url.searchParams.get("channelLinkId") ?? undefined;
      const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
        : 25;

      if (channelLinkId) {
        const role = await repo.getRoleForUser(session.user.id, channelLinkId);

        if (!role) {
          throw new AppError(403, "insufficient_permissions");
        }
      }

      return appJson(request, env, {
        items: await repo.listAuditLogForUser(session.user.id, {
          channelLinkId,
          limit,
        }),
      });
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
        const subscription = body.subscription as { id?: string } | undefined;

        if (subscription?.id) {
          await chatStore.markEventSubSubscriptionStatus(
            subscription.id,
            "enabled"
          );
        }

        return plainText(String(body.challenge ?? ""));
      }

      if (messageType === "revocation") {
        const subscription = body.subscription as
          | {
              id?: string;
              status?: string;
              condition?: {
                broadcaster_user_id?: string;
              };
            }
          | undefined;

        if (subscription?.id) {
          await enqueueEdgeQueueMessages(env, [
            {
              type: "subscription_revoked",
              subscriptionId: subscription.id,
              broadcasterId:
                subscription.condition?.broadcaster_user_id ?? null,
              sourceChannelId:
                subscription.condition?.broadcaster_user_id ?? null,
              reason: subscription.status ?? "revoked",
            },
          ]);
        }

        return withCors(request, env, noContent());
      }

      const subscription = body.subscription as
        | {
            type?: string;
          }
        | undefined;

      if (
        messageType === "notification" &&
        subscription?.type === "channel.chat.message"
      ) {
        const event = body.event as
          | {
              broadcaster_user_id?: string;
              source_broadcaster_user_id?: string;
              chatter_user_id?: string;
              message_id?: string;
              message?: {
                text?: string;
              };
              text?: string;
            }
          | undefined;
        const messageText = event?.message?.text ?? event?.text ?? "";
        const sourceChannelId =
          event?.source_broadcaster_user_id ?? event?.broadcaster_user_id ?? "";
        const viewerId = event?.chatter_user_id ?? "";

        if (!messageText.startsWith("!gg")) {
          return withCors(request, env, noContent());
        }

        if (!sourceChannelId || !viewerId) {
          return withCors(request, env, noContent());
        }

        await enqueueEdgeQueueMessages(env, [
          {
            type: "chat_command",
            messageId:
              event?.message_id ??
              request.headers.get("Twitch-Eventsub-Message-Id") ??
              crypto.randomUUID(),
            sentAt:
              request.headers.get("Twitch-Eventsub-Message-Timestamp") ??
              new Date().toISOString(),
            sourceChannelId,
            broadcasterId: event?.broadcaster_user_id ?? sourceChannelId,
            viewerId,
            messageText,
            replyParentId: event?.message_id ?? null,
          },
        ]);

        return withCors(request, env, noContent());
      }

      return withCors(request, env, noContent());
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
            details: result.error.flatten(),
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
            note: "Set TWITCH_EXTENSION_SECRET before using the EBS token endpoint.",
          },
          { status: 501 }
        );
      }

      if (result.data.channelId !== session.ownedChannel.twitchChannelId) {
        throw new AppError(403, "channel_access_denied");
      }

      if (result.data.role !== "external") {
        return appJson(
          request,
          env,
          {
            error: "invalid_extension_role",
            note: "Twitch EBS-signed JWTs must use the external role.",
          },
          { status: 400 }
        );
      }

      const secret = decodeExtensionSecret(env.TWITCH_EXTENSION_SECRET);
      const issuedAt = Math.floor(Date.now() / 1000);
      const payload = new Uint8Array(
        new TextEncoder().encode(
          JSON.stringify({
            iat: issuedAt,
            exp: issuedAt + 60 * 5,
            channel_id: session.ownedChannel.twitchChannelId,
            role: "external",
            user_id: result.data.userId ?? session.user.twitchUserId,
          })
        )
      );
      const token = await new CompactSign(payload)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .sign(secret);

      return appJson(
        request,
        env,
        { ok: true, token },
        {
          headers: {
            "Cache-Control": "private, no-store",
          },
        }
      );
    }

    if (url.pathname.startsWith("/ws/control/matches/")) {
      assertAppOrigin(request, env);
      const matchId = url.pathname.split("/").at(-1);

      if (!matchId) {
        return appJson(
          request,
          env,
          { error: "match_id_required" },
          { status: 400 }
        );
      }

      await requireControlRoomMatchAccess(request, env, repo, matchId);

      const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
      const coordinator = env.MATCH_COORDINATOR.get(coordinatorId);
      const targetUrl = new URL(request.url);
      targetUrl.pathname = "/ws";
      targetUrl.searchParams.set("matchId", matchId);

      return coordinator.fetch(new Request(targetUrl, request));
    }

    if (
      url.pathname.startsWith("/api/matches/") &&
      url.pathname.endsWith("/snapshot")
    ) {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      const matchId = url.pathname.split("/")[3];
      await requireControlRoomMatchAccess(request, env, repo, matchId);

      const snapshotResponse = await getSnapshotEnvelopeFromCoordinator(
        env,
        matchId
      );

      if (request.headers.get("If-None-Match") === snapshotResponse.etag) {
        return withCors(
          request,
          env,
          new Response(null, {
            status: 304,
            headers: {
              ETag: snapshotResponse.etag,
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          })
        );
      }

      const headers = new Headers({
        ETag: snapshotResponse.etag,
        "content-type": "application/json; charset=utf-8",
      });
      headers.set("Cache-Control", "private, max-age=0, must-revalidate");

      return withCors(
        request,
        env,
        new Response(JSON.stringify(snapshotResponse.snapshot), {
          status: 200,
          headers,
        })
      );
    }

    if (
      url.pathname.startsWith("/api/public/matches/") &&
      url.pathname.endsWith("/surface")
    ) {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      let slug: string;

      try {
        slug = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      } catch {
        return appJson(
          request,
          env,
          { error: "match_not_found" },
          { status: 404 }
        );
      }

      const parsedView = publicSurfaceViewSchema.safeParse(
        url.searchParams.get("view")
      );

      if (!parsedView.success) {
        return appJson(
          request,
          env,
          { error: "invalid_surface_view" },
          { status: 400 }
        );
      }

      const viewerOptions =
        parsedView.data === "page"
          ? {
              cacheTtlSeconds: PUBLIC_MATCH_PAGE_CACHE_TTL_SECONDS,
              staleSeconds: PUBLIC_MATCH_PAGE_STALE_SECONDS,
            }
          : {
              cacheTtlSeconds: PUBLIC_MATCH_OVERLAY_CACHE_TTL_SECONDS,
              staleSeconds: PUBLIC_MATCH_OVERLAY_STALE_SECONDS,
            };
      const cacheContext = getViewerProjectionCacheContext(
        request,
        env,
        viewerOptions.cacheTtlSeconds,
        viewerOptions.staleSeconds
      );
      const cachedResponse = await tryRespondFromViewerProjectionCache(
        request,
        env,
        cacheContext,
        async (cachedMatchId) => {
          const surfaceEnvelope = await getSurfaceEnvelopeFromCoordinator(
            env,
            cachedMatchId,
            parsedView.data
          );
          const refreshedResponse = buildViewerProjectionResponse(
            {
              etag: surfaceEnvelope.etag,
              matchId: cachedMatchId,
              payload: surfaceEnvelope.surface,
            },
            viewerOptions.cacheTtlSeconds,
            viewerOptions.staleSeconds
          );
          await writeViewerProjectionCache(cacheContext, refreshedResponse);
        },
        ctx
      );

      if (cachedResponse) {
        return cachedResponse;
      }

      const matchId = await repo.getMatchIdBySlug(slug);

      if (!matchId) {
        return appJson(
          request,
          env,
          { error: "match_not_found" },
          { status: 404 }
        );
      }

      return fetchViewerProjectionResponse(
        request,
        env,
        matchId,
        {
          cacheContext,
          cacheTtlSeconds: viewerOptions.cacheTtlSeconds,
          loadProjection: async (freshMatchId) => {
            const surfaceEnvelope = await getSurfaceEnvelopeFromCoordinator(
              env,
              freshMatchId,
              parsedView.data
            );

            return {
              etag: surfaceEnvelope.etag,
              matchId: freshMatchId,
              payload: surfaceEnvelope.surface,
            };
          },
          skipCacheLookup: true,
          staleSeconds: viewerOptions.staleSeconds,
        },
        ctx
      );
    }

    if (
      url.pathname.startsWith("/api/public/matches/") &&
      url.pathname.endsWith("/snapshot")
    ) {
      if (request.method !== "GET") {
        return withCors(request, env, methodNotAllowed(["GET"]));
      }

      let slug: string;

      try {
        slug = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      } catch {
        return appJson(
          request,
          env,
          { error: "match_not_found" },
          { status: 404 }
        );
      }

      const cacheContext = getViewerProjectionCacheContext(
        request,
        env,
        VIEWER_SNAPSHOT_CACHE_TTL_SECONDS,
        VIEWER_SNAPSHOT_STALE_SECONDS
      );
      const cachedResponse = await tryRespondFromViewerProjectionCache(
        request,
        env,
        cacheContext,
        async (cachedMatchId) => {
          const snapshotEnvelope = await getSnapshotEnvelopeFromCoordinator(
            env,
            cachedMatchId
          );
          const refreshedResponse = buildViewerProjectionResponse(
            {
              etag: snapshotEnvelope.etag,
              matchId: cachedMatchId,
              payload: redactViewerSnapshot(snapshotEnvelope.snapshot),
            },
            VIEWER_SNAPSHOT_CACHE_TTL_SECONDS,
            VIEWER_SNAPSHOT_STALE_SECONDS
          );
          await writeViewerProjectionCache(cacheContext, refreshedResponse);
        },
        ctx
      );

      if (cachedResponse) {
        return cachedResponse;
      }

      const matchId = await repo.getMatchIdBySlug(slug);

      if (!matchId) {
        return appJson(
          request,
          env,
          { error: "match_not_found" },
          { status: 404 }
        );
      }

      return fetchViewerProjectionResponse(
        request,
        env,
        matchId,
        {
          cacheContext,
          cacheTtlSeconds: VIEWER_SNAPSHOT_CACHE_TTL_SECONDS,
          loadProjection: async (freshMatchId) => {
            const snapshotEnvelope = await getSnapshotEnvelopeFromCoordinator(
              env,
              freshMatchId
            );

            return {
              etag: snapshotEnvelope.etag,
              matchId: freshMatchId,
              payload: redactViewerSnapshot(snapshotEnvelope.snapshot),
            };
          },
          skipCacheLookup: true,
          staleSeconds: VIEWER_SNAPSHOT_STALE_SECONDS,
        },
        ctx
      );
    }

    return appJson(request, env, { error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(request, env, error);
  }
}

export default {
  fetch: handleRequest,

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const repo = createRepository(env);
    const chatStore = createChatStore(env);
    const sendReply = createQueueReplySender(env, repo);
    const queuedCommands: QueuedChatCommand[] = [];
    const reconcileMessagesByChannelLinkId = new Map<
      string,
      Message<unknown>[]
    >();
    const revokedMessages: Array<{
      message: Message<unknown>;
      payload: Extract<EdgeQueueMessage, { type: "subscription_revoked" }>;
    }> = [];

    for (const message of batch.messages) {
      const parsed = edgeQueueMessageSchema.safeParse(message.body);

      if (!parsed.success) {
        console.error("invalid queue message", parsed.error.flatten());
        message.ack();
        continue;
      }

      const payload = parsed.data;

      if (payload.type === "chat_command") {
        queuedCommands.push({
          message,
          payload,
          command: parseChatCommand(payload.messageText),
        });
        continue;
      }

      if (payload.type === "subscription_reconcile") {
        const messages =
          reconcileMessagesByChannelLinkId.get(payload.channelLinkId) ?? [];
        messages.push(message);
        reconcileMessagesByChannelLinkId.set(payload.channelLinkId, messages);
        continue;
      }

      if (payload.type === "subscription_revoked") {
        revokedMessages.push({
          message,
          payload,
        });
        continue;
      }

      message.ack();
    }

    if (queuedCommands.length > 0) {
      try {
        await handleChatCommandQueueBatch(
          env,
          chatStore,
          queuedCommands,
          sendReply
        );
      } catch (error) {
        console.error("chat command queue batch failed", error);

        for (const queuedCommand of queuedCommands) {
          queuedCommand.message.retry();
        }
      }
    }

    for (const [channelLinkId, messages] of reconcileMessagesByChannelLinkId) {
      try {
        await reconcileEventSubSubscriptions(
          env,
          repo,
          chatStore,
          channelLinkId
        );

        for (const message of messages) {
          message.ack();
        }
      } catch (error) {
        console.error("subscription reconcile queue message failed", {
          error,
          channelLinkId,
          count: messages.length,
        });

        for (const message of messages) {
          message.retry();
        }
      }
    }

    const manualRepairMessages = new Map<
      string,
      {
        body: Extract<EdgeQueueMessage, { type: "subscription_reconcile" }>;
        originatingMessages: Message<unknown>[];
      }
    >();
    const revokedMessagesWithoutRepair: Message<unknown>[] = [];

    for (const revokedMessage of revokedMessages) {
      try {
        const existing = await chatStore.getEventSubSubscription(
          revokedMessage.payload.subscriptionId
        );

        await chatStore.markEventSubSubscriptionStatus(
          revokedMessage.payload.subscriptionId,
          "revoked",
          revokedMessage.payload.reason
        );

        if (!existing) {
          revokedMessagesWithoutRepair.push(revokedMessage.message);
          continue;
        }

        const existingRepairMessage = manualRepairMessages.get(
          existing.channel_link_id
        );

        if (existingRepairMessage) {
          existingRepairMessage.originatingMessages.push(
            revokedMessage.message
          );
        } else {
          manualRepairMessages.set(existing.channel_link_id, {
            body: {
              type: "subscription_reconcile",
              channelLinkId: existing.channel_link_id,
              reason: "manual_repair",
            },
            originatingMessages: [revokedMessage.message],
          });
        }
      } catch (error) {
        console.error("subscription revocation queue message failed", error);
        revokedMessage.message.retry();
      }
    }

    for (const message of revokedMessagesWithoutRepair) {
      message.ack();
    }

    if (manualRepairMessages.size > 0) {
      try {
        await enqueueEdgeQueueMessages(
          env,
          [...manualRepairMessages.values()].map((entry) => entry.body)
        );

        for (const entry of manualRepairMessages.values()) {
          for (const message of entry.originatingMessages) {
            message.ack();
          }
        }
      } catch (error) {
        console.error("manual repair enqueue failed", error);

        for (const entry of manualRepairMessages.values()) {
          for (const message of entry.originatingMessages) {
            message.retry();
          }
        }
      }
    }
  },
} satisfies ExportedHandler<Env>;
