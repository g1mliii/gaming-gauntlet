import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev pairs this Vite server with the API Worker running under
    // `wrangler dev --config wrangler.api.toml` (port 8787); in production the
    // Worker is routed on the same origin under /api/*.
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  },
  test: {
    css: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
