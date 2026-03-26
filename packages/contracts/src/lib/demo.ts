import { createCanonicalGameKey } from "../domain/games";
import type { MatchSnapshot } from "../domain/match";

export function createDemoMatchSnapshot(partial?: Partial<MatchSnapshot>): MatchSnapshot {
  const targetWins = partial?.targetWins === undefined ? 3 : partial.targetWins;

  return {
    matchId: partial?.matchId ?? "match_demo_01",
    slug: partial?.slug ?? "speedrun-showdown",
    title: partial?.title ?? "Gaming Gauntlet: Speedrun Showdown",
    status: partial?.status ?? "live",
    chatState: partial?.chatState ?? "live",
    chatEnabledUntil: partial?.chatEnabledUntil ?? null,
    boardRevision: partial?.boardRevision ?? 7,
    subscriptionHealth: partial?.subscriptionHealth ?? "ready",
    targetWins,
    players: partial?.players ?? [
      {
        id: "player_a",
        displayName: "PixelRiot",
        channelId: "1001",
        channelLogin: "pixelriot",
        role: "streamer",
        wins: 2
      },
      {
        id: "player_b",
        displayName: "NovaRune",
        channelId: "1002",
        channelLogin: "novarune",
        role: "streamer",
        wins: 1
      }
    ],
    suggestions: partial?.suggestions ?? [
      {
        id: "sgg_01",
        boardId: "01",
        title: "Balatro",
        canonicalKey: createCanonicalGameKey("Balatro"),
        aliases: ["balatro"],
        sourceChannelId: "1001",
        suggestedBy: "chat_amy",
        voteCount: 22,
        status: "board"
      },
      {
        id: "sgg_02",
        boardId: "02",
        title: "Mario Kart 8 Deluxe",
        canonicalKey: createCanonicalGameKey("Mario Kart 8 Deluxe"),
        aliases: ["mk8d"],
        sourceChannelId: "1002",
        suggestedBy: "chat_miles",
        voteCount: 18,
        status: "queued"
      },
      {
        id: "sgg_03",
        boardId: "03",
        title: "Neon White",
        canonicalKey: createCanonicalGameKey("Neon White"),
        aliases: [],
        sourceChannelId: "1001",
        suggestedBy: "chat_nia",
        voteCount: 14,
        status: "board"
      }
    ],
    queue: partial?.queue ?? [
      {
        id: "queue_sgg_02",
        order: 0,
        title: "Mario Kart 8 Deluxe",
        sourceSuggestionId: "sgg_02",
        status: "live",
        winnerPlayerId: null
      },
      {
        id: "queue_manual_01",
        order: 1,
        title: "Rocket League",
        sourceSuggestionId: null,
        status: "queued",
        winnerPlayerId: null
      }
    ],
    currentGameId: partial?.currentGameId ?? "queue_sgg_02",
    updatedAt: partial?.updatedAt ?? new Date().toISOString()
  };
}

export function createOverlayViewModel(snapshot: MatchSnapshot) {
  const currentGame = snapshot.queue.find((entry) => entry.id === snapshot.currentGameId) ?? null;
  const nextGames = snapshot.queue.filter((entry) => entry.status === "queued").slice(0, 3);

    return {
      matchId: snapshot.matchId,
      title: snapshot.title,
      players: snapshot.players,
      currentGame,
      nextGames,
      targetWins: snapshot.targetWins
    };
}
