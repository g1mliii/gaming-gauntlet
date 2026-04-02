import React from "react";
import ReactDOM from "react-dom/client";

import "@gaming-gauntlet/ui/styles.css";
import "./extension.css";
import { ExtensionConfigPage } from "./config-page";

export function LiveConfigApp() {
  return <ExtensionConfigPage surface="live_config" />;
}

export function bootstrapLiveConfig(): void {
  const root = document.getElementById("live-config-root");

  if (!root) {
    return;
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <LiveConfigApp />
    </React.StrictMode>
  );
}

bootstrapLiveConfig();
