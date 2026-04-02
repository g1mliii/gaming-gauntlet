import {
  MATCH_AUTO_COMPLETE_LIVE_INACTIVITY_MS,
  MATCH_AUTO_COMPLETE_PAUSED_INACTIVITY_MS,
  addManualQueueItem,
  applyMatchControlAction,
  boardResponseSchema,
  closeCurrentRound,
  createMatchRequestSchema,
  edgeQueueMessageSchema,
  getMatchAutoCompleteReason,
  matchControlActionSchema,
  moveQueueItem,
  randomizeUpcomingQueue,
  recordQueueWin,
  rejectSuggestion,
  removeQueueItem,
  startNextRound,
  startSelectedRound,
  updateMatchStatusRequestSchema,
} from "./match";
import { createDemoMatchSnapshot } from "../lib/demo";
import type { MatchSnapshot } from "./match";

describe("createMatchRequestSchema", () => {
  it("accepts the phase-2 match payload", () => {
    const parsed = createMatchRequestSchema.parse({
      channelLinkId: "link_1",
      title: "Gauntlet Finals",
      slug: "gauntlet-finals",
      targetWins: 5,
    });

    expect(parsed.channelLinkId).toBe("link_1");
    expect(parsed.targetWins).toBe(5);
  });

  it("rejects the old channel array payload", () => {
    expect(() =>
      createMatchRequestSchema.parse({
        title: "Gauntlet Finals",
        slug: "gauntlet-finals",
        targetWins: 5,
        channels: [
          {
            channelId: "1001",
            channelLogin: "pixelriot",
            displayName: "PixelRiot",
          },
        ],
      })
    ).toThrow();
  });

  it("rejects slugs that are not URL-safe path segments", () => {
    expect(() =>
      createMatchRequestSchema.parse({
        channelLinkId: "link_1",
        title: "Gauntlet Finals",
        slug: "grand finals",
        targetWins: 5,
      })
    ).toThrow();
  });

  it("parses the phase-3 status update payload", () => {
    const parsed = updateMatchStatusRequestSchema.parse({
      status: "live",
    });

    expect(parsed.status).toBe("live");
  });

  it("parses compact board payloads", () => {
    const parsed = boardResponseSchema.parse({
      matchId: "match_1",
      boardRevision: 3,
      updatedAt: "2026-03-25T01:00:00.000Z",
      suggestions: [],
    });

    expect(parsed.boardRevision).toBe(3);
  });

  it("accepts redacted public suggestion metadata", () => {
    const parsed = boardResponseSchema.parse({
      matchId: "match_1",
      boardRevision: 3,
      updatedAt: "2026-03-25T01:00:00.000Z",
      suggestions: [
        {
          id: "sgg_01",
          boardId: "01",
          title: "Spelunky 2",
          canonicalKey: "spelunky-2",
          aliases: ["Spelunky 2"],
          sourceChannelId: null,
          suggestedBy: null,
          voteCount: 5,
          status: "board",
        },
      ],
    });

    expect(parsed.suggestions[0]?.sourceChannelId).toBeNull();
    expect(parsed.suggestions[0]?.suggestedBy).toBeNull();
  });

  it("parses queue messages for command ingestion", () => {
    const parsed = edgeQueueMessageSchema.parse({
      type: "chat_command",
      messageId: "message_1",
      sentAt: "2026-03-25T01:00:00.000Z",
      sourceChannelId: "1001",
      broadcasterId: "1001",
      viewerId: "2001",
      messageText: "!gg vote 01",
      replyParentId: null,
    });

    expect(parsed.type).toBe("chat_command");
  });

  it("parses control-room action payloads", () => {
    const parsed = matchControlActionSchema.parse({
      type: "start_selected_round",
      queueItemId: "queue_1",
    });

    expect(parsed.type).toBe("start_selected_round");
    if (parsed.type !== "start_selected_round") {
      throw new Error("expected start_selected_round action");
    }
    expect(parsed.queueItemId).toBe("queue_1");
  });
});

