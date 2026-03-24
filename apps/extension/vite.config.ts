import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5174
  },
  build: {
    rollupOptions: {
      input: {
        video_overlay: fileURLToPath(new URL("./video_overlay.html", import.meta.url)),
        config: fileURLToPath(new URL("./config.html", import.meta.url))
      }
    }
  }
});
