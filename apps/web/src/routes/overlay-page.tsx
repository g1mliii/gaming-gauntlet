import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { EdgeError } from "../lib/edge";
import { useLiveSnapshot } from "../lib/live-snapshot";

const OVERLAY_POLL_INTERVAL_MS = 15_000;

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The overlay feed is offline right now.";
  }

  if (error instanceof EdgeError && error.code === "match_not_found") {
    return "That overlay match could not be found.";
  }

  return "The overlay failed to load.";
}

export function OverlayPage() {
  const { slug = "" } = useParams();
  const { pageError, snapshot } = useLiveSnapshot({
    missingPathError: "No match slug was provided.",
    path: slug ? `/api/public/matches/${slug}/snapshot` : null,
    pollIntervalMs: OVERLAY_POLL_INTERVAL_MS,
    stopPollingOnComplete: true,
    toFriendlyError,
  });

  useEffect(() => {
    document.documentElement.classList.add("gg-doc--overlay");
    document.body.classList.add("gg-body--overlay");

    return () => {
      document.documentElement.classList.remove("gg-doc--overlay");
      document.body.classList.remove("gg-body--overlay");
    };
  }, []);

  return (
    <div className="overlay-page">
      <div className="overlay-frame">
        {snapshot ? <ScoreBug match={snapshot} transparent /> : null}
        {snapshot ? <QueueList items={snapshot.queue} title="Next in queue" transparent /> : null}
        {pageError ? <p className="dashboard-message dashboard-message--warning">{pageError}</p> : null}
      </div>
    </div>
  );
}
