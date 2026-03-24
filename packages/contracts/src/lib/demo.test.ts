import { createDemoMatchSnapshot, createOverlayViewModel } from "./demo";

describe("overlay view model", () => {
  it("surfaces the current and queued games", () => {
    const overlay = createOverlayViewModel(createDemoMatchSnapshot());
    expect(overlay.currentGame?.title).toBe("Mario Kart 8 Deluxe");
    expect(overlay.nextGames).toHaveLength(1);
  });
});
