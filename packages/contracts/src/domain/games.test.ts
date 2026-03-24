import { createCanonicalGameKey, normalizeGameTitle, shouldAutoMergeSuggestions } from "./games";

describe("game title normalization", () => {
  it("normalizes case and punctuation", () => {
    expect(normalizeGameTitle("Mario Kart 8 Deluxe!!")).toBe("mario kart 8 deluxe");
  });

  it("creates stable canonical keys", () => {
    expect(createCanonicalGameKey("Halo: Infinite")).toBe("halo-infinite");
  });

  it("detects merge-safe duplicates", () => {
    expect(shouldAutoMergeSuggestions("Hades II", "hades ii")).toBe(true);
  });
});
