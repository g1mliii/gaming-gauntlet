import {
  createPublicMatchComponentSurface,
  createPublicMatchOverlaySurface,
  createPublicMatchPageSurface,
  publicMatchComponentSurfaceSchema,
  publicMatchOverlaySurfaceSchema,
  publicMatchPageSurfaceSchema,
  publicSurfaceViewSchema,
} from "./public-surface";
import { createDemoMatchSnapshot } from "../lib/demo";

describe("publicSurfaceViewSchema", () => {
  it("accepts the supported viewer surface modes", () => {
    expect(publicSurfaceViewSchema.parse("component")).toBe("component");
    expect(publicSurfaceViewSchema.parse("page")).toBe("page");
    expect(publicSurfaceViewSchema.parse("overlay")).toBe("overlay");
  });
});

describe("createPublicMatchComponentSurface", () => {
  it("returns a minimal component-safe surface payload", () => {
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
          id: "queue_1",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_2",
          order: 2,
          title: "Balatro",
          sourceSuggestionId: "sgg_01",
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_live",
    });

    const surface = createPublicMatchComponentSurface(snapshot);
    const parsed = publicMatchComponentSurfaceSchema.parse(surface);

    expect(parsed.currentGame?.title).toBe("Mario Kart 8 Deluxe");
    expect(parsed.upcomingQueueCount).toBe(2);
    expect(parsed).not.toHaveProperty("upcomingQueue");
  });
});

describe("createPublicMatchOverlaySurface", () => {
  it("returns only the overlay-safe surface data", () => {
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
          id: "queue_1",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_2",
          order: 2,
          title: "Balatro",
          sourceSuggestionId: "sgg_01",
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_3",
          order: 3,
          title: "Street Fighter 6",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_4",
          order: 4,
          title: "Tetris Effect",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
      ],
      currentGameId: "queue_live",
    });

    const surface = createPublicMatchOverlaySurface(snapshot);
    const parsed = publicMatchOverlaySurfaceSchema.parse(surface);

    expect(parsed.currentGame?.title).toBe("Mario Kart 8 Deluxe");
    expect(parsed.upcomingQueue).toEqual([
      expect.objectContaining({ id: "queue_1", title: "Rocket League" }),
      expect.objectContaining({ id: "queue_2", title: "Balatro" }),
      expect.objectContaining({ id: "queue_3", title: "Street Fighter 6" }),
    ]);
    expect(parsed).not.toHaveProperty("boardRevision");
    expect(parsed).not.toHaveProperty("topBoard");
  });
});

describe("createPublicMatchPageSurface", () => {
  it("limits the board preview and reports remaining queued items", () => {
    const snapshot = createDemoMatchSnapshot({
      suggestions: [
        {
          id: "sgg_01",
          boardId: "09",
          title: "Balatro",
          canonicalKey: "balatro",
          aliases: ["balatro"],
          sourceChannelId: "1001",
          suggestedBy: "viewer_1",
          voteCount: 14,
          status: "board",
        },
        {
          id: "sgg_02",
          boardId: "02",
          title: "Neon White",
          canonicalKey: "neon-white",
          aliases: [],
          sourceChannelId: "1002",
          suggestedBy: "viewer_2",
          voteCount: 18,
          status: "board",
        },
        {
          id: "sgg_03",
          boardId: "01",
          title: "Tetris Effect",
          canonicalKey: "tetris-effect",
          aliases: [],
          sourceChannelId: "1002",
          suggestedBy: "viewer_3",
          voteCount: 18,
          status: "board",
        },
        {
          id: "sgg_04",
          boardId: "05",
          title: "Rocket League",
          canonicalKey: "rocket-league",
          aliases: [],
          sourceChannelId: "1001",
          suggestedBy: "viewer_4",
          voteCount: 12,
          status: "board",
        },
        {
          id: "sgg_05",
          boardId: "04",
          title: "Celeste",
          canonicalKey: "celeste",
          aliases: [],
          sourceChannelId: "1001",
          suggestedBy: "viewer_5",
          voteCount: 10,
          status: "board",
        },
        {
          id: "sgg_06",
          boardId: "06",
          title: "Spelunky 2",
          canonicalKey: "spelunky-2",
          aliases: [],
          sourceChannelId: "1001",
          suggestedBy: "viewer_6",
          voteCount: 9,
          status: "board",
        },
      ],
      queue: [
        {
          id: "queue_live",
          order: 0,
          title: "Mario Kart 8 Deluxe",
          sourceSuggestionId: "sgg_live",
          status: "live",
          winnerPlayerId: null,
        },
        {
          id: "queue_1",
          order: 1,
          title: "Rocket League",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_2",
          order: 2,
          title: "Balatro",
          sourceSuggestionId: "sgg_01",
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_3",
          order: 3,
          title: "Street Fighter 6",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
        {
          id: "queue_4",
          order: 4,
          title: "Tetris Effect",
          sourceSuggestionId: null,
          status: "queued",
          winnerPlayerId: null,
        },
      ],
    });

    const surface = createPublicMatchPageSurface(snapshot);
    const parsed = publicMatchPageSurfaceSchema.parse(surface);

    expect(parsed.remainingQueueCount).toBe(4);
    expect(parsed.topBoard).toHaveLength(5);
    expect(parsed.topBoard.map((entry) => entry.title)).toEqual([
      "Tetris Effect",
      "Neon White",
      "Balatro",
      "Rocket League",
      "Celeste",
    ]);
  });
});
