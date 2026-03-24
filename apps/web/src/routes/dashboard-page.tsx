import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { PageShell, QueueList, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";

const demoMatch = createDemoMatchSnapshot();

export function DashboardPage() {
  return (
    <div className="dashboard-grid">
      <PageShell
        eyebrow="Dashboard"
        title="Live control rail"
        deck="Broadcasters link channels, seed a match, and monitor both communities from one board."
        actions={<span className="gg-chip">2 linked channels</span>}
      >
        <ScoreBug match={demoMatch} />
      </PageShell>
      <SuggestionBoard suggestions={demoMatch.suggestions} />
      <QueueList items={demoMatch.queue} />
    </div>
  );
}
