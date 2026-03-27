import { z } from "zod";

import { roleSchema } from "./roles";

export const matchStatusSchema = z.enum(["draft", "live", "paused", "complete"]);
export const suggestionStatusSchema = z.enum(["board", "approved", "queued", "played", "rejected"]);
export const queueStatusSchema = z.enum(["queued", "live", "completed"]);
export const queueMoveDirectionSchema = z.enum(["up", "down"]);
export const chatStateSchema = z.enum(["idle", "live", "paused_grace", "expired"]);
export const subscriptionHealthSchema = z.enum(["idle", "ready", "repairing", "revoked", "error"]);
export const MATCH_PAUSE_GRACE_MS = 10 * 60 * 1000;
export const MATCH_AUTO_COMPLETE_PAUSED_BUFFER_MS = 5 * 60 * 1000;
export const MATCH_AUTO_COMPLETE_LIVE_INACTIVITY_MS = 3 * 60 * 60 * 1000;
export const MATCH_AUTO_COMPLETE_PAUSED_INACTIVITY_MS =
  MATCH_PAUSE_GRACE_MS + MATCH_AUTO_COMPLETE_PAUSED_BUFFER_MS;
export const websocketEventTypeSchema = z.enum([
  "match.snapshot",
  "suggestions.updated",
  "queue.updated",
  "score.updated",
  "match.status.updated"
]);

export const playerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  channelId: z.string().min(1),
  channelLogin: z.string().min(1),
  role: roleSchema,
  wins: z.number().int().nonnegative()
});

export const suggestionSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  title: z.string().min(1),
  canonicalKey: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  sourceChannelId: z.string().min(1).nullable(),
  suggestedBy: z.string().min(1).nullable(),
  voteCount: z.number().int().nonnegative(),
  status: suggestionStatusSchema
});

export const queueItemSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  sourceSuggestionId: z.string().nullable(),
  status: queueStatusSchema,
  winnerPlayerId: z.string().nullable()
});

export const matchSnapshotSchema = z.object({
  matchId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  status: matchStatusSchema,
  chatState: chatStateSchema,
  chatEnabledUntil: z.string().datetime().nullable(),
  boardRevision: z.number().int().nonnegative(),
  subscriptionHealth: subscriptionHealthSchema,
  targetWins: z.number().int().positive().nullable(),
  players: z.array(playerSchema).min(2),
  suggestions: z.array(suggestionSchema),
  queue: z.array(queueItemSchema),
  currentGameId: z.string().nullable(),
  updatedAt: z.string().datetime()
});

export const websocketEventEnvelopeSchema = z.object({
  type: websocketEventTypeSchema,
  matchId: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.unknown()
});

export const createMatchRequestSchema = z.object({
  channelLinkId: z.string().min(1),
  title: z.string().min(3),
  slug: z.string().min(3).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  targetWins: z.number().int().positive().nullable().default(null)
}).strict();

export const updateMatchStatusRequestSchema = z.object({
  status: matchStatusSchema
}).strict();

export const matchControlActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approve_suggestion"),
    suggestionId: z.string().min(1)
  }),
  z.object({
    type: z.literal("reject_suggestion"),
    suggestionId: z.string().min(1)
  }),
  z.object({
    type: z.literal("add_manual_queue_item"),
    title: z.string().trim().min(1)
  }),
  z.object({
    type: z.literal("remove_queue_item"),
    queueItemId: z.string().min(1)
  }),
  z.object({
    type: z.literal("move_queue_item"),
    queueItemId: z.string().min(1),
    direction: queueMoveDirectionSchema
  }),
  z.object({
    type: z.literal("randomize_queue")
  }),
  z.object({
    type: z.literal("start_next_round")
  }),
  z.object({
    type: z.literal("record_round_winner"),
    queueItemId: z.string().min(1),
    winnerPlayerId: z.string().min(1)
  }),
  z.object({
    type: z.literal("close_round"),
    queueItemId: z.string().min(1).optional()
  })
]);

export const extensionBootstrapRequestSchema = z.object({
  channelId: z.string().min(1),
  role: z.enum(["viewer", "broadcaster", "moderator", "external"]).default("external"),
  opaqueUserId: z.string().min(1).default("U-demo"),
  userId: z.string().min(1).optional()
});

export const boardResponseSchema = z.object({
  matchId: z.string().min(1),
  boardRevision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  suggestions: z.array(suggestionSchema)
});

