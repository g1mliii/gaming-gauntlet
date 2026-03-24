import type { MatchSnapshot } from "./match";

export type SeriesState = {
  isComplete: boolean;
  leaderPlayerId: string | null;
  winsRemaining: number | null;
};

export function computeSeriesState(snapshot: MatchSnapshot): SeriesState {
  const sorted = [...snapshot.players].sort((left, right) => right.wins - left.wins);
  const leader = sorted[0] ?? null;

  if (!leader) {
    return {
      isComplete: false,
      leaderPlayerId: null,
      winsRemaining: snapshot.targetWins
    };
  }

  if (snapshot.targetWins === null) {
    return {
      isComplete: snapshot.status === "complete",
      leaderPlayerId: leader.id,
      winsRemaining: null
    };
  }

  return {
    isComplete: leader.wins >= snapshot.targetWins,
    leaderPlayerId: leader.id,
    winsRemaining: Math.max(snapshot.targetWins - leader.wins, 0)
  };
}
