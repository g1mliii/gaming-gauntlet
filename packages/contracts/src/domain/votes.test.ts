import { applyViewerVote, tallyVotes } from "./votes";

describe("vote handling", () => {
  it("keeps one active vote per viewer", () => {
    const votes = applyViewerVote(
      [{ voterId: "viewer-1", suggestionId: "one" }],
      { voterId: "viewer-1", suggestionId: "two" }
    );

    expect(votes).toEqual([{ voterId: "viewer-1", suggestionId: "two" }]);
  });

  it("counts votes by suggestion", () => {
    expect(
      tallyVotes([
        { voterId: "viewer-1", suggestionId: "one" },
        { voterId: "viewer-2", suggestionId: "one" },
        { voterId: "viewer-3", suggestionId: "two" }
      ])
    ).toEqual({ one: 2, two: 1 });
  });
});
