import { createMatchRequestSchema } from "./match";

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
});
