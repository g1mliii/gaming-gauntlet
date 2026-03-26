import { auditLogResponseSchema } from "./audit";

describe("audit contracts", () => {
  it("parses dashboard audit activity entries", () => {
    const payload = auditLogResponseSchema.parse({
      items: [
        {
          id: "audit_1",
          createdAt: "2026-03-24T04:00:00.000Z",
          action: "match.created",
          actor: {
            id: "user_1",
            login: "pixelriot",
            displayName: "PixelRiot"
          },
          channelLinkId: "link_1",
          channelPairLabel: "@pixelriot vs @novarune",
          matchId: "match_1",
          matchTitle: "Gauntlet Finals",
          payload: {
            slug: "gauntlet-finals"
          }
        }
      ]
    });

    expect(payload.items[0]?.action).toBe("match.created");
    expect(payload.items[0]?.channelPairLabel).toBe("@pixelriot vs @novarune");
  });
});
