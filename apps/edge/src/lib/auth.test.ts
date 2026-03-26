import type { Env } from "../env";

import { resolveSessionSameSite } from "./auth";

describe("resolveSessionSameSite", () => {
  it("keeps localhost ports on Lax", () => {
    expect(
      resolveSessionSameSite(
        { APP_ORIGIN: "http://localhost:5173" } as Env,
        new Request("http://localhost:8787/api/auth/twitch/callback")
      )
    ).toBe("Lax");
  });

  it("uses None for cross-site requests", () => {
    expect(
      resolveSessionSameSite(
        { APP_ORIGIN: "https://app.example.com" } as Env,
        new Request("https://edge.other.example/api/auth/twitch/callback")
      )
    ).toBe("None");
  });
});
