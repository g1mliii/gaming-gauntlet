import { boardResponseSchema, createMatchRequestSchema, edgeQueueMessageSchema, updateMatchStatusRequestSchema } from "./match";

describe("createMatchRequestSchema", () => {
  it("accepts the phase-2 match payload", () => {
    const parsed = createMatchRequestSchema.parse({
      channelLinkId: "link_1",
      title: "Gauntlet Finals",
      slug: "gauntlet-finals",
      targetWins: 5
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
            displayName: "PixelRiot"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects slugs that are not URL-safe path segments", () => {
    expect(() =>
      createMatchRequestSchema.parse({
        channelLinkId: "link_1",
        title: "Gauntlet Finals",
        slug: "grand finals",
        targetWins: 5
      })
    ).toThrow();
  });

  it("parses the phase-3 status update payload", () => {
    const parsed = updateMatchStatusRequestSchema.parse({
      status: "live"
    });

    expect(parsed.status).toBe("live");
  });

  it("parses compact board payloads", () => {
    const parsed = boardResponseSchema.parse({
      matchId: "match_1",
      boardRevision: 3,
      updatedAt: "2026-03-25T01:00:00.000Z",
      suggestions: []
    });

    expect(parsed.boardRevision).toBe(3);
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
      replyParentId: null
    });

    expect(parsed.type).toBe("chat_command");
  });
});
