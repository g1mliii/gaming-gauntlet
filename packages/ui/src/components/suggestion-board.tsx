import type { Suggestion } from "@gaming-gauntlet/contracts";

type SuggestionBoardProps = {
  suggestions: Suggestion[];
  title?: string;
};

export function SuggestionBoard({
  suggestions,
  title = "Chat Board",
}: SuggestionBoardProps) {
  return (
    <section className="gg-panel">
      <div className="gg-panel__header">
        <div>
          <p className="gg-panel__eyebrow">Live voting</p>
          <h2 className="gg-panel__title">{title}</h2>
        </div>
        <span className="gg-chip">{suggestions.length} tracked</span>
      </div>
      {suggestions.length > 0 ? (
        <ol className="gg-board">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="gg-board__row">
              <div>
                <p className="gg-board__title">{suggestion.title}</p>
                <p className="gg-board__meta">
                  #{suggestion.boardId} from channel{" "}
                  {suggestion.sourceChannelId}
                </p>
              </div>
              <strong className="gg-board__votes">
                {suggestion.voteCount} votes
              </strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="gg-empty">No chat suggestions yet.</p>
      )}
    </section>
  );
}
