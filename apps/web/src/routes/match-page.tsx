import { PageShell, QueueList, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import { useParams } from "react-router-dom";

import { EdgeError } from "../lib/edge";
import { useLiveSnapshot } from "../lib/live-snapshot";

const PUBLIC_MATCH_POLL_INTERVAL_MS = 20_000;

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The live match feed is offline right now.";
  }

  if (error instanceof EdgeError && error.code === "match_not_found") {
    return "That match could not be found.";
  }

  return "The public match page failed to load.";
}

export function MatchPage() {
  const { slug = "" } = useParams();
  const { isLoading, pageError, snapshot } = useLiveSnapshot({
    missingPathError: "No match slug was provided.",
    path: slug ? `/api/public/matches/${slug}/snapshot` : null,
    pollIntervalMs: PUBLIC_MATCH_POLL_INTERVAL_MS,
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
    <div className="two-column">
      <PageShell
        eyebrow="Public match page"
        title={snapshot.title}
        deck="This route is the public-facing live surface for viewers, clips, and sponsor pages."
      >
        {pageError ? (
          <p className="dashboard-message dashboard-message--warning" role="status" aria-live="polite">
            {pageError}
          </p>
        ) : null}
        <ScoreBug match={snapshot} />
      </PageShell>
      <div className="match-support-grid">
        <SuggestionBoard suggestions={snapshot.suggestions} />
        <QueueList items={snapshot.queue} />
      </div>
    </div>
  );
}
