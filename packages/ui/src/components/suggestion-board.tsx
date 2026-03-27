import type { Suggestion } from "@gaming-gauntlet/contracts";

type SuggestionBoardProps = {
  suggestions: Suggestion[];
  title?: string;
};

export function SuggestionBoard({
  suggestions,
  title = "Chat Board",
}: SuggestionBoardProps) {
  const boardSuggestions = suggestions.filter(
    (suggestion) => suggestion.status === "board"
  );

  return (
    <section className="gg-panel">
      <div className="gg-panel__header">
        <div>
          <p className="gg-panel__eyebrow">Live voting</p>
          <h2 className="gg-panel__title">{title}</h2>
        </div>
        <span className="gg-chip">{boardSuggestions.length} tracked</span>
      </div>
      {boardSuggestions.length > 0 ? (
        <ol className="gg-board">
          {boardSuggestions.map((suggestion) => (
            <li key={suggestion.id} className="gg-board__row">
              <div>
                <p className="gg-board__title">{suggestion.title}</p>
                <p className="gg-board__meta">
                  #{suggestion.boardId}{" "}
                  {suggestion.sourceChannelId
                    ? `from channel ${suggestion.sourceChannelId}`
                    : "viewer submitted"}
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
