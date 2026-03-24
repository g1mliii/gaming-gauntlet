import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { PageShell, QueueList, ScoreBug } from "@gaming-gauntlet/ui";

const demoMatch = createDemoMatchSnapshot();

export function OverlayPage() {
  return (
    <div className="overlay-page">
      <div className="overlay-frame">
        <PageShell
          eyebrow="OBS browser source"
          title="Transparent overlay"
          deck="Use this route as the browser-source score bug. In later phases, the match ID becomes a realtime websocket bootstrap key."
          tone="overlay"
        >
          <ScoreBug match={demoMatch} transparent />
          <QueueList items={demoMatch.queue} title="Next in queue" />
        </PageShell>
      </div>
    </div>
  );
}
