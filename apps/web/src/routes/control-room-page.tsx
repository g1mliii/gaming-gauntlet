import {
  approveSuggestion,
  createDemoMatchSnapshot,
  recordQueueWin,
  type MatchSnapshot
} from "@gaming-gauntlet/contracts";
import { PageShell, QueueList, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import { useMemo, useState } from "react";

const seededMatch = createDemoMatchSnapshot();

export function ControlRoomPage() {
  const [match, setMatch] = useState<MatchSnapshot>(seededMatch);

  const topSuggestion = useMemo(
    () =>
      [...match.suggestions]
        .filter((entry) => entry.status === "board")
        .sort((left, right) => right.voteCount - left.voteCount)[0] ?? null,
    [match.suggestions]
  );

  const currentGameId = match.currentGameId;
  const [leftPlayer, rightPlayer] = match.players;

  return (
    <div className="two-column">
      <PageShell
        eyebrow="Control room"
        title="Run the live set"
        deck="This bootstrap page simulates the moderation workflow with local demo state so the repo already has a tangible control-room surface."
      >
        <ScoreBug match={match} />
        <div className="control-grid control-grid--spaced">
          <button
            className="control-button control-button--utility"
            type="button"
            onClick={() => {
              if (!topSuggestion) {
                return;
              }
              setMatch((current) => approveSuggestion(current, topSuggestion.id));
            }}
          >
            Queue top chat pick
          </button>
          <button
            className="control-button control-button--utility"
            type="button"
            onClick={() => {
              setMatch((current) => ({
                ...current,
                queue: shuffleQueue(current.queue)
              }));
            }}
          >
            Randomize queue order
          </button>
          <button
            className="control-button control-button--team-alpha"
            type="button"
            onClick={() => {
              if (!currentGameId) {
                return;
              }
              setMatch((current) => recordQueueWin(current, currentGameId, leftPlayer.id));
            }}
          >
            Award win to {leftPlayer.displayName}
          </button>
          <button
            className="control-button control-button--team-bravo"
            type="button"
            onClick={() => {
              if (!currentGameId) {
                return;
              }
              setMatch((current) => recordQueueWin(current, currentGameId, rightPlayer.id));
            }}
          >
            Award win to {rightPlayer.displayName}
          </button>
        </div>
      </PageShell>
      <div className="match-support-grid">
        <SuggestionBoard suggestions={match.suggestions} />
        <QueueList items={match.queue} />
      </div>
    </div>
  );
}

function shuffleQueue(queue: MatchSnapshot["queue"]) {
  const shuffled = [...queue];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled.map((entry, index) => ({ ...entry, order: index }));
}
