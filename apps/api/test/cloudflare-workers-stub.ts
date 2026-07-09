// Test-only stand-in for the `cloudflare:workers` runtime module, which only
// exists inside workerd. The API unit tests run in Node and never instantiate
// the Durable Object — they exercise handleApiRequest with a mocked hub
// namespace — so this just needs to make `class LobbyHub extends DurableObject`
// importable. Method bodies that touch real runtime globals are never executed
// here. The vitest alias to this file lives in apps/api/vitest.config.ts.
export class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx?: unknown, env?: Env) {
    this.ctx = ctx;
    this.env = env as Env;
  }
}