describe("match auto-complete policy", () => {
  it("auto-completes live matches after prolonged inactivity", () => {
    const now = Date.parse("2026-03-27T05:00:00.000Z");

    expect(
      getMatchAutoCompleteReason(
        {
          status: "live",
          chatEnabledUntil: null,
          updatedAt: new Date(
            now - MATCH_AUTO_COMPLETE_LIVE_INACTIVITY_MS
          ).toISOString(),
        },
        now
      )
    ).toBe("live_inactive");
  });

  it("does not auto-complete active live matches before the inactivity threshold", () => {
    const now = Date.parse("2026-03-27T05:00:00.000Z");

    expect(
      getMatchAutoCompleteReason(
        {
          status: "live",
          chatEnabledUntil: null,
          updatedAt: new Date(
            now - MATCH_AUTO_COMPLETE_LIVE_INACTIVITY_MS + 1_000
          ).toISOString(),
        },
        now
      )
    ).toBeNull();
  });

  it("auto-completes paused matches after the grace window and buffer expire", () => {
    const now = Date.parse("2026-03-27T05:00:00.000Z");

    expect(
      getMatchAutoCompleteReason(
        {
          status: "paused",
          chatEnabledUntil: new Date(
            now - MATCH_AUTO_COMPLETE_PAUSED_INACTIVITY_MS
          ).toISOString(),
          updatedAt: "2026-03-27T04:00:00.000Z",
        },
        now
      )
    ).toBe("paused_inactive");
  });
});

