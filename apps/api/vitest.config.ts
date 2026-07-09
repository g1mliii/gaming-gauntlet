import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The Worker imports `cloudflare:workers` (for the Durable Object base class),
// a virtual module that only resolves inside the workerd runtime. The unit
// tests run in Node, so alias it to a minimal stub — the tests never construct
// the Durable Object, they drive handleApiRequest with a mocked hub binding.
export default defineConfig({
  test: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/cloudflare-workers-stub.ts", import.meta.url)
      ),
    },
  },
});
