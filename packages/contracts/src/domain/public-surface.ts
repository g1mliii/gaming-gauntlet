import { z } from "zod";

import {
  type MatchSnapshot,
  matchStatusSchema,
  queueStatusSchema,
} from "./match";

export const publicSurfaceViewSchema = z.enum(["page", "overlay"]);

export const publicMatchPlayerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  wins: z.number().int().nonnegative(),
});

export const publicCurrentGameSchema = z.object({
  title: z.string().min(1),
});

export const publicQueuePreviewItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: queueStatusSchema,
});

export const publicBoardEntrySchema = z.object({
  boardId: z.string().min(1),
  title: z.string().min(1),
  voteCount: z.number().int().nonnegative(),
});

export const publicMatchOverlaySurfaceSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  status: matchStatusSchema,
  updatedAt: z.string().datetime(),
  targetWins: z.number().int().positive().nullable(),
  players: z.array(publicMatchPlayerSchema).min(2),
  currentGame: publicCurrentGameSchema.nullable(),
  upcomingQueue: z.array(publicQueuePreviewItemSchema),
});

export const publicMatchPageSurfaceSchema =
  publicMatchOverlaySurfaceSchema.extend({
    boardRevision: z.number().int().nonnegative(),
    topBoard: z.array(publicBoardEntrySchema).max(5),
    remainingQueueCount: z.number().int().nonnegative(),
  });

export type PublicBoardEntry = z.infer<typeof publicBoardEntrySchema>;
export type PublicCurrentGame = z.infer<typeof publicCurrentGameSchema>;
export type PublicMatchOverlaySurface = z.infer<
  typeof publicMatchOverlaySurfaceSchema
>;
export type PublicMatchPageSurface = z.infer<
  typeof publicMatchPageSurfaceSchema
>;
export type PublicMatchPlayer = z.infer<typeof publicMatchPlayerSchema>;
export type PublicQueuePreviewItem = z.infer<
  typeof publicQueuePreviewItemSchema
>;
export type PublicSurfaceView = z.infer<typeof publicSurfaceViewSchema>;

const DEFAULT_QUEUE_PREVIEW_LIMIT = 3;
const DEFAULT_TOP_BOARD_LIMIT = 5;

function toPublicPlayers(snapshot: MatchSnapshot): PublicMatchOverlaySurface["players"] {
  return snapshot.players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    wins: player.wins,
  }));
}

function getCurrentGame(snapshot: MatchSnapshot): PublicCurrentGame | null {
  const currentEntry =
    snapshot.queue.find((entry) => entry.id === snapshot.currentGameId) ??
    snapshot.queue.find((entry) => entry.status === "live") ??
    null;

  return currentEntry ? { title: currentEntry.title } : null;
}

function getUpcomingQueue(
  snapshot: MatchSnapshot,
  queueLimit = DEFAULT_QUEUE_PREVIEW_LIMIT
): PublicQueuePreviewItem[] {
  return snapshot.queue
    .filter((entry) => entry.status === "queued")
    .slice(0, Math.max(queueLimit, 0))
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: entry.status,
    }));
}

function getTopBoard(
  snapshot: MatchSnapshot,
  boardLimit = DEFAULT_TOP_BOARD_LIMIT
): PublicBoardEntry[] {
  return snapshot.suggestions
    .filter((suggestion) => suggestion.status === "board")
    .toSorted(
      (left, right) =>
        right.voteCount - left.voteCount ||
        left.boardId.localeCompare(right.boardId)
    )
    .slice(0, Math.max(boardLimit, 0))
    .map((suggestion) => ({
      boardId: suggestion.boardId,
      title: suggestion.title,
      voteCount: suggestion.voteCount,
    }));
}

export function createPublicMatchOverlaySurface(
  snapshot: MatchSnapshot,
  options?: {
    queueLimit?: number;
  }
): PublicMatchOverlaySurface {
  return {
    slug: snapshot.slug,
    title: snapshot.title,
    status: snapshot.status,
    updatedAt: snapshot.updatedAt,
    targetWins: snapshot.targetWins,
    players: toPublicPlayers(snapshot),
    currentGame: getCurrentGame(snapshot),
    upcomingQueue: getUpcomingQueue(snapshot, options?.queueLimit),
  };
}

export function createPublicMatchPageSurface(
  snapshot: MatchSnapshot,
  options?: {
    boardLimit?: number;
    queueLimit?: number;
  }
): PublicMatchPageSurface {
  return {
    ...createPublicMatchOverlaySurface(snapshot, {
      queueLimit: options?.queueLimit,
    }),
    boardRevision: snapshot.boardRevision,
    topBoard: getTopBoard(snapshot, options?.boardLimit),
    remainingQueueCount: snapshot.queue.filter((entry) => entry.status === "queued")
      .length,
  };
}