export const chatCommandQueueMessageSchema = z.object({
  type: z.literal("chat_command"),
  messageId: z.string().min(1),
  sentAt: z.string().datetime(),
  sourceChannelId: z.string().min(1),
  broadcasterId: z.string().min(1),
  viewerId: z.string().min(1),
  messageText: z.string().min(1),
  replyParentId: z.string().min(1).nullable()
});

export const subscriptionReconcileQueueMessageSchema = z.object({
  type: z.literal("subscription_reconcile"),
  channelLinkId: z.string().min(1),
  reason: z.enum(["match_status", "link_accepted", "chat_auth", "manual_repair"])
});

export const subscriptionRevokedQueueMessageSchema = z.object({
  type: z.literal("subscription_revoked"),
  subscriptionId: z.string().min(1),
  broadcasterId: z.string().min(1).nullable(),
  sourceChannelId: z.string().min(1).nullable(),
  reason: z.string().min(1)
});

export const edgeQueueMessageSchema = z.discriminatedUnion("type", [
  chatCommandQueueMessageSchema,
  subscriptionReconcileQueueMessageSchema,
  subscriptionRevokedQueueMessageSchema
]);

export type BoardResponse = z.infer<typeof boardResponseSchema>;
export type ChatCommandQueueMessage = z.infer<typeof chatCommandQueueMessageSchema>;
export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;
export type EdgeQueueMessage = z.infer<typeof edgeQueueMessageSchema>;
export type MatchControlAction = z.infer<typeof matchControlActionSchema>;
export type MatchAutoCompleteReason = "paused_inactive" | "live_inactive";
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type Player = z.infer<typeof playerSchema>;
export type QueueItem = z.infer<typeof queueItemSchema>;
export type QueueMoveDirection = z.infer<typeof queueMoveDirectionSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type SubscriptionReconcileQueueMessage = z.infer<typeof subscriptionReconcileQueueMessageSchema>;
export type SubscriptionRevokedQueueMessage = z.infer<typeof subscriptionRevokedQueueMessageSchema>;
export type UpdateMatchStatusRequest = z.infer<typeof updateMatchStatusRequestSchema>;
export type WebsocketEventEnvelope = z.infer<typeof websocketEventEnvelopeSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMatchAutoCompleteAt(input: {
  status: MatchSnapshot["status"];
  chatEnabledUntil: string | null;
  updatedAt: string;
}): number | null {
  switch (input.status) {
    case "live": {
      const updatedAt = parseTimestamp(input.updatedAt);
      return updatedAt === null
        ? null
        : updatedAt + MATCH_AUTO_COMPLETE_LIVE_INACTIVITY_MS;
    }
    case "paused": {
      const chatEnabledUntil = parseTimestamp(input.chatEnabledUntil);

      if (chatEnabledUntil !== null) {
        return chatEnabledUntil + MATCH_AUTO_COMPLETE_PAUSED_BUFFER_MS;
      }

      const updatedAt = parseTimestamp(input.updatedAt);
      return updatedAt === null
        ? null
        : updatedAt + MATCH_AUTO_COMPLETE_PAUSED_INACTIVITY_MS;
    }
    default:
      return null;
  }
}

export function getMatchAutoCompleteReason(
  input: {
    status: MatchSnapshot["status"];
    chatEnabledUntil: string | null;
    updatedAt: string;
  },
  now = Date.now()
): MatchAutoCompleteReason | null {
  const autoCompleteAt = getMatchAutoCompleteAt(input);

  if (autoCompleteAt === null || now < autoCompleteAt) {
    return null;
  }

  switch (input.status) {
    case "live":
      return "live_inactive";
    case "paused":
      return "paused_inactive";
    default:
      return null;
  }
}

function createQueueItemId(): string {
  return `queue_${crypto.randomUUID()}`;
}

function reindexQueue(queue: QueueItem[]): QueueItem[] {
  return queue.map((entry, index) =>
    entry.order === index ? entry : { ...entry, order: index }
  );
}

function updateSuggestionStatus(
  suggestions: Suggestion[],
  suggestionId: string,
  status: Suggestion["status"]
): Suggestion[] {
  let changed = false;
  const nextSuggestions = suggestions.map((entry) => {
    if (entry.id !== suggestionId || entry.status === status) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      status,
    };
  });

  return changed ? nextSuggestions : suggestions;
}

