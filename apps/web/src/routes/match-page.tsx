import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { PageShell, QueueList, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";

const demoMatch = createDemoMatchSnapshot();

export function MatchPage() {
  return (
    <div className="two-column">
      <PageShell
        eyebrow="Public match page"
        title={demoMatch.title}
        deck="This route is the public-facing live surface for viewers, clips, and sponsor pages."
      >
        <ScoreBug match={demoMatch} />
      </PageShell>
      <div className="dashboard-grid">
        <SuggestionBoard suggestions={demoMatch.suggestions} />
        <QueueList items={demoMatch.queue} />
      </div>
    </div>
  );
}
