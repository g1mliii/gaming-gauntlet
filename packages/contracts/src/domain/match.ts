import { z } from "zod";

import { roleSchema } from "./roles";

export const matchStatusSchema = z.enum(["draft", "live", "paused", "complete"]);
export const suggestionStatusSchema = z.enum(["board", "approved", "queued", "played", "rejected"]);
export const queueStatusSchema = z.enum(["queued", "live", "completed"]);
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
  sourceChannelId: z.string().min(1),
  suggestedBy: z.string().min(1),
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
  slug: z.string().min(3),
  targetWins: z.number().int().positive().nullable().default(null)
}).strict();

export const extensionBootstrapRequestSchema = z.object({
  channelId: z.string().min(1),
  role: z.enum(["viewer", "broadcaster", "moderator", "external"]).default("external"),
  opaqueUserId: z.string().min(1).default("U-demo"),
  userId: z.string().min(1).optional()
});

export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type Player = z.infer<typeof playerSchema>;
export type QueueItem = z.infer<typeof queueItemSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type WebsocketEventEnvelope = z.infer<typeof websocketEventEnvelopeSchema>;

export function approveSuggestion(snapshot: MatchSnapshot, suggestionId: string): MatchSnapshot {
  const suggestion = snapshot.suggestions.find((entry) => entry.id === suggestionId);
  if (!suggestion) {
    return snapshot;
  }

  const nextOrder = snapshot.queue.length;
  const nextQueueId = `queue-${suggestionId}`;

  return {
    ...snapshot,
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
    suggestions: snapshot.suggestions.map((entry) =>
      entry.id === suggestionId ? { ...entry, status: "queued" } : entry
    ),
    updatedAt: new Date().toISOString()
  };
}

export function recordQueueWin(
  snapshot: MatchSnapshot,
  queueItemId: string,
  winnerPlayerId: string
): MatchSnapshot {
  const completedQueue: QueueItem[] = snapshot.queue.map((entry) =>
    entry.id === queueItemId ? { ...entry, status: "completed", winnerPlayerId } : entry
  );

  const nextQueued = completedQueue.find((entry) => entry.status === "queued");

  return {
    ...snapshot,
    players: snapshot.players.map((player) =>
      player.id === winnerPlayerId ? { ...player, wins: player.wins + 1 } : player
    ),
    queue: completedQueue.map((entry): QueueItem =>
      entry.id === nextQueued?.id ? { ...entry, status: "live" } : entry
    ),
    currentGameId: nextQueued?.id ?? null,
    updatedAt: new Date().toISOString()
  };
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