function completeRound(
  snapshot: MatchSnapshot,
  queueItemId: string,
  winnerPlayerId: string | null
): MatchSnapshot {
  const liveItem = snapshot.queue.find((entry) => entry.id === queueItemId);

  if (!liveItem || liveItem.status !== "live") {
    return snapshot;
  }

  if (
    winnerPlayerId &&
    !snapshot.players.some((player) => player.id === winnerPlayerId)
  ) {
    return snapshot;
  }

  const completedQueue = snapshot.queue.map((entry) =>
    entry.id === queueItemId
      ? {
          ...entry,
          status: "completed" as const,
          winnerPlayerId,
        }
      : entry
  );
  const nextQueued = completedQueue.find((entry) => entry.status === "queued");
  const queue = completedQueue.map((entry) =>
    entry.id === nextQueued?.id
      ? {
          ...entry,
          status: "live" as const,
        }
      : entry
  );
  const suggestions = liveItem.sourceSuggestionId
    ? updateSuggestionStatus(
        snapshot.suggestions,
        liveItem.sourceSuggestionId,
        "played"
      )
    : snapshot.suggestions;

  return {
    ...snapshot,
    players: winnerPlayerId
      ? snapshot.players.map((player) =>
          player.id === winnerPlayerId
            ? { ...player, wins: player.wins + 1 }
            : player
        )
      : snapshot.players,
    suggestions,
    queue,
    currentGameId: nextQueued?.id ?? null,
    updatedAt: nowIso()
  };
}

export function approveSuggestion(snapshot: MatchSnapshot, suggestionId: string): MatchSnapshot {
  const suggestion = snapshot.suggestions.find((entry) => entry.id === suggestionId);
  if (!suggestion || suggestion.status !== "board") {
    return snapshot;
  }

  if (
    snapshot.queue.some(
      (entry) =>
        entry.sourceSuggestionId === suggestionId && entry.status !== "completed"
    )
  ) {
    return snapshot;
  }

  const nextOrder = snapshot.queue.length;
  const nextQueueId = createQueueItemId();
  const nextSuggestions = updateSuggestionStatus(
    snapshot.suggestions,
    suggestionId,
    "queued"
  );

  return {
    ...snapshot,
    suggestions: nextSuggestions,
    queue: [
      ...snapshot.queue,
      {
        id: nextQueueId,
        order: nextOrder,
        title: suggestion.title,
        sourceSuggestionId: suggestion.id,
        status: snapshot.currentGameId ? "queued" : "live",
        winnerPlayerId: null
      }
    ],
    currentGameId: snapshot.currentGameId ?? nextQueueId,
    updatedAt: nowIso()
  };
}

export function rejectSuggestion(
  snapshot: MatchSnapshot,
  suggestionId: string
): MatchSnapshot {
  const suggestion = snapshot.suggestions.find((entry) => entry.id === suggestionId);

  if (!suggestion || suggestion.status !== "board") {
    return snapshot;
  }

  const suggestions = updateSuggestionStatus(
    snapshot.suggestions,
    suggestionId,
    "rejected"
  );

  return {
    ...snapshot,
    suggestions,
    updatedAt: nowIso()
  };
}

export function addManualQueueItem(
  snapshot: MatchSnapshot,
  title: string
): MatchSnapshot {
  const trimmedTitle = title.trim();

  if (trimmedTitle.length === 0) {
    return snapshot;
  }

  const nextQueueId = createQueueItemId();

  return {
    ...snapshot,
    queue: [
      ...snapshot.queue,
      {
        id: nextQueueId,
        order: snapshot.queue.length,
        title: trimmedTitle,
        sourceSuggestionId: null,
        status: snapshot.currentGameId ? "queued" : "live",
        winnerPlayerId: null
      }
    ],
    currentGameId: snapshot.currentGameId ?? nextQueueId,
    updatedAt: nowIso()
  };
}

export function removeQueueItem(
  snapshot: MatchSnapshot,
  queueItemId: string
): MatchSnapshot {
  const queueItem = snapshot.queue.find((entry) => entry.id === queueItemId);

  if (!queueItem || queueItem.status !== "queued") {
    return snapshot;
  }

  const suggestions = queueItem.sourceSuggestionId
    ? updateSuggestionStatus(
        snapshot.suggestions,
        queueItem.sourceSuggestionId,
        "board"
      )
    : snapshot.suggestions;

  return {
    ...snapshot,
    suggestions,
    queue: reindexQueue(
      snapshot.queue.filter((entry) => entry.id !== queueItemId)
    ),
    updatedAt: nowIso()
  };
}

