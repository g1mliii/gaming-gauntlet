import type {
  PublicBoardEntry,
  Suggestion,
} from "@gaming-gauntlet/contracts";

type SuggestionBoardProps = {
  suggestions: Array<Suggestion | PublicBoardEntry>;
  title?: string;
  trackedCount?: number;
  emptyLabel?: string;
};

export function SuggestionBoard({
  suggestions,
  title = "Chat Board",
  trackedCount,
  emptyLabel = "No chat suggestions yet.",
}: SuggestionBoardProps) {
  const boardSuggestions = suggestions.filter(
    (suggestion) => !("status" in suggestion) || suggestion.status === "board"
  );

  return (
    <section className="gg-panel">
      <div className="gg-panel__header">
        <div>
          <p className="gg-panel__eyebrow">Live voting</p>
          <h2 className="gg-panel__title">{title}</h2>
        </div>
        <span className="gg-chip">
          {(trackedCount ?? boardSuggestions.length).toString()} tracked
        </span>
      </div>
      {boardSuggestions.length > 0 ? (
        <ol className="gg-board">
          {boardSuggestions.map((suggestion) => (
            <li
              key={"id" in suggestion ? suggestion.id : suggestion.boardId}
              className="gg-board__row"
            >
              <div>
                <p className="gg-board__title">{suggestion.title}</p>
                <p className="gg-board__meta">
                  #{suggestion.boardId}
                  {"sourceChannelId" in suggestion && suggestion.sourceChannelId
                    ? ` from channel ${suggestion.sourceChannelId}`
                    : ""}
                </p>
              </div>
              <strong className="gg-board__votes">
                {suggestion.voteCount} votes
              </strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="gg-empty">{emptyLabel}</p>
      )}
    </section>
  );
}
