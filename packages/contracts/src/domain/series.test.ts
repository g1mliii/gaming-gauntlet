import { createDemoMatchSnapshot } from "../lib/demo";
import { computeSeriesState } from "./series";

describe("computeSeriesState", () => {
  it("respects target wins", () => {
    const state = computeSeriesState(
      createDemoMatchSnapshot({
        targetWins: 3,
        players: [
          {
            id: "a",
            displayName: "One",
            channelId: "1",
            channelLogin: "one",
            role: "streamer",
            wins: 3
          },
          {
            id: "b",
            displayName: "Two",
            channelId: "2",
            channelLogin: "two",
            role: "streamer",
            wins: 1
          }
        ]
      })
    );

    expect(state).toEqual({
      isComplete: true,
      leaderPlayerId: "a",
      winsRemaining: 0
    });
  });

  it("supports open-ended mode", () => {
    const state = computeSeriesState(createDemoMatchSnapshot({ targetWins: null }));
    expect(state.winsRemaining).toBeNull();
  });
});
