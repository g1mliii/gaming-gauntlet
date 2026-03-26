import type {
  AuditLogEntry,
  AuthChannel,
  AuthSession,
  AuthUser,
  BoardResponse,
  ChannelLinkInvite,
  ChannelLinkSummary,
  InviteStatus,
  MatchSnapshot,
  MatchSummary,
  Suggestion,
  Role,
} from "@gaming-gauntlet/contracts";
import { canCreateMatches } from "@gaming-gauntlet/contracts";

import type { Env } from "../env";
import { decryptString, encryptString, randomToken, sha256Hex } from "./crypto";
import {
  refreshAccessToken,
  type TwitchIdentity,
  type ValidatedAccessToken,
} from "./twitch";

type QueryResult<T> = {
  results?: T[];
};

type SessionRow = {
  session_id: string;
  expires_at: string;
  user_id: string;
  twitch_user_id: string;
  user_login: string;
  user_display_name: string;
  channel_id: string | null;
  twitch_channel_id: string | null;
  channel_login: string | null;
  channel_display_name: string | null;
};

type StoredTokenRow = {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  scopes_json: string;
};

type LinkRow = {
  id: string;
  status: "pending" | "active";
  pair_key: string | null;
  created_at: string;
  updated_at: string;
  invited_channel_login: string | null;
  owner_channel_id: string;
  linked_channel_id: string | null;
  owner_twitch_channel_id: string;
  owner_login: string;
  owner_display_name: string;
  linked_twitch_channel_id: string | null;
  linked_login: string | null;
  linked_display_name: string | null;
};

type MembershipRow = {
  id: string;
  channel_link_id: string;
  role: Role;
  created_at: string;
  user_id: string;
  twitch_user_id: string;
  user_login: string;
  user_display_name: string;
  channel_id: string;
  twitch_channel_id: string;
  channel_login: string;
  channel_display_name: string;
};

type InviteRow = {
  id: string;
  channel_link_id: string;
  code_hash: string;
  code_ciphertext: string;
  invited_channel_login: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
  created_at: string;
};

type MatchRow = {
  id: string;
  channel_link_id: string;
  slug: string;
  title: string;
  status: "draft" | "live" | "paused" | "complete";
  board_revision: number;
  chat_enabled_until: string | null;
  target_wins: number | null;
  created_at: string;
  updated_at: string;
  participant_id: string;
  participant_role: Role;
  participant_wins: number;
  channel_id: string;
  channel_login: string;
  channel_display_name: string;
};

type AuditLogRow = {
  id: string;
  created_at: string;
  action: AuditLogEntry["action"];
  payload_json: string;
  channel_link_id: string | null;
  match_id: string | null;
  match_title: string | null;
  actor_user_id: string | null;
  actor_login: string | null;
  actor_display_name: string | null;
  owner_login: string | null;
  linked_login: string | null;
  invited_channel_login: string | null;
};

type ChannelScopesRow = {
  channel_id: string;
  scopes_json: string;
};

type SubscriptionStatusRow = {
  channel_link_id: string;
  status: string;
};

type MatchMetaRow = {
  id: string;
  channel_link_id: string;
  slug: string;
  title: string;
  status: MatchSummary["status"];
  board_revision: number;
  chat_enabled_until: string | null;
  target_wins: number | null;
  created_at: string;
  updated_at: string;
};

type MatchAccessRow = MatchMetaRow & {
  owner_twitch_channel_id: string;
  linked_twitch_channel_id: string | null;
};

type SuggestionRow = {
  id: string;
  board_id: string;
  title: string;
  canonical_key: string;
  aliases_json: string;
  source_channel_id: string;
  suggested_by: string;
  status: Suggestion["status"];
  vote_count: number;
};

type QueueRow = {
  id: string;
  title: string;
  order_index: number;
  suggestion_id: string | null;
  status: "queued" | "live" | "completed";
  winner_participant_id: string | null;
};

type SharedBotIdentityRow = {
  user_id: string;
  twitch_user_id: string;
};

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>
  ) {
    super(code);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function plusHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function plusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function stableUserId(twitchUserId: string): string {
  return `user_${twitchUserId}`;
}

function stableChannelId(twitchUserId: string): string {
  return `channel_${twitchUserId}`;
}

function stableTokenId(channelId: string, userId: string): string {
  return `token_${channelId}_${userId}`;
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function buildPairKey(channelA: string, channelB: string): string {
  return [channelA, channelB].sort().join(":");
}

async function all<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const result = (await db
    .prepare(sql)
    .bind(...bindings)
    .all<T>()) as QueryResult<T>;
  return result.results ?? [];
}

async function first<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  return (
    (await db
      .prepare(sql)
      .bind(...bindings)
      .first<T>()) ?? null
  );
}

async function run(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<void> {
  await db
    .prepare(sql)
    .bind(...bindings)
    .run();
}

function groupByLinkId<T extends { channel_link_id: string }>(
  rows: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const current = grouped.get(row.channel_link_id) ?? [];
    current.push(row);
    grouped.set(row.channel_link_id, current);
  }

  return grouped;
}

function parseAuditPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function hasScope(scopes: string[] | undefined, scope: string): boolean {
  return Boolean(scopes?.includes(scope));
}

function deriveSubscriptionHealth(
  statuses: string[]
): MatchSummary["subscriptionHealth"] {
  if (statuses.length === 0) {
    return "idle";
  }

  if (statuses.some((status) => status.includes("revoked"))) {
    return "revoked";
  }

  if (
    statuses.some((status) => status.includes("fail") || status === "repairing")
  ) {
    return "repairing";
  }

  if (statuses.every((status) => status === "enabled")) {
    return "ready";
  }

  if (statuses.some((status) => status.includes("pending"))) {
    return "repairing";
  }

  return "error";
}

function deriveChatState(
  status: MatchSummary["status"],
  chatEnabledUntil: string | null
): MatchSummary["chatState"] {
  if (status === "live") {
    return "live";
  }

  if (status === "paused") {
    return chatEnabledUntil && Date.parse(chatEnabledUntil) > Date.now()
      ? "paused_grace"
      : "expired";
  }

  return "idle";
}

function deriveChatIntegrationStatus(input: {
  linkedChannelId: string | null;
  ownerAuthorized: boolean;
  linkedAuthorized: boolean;
  subscriptionHealth: MatchSummary["subscriptionHealth"];
}): ChannelLinkSummary["chatIntegration"]["status"] {
  if (!input.linkedChannelId) {
    return "idle";
  }

  if (!input.ownerAuthorized || !input.linkedAuthorized) {
    return "needs_consent";
  }

  if (input.subscriptionHealth === "revoked") {
    return "revoked";
  }

  if (
    input.subscriptionHealth === "repairing" ||
    input.subscriptionHealth === "error"
  ) {
    return "repairing";
  }

  if (input.subscriptionHealth === "ready") {
    return "ready";
  }

  return "idle";
}

