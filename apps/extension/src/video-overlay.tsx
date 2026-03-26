import React from "react";
import ReactDOM from "react-dom/client";

import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";

const demoMatch = createDemoMatchSnapshot();

function VideoOverlayApp() {
  return (
    <main className="extension-root extension-root--overlay">
      <ScoreBug match={demoMatch} transparent />
      <QueueList items={demoMatch.queue} title="Approved queue" transparent />
    </main>
  );
}

document.documentElement.classList.add("gg-doc--overlay");
document.body.classList.add("gg-body--overlay");

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <React.StrictMode>
    <VideoOverlayApp />
  </React.StrictMode>
);
