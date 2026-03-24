import type { MatchSnapshot } from "@gaming-gauntlet/contracts";

type ScoreBugProps = {
  match: MatchSnapshot;
  transparent?: boolean;
};

export function ScoreBug({ match, transparent = false }: ScoreBugProps) {
  const [left, right] = match.players;
  const currentGame = match.queue.find((item) => item.id === match.currentGameId) ?? null;

  if (!left || !right) {
    return (
      <section className={`gg-scorebug ${transparent ? "gg-scorebug--transparent" : ""}`}>
        <div className="gg-scorebug__footer">
          <span>Waiting for both streamers to join.</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`gg-scorebug ${transparent ? "gg-scorebug--transparent" : ""}`}>
      <div className="gg-scorebug__meta">
        <span className="gg-chip">Live Match</span>
        <span className="gg-scorebug__title">{match.title}</span>
      </div>
      <div className="gg-scorebug__line">
        <article className="gg-scorebug__player">
          <p className="gg-scorebug__label">{left.displayName}</p>
          <p className="gg-scorebug__score">{left.wins}</p>
        </article>
        <div className="gg-scorebug__versus">vs</div>
        <article className="gg-scorebug__player">
          <p className="gg-scorebug__label">{right.displayName}</p>
          <p className="gg-scorebug__score">{right.wins}</p>
        </article>
      </div>
      <div className="gg-scorebug__footer">
        <span>Current game</span>
        <strong>{currentGame?.title ?? "Waiting for next pick"}</strong>
        <span>{match.targetWins ? `First to ${match.targetWins}` : "Open mode"}</span>
      </div>
    </section>
  );
}