export function createRepository(env: Env) {
  const db = env.DB;

  async function upsertIdentity(
    profile: TwitchIdentity,
    tokenPayload: {
      accessToken: string;
      refreshToken: string | null;
      expiresIn: number;
      scopes: string[];
      tokenType: string;
    },
    validatedToken: ValidatedAccessToken
  ): Promise<{ user: AuthUser; ownedChannel: AuthChannel }> {
    const userId = stableUserId(profile.id);
    const channelId = stableChannelId(profile.id);
    const normalizedLogin = normalizeLogin(profile.login);
    const accessTokenEncrypted = await encryptString(
      tokenPayload.accessToken,
      env.TOKEN_ENCRYPTION_KEY
    );
    const refreshTokenEncrypted = tokenPayload.refreshToken
      ? await encryptString(tokenPayload.refreshToken, env.TOKEN_ENCRYPTION_KEY)
      : null;
    const expiresAt = new Date(
      Date.now() + tokenPayload.expiresIn * 1000
    ).toISOString();
    const timestamp = nowIso();

    await run(
      db,
      `INSERT INTO users (id, twitch_user_id, login, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(twitch_user_id) DO UPDATE SET
         login = excluded.login,
         display_name = excluded.display_name`,
      userId,
      profile.id,
      normalizedLogin,
      profile.display_name,
      timestamp
    );

    await run(
      db,
      `INSERT INTO channels (id, twitch_channel_id, login, display_name, owner_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(twitch_channel_id) DO UPDATE SET
         login = excluded.login,
         display_name = excluded.display_name,
         owner_user_id = excluded.owner_user_id`,
      channelId,
      profile.id,
      normalizedLogin,
      profile.display_name,
      userId,
      timestamp
    );

    await run(
      db,
      `INSERT INTO twitch_tokens (
          id,
          channel_id,
          subject_user_id,
          token_type,
          access_token_encrypted,
          refresh_token_encrypted,
          expires_at,
          scopes_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          token_type = excluded.token_type,
          access_token_encrypted = excluded.access_token_encrypted,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          expires_at = excluded.expires_at,
          scopes_json = excluded.scopes_json`,
      stableTokenId(channelId, userId),
      channelId,
      userId,
      tokenPayload.tokenType,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt,
      JSON.stringify(tokenPayload.scopes),
      timestamp
    );

    return {
      user: {
        id: userId,
        twitchUserId: validatedToken.user_id,
        login: normalizedLogin,
        displayName: profile.display_name,
      },
      ownedChannel: {
        id: channelId,
        twitchChannelId: validatedToken.user_id,
        login: normalizedLogin,
        displayName: profile.display_name,
      },
    };
  }

  async function createSession(
    userId: string
  ): Promise<{ id: string; expiresAt: string }> {
    const id = randomToken(32);
    const expiresAt = plusDays(30);
    const timestamp = nowIso();

    await run(
      db,
      `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      userId,
      expiresAt,
      timestamp,
      timestamp
    );

    return { id, expiresAt };
  }

  async function getSession(sessionId: string): Promise<AuthSession | null> {
    const row = await first<SessionRow>(
      db,
      `SELECT
          s.id AS session_id,
          s.expires_at,
          u.id AS user_id,
          u.twitch_user_id,
          u.login AS user_login,
          u.display_name AS user_display_name,
          c.id AS channel_id,
          c.twitch_channel_id,
          c.login AS channel_login,
          c.display_name AS channel_display_name
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN channels c ON c.owner_user_id = u.id
        WHERE s.id = ?
          AND s.expires_at > ?
        ORDER BY c.created_at ASC
        LIMIT 1`,
      sessionId,
      nowIso()
    );

    if (!row) {
      return null;
    }

    await run(
      db,
      `UPDATE sessions SET last_seen_at = ? WHERE id = ?`,
      nowIso(),
      sessionId
    );

    return {
      authenticated: true,
      user: {
        id: row.user_id,
        twitchUserId: row.twitch_user_id,
        login: row.user_login,
        displayName: row.user_display_name,
      },
      ownedChannel:
        row.channel_id &&
        row.twitch_channel_id &&
        row.channel_login &&
        row.channel_display_name
          ? {
              id: row.channel_id,
              twitchChannelId: row.twitch_channel_id,
              login: row.channel_login,
              displayName: row.channel_display_name,
            }
          : null,
    };
  }

  async function deleteSession(sessionId: string): Promise<void> {
    await run(db, `DELETE FROM sessions WHERE id = ?`, sessionId);
  }

  async function ensureFreshTwitchToken(
    userId: string
  ): Promise<{ accessToken: string; scopes: string[] }> {
    const token = await first<StoredTokenRow>(
      db,
      `SELECT id, access_token_encrypted, refresh_token_encrypted, expires_at, scopes_json
        FROM twitch_tokens
        WHERE subject_user_id = ?
        LIMIT 1`,
      userId
    );

    if (!token) {
      throw new AppError(404, "token_not_found");
    }

    const accessToken = await decryptString(
      token.access_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY
    );
    const scopes = JSON.parse(token.scopes_json) as string[];

    if (
      !token.expires_at ||
      Date.parse(token.expires_at) > Date.now() + 60_000
    ) {
      return { accessToken, scopes };
    }

    if (!token.refresh_token_encrypted) {
      return { accessToken, scopes };
    }

    const refreshToken = await decryptString(
      token.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY
    );
    const refreshed = await refreshAccessToken(env, refreshToken);
    const expiresAt = new Date(
      Date.now() + refreshed.expires_in * 1000
    ).toISOString();
    const nextScopes = Array.isArray(refreshed.scope)
      ? refreshed.scope
      : typeof refreshed.scope === "string" && refreshed.scope.length > 0
        ? refreshed.scope.split(" ")
        : scopes;

    await run(
      db,
      `UPDATE twitch_tokens
        SET access_token_encrypted = ?,
            refresh_token_encrypted = ?,
            expires_at = ?,
            scopes_json = ?
        WHERE id = ?`,
      await encryptString(refreshed.access_token, env.TOKEN_ENCRYPTION_KEY),
      refreshed.refresh_token
        ? await encryptString(refreshed.refresh_token, env.TOKEN_ENCRYPTION_KEY)
        : token.refresh_token_encrypted,
      expiresAt,
      JSON.stringify(nextScopes),
      token.id
    );

    return {
      accessToken: refreshed.access_token,
      scopes: nextScopes,
    };
  }

  async function getChannelScopes(
    channelIds: string[]
  ): Promise<Map<string, string[]>> {
    if (channelIds.length === 0) {
      return new Map();
    }

    const placeholders = channelIds.map(() => "?").join(", ");
    const rows = await all<ChannelScopesRow>(
      db,
      `SELECT channel_id, scopes_json
        FROM twitch_tokens
        WHERE channel_id IN (${placeholders})`,
      ...channelIds
    );

    const scopesByChannelId = new Map<string, Set<string>>();

    for (const row of rows) {
      const existing =
        scopesByChannelId.get(row.channel_id) ?? new Set<string>();

      for (const scope of parseJsonArray(row.scopes_json)) {
        existing.add(scope);
      }

      scopesByChannelId.set(row.channel_id, existing);
    }

    return new Map(
      [...scopesByChannelId.entries()].map(([channelId, scopes]) => [
        channelId,
        [...scopes],
      ])
    );
  }

  async function getSubscriptionHealthByChannelLinkIds(
    channelLinkIds: string[]
  ): Promise<Map<string, MatchSummary["subscriptionHealth"]>> {
    if (channelLinkIds.length === 0) {
      return new Map();
    }

    const placeholders = channelLinkIds.map(() => "?").join(", ");
    const rows = await all<SubscriptionStatusRow>(
      db,
      `SELECT channel_link_id, status
        FROM eventsub_subscriptions
        WHERE channel_link_id IN (${placeholders})`,
      ...channelLinkIds
    );

    const grouped = new Map<string, string[]>();

    for (const row of rows) {
      const current = grouped.get(row.channel_link_id) ?? [];
      current.push(row.status);
      grouped.set(row.channel_link_id, current);
    }

    return new Map(
      channelLinkIds.map((channelLinkId) => [
        channelLinkId,
        deriveSubscriptionHealth(grouped.get(channelLinkId) ?? []),
      ])
    );
  }

  async function syncChatTargetsForChannelLink(
    channelLinkId: string
  ): Promise<void> {
    const link = await first<{
      id: string;
      owner_twitch_channel_id: string;
      linked_twitch_channel_id: string | null;
    }>(
      db,
      `SELECT
          link.id,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id
        FROM channel_links link
        JOIN channels owner_channel ON owner_channel.id = link.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = link.linked_channel_id
        WHERE link.id = ?
        LIMIT 1`,
      channelLinkId
    );

    if (!link) {
      return;
    }

    const now = nowIso();
    const target = await first<{
      id: string;
      status: MatchSummary["status"];
      chat_enabled_until: string | null;
    }>(
      db,
      `SELECT id, status, chat_enabled_until
        FROM matches
        WHERE channel_link_id = ?
          AND (
            status = 'live'
            OR (status = 'paused' AND chat_enabled_until IS NOT NULL AND chat_enabled_until > ?)
          )
        ORDER BY
          CASE WHEN status = 'live' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 1`,
      channelLinkId,
      now
    );

    await run(
      db,
      `DELETE FROM channel_chat_targets WHERE channel_link_id = ?`,
      channelLinkId
    );

    if (!target || !link.linked_twitch_channel_id) {
      return;
    }

    const state = deriveChatState(target.status, target.chat_enabled_until);
    const enabledUntil =
      target.status === "paused" ? target.chat_enabled_until : null;
    const timestamp = nowIso();

    await db.batch([
      db
        .prepare(
          `INSERT INTO channel_chat_targets (
              source_twitch_channel_id,
              match_id,
              channel_link_id,
              state,
              enabled_until,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          link.owner_twitch_channel_id,
          target.id,
          channelLinkId,
          state,
          enabledUntil,
          timestamp,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO channel_chat_targets (
              source_twitch_channel_id,
              match_id,
              channel_link_id,
              state,
              enabled_until,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          link.linked_twitch_channel_id,
          target.id,
          channelLinkId,
          state,
          enabledUntil,
          timestamp,
          timestamp
        ),
    ]);
  }

  async function getRoleForUser(
    userId: string,
    channelLinkId: string
  ): Promise<Role | null> {
    const row = await first<{ role: Role }>(
      db,
      `SELECT role
        FROM channel_link_memberships
        WHERE channel_link_id = ?
          AND user_id = ?
        LIMIT 1`,
      channelLinkId,
      userId
    );

    return row?.role ?? null;
  }

  async function writeAuditLog(input: {
    action: string;
    actorUserId: string | null;
    matchId?: string | null;
    channelLinkId?: string | null;
    payload: unknown;
  }): Promise<void> {
    await run(
      db,
      `INSERT INTO audit_log (id, match_id, actor_user_id, action, payload_json, channel_link_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `audit_${crypto.randomUUID()}`,
      input.matchId ?? null,
      input.actorUserId,
      input.action,
      JSON.stringify(input.payload),
      input.channelLinkId ?? null,
      nowIso()
    );
  }

  async function getExistingPendingLink(
    ownerChannelId: string,
    invitedChannelLogin: string
  ): Promise<string | null> {
    const row = await first<{ id: string }>(
      db,
      `SELECT cl.id
        FROM channel_links cl
        JOIN channel_link_invites invite ON invite.channel_link_id = cl.id
        WHERE cl.owner_channel_id = ?
          AND cl.status = 'pending'
          AND cl.invited_channel_login = ?
          AND invite.claimed_at IS NULL
          AND invite.expires_at > ?
        LIMIT 1`,
      ownerChannelId,
      invitedChannelLogin,
      nowIso()
    );

    return row?.id ?? null;
  }

  async function createChannelLink(
    user: { id: string; channel: AuthChannel },
    invitedChannelLogin: string
  ) {
    const normalizedLogin = normalizeLogin(invitedChannelLogin);

    if (normalizedLogin === user.channel.login) {
      throw new AppError(400, "cannot_invite_self");
    }

    const existingPending = await getExistingPendingLink(
      user.channel.id,
      normalizedLogin
    );

    if (existingPending) {
      throw new AppError(409, "channel_link_pending");
    }

    const channelLinkId = `link_${crypto.randomUUID()}`;
    const inviteId = `invite_${crypto.randomUUID()}`;
    const ownerMembershipId = `membership_${crypto.randomUUID()}`;
    const inviteCode = randomToken(18);
    const timestamp = nowIso();
    const expiresAt = plusHours(24);

    await db.batch([
      db
        .prepare(
          `INSERT INTO channel_links (
              id,
              status,
              owner_channel_id,
              invited_channel_login,
              linked_channel_id,
              pair_key,
              created_by_user_id,
              created_at,
              updated_at
            )
            VALUES (?, 'pending', ?, ?, NULL, NULL, ?, ?, ?)`
        )
        .bind(
          channelLinkId,
          user.channel.id,
          normalizedLogin,
          user.id,
          timestamp,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO channel_link_invites (
              id,
              channel_link_id,
              code_hash,
              code_ciphertext,
              invited_channel_login,
              expires_at,
              claimed_at,
              claimed_by_user_id,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
        )
        .bind(
          inviteId,
          channelLinkId,
          await sha256Hex(inviteCode),
          await encryptString(inviteCode, env.TOKEN_ENCRYPTION_KEY),
          normalizedLogin,
          expiresAt,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO channel_link_memberships (id, channel_link_id, user_id, channel_id, role, created_at)
            VALUES (?, ?, ?, ?, 'owner', ?)`
        )
        .bind(
          ownerMembershipId,
          channelLinkId,
          user.id,
          user.channel.id,
          timestamp
        ),
    ]);

    await writeAuditLog({
      action: "channel_link.created",
      actorUserId: user.id,
      channelLinkId,
      payload: {
        invitedChannelLogin: normalizedLogin,
      },
    });

    return {
      channelLinkId,
      invite: {
        code: inviteCode,
        shareUrl: `${env.APP_ORIGIN}/link/${inviteCode}`,
        invitedChannelLogin: normalizedLogin,
        expiresAt,
        claimedAt: null,
      } satisfies ChannelLinkInvite,
    };
  }

  async function listChannelLinksForUser(
    userId: string
  ): Promise<ChannelLinkSummary[]> {
    const links = await all<LinkRow>(
      db,
      `SELECT DISTINCT
          cl.id,
          cl.status,
          cl.pair_key,
          cl.created_at,
          cl.updated_at,
          cl.invited_channel_login,
          cl.owner_channel_id,
          cl.linked_channel_id,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          owner_channel.login AS owner_login,
          owner_channel.display_name AS owner_display_name,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id,
          linked_channel.login AS linked_login,
          linked_channel.display_name AS linked_display_name
        FROM channel_links cl
        JOIN channel_link_memberships membership ON membership.channel_link_id = cl.id
        JOIN channels owner_channel ON owner_channel.id = cl.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = cl.linked_channel_id
        WHERE membership.user_id = ?
        ORDER BY cl.updated_at DESC`,
      userId
    );

    if (links.length === 0) {
      return [];
    }

    const linkIds = links.map((row) => row.id);
    const placeholders = linkIds.map(() => "?").join(", ");
    const memberships = await all<MembershipRow>(
      db,
      `SELECT
          membership.id,
          membership.channel_link_id,
          membership.role,
          membership.created_at,
          user.id AS user_id,
          user.twitch_user_id,
          user.login AS user_login,
          user.display_name AS user_display_name,
          channel.id AS channel_id,
          channel.twitch_channel_id,
          channel.login AS channel_login,
          channel.display_name AS channel_display_name
        FROM channel_link_memberships membership
        JOIN users user ON user.id = membership.user_id
        JOIN channels channel ON channel.id = membership.channel_id
        WHERE membership.channel_link_id IN (${placeholders})
        ORDER BY membership.created_at ASC`,
      ...linkIds
    );
    const invites = await all<InviteRow>(
      db,
      `SELECT id, channel_link_id, code_hash, code_ciphertext, invited_channel_login, expires_at, claimed_at, claimed_by_user_id, created_at
        FROM channel_link_invites
        WHERE channel_link_id IN (${placeholders})`,
      ...linkIds
    );
    const scopesByChannelId = await getChannelScopes([
      ...new Set(
        links.flatMap((row) =>
          [row.owner_channel_id, row.linked_channel_id].filter(
            (value): value is string => Boolean(value)
          )
        )
      ),
    ]);
    const subscriptionHealthByLinkId =
      await getSubscriptionHealthByChannelLinkIds(linkIds);

    const membershipsByLink = groupByLinkId(memberships);
    const inviteByLink = new Map(
      invites.map((invite) => [invite.channel_link_id, invite])
    );

    return Promise.all(
      links.map(async (row) => {
        const linkMemberships = membershipsByLink.get(row.id) ?? [];
        const invite = inviteByLink.get(row.id);
        const canInspectPendingInvite =
          invite &&
          invite.claimed_at === null &&
          Date.parse(invite.expires_at) > Date.now() &&
          linkMemberships.some(
            (membership) =>
              membership.user_id === userId && membership.role === "owner"
          );
        const inviteCode = canInspectPendingInvite
          ? await decryptString(
              invite.code_ciphertext,
              env.TOKEN_ENCRYPTION_KEY
            )
          : null;

        return {
          id: row.id,
          status: row.status,
          pairKey: row.pair_key,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ownerChannel: {
            id: row.owner_channel_id,
            twitchChannelId: row.owner_twitch_channel_id,
            login: row.owner_login,
            displayName: row.owner_display_name,
          },
          linkedChannel:
            row.linked_channel_id &&
            row.linked_twitch_channel_id &&
            row.linked_login &&
            row.linked_display_name
              ? {
                  id: row.linked_channel_id,
                  twitchChannelId: row.linked_twitch_channel_id,
                  login: row.linked_login,
                  displayName: row.linked_display_name,
                }
              : null,
          invitedChannelLogin: row.invited_channel_login,
          memberships: linkMemberships.map((membership) => ({
            id: membership.id,
            role: membership.role,
            createdAt: membership.created_at,
            user: {
              id: membership.user_id,
              twitchUserId: membership.twitch_user_id,
              login: membership.user_login,
              displayName: membership.user_display_name,
            },
            channel: {
              id: membership.channel_id,
              twitchChannelId: membership.twitch_channel_id,
              login: membership.channel_login,
              displayName: membership.channel_display_name,
            },
          })),
          pendingInvite:
            invite && inviteCode
              ? {
                  code: inviteCode,
                  shareUrl: `${env.APP_ORIGIN}/link/${inviteCode}`,
                  invitedChannelLogin: invite.invited_channel_login,
                  expiresAt: invite.expires_at,
                  claimedAt: invite.claimed_at,
                }
              : null,
          chatIntegration: {
            ownerAuthorized: hasScope(
              scopesByChannelId.get(row.owner_channel_id),
              "channel:bot"
            ),
            linkedAuthorized:
              row.linked_channel_id !== null
                ? hasScope(
                    scopesByChannelId.get(row.linked_channel_id),
                    "channel:bot"
                  )
                : false,
            status: deriveChatIntegrationStatus({
              linkedChannelId: row.linked_channel_id,
              ownerAuthorized: hasScope(
                scopesByChannelId.get(row.owner_channel_id),
                "channel:bot"
              ),
              linkedAuthorized:
                row.linked_channel_id !== null
                  ? hasScope(
                      scopesByChannelId.get(row.linked_channel_id),
                      "channel:bot"
                    )
                  : false,
              subscriptionHealth:
                subscriptionHealthByLinkId.get(row.id) ?? "idle",
            }),
          },
        } satisfies ChannelLinkSummary;
      })
    );
  }

  async function getInviteRecord(
    inviteCode: string
  ): Promise<(InviteRow & LinkRow) | null> {
    return first<InviteRow & LinkRow>(
      db,
      `SELECT
          invite.id,
          invite.channel_link_id,
          invite.code_hash,
          invite.code_ciphertext,
          invite.invited_channel_login,
          invite.expires_at,
          invite.claimed_at,
          invite.claimed_by_user_id,
          invite.created_at,
          link.status,
          link.pair_key,
          link.updated_at,
          link.created_at,
          link.owner_channel_id,
          link.linked_channel_id,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          owner_channel.login AS owner_login,
          owner_channel.display_name AS owner_display_name,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id,
          linked_channel.login AS linked_login,
          linked_channel.display_name AS linked_display_name
        FROM channel_link_invites invite
        JOIN channel_links link ON link.id = invite.channel_link_id
        JOIN channels owner_channel ON owner_channel.id = link.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = link.linked_channel_id
        WHERE invite.code_hash = ?
        LIMIT 1`,
      await sha256Hex(inviteCode)
    );
  }

  async function getInviteStatus(inviteCode: string): Promise<InviteStatus> {
    const invite = await getInviteRecord(inviteCode);

    if (!invite) {
      return {
        code: inviteCode,
        status: "not_found",
        invitedChannelLogin: null,
        ownerChannel: null,
        claimedChannel: null,
        expiresAt: null,
      };
    }

    return {
      code: inviteCode,
      status:
        invite.claimed_at !== null
          ? "accepted"
          : Date.parse(invite.expires_at) <= Date.now()
            ? "expired"
            : "pending",
      invitedChannelLogin: invite.invited_channel_login,
      ownerChannel: {
        id: invite.owner_channel_id,
        twitchChannelId: invite.owner_twitch_channel_id,
        login: invite.owner_login,
        displayName: invite.owner_display_name,
      },
      claimedChannel:
        invite.linked_channel_id &&
        invite.linked_twitch_channel_id &&
        invite.linked_login &&
        invite.linked_display_name
          ? {
              id: invite.linked_channel_id,
              twitchChannelId: invite.linked_twitch_channel_id,
              login: invite.linked_login,
              displayName: invite.linked_display_name,
            }
          : null,
      expiresAt: invite.expires_at,
    };
  }

  async function acceptInvite(
    user: { id: string; channel: AuthChannel },
    inviteCode: string
  ): Promise<void> {
    const invite = await getInviteRecord(inviteCode);

    if (!invite) {
      throw new AppError(404, "invite_not_found");
    }

    if (invite.claimed_at) {
      throw new AppError(409, "invite_already_claimed");
    }

    if (Date.parse(invite.expires_at) <= Date.now()) {
      throw new AppError(410, "invite_expired");
    }

    if (user.channel.login !== invite.invited_channel_login) {
      throw new AppError(403, "invite_login_mismatch", {
        expectedLogin: invite.invited_channel_login,
        actualLogin: user.channel.login,
      });
    }

    const pairKey = buildPairKey(invite.owner_channel_id, user.channel.id);
    const duplicate = await first<{ id: string }>(
      db,
      `SELECT id
        FROM channel_links
        WHERE pair_key = ?
          AND id != ?
        LIMIT 1`,
      pairKey,
      invite.channel_link_id
    );

    if (duplicate) {
      throw new AppError(409, "duplicate_channel_pair");
    }

    await db.batch([
      db
        .prepare(
          `UPDATE channel_links
            SET status = 'active',
                linked_channel_id = ?,
                pair_key = ?,
                updated_at = ?
            WHERE id = ?`
        )
        .bind(user.channel.id, pairKey, nowIso(), invite.channel_link_id),
      db
        .prepare(
          `UPDATE channel_link_invites
            SET claimed_at = ?, claimed_by_user_id = ?
            WHERE id = ?`
        )
        .bind(nowIso(), user.id, invite.id),
      db
        .prepare(
          `INSERT INTO channel_link_memberships (id, channel_link_id, user_id, channel_id, role, created_at)
            VALUES (?, ?, ?, ?, 'streamer', ?)
            ON CONFLICT(channel_link_id, user_id) DO NOTHING`
        )
        .bind(
          `membership_${crypto.randomUUID()}`,
          invite.channel_link_id,
          user.id,
          user.channel.id,
          nowIso()
        ),
    ]);

    await writeAuditLog({
      action: "channel_link.accepted",
      actorUserId: user.id,
      channelLinkId: invite.channel_link_id,
      payload: {
        claimedChannelId: user.channel.id,
      },
    });
  }

  async function addModerator(
    actorUserId: string,
    channelLinkId: string,
    login: string
  ): Promise<void> {
    const target = await first<{
      user_id: string;
      user_login: string;
      channel_id: string;
    }>(
      db,
      `SELECT
          user.id AS user_id,
          user.login AS user_login,
          channel.id AS channel_id
        FROM users user
        JOIN channels channel ON channel.owner_user_id = user.id
        WHERE user.login = ?
        LIMIT 1`,
      normalizeLogin(login)
    );

    if (!target) {
      throw new AppError(404, "moderator_not_signed_in");
    }

    const existing = await first<{ id: string }>(
      db,
      `SELECT id
        FROM channel_link_memberships
        WHERE channel_link_id = ?
          AND user_id = ?
        LIMIT 1`,
      channelLinkId,
      target.user_id
    );

    if (existing) {
      throw new AppError(409, "membership_exists");
    }

    await run(
      db,
      `INSERT INTO channel_link_memberships (id, channel_link_id, user_id, channel_id, role, created_at)
        VALUES (?, ?, ?, ?, 'mod', ?)`,
      `membership_${crypto.randomUUID()}`,
      channelLinkId,
      target.user_id,
      target.channel_id,
      nowIso()
    );

    await writeAuditLog({
      action: "member.assigned",
      actorUserId,
      channelLinkId,
      payload: {
        login: target.user_login,
        role: "mod",
      },
    });
  }

  async function removeModerator(
    actorUserId: string,
    channelLinkId: string,
    membershipId: string
  ): Promise<void> {
    const membership = await first<{ id: string; role: Role; user_id: string }>(
      db,
      `SELECT id, role, user_id
        FROM channel_link_memberships
        WHERE id = ?
          AND channel_link_id = ?
        LIMIT 1`,
      membershipId,
      channelLinkId
    );

    if (!membership) {
      throw new AppError(404, "membership_not_found");
    }

    if (membership.role !== "mod") {
      throw new AppError(400, "membership_not_moderator");
    }

    await run(
      db,
      `DELETE FROM channel_link_memberships WHERE id = ?`,
      membershipId
    );

    await writeAuditLog({
      action: "member.revoked",
      actorUserId,
      channelLinkId,
      payload: {
        membershipId,
        userId: membership.user_id,
      },
    });
  }

  async function getAccessibleLink(
    userId: string,
    channelLinkId: string
  ): Promise<LinkRow | null> {
    return first<LinkRow>(
      db,
      `SELECT DISTINCT
          cl.id,
          cl.status,
          cl.pair_key,
          cl.created_at,
          cl.updated_at,
          cl.invited_channel_login,
          cl.owner_channel_id,
          cl.linked_channel_id,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          owner_channel.login AS owner_login,
          owner_channel.display_name AS owner_display_name,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id,
          linked_channel.login AS linked_login,
          linked_channel.display_name AS linked_display_name
        FROM channel_links cl
        JOIN channel_link_memberships membership ON membership.channel_link_id = cl.id
        JOIN channels owner_channel ON owner_channel.id = cl.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = cl.linked_channel_id
        WHERE membership.user_id = ?
          AND cl.id = ?
        LIMIT 1`,
      userId,
      channelLinkId
    );
  }

  async function createMatch(
    userId: string,
    input: {
      channelLinkId: string;
      title: string;
      slug: string;
      targetWins: number | null;
    }
  ): Promise<MatchSummary> {
    const link = await getAccessibleLink(userId, input.channelLinkId);

    if (!link) {
      throw new AppError(404, "channel_link_not_found");
    }

    if (
      link.status !== "active" ||
      !link.linked_channel_id ||
      !link.linked_login ||
      !link.linked_display_name
    ) {
      throw new AppError(400, "channel_link_not_active");
    }

    const existing = await first<{ id: string }>(
      db,
      `SELECT id FROM matches WHERE slug = ? LIMIT 1`,
      input.slug
    );

    if (existing) {
      throw new AppError(409, "match_slug_taken");
    }

    const matchId = `match_${crypto.randomUUID()}`;
    const timestamp = nowIso();

    await db.batch([
      db
        .prepare(
          `INSERT INTO matches (
              id,
              slug,
              title,
              status,
              target_wins,
              created_by_user_id,
              created_at,
              updated_at,
              channel_link_id
            )
            VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .bind(
          matchId,
          input.slug,
          input.title,
          input.targetWins,
          userId,
          timestamp,
          timestamp,
          input.channelLinkId
        ),
      db
        .prepare(
          `INSERT INTO match_participants (id, match_id, channel_id, role, wins, created_at)
            VALUES (?, ?, ?, 'streamer', 0, ?)`
        )
        .bind(
          `participant_${crypto.randomUUID()}`,
          matchId,
          link.owner_channel_id,
          timestamp
        ),
      db
        .prepare(
          `INSERT INTO match_participants (id, match_id, channel_id, role, wins, created_at)
            VALUES (?, ?, ?, 'streamer', 0, ?)`
        )
        .bind(
          `participant_${crypto.randomUUID()}`,
          matchId,
          link.linked_channel_id,
          timestamp
        ),
    ]);

    await writeAuditLog({
      action: "match.created",
      actorUserId: userId,
      matchId,
      channelLinkId: input.channelLinkId,
      payload: {
        slug: input.slug,
        title: input.title,
        targetWins: input.targetWins,
      },
    });

    return {
      id: matchId,
      channelLinkId: input.channelLinkId,
      slug: input.slug,
      title: input.title,
      status: "draft",
      chatState: "idle",
      chatEnabledUntil: null,
      boardRevision: 0,
      subscriptionHealth: "idle",
      targetWins: input.targetWins,
      players: [
        {
          id: `player_${link.owner_channel_id}`,
          displayName: link.owner_display_name,
          channelId: link.owner_channel_id,
          channelLogin: link.owner_login,
          role: "streamer",
          wins: 0,
        },
        {
          id: `player_${link.linked_channel_id}`,
          displayName: link.linked_display_name,
          channelId: link.linked_channel_id,
          channelLogin: link.linked_login,
          role: "streamer",
          wins: 0,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async function listMatchesForUser(userId: string): Promise<MatchSummary[]> {
    const rows = await all<MatchRow>(
      db,
      `SELECT
          match.id,
          match.channel_link_id,
          match.slug,
          match.title,
          match.status,
          match.board_revision,
          match.chat_enabled_until,
          match.target_wins,
          match.created_at,
          match.updated_at,
          participant.id AS participant_id,
          participant.role AS participant_role,
          participant.wins AS participant_wins,
          channel.id AS channel_id,
          channel.login AS channel_login,
          channel.display_name AS channel_display_name
        FROM matches match
        JOIN channel_link_memberships membership ON membership.channel_link_id = match.channel_link_id
        JOIN match_participants participant ON participant.match_id = match.id
        JOIN channels channel ON channel.id = participant.channel_id
        WHERE membership.user_id = ?
        ORDER BY match.updated_at DESC, participant.created_at ASC`,
      userId
    );
    const subscriptionHealthByLinkId =
      await getSubscriptionHealthByChannelLinkIds([
        ...new Set(rows.map((row) => row.channel_link_id)),
      ]);

    const grouped = new Map<string, MatchSummary>();

    for (const row of rows) {
      const current = grouped.get(row.id);

      if (current) {
        current.players.push({
          id: row.participant_id,
          displayName: row.channel_display_name,
          channelId: row.channel_id,
          channelLogin: row.channel_login,
          role: row.participant_role,
          wins: row.participant_wins,
        });
        continue;
      }

      grouped.set(row.id, {
        id: row.id,
        channelLinkId: row.channel_link_id,
        slug: row.slug,
        title: row.title,
        status: row.status,
        chatState: deriveChatState(row.status, row.chat_enabled_until),
        chatEnabledUntil: row.chat_enabled_until,
        boardRevision: row.board_revision,
        subscriptionHealth:
          subscriptionHealthByLinkId.get(row.channel_link_id) ?? "idle",
        targetWins: row.target_wins,
        players: [
          {
            id: row.participant_id,
            displayName: row.channel_display_name,
            channelId: row.channel_id,
            channelLogin: row.channel_login,
            role: row.participant_role,
            wins: row.participant_wins,
          },
        ],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return [...grouped.values()];
  }

  async function getAccessibleMatchForUser(
    userId: string,
    matchId: string
  ): Promise<MatchAccessRow | null> {
    return first<MatchAccessRow>(
      db,
      `SELECT
          match.id,
          match.channel_link_id,
          match.slug,
          match.title,
          match.status,
          match.board_revision,
          match.chat_enabled_until,
          match.target_wins,
          match.created_at,
          match.updated_at,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id
        FROM matches match
        JOIN channel_link_memberships membership ON membership.channel_link_id = match.channel_link_id
        JOIN channel_links link ON link.id = match.channel_link_id
        JOIN channels owner_channel ON owner_channel.id = link.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = link.linked_channel_id
        WHERE membership.user_id = ?
          AND match.id = ?
        LIMIT 1`,
      userId,
      matchId
    );
  }

  async function getMatchSummaryForUser(
    userId: string,
    matchId: string
  ): Promise<MatchSummary | null> {
    const match = await getAccessibleMatchForUser(userId, matchId);

    if (!match) {
      return null;
    }

    const playerRows = await all<MatchRow>(
      db,
      `SELECT
          match.id,
          match.channel_link_id,
          match.slug,
          match.title,
          match.status,
          match.board_revision,
          match.chat_enabled_until,
          match.target_wins,
          match.created_at,
          match.updated_at,
          participant.id AS participant_id,
          participant.role AS participant_role,
          participant.wins AS participant_wins,
          channel.id AS channel_id,
          channel.login AS channel_login,
          channel.display_name AS channel_display_name
        FROM matches match
        JOIN match_participants participant ON participant.match_id = match.id
        JOIN channels channel ON channel.id = participant.channel_id
        WHERE match.id = ?
        ORDER BY participant.created_at ASC`,
      matchId
    );
    const subscriptionHealthByLinkId =
      await getSubscriptionHealthByChannelLinkIds([match.channel_link_id]);

    return {
      id: match.id,
      channelLinkId: match.channel_link_id,
      slug: match.slug,
      title: match.title,
      status: match.status,
      chatState: deriveChatState(match.status, match.chat_enabled_until),
      chatEnabledUntil: match.chat_enabled_until,
      boardRevision: match.board_revision,
      subscriptionHealth:
        subscriptionHealthByLinkId.get(match.channel_link_id) ?? "idle",
      targetWins: match.target_wins,
      players: playerRows.map((row) => ({
        id: row.participant_id,
        displayName: row.channel_display_name,
        channelId: row.channel_id,
        channelLogin: row.channel_login,
        role: row.participant_role,
        wins: row.participant_wins,
      })),
      createdAt: match.created_at,
      updatedAt: match.updated_at,
    };
  }

  async function updateMatchStatusForUser(
    userId: string,
    matchId: string,
    nextStatus: MatchSummary["status"]
  ): Promise<MatchSummary> {
    const match = await getAccessibleMatchForUser(userId, matchId);

    if (!match) {
      throw new AppError(404, "match_not_found");
    }

    const role = await getRoleForUser(userId, match.channel_link_id);

    if (!role || !canCreateMatches(role)) {
      throw new AppError(403, "insufficient_permissions");
    }

    const previousStatus = match.status;
    const timestamp = nowIso();
    const chatEnabledUntil = nextStatus === "paused" ? plusMinutes(10) : null;

    if (nextStatus === "live") {
      const existingLive = await first<{ id: string }>(
        db,
        `SELECT id
          FROM matches
          WHERE channel_link_id = ?
            AND status = 'live'
            AND id != ?
          LIMIT 1`,
        match.channel_link_id,
        matchId
      );

      if (existingLive) {
        throw new AppError(409, "live_match_exists");
      }
    }

    await run(
      db,
      `UPDATE matches
        SET status = ?,
            chat_enabled_until = ?,
            updated_at = ?
        WHERE id = ?`,
      nextStatus,
      chatEnabledUntil,
      timestamp,
      matchId
    );

    await syncChatTargetsForChannelLink(match.channel_link_id);
    await writeAuditLog({
      action: "match.status.updated",
      actorUserId: userId,
      matchId,
      channelLinkId: match.channel_link_id,
      payload: {
        fromStatus: previousStatus,
        toStatus: nextStatus,
      },
    });

    const summary = await getMatchSummaryForUser(userId, matchId);

    if (!summary) {
      throw new AppError(404, "match_not_found");
    }

    return summary;
  }

  async function getCompactBoardForUser(
    userId: string,
    matchId: string
  ): Promise<BoardResponse> {
    const match = await getAccessibleMatchForUser(userId, matchId);

    if (!match) {
      throw new AppError(404, "match_not_found");
    }

    const suggestions = await all<SuggestionRow>(
      db,
      `SELECT
          id,
          board_id,
          title,
          canonical_key,
          aliases_json,
          source_channel_id,
          suggested_by,
          status,
          vote_count
        FROM suggestions
        WHERE match_id = ?
        ORDER BY vote_count DESC, CAST(board_id AS INTEGER) ASC
        LIMIT 100`,
      matchId
    );

    return {
      matchId,
      boardRevision: match.board_revision,
      updatedAt: match.updated_at,
      suggestions: suggestions.map((row) => ({
        id: row.id,
        boardId: row.board_id,
        title: row.title,
        canonicalKey: row.canonical_key,
        aliases: parseJsonArray(row.aliases_json),
        sourceChannelId: row.source_channel_id,
        suggestedBy: row.suggested_by,
        voteCount: row.vote_count,
        status: row.status,
      })),
    };
  }

  async function getMatchSnapshot(
    matchId: string
  ): Promise<MatchSnapshot | null> {
    const match = await first<MatchMetaRow>(
      db,
      `SELECT
          id,
          channel_link_id,
          slug,
          title,
          status,
          board_revision,
          chat_enabled_until,
          target_wins,
          created_at,
          updated_at
        FROM matches
        WHERE id = ?
        LIMIT 1`,
      matchId
    );

    if (!match) {
      return null;
    }

    const subscriptionHealthByLinkId =
      await getSubscriptionHealthByChannelLinkIds([match.channel_link_id]);
    const participants = await all<MatchRow>(
      db,
      `SELECT
          match.id,
          match.channel_link_id,
          match.slug,
          match.title,
          match.status,
          match.board_revision,
          match.chat_enabled_until,
          match.target_wins,
          match.created_at,
          match.updated_at,
          participant.id AS participant_id,
          participant.role AS participant_role,
          participant.wins AS participant_wins,
          channel.id AS channel_id,
          channel.login AS channel_login,
          channel.display_name AS channel_display_name
        FROM matches match
        JOIN match_participants participant ON participant.match_id = match.id
        JOIN channels channel ON channel.id = participant.channel_id
        WHERE match.id = ?
        ORDER BY participant.created_at ASC`,
      matchId
    );
    const suggestions = await all<SuggestionRow>(
      db,
      `SELECT
          id,
          board_id,
          title,
          canonical_key,
          aliases_json,
          source_channel_id,
          suggested_by,
          status,
          vote_count
        FROM suggestions
        WHERE match_id = ?
        ORDER BY vote_count DESC, CAST(board_id AS INTEGER) ASC`,
      matchId
    );
    const queue = await all<QueueRow>(
      db,
      `SELECT
          id,
          title,
          order_index,
          suggestion_id,
          status,
          winner_participant_id
        FROM queue_entries
        WHERE match_id = ?
        ORDER BY order_index ASC`,
      matchId
    );

    return {
      matchId: match.id,
      slug: match.slug,
      title: match.title,
      status: match.status,
      chatState: deriveChatState(match.status, match.chat_enabled_until),
      chatEnabledUntil: match.chat_enabled_until,
      boardRevision: match.board_revision,
      subscriptionHealth:
        subscriptionHealthByLinkId.get(match.channel_link_id) ?? "idle",
      targetWins: match.target_wins,
      players: participants.map((row) => ({
        id: row.participant_id,
        displayName: row.channel_display_name,
        channelId: row.channel_id,
        channelLogin: row.channel_login,
        role: row.participant_role,
        wins: row.participant_wins,
      })),
      suggestions: suggestions.map((row) => ({
        id: row.id,
        boardId: row.board_id,
        title: row.title,
        canonicalKey: row.canonical_key,
        aliases: parseJsonArray(row.aliases_json),
        sourceChannelId: row.source_channel_id,
        suggestedBy: row.suggested_by,
        voteCount: row.vote_count,
        status: row.status,
      })),
      queue: queue.map((row) => ({
        id: row.id,
        order: row.order_index,
        title: row.title,
        sourceSuggestionId: row.suggestion_id,
        status: row.status,
        winnerPlayerId: row.winner_participant_id,
      })),
      currentGameId: queue.find((row) => row.status === "live")?.id ?? null,
      updatedAt: match.updated_at,
    };
  }

  async function getMatchSnapshotBySlug(
    slug: string
  ): Promise<MatchSnapshot | null> {
    const matchId = await getMatchIdBySlug(slug);

    if (!matchId) {
      return null;
    }

    return getMatchSnapshot(matchId);
  }

  async function getMatchIdBySlug(slug: string): Promise<string | null> {
    const match = await first<{ id: string }>(
      db,
      `SELECT id
        FROM matches
        WHERE slug = ?
        LIMIT 1`,
      slug
    );

    if (!match) {
      return null;
    }

    return match.id;
  }

  async function findSharedBotIdentity(): Promise<SharedBotIdentityRow | null> {
    return first<SharedBotIdentityRow>(
      db,
      `SELECT
          token.subject_user_id AS user_id,
          user.twitch_user_id
        FROM twitch_tokens token
        JOIN users user ON user.id = token.subject_user_id
        WHERE token.scopes_json LIKE '%user:bot%'
        ORDER BY token.created_at DESC
        LIMIT 1`
    );
  }

  async function listAuditLogForUser(
    userId: string,
    options: {
      channelLinkId?: string;
      limit: number;
    }
  ): Promise<AuditLogEntry[]> {
    const rows = await all<AuditLogRow>(
      db,
      `SELECT
          audit.id,
          audit.created_at,
          audit.action,
          audit.payload_json,
          audit.channel_link_id,
          audit.match_id,
          match_row.title AS match_title,
          actor.id AS actor_user_id,
          actor.login AS actor_login,
          actor.display_name AS actor_display_name,
          owner_channel.login AS owner_login,
          linked_channel.login AS linked_login,
          link.invited_channel_login
        FROM audit_log audit
        LEFT JOIN users actor ON actor.id = audit.actor_user_id
        LEFT JOIN matches match_row ON match_row.id = audit.match_id
        LEFT JOIN channel_links link ON link.id = audit.channel_link_id
        LEFT JOIN channels owner_channel ON owner_channel.id = link.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = link.linked_channel_id
        WHERE audit.channel_link_id IS NOT NULL
          AND audit.action NOT IN ('auth.login', 'auth.logout')
          AND EXISTS (
            SELECT 1
            FROM channel_link_memberships membership
            WHERE membership.channel_link_id = audit.channel_link_id
              AND membership.user_id = ?
          )
          AND (? IS NULL OR audit.channel_link_id = ?)
        ORDER BY audit.created_at DESC
        LIMIT ?`,
      userId,
      options.channelLinkId ?? null,
      options.channelLinkId ?? null,
      options.limit
    );

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      actor:
        row.actor_user_id && row.actor_login && row.actor_display_name
          ? {
              id: row.actor_user_id,
              login: row.actor_login,
              displayName: row.actor_display_name,
            }
          : null,
      channelLinkId: row.channel_link_id,
      channelPairLabel:
        row.owner_login && (row.linked_login ?? row.invited_channel_login)
          ? `@${row.owner_login} vs @${row.linked_login ?? row.invited_channel_login}`
          : null,
      matchId: row.match_id,
      matchTitle: row.match_title,
      payload: parseAuditPayload(row.payload_json),
    }));
  }

  return {
    acceptInvite,
    addModerator,
    createChannelLink,
    createMatch,
    createSession,
    deleteSession,
    ensureFreshTwitchToken,
    findSharedBotIdentity,
    getCompactBoardForUser,
    getInviteStatus,
    getMatchIdBySlug,
    getMatchSnapshot,
    getMatchSnapshotBySlug,
    getMatchSummaryForUser,
    getRoleForUser,
    getSession,
    listAuditLogForUser,
    listChannelLinksForUser,
    listMatchesForUser,
    removeModerator,
    updateMatchStatusForUser,
    upsertIdentity,
    writeAuditLog,
  };
}