describe("phase-4 match controls", () => {
  it("rejects board suggestions without affecting the queue", () => {
    const snapshot = createDemoMatchSnapshot();

    const nextSnapshot = rejectSuggestion(snapshot, "sgg_01");

    expect(
      nextSnapshot.suggestions.find((entry) => entry.id === "sgg_01")?.status
    ).toBe("rejected");
    expect(nextSnapshot.queue).toEqual(snapshot.queue);
  });

  it("adds manual queue items without replacing the live round", () => {
    const snapshot = createDemoMatchSnapshot();

    const nextSnapshot = addManualQueueItem(snapshot, "Street Fighter 6");

    expect(nextSnapshot.queue.at(-1)?.title).toBe("Street Fighter 6");
    expect(nextSnapshot.queue.at(-1)?.status).toBe("queued");
    expect(nextSnapshot.currentGameId).toBe(snapshot.currentGameId);
  });

  it("returns removed queued suggestions to the board", () => {
    const snapshot = createDemoMatchSnapshot({
      currentGameId: null,
      queue: [
        {
          id: "queue_sgg_02",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "queued",
          winnerPlayerId: null,
        },
      ],
    });

    const nextSnapshot = removeQueueItem(snapshot, "queue_sgg_02");

    expect(nextSnapshot.queue).toHaveLength(0);
    expect(
      nextSnapshot.suggestions.find((entry) => entry.id === "sgg_02")?.status
    ).toBe("board");
  });

  it("moves queued items without changing live queue entries", () => {
    const snapshot = createDemoMatchSnapshot({
      queue: [
        {
          id: "queue_live",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "live",
          winnerPlayerId: null,
        },
        {
          id: "queue_a",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_b",
          order: 2,
          title: "Neon White",
          sourceSuggestionId: "sgg_03",
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_live",
    });

    const nextSnapshot = moveQueueItem(snapshot, "queue_b", "up");

    expect(nextSnapshot.queue.map((entry) => entry.id)).toEqual([
      "queue_live",
      "queue_b",
      "queue_a",
    ]);
    expect(nextSnapshot.currentGameId).toBe("queue_live");
  });

  it("randomizes upcoming queued items only", () => {
    const snapshot = createDemoMatchSnapshot({
      queue: [
        {
          id: "queue_live",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "live",
          winnerPlayerId: null,
        },
        {
          id: "queue_a",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_b",
          order: 2,
          title: "Neon White",
          sourceSuggestionId: "sgg_03",
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_live",
    });

    const nextSnapshot = randomizeUpcomingQueue(snapshot, () => 0);

    expect(nextSnapshot.queue[0]?.id).toBe("queue_live");
    expect(nextSnapshot.queue.slice(1).map((entry) => entry.id)).toEqual([
      "queue_b",
      "queue_a",
    ]);
  });

  it("starts the next queued round when nothing is live", () => {
    const snapshot = {
      ...createDemoMatchSnapshot({
        queue: [
          {
            id: "queue_a",
            order: 0,
            title: "Rocket League",
            sourceSuggestionId: null,
            status: "queued",
            winnerPlayerId: null,
          },
        ],
      }),
      currentGameId: null,
    };

    const nextSnapshot = startNextRound(snapshot);

    expect(nextSnapshot.currentGameId).toBe("queue_a");
    expect(nextSnapshot.queue[0]?.status).toBe("live");
  });

  it("starts a selected queued round and promotes it to the live slot", () => {
    const snapshot = {
      ...createDemoMatchSnapshot({}),
      currentGameId: null,
      queue: [
        {
          id: "queue_completed",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "completed",
          winnerPlayerId: "player_a",
        },
        {
          id: "queue_a",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_b",
          order: 2,
          title: "Neon White",
          sourceSuggestionId: "sgg_03",
          status: "queued",
          winnerPlayerId: null,
        },
      ],
    } satisfies MatchSnapshot;

    const nextSnapshot = startSelectedRound(snapshot, "queue_b");

    expect(nextSnapshot.currentGameId).toBe("queue_b");
    expect(nextSnapshot.queue.map((entry) => entry.id)).toEqual([
      "queue_completed",
      "queue_b",
      "queue_a",
    ]);
    expect(nextSnapshot.queue[1]?.status).toBe("live");
    expect(nextSnapshot.queue[2]?.status).toBe("queued");
  });

  it("records winners, advances the queue, and marks played suggestions", () => {
    const snapshot = createDemoMatchSnapshot({
      queue: [
        {
          id: "queue_sgg_02",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "live",
          winnerPlayerId: null,
        },
        {
          id: "queue_manual_01",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_sgg_02",
    });

    const nextSnapshot = recordQueueWin(snapshot, "queue_sgg_02", "player_a");

    expect(
      nextSnapshot.players.find((player) => player.id === "player_a")?.wins
    ).toBe(3);
    expect(nextSnapshot.queue[0]?.status).toBe("completed");
    expect(nextSnapshot.queue[0]?.winnerPlayerId).toBe("player_a");
    expect(nextSnapshot.queue[1]?.status).toBe("live");
    expect(nextSnapshot.currentGameId).toBe("queue_manual_01");
    expect(
      nextSnapshot.suggestions.find((entry) => entry.id === "sgg_02")?.status
    ).toBe("played");
  });

  it("closes live rounds without assigning a winner", () => {
    const snapshot = createDemoMatchSnapshot({
      queue: [
        {
          id: "queue_sgg_02",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_02",
          status: "live",
          winnerPlayerId: null,
        },
        {
          id: "queue_manual_01",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_sgg_02",
    });

    const nextSnapshot = closeCurrentRound(snapshot, "queue_sgg_02");

    expect(nextSnapshot.queue[0]?.status).toBe("completed");
    expect(nextSnapshot.queue[0]?.winnerPlayerId).toBeNull();
    expect(nextSnapshot.queue[1]?.status).toBe("live");
    expect(nextSnapshot.currentGameId).toBe("queue_manual_01");
  });

  it("dispatches action unions through applyMatchControlAction", () => {
    const snapshot = createDemoMatchSnapshot();

    const nextSnapshot = applyMatchControlAction(snapshot, {
      type: "reject_suggestion",
      suggestionId: "sgg_01",
    });

    expect(
      nextSnapshot.suggestions.find((entry) => entry.id === "sgg_01")?.status
    ).toBe("rejected");
  });
});
