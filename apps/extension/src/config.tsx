import React from "react";
import ReactDOM from "react-dom/client";

import { createDemoMatchSnapshot } from "@gaming-gauntlet/contracts";
import { PageShell, ScoreBug, SuggestionBoard } from "@gaming-gauntlet/ui";
import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";

const demoMatch = createDemoMatchSnapshot();

function ConfigApp() {
  return (
    <main className="extension-config">
      <PageShell
        eyebrow="Broadcaster config"
        title="Wire the overlay"
        deck="This page becomes the broadcaster-facing extension configuration surface. It explains the OBS browser-source URL, realtime bootstrap, and testing flow."
        actions={<span className="gg-chip">Config view</span>}
      >
        <div className="extension-config__grid">
          <div className="extension-list">
            <article>
              <strong>1. Link the live match</strong>
              <p>Match ID: {demoMatch.matchId}</p>
            </article>
            <article>
              <strong>2. Share the OBS URL</strong>
              <p>/overlay/{demoMatch.matchId}</p>
            </article>
            <article>
              <strong>3. Validate extension auth</strong>
              <p>The Worker EBS endpoint will mint short-lived tokens for the iframe session.</p>
            </article>
          </div>
          <ScoreBug match={demoMatch} />
        </div>
        <div style={{ marginTop: "1rem" }}>
          <SuggestionBoard suggestions={demoMatch.suggestions} title="Current ranked board" />
        </div>
      </PageShell>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("config-root")!).render(
  <React.StrictMode>
    <ConfigApp />
  </React.StrictMode>
);
