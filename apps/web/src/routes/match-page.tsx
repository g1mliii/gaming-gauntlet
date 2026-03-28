import type { PublicMatchPageSurface } from "@gaming-gauntlet/contracts";
import {
  PageShell,
  QueueList,
  ScoreBug,
  SuggestionBoard,
} from "@gaming-gauntlet/ui";
import { useParams } from "react-router-dom";

import { EdgeError } from "../lib/edge";
import { useLiveSnapshot } from "../lib/live-snapshot";

const PUBLIC_MATCH_POLL_INTERVAL_MS = 30_000;

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The live match feed is offline right now.";
  }

  if (error instanceof EdgeError && error.code === "match_not_found") {
    return "That match could not be found.";
  }

  return "The public match page failed to load.";
}

function getQueueSummary(snapshot: PublicMatchPageSurface): string {
  if (snapshot.remainingQueueCount === 0) {
    return "No games are queued after the current round.";
  }

  if (snapshot.remainingQueueCount > snapshot.upcomingQueue.length) {
    return `Showing the next ${snapshot.upcomingQueue.length} of ${snapshot.remainingQueueCount} queued games.`;
  }

  return `${snapshot.remainingQueueCount} queued game${snapshot.remainingQueueCount === 1 ? "" : "s"} still in the wings.`;
}

export function MatchPage() {
  const { slug = "" } = useParams();
  const { isLoading, pageError, snapshot } =
    useLiveSnapshot<PublicMatchPageSurface>({
    missingPathError: "No match slug was provided.",
    path: slug ? `/api/public/matches/${slug}/surface?view=page` : null,
    pollIntervalMs: PUBLIC_MATCH_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  if (!snapshot) {
    return (
      <PageShell
        eyebrow="Public match page"
        title={isLoading ? "Loading live match" : "Live match unavailable"}
        deck={pageError ?? "This route is the public-facing live surface for viewers, clips, and sponsor pages."}
      />
    );
  }

  return (
    <div className="match-page">
      <PageShell
        eyebrow="Public match page"
        title={snapshot.title}
        deck="Broadcast-first live surface for viewers, clips, and sponsor pages."
        actions={
          <div className="match-page__chips">
            <span className="gg-chip">match {snapshot.status}</span>
            <span className="gg-chip">rev {snapshot.boardRevision}</span>
            <span className="gg-chip">
              queue {snapshot.remainingQueueCount}
            </span>
          </div>
        }
      >
        {pageError ? (
          <p className="dashboard-message dashboard-message--warning" role="status" aria-live="polite">
            {pageError}
          </p>
        ) : null}
        <ScoreBug match={snapshot} />
      </PageShell>
      <div className="match-support-grid">
        <QueueList
          items={snapshot.upcomingQueue}
          title="Next on deck"
          summary={getQueueSummary(snapshot)}
          emptyLabel="No games are queued after this round."
        />
        <SuggestionBoard
          suggestions={snapshot.topBoard}
          title="Top chat picks"
          trackedCount={snapshot.topBoard.length}
          emptyLabel="No chat picks are active right now."
        />
      </div>
    </div>
  );
}
