import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules") && !id.includes("/packages/")) {
    return undefined;
  }

  if (
    id.includes("react-router-dom") ||
    id.includes("/react-router/") ||
    id.includes("@remix-run/router")
  ) {
    return "router-vendor";
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
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 5173,
  },
});
