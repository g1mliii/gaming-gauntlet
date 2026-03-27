import type { MatchSnapshot, Suggestion } from "@gaming-gauntlet/contracts";

import type { Env } from "../env";
import { AppError, createRepository } from "./repository";

type QueryResult<T> = {
  results?: T[];
};

type ChatTargetRow = {
  match_id: string;
  channel_link_id: string;
  source_twitch_channel_id: string;
  broadcaster_twitch_channel_id: string;
  internal_channel_id: string;
};

type SubscriptionRow = {
  id: string;
  subscription_id: string;
  channel_link_id: string;
  source_twitch_channel_id: string;
  broadcaster_twitch_channel_id: string;
  status: string;
  last_error: string | null;
};

type SubscriptionPlanRow = {
  channel_link_id: string;
  owner_twitch_channel_id: string;
  linked_twitch_channel_id: string | null;
  owner_authorized: string | null;
  linked_authorized: string | null;
};

type PersistedSuggestionRow = {
  id: string;
  board_id: string;
  title: string;
  canonical_key: string;
  aliases_json: string;
  source_channel_id: string;
  suggested_by: string;
  status: Suggestion["status"];
  vote_count: number;
  created_at: string;
  updated_at: string;
};

type VoteSelectionRow = {
  voter_twitch_id: string;
  suggestion_id: string;
};

type ProcessedMessageRow = {
  message_id: string;
  expires_at: string;
};

export type ResolvedChatTarget = {
  matchId: string;
  channelLinkId: string;
  sourceTwitchChannelId: string;
  broadcasterTwitchChannelId: string;
  internalSourceChannelId: string;
};

export type PersistedSuggestionState = Suggestion & {
  createdAt: string;
  updatedAt: string;
};

