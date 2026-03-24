import React from "react";
import ReactDOM from "react-dom/client";

import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { PageShell, QueueList, ScoreBug } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";

const demoMatch = createDemoMatchSnapshot();

function VideoOverlayApp() {
  return (
    <main className="extension-root">
      <PageShell
        eyebrow="Twitch video overlay"
        title="Extension surface"
        deck="This entry mirrors the browser-source score bug while staying inside Twitch's iframe constraints."
        tone="overlay"
      >
        <ScoreBug match={demoMatch} transparent />
        <QueueList items={demoMatch.queue} title="Approved queue" />
      </PageShell>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <React.StrictMode>
    <VideoOverlayApp />
  </React.StrictMode>
);
