import { useEffect } from "react";

import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";

const demoMatch = createDemoMatchSnapshot();

export function OverlayPage() {
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
        <ScoreBug match={demoMatch} transparent />
        <QueueList items={demoMatch.queue} title="Next in queue" transparent />
      </div>
    </div>
  );
}
