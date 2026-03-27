import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules") && !id.includes("/packages/")) {
    return undefined;
  }

  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  ) {
    return "react-vendor";
  }

  if (id.includes("/packages/ui/")) {
    return "ui-shared";
  }

  if (id.includes("/packages/contracts/")) {
    return "contracts-shared";
  }

  return undefined;
}

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
      input: {
        video_overlay: fileURLToPath(
          new URL("./video_overlay.html", import.meta.url)
        ),
        config: fileURLToPath(new URL("./config.html", import.meta.url)),
      },
    },
  },
});