export function moveQueueItem(
  snapshot: MatchSnapshot,
  queueItemId: string,
  direction: QueueMoveDirection
): MatchSnapshot {
  const queuedIndices = snapshot.queue.reduce<number[]>((indices, entry, index) => {
    if (entry.status === "queued") {
      indices.push(index);
    }

    return indices;
  }, []);
  const queuedItems = queuedIndices.map((index) => snapshot.queue[index]);
  const queuedPosition = queuedItems.findIndex((entry) => entry.id === queueItemId);

  if (queuedPosition === -1) {
    return snapshot;
  }

  const targetPosition =
    direction === "up" ? queuedPosition - 1 : queuedPosition + 1;

  if (targetPosition < 0 || targetPosition >= queuedItems.length) {
    return snapshot;
  }

  const nextQueuedItems = [...queuedItems];
  const currentItem = nextQueuedItems[queuedPosition];
  nextQueuedItems[queuedPosition] = nextQueuedItems[targetPosition];
  nextQueuedItems[targetPosition] = currentItem;

  const nextQueue = [...snapshot.queue];
  queuedIndices.forEach((index, itemIndex) => {
    nextQueue[index] = nextQueuedItems[itemIndex];
  });

  return {
    ...snapshot,
    queue: reindexQueue(nextQueue),
    updatedAt: nowIso()
  };
}

export function randomizeUpcomingQueue(
  snapshot: MatchSnapshot,
  random: () => number = Math.random
): MatchSnapshot {
  const queuedIndices = snapshot.queue.reduce<number[]>((indices, entry, index) => {
    if (entry.status === "queued") {
      indices.push(index);
    }

    return indices;
  }, []);

  if (queuedIndices.length < 2) {
    return snapshot;
  }

  const shuffledQueuedItems = queuedIndices
    .map((index) => snapshot.queue[index])
    .slice();

  for (let index = shuffledQueuedItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffledQueuedItems[index];
    shuffledQueuedItems[index] = shuffledQueuedItems[swapIndex];
    shuffledQueuedItems[swapIndex] = current;
  }

  const nextQueue = [...snapshot.queue];
  queuedIndices.forEach((index, itemIndex) => {
    nextQueue[index] = shuffledQueuedItems[itemIndex];
  });

  return {
    ...snapshot,
    queue: reindexQueue(nextQueue),
    updatedAt: nowIso()
  };
}

export function startNextRound(snapshot: MatchSnapshot): MatchSnapshot {
  if (snapshot.currentGameId) {
    return snapshot;
  }

  const nextQueued = snapshot.queue.find((entry) => entry.status === "queued");

  if (!nextQueued) {
    return snapshot;
  }

  return {
    ...snapshot,
    queue: snapshot.queue.map((entry) =>
      entry.id === nextQueued.id
        ? {
            ...entry,
            status: "live"
          }
        : entry
    ),
    currentGameId: nextQueued.id,
    updatedAt: nowIso()
  };
}

export function closeCurrentRound(
  snapshot: MatchSnapshot,
  queueItemId?: string
): MatchSnapshot {
  const liveItemId =
    queueItemId ??
    snapshot.queue.find((entry) => entry.status === "live")?.id ??
    snapshot.currentGameId;

  if (!liveItemId) {
    return snapshot;
  }

  return completeRound(snapshot, liveItemId, null);
}

export function recordQueueWin(
  snapshot: MatchSnapshot,
  queueItemId: string,
  winnerPlayerId: string
): MatchSnapshot {
  return completeRound(snapshot, queueItemId, winnerPlayerId);
}

export function applyMatchControlAction(
  snapshot: MatchSnapshot,
  action: MatchControlAction
): MatchSnapshot {
  switch (action.type) {
    case "approve_suggestion":
      return approveSuggestion(snapshot, action.suggestionId);
    case "reject_suggestion":
      return rejectSuggestion(snapshot, action.suggestionId);
    case "add_manual_queue_item":
      return addManualQueueItem(snapshot, action.title);
    case "remove_queue_item":
      return removeQueueItem(snapshot, action.queueItemId);
    case "move_queue_item":
      return moveQueueItem(snapshot, action.queueItemId, action.direction);
    case "randomize_queue":
      return randomizeUpcomingQueue(snapshot);
    case "start_next_round":
      return startNextRound(snapshot);
    case "record_round_winner":
      return recordQueueWin(snapshot, action.queueItemId, action.winnerPlayerId);
    case "close_round":
      return closeCurrentRound(snapshot, action.queueItemId);
    default:
      return snapshot;
  }
}

export function createWebsocketEnvelope(
  type: WebsocketEventEnvelope["type"],
  matchId: string,
  payload: unknown
): WebsocketEventEnvelope {
  return {
    type,
    matchId,
    occurredAt: new Date().toISOString(),
    payload
  };
}
