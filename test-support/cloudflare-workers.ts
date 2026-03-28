export class DurableObject<Env = unknown, Props = unknown> {
  protected ctx: Props;
  protected env: Env;

  constructor(ctx: Props, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
