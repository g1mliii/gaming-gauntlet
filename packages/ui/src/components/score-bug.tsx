import type {
  MatchSnapshot,
  PublicMatchComponentSurface,
  PublicMatchOverlaySurface,
  PublicMatchPageSurface,
} from "@gaming-gauntlet/contracts";

type ScoreBugProps = {
  match:
    | MatchSnapshot
    | PublicMatchComponentSurface
    | PublicMatchOverlaySurface
    | PublicMatchPageSurface;
  transparent?: boolean;
};

function getCurrentGameTitle(
  match:
    | MatchSnapshot
    | PublicMatchComponentSurface
    | PublicMatchOverlaySurface
    | PublicMatchPageSurface
): string {
  if ("currentGame" in match) {
    return match.currentGame?.title ?? "Waiting for next pick";
  }

  const currentGame =
    match.queue.find((item) => item.id === match.currentGameId) ?? null;
  return currentGame?.title ?? "Waiting for next pick";
}

export function ScoreBug({ match, transparent = false }: ScoreBugProps) {
  const [left, right] = match.players;
  const currentGameTitle = getCurrentGameTitle(match);

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
        <span className="gg-scorebug__title">{match.title}</span>
      </div>
      <div className="gg-scorebug__line">
        <article className="gg-scorebug__player gg-scorebug__player--left">
          <p className="gg-scorebug__label">{left.displayName}</p>
          <p className="gg-scorebug__score">{left.wins}</p>
        </article>
        <div className="gg-scorebug__versus">vs</div>
        <article className="gg-scorebug__player gg-scorebug__player--right">
          <p className="gg-scorebug__label">{right.displayName}</p>
          <p className="gg-scorebug__score">{right.wins}</p>
        </article>
      </div>
      <div className="gg-scorebug__footer">
        <span className="gg-scorebug__meta-label">Current game</span>
        <strong className="gg-scorebug__current-game">{currentGameTitle}</strong>
        <span className="gg-scorebug__meta-label gg-scorebug__meta-label--right">
          {match.targetWins ? `First to ${match.targetWins}` : "Open mode"}
        </span>
      </div>
    </section>
  );
}