export type LoadedCommandState = {
  snapshot: MatchSnapshot;
  suggestions: PersistedSuggestionState[];
  viewerVotes: Map<string, string>;
  recentMessageIds: Map<string, number>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function plusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
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

export function createChatStore(env: Env) {
  const db = env.DB;
  const repo = createRepository(env);

  async function resolveChatCommandTarget(
    sourceTwitchChannelId: string
  ): Promise<ResolvedChatTarget | null> {
    const row = await first<ChatTargetRow>(
      db,
      `SELECT
          target.match_id,
          target.channel_link_id,
          target.source_twitch_channel_id,
          target.source_twitch_channel_id AS broadcaster_twitch_channel_id,
          channel.id AS internal_channel_id
        FROM channel_chat_targets target
        JOIN channels channel ON channel.twitch_channel_id = target.source_twitch_channel_id
        WHERE target.source_twitch_channel_id = ?
          AND (target.enabled_until IS NULL OR target.enabled_until > ?)
        LIMIT 1`,
      sourceTwitchChannelId,
      nowIso()
    );

    if (!row) {
      return null;
    }

    return {
      matchId: row.match_id,
      channelLinkId: row.channel_link_id,
      sourceTwitchChannelId: row.source_twitch_channel_id,
      broadcasterTwitchChannelId: row.broadcaster_twitch_channel_id,
      internalSourceChannelId: row.internal_channel_id,
    };
  }

  async function resolveChatCommandTargets(
    sourceTwitchChannelIds: string[]
  ): Promise<Map<string, ResolvedChatTarget>> {
    const uniqueSourceChannelIds = [...new Set(sourceTwitchChannelIds)];

    if (uniqueSourceChannelIds.length === 0) {
      return new Map();
    }

    const placeholders = uniqueSourceChannelIds.map(() => "?").join(", ");
    const rows = await all<ChatTargetRow>(
      db,
      `SELECT
          target.match_id,
          target.channel_link_id,
          target.source_twitch_channel_id,
          target.source_twitch_channel_id AS broadcaster_twitch_channel_id,
          channel.id AS internal_channel_id
        FROM channel_chat_targets target
        JOIN channels channel ON channel.twitch_channel_id = target.source_twitch_channel_id
        WHERE target.source_twitch_channel_id IN (${placeholders})
          AND (target.enabled_until IS NULL OR target.enabled_until > ?)`,
      ...uniqueSourceChannelIds,
      nowIso()
    );

    return new Map(
      rows.map((row) => [
        row.source_twitch_channel_id,
        {
          matchId: row.match_id,
          channelLinkId: row.channel_link_id,
          sourceTwitchChannelId: row.source_twitch_channel_id,
          broadcasterTwitchChannelId: row.broadcaster_twitch_channel_id,
          internalSourceChannelId: row.internal_channel_id,
        } satisfies ResolvedChatTarget,
      ])
    );
  }

  async function getSubscriptionPlan(channelLinkId: string): Promise<{
    channelLinkId: string;
    ownerTwitchChannelId: string;
    linkedTwitchChannelId: string;
    ownerAuthorized: boolean;
    linkedAuthorized: boolean;
    activeSourceChannelIds: string[];
  } | null> {
    const row = await first<SubscriptionPlanRow>(
      db,
      `SELECT
          link.id AS channel_link_id,
          owner_channel.twitch_channel_id AS owner_twitch_channel_id,
          linked_channel.twitch_channel_id AS linked_twitch_channel_id,
          owner_token.id AS owner_authorized,
          linked_token.id AS linked_authorized
        FROM channel_links link
        JOIN channels owner_channel ON owner_channel.id = link.owner_channel_id
        LEFT JOIN channels linked_channel ON linked_channel.id = link.linked_channel_id
        LEFT JOIN twitch_tokens owner_token
          ON owner_token.channel_id = link.owner_channel_id
          AND owner_token.scopes_json LIKE '%channel:bot%'
        LEFT JOIN twitch_tokens linked_token
          ON linked_token.channel_id = link.linked_channel_id
          AND linked_token.scopes_json LIKE '%channel:bot%'
        WHERE link.id = ?
        LIMIT 1`,
      channelLinkId
    );

    if (!row || !row.linked_twitch_channel_id) {
      return null;
    }

    const targets = await all<{ source_twitch_channel_id: string }>(
      db,
      `SELECT source_twitch_channel_id
        FROM channel_chat_targets
        WHERE channel_link_id = ?
          AND (enabled_until IS NULL OR enabled_until > ?)`,
      channelLinkId,
      nowIso()
    );

    return {
      channelLinkId,
      ownerTwitchChannelId: row.owner_twitch_channel_id,
      linkedTwitchChannelId: row.linked_twitch_channel_id,
      ownerAuthorized: Boolean(row.owner_authorized),
      linkedAuthorized: Boolean(row.linked_authorized),
      activeSourceChannelIds: targets.map(
        (target) => target.source_twitch_channel_id
      ),
    };
  }

  async function listEventSubSubscriptions(
    channelLinkId: string
  ): Promise<SubscriptionRow[]> {
    return all<SubscriptionRow>(
      db,
      `SELECT
          id,
          subscription_id,
          channel_link_id,
          source_twitch_channel_id,
          broadcaster_twitch_channel_id,
          status,
          last_error
        FROM eventsub_subscriptions
        WHERE channel_link_id = ?`,
      channelLinkId
    );
  }

  async function getEventSubSubscription(
    subscriptionId: string
  ): Promise<SubscriptionRow | null> {
    return first<SubscriptionRow>(
      db,
      `SELECT
          id,
          subscription_id,
          channel_link_id,
          source_twitch_channel_id,
          broadcaster_twitch_channel_id,
          status,
          last_error
        FROM eventsub_subscriptions
        WHERE subscription_id = ?
        LIMIT 1`,
      subscriptionId
    );
  }

  async function upsertEventSubSubscription(input: {
    channelLinkId: string;
    subscriptionId: string;
    sourceTwitchChannelId: string;
    broadcasterTwitchChannelId: string;
    status: string;
    lastVerifiedAt?: string | null;
    lastError?: string | null;
  }): Promise<void> {
    const timestamp = nowIso();

    await run(
      db,
      `INSERT INTO eventsub_subscriptions (
          id,
          subscription_id,
          channel_link_id,
          source_twitch_channel_id,
          broadcaster_twitch_channel_id,
          type,
          status,
          last_verified_at,
          last_error,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'channel.chat.message', ?, ?, ?, ?, ?)
        ON CONFLICT(subscription_id) DO UPDATE SET
          status = excluded.status,
          last_verified_at = excluded.last_verified_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`,
      `eventsub_${input.subscriptionId}`,
      input.subscriptionId,
      input.channelLinkId,
      input.sourceTwitchChannelId,
      input.broadcasterTwitchChannelId,
      input.status,
      input.lastVerifiedAt ?? null,
      input.lastError ?? null,
      timestamp,
      timestamp
    );
  }

  async function markEventSubSubscriptionStatus(
    subscriptionId: string,
    status: string,
    lastError: string | null = null
  ): Promise<void> {
    await run(
      db,
      `UPDATE eventsub_subscriptions
        SET status = ?,
            last_error = ?,
            last_verified_at = CASE WHEN ? = 'enabled' THEN ? ELSE last_verified_at END,
            updated_at = ?
        WHERE subscription_id = ?`,
      status,
      lastError,
      status,
      nowIso(),
      nowIso(),
      subscriptionId
    );
  }

  async function deleteEventSubSubscriptions(
    channelLinkId: string
  ): Promise<void> {
    await run(
      db,
      `DELETE FROM eventsub_subscriptions WHERE channel_link_id = ?`,
      channelLinkId
    );
  }

  async function loadCommandState(
    matchId: string
  ): Promise<LoadedCommandState> {
    const timestamp = nowIso();
    const snapshot = await repo.getMatchSnapshot(matchId);

    if (!snapshot) {
      throw new AppError(404, "match_not_found");
    }

    const suggestions = await all<PersistedSuggestionRow>(
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
          vote_count,
          created_at,
          updated_at
        FROM suggestions
        WHERE match_id = ?
        ORDER BY CAST(board_id AS INTEGER) ASC`,
      matchId
    );
    const votes = await all<VoteSelectionRow>(
      db,
      `SELECT voter_twitch_id, suggestion_id
        FROM votes
        WHERE match_id = ?`,
      matchId
    );
    const processedMessages = await all<ProcessedMessageRow>(
      db,
      `SELECT message_id, expires_at
        FROM processed_command_messages
        WHERE match_id = ?
          AND expires_at > ?
        ORDER BY expires_at ASC`,
      matchId,
      timestamp
    );

    return {
      snapshot,
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
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      viewerVotes: new Map(
        votes.map((row) => [row.voter_twitch_id, row.suggestion_id])
      ),
      recentMessageIds: processedMessages.reduce((map, row) => {
        const expiresAt = Date.parse(row.expires_at);

        if (Number.isFinite(expiresAt)) {
          map.set(row.message_id, expiresAt);
        }

        return map;
      }, new Map<string, number>()),
    };
  }

  async function flushCommandState(input: {
    matchId: string;
    boardRevision: number;
    updatedAt: string;
    dirtySuggestions: PersistedSuggestionState[];
    dirtyVotes: Array<{
      viewerId: string;
      suggestionId: string;
      sourceChannelId: string;
    }>;
    processedMessages: Array<{
      messageId: string;
      sourceTwitchChannelId: string;
    }>;
    players?: MatchSnapshot["players"];
    dirtyQueueEntries?: MatchSnapshot["queue"];
    removedQueueIds?: string[];
  }): Promise<void> {
    const commands: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE matches
            SET board_revision = ?,
                updated_at = ?
            WHERE id = ?`
        )
        .bind(input.boardRevision, input.updatedAt, input.matchId),
      db
        .prepare(
          `DELETE FROM processed_command_messages WHERE match_id = ? AND expires_at <= ?`
        )
        .bind(input.matchId, nowIso()),
    ];

    if (input.players) {
      for (const player of input.players) {
        commands.push(
          db
            .prepare(
              `UPDATE match_participants
                SET wins = ?
                WHERE id = ?
                  AND match_id = ?`
            )
            .bind(player.wins, player.id, input.matchId)
        );
      }
    }

    if (input.removedQueueIds && input.removedQueueIds.length > 0) {
      const placeholders = input.removedQueueIds.map(() => "?").join(", ");
      commands.push(
        db
          .prepare(
            `DELETE FROM queue_entries
              WHERE match_id = ?
                AND id IN (${placeholders})`
          )
          .bind(input.matchId, ...input.removedQueueIds)
      );
    }

    if (input.dirtyQueueEntries) {
      for (const entry of input.dirtyQueueEntries) {
        commands.push(
          db
            .prepare(
              `INSERT INTO queue_entries (
                  id,
                  match_id,
                  suggestion_id,
                  title,
                  order_index,
                  status,
                  winner_participant_id,
                  created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  suggestion_id = excluded.suggestion_id,
                  title = excluded.title,
                  order_index = excluded.order_index,
                  status = excluded.status,
                  winner_participant_id = excluded.winner_participant_id`
            )
            .bind(
              entry.id,
              input.matchId,
              entry.sourceSuggestionId,
              entry.title,
              entry.order,
              entry.status,
              entry.winnerPlayerId,
              input.updatedAt
            )
        );
      }
    }

    for (const suggestion of input.dirtySuggestions) {
      commands.push(
        db
          .prepare(
            `INSERT INTO suggestions (
                id,
                match_id,
                board_id,
                canonical_key,
                title,
                aliases_json,
                source_channel_id,
                suggested_by,
                status,
                vote_count,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                board_id = excluded.board_id,
                title = excluded.title,
                aliases_json = excluded.aliases_json,
                source_channel_id = excluded.source_channel_id,
                suggested_by = excluded.suggested_by,
                status = excluded.status,
                vote_count = excluded.vote_count,
                updated_at = excluded.updated_at`
          )
          .bind(
            suggestion.id,
            input.matchId,
            suggestion.boardId,
            suggestion.canonicalKey,
            suggestion.title,
            JSON.stringify(suggestion.aliases),
            suggestion.sourceChannelId,
            suggestion.suggestedBy,
            suggestion.status,
            suggestion.voteCount,
            suggestion.createdAt,
            suggestion.updatedAt
          )
      );
    }

    for (const vote of input.dirtyVotes) {
      commands.push(
        db
          .prepare(
            `INSERT INTO votes (
                id,
                match_id,
                suggestion_id,
                voter_twitch_id,
                source_channel_id,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(match_id, voter_twitch_id) DO UPDATE SET
                suggestion_id = excluded.suggestion_id,
                source_channel_id = excluded.source_channel_id,
                created_at = excluded.created_at`
          )
          .bind(
            `vote_${input.matchId}_${vote.viewerId}`,
            input.matchId,
            vote.suggestionId,
            vote.viewerId,
            vote.sourceChannelId,
            input.updatedAt
          )
      );
    }

    for (const processed of input.processedMessages) {
      commands.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO processed_command_messages (
                message_id,
                match_id,
                source_twitch_channel_id,
                processed_at,
                expires_at
              )
              VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            processed.messageId,
            input.matchId,
            processed.sourceTwitchChannelId,
            input.updatedAt,
            plusMinutes(15)
          )
      );
    }

    await db.batch(commands);
  }

  return {
    deleteEventSubSubscriptions,
    flushCommandState,
    getEventSubSubscription,
    getSubscriptionPlan,
    listEventSubSubscriptions,
    loadCommandState,
    markEventSubSubscriptionStatus,
    resolveChatCommandTarget,
    resolveChatCommandTargets,
    upsertEventSubSubscription,
  };
}
