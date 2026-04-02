import {
  extensionBroadcasterConfigSchema,
  extensionMatchSummarySchema,
  twitchExtensionAnchorSchema,
  twitchExtensionModeSchema,
} from "./extension";

describe("extension contracts", () => {
  it("parses broadcaster config payloads", () => {
    expect(
      extensionBroadcasterConfigSchema.parse({
        version: 1,
        matchSlug: "gauntlet-finals",
      })
    ).toEqual({
      version: 1,
      matchSlug: "gauntlet-finals",
    });
  });

  it("accepts twitch helper query enums", () => {
    expect(twitchExtensionModeSchema.parse("viewer")).toBe("viewer");
    expect(twitchExtensionAnchorSchema.parse("video_overlay")).toBe(
      "video_overlay"
    );
  });

  it("validates extension match summaries", () => {
    expect(
      extensionMatchSummarySchema.parse({
        id: "match_1",
        slug: "gauntlet-finals",
        title: "Gauntlet Finals",
        status: "live",
        boardRevision: 3,
        subscriptionHealth: "ready",
        targetWins: 3,
        players: [
          {
            id: "player_1",
            displayName: "PixelRiot",
            wins: 2,
          },
          {
            id: "player_2",
            displayName: "NovaRune",
            wins: 1,
          },
        ],
        updatedAt: "2026-03-24T04:00:00.000Z",
      })
    ).toEqual(
      expect.objectContaining({
        slug: "gauntlet-finals",
        status: "live",
      })
    );
  });
});
