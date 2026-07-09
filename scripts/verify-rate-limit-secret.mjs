/* global console, process */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const requiredSecret = "RATE_LIMIT_KEY_SALT";
const wranglerBin = resolve(
  process.cwd(),
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js"
);

let output;

try {
  output = execFileSync(
    process.execPath,
    [
      wranglerBin,
      "secret",
      "list",
      "--config",
      "wrangler.api.toml",
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }
  );
} catch {
  throw new Error(
    `Unable to verify the ${requiredSecret} Worker secret. Refusing to deploy.`
  );
}

let secrets;

try {
  secrets = JSON.parse(output);
} catch {
  throw new Error(
    "Wrangler returned an invalid secret list. Refusing to deploy."
  );
}

if (
  !Array.isArray(secrets) ||
  !secrets.some(
    (secret) =>
      secret && typeof secret === "object" && secret.name === requiredSecret
  )
) {
  throw new Error(
    `${requiredSecret} is required when rate-limit bindings are configured. Set it with "npx wrangler secret put ${requiredSecret} --config wrangler.api.toml" before deploying.`
  );
}

console.log(`${requiredSecret} is configured for the API Worker.`);
