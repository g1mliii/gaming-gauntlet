/* global console, process */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const apiConfigPath = join(root, "wrangler.api.toml");
const pagesConfigPath = join(root, "apps", "web", "wrangler.toml");
const packagePath = join(root, "package.json");
const migrationsPath = join(root, "migrations");

const apiConfig = readFileSync(apiConfigPath, "utf8");
const pagesConfig = readFileSync(pagesConfigPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

const expectedScripts = {
  "deploy:api": "wrangler deploy --config wrangler.api.toml",
  "deploy:api:dry-run": "wrangler deploy --dry-run --config wrangler.api.toml",
  "deploy:d1:apply":
    "wrangler d1 migrations apply gaming-gauntlet-v1 --config wrangler.api.toml --remote",
  "deploy:d1:list":
    "wrangler d1 migrations list gaming-gauntlet-v1 --config wrangler.api.toml --remote",
  "deploy:pages":
    "npm run build --workspace @gaming-gauntlet/web && cd apps/web && wrangler pages deploy dist --project-name gaming-gauntlet",
};

const requiredRateLimits = [
  "CREATE_RATE_LIMITER",
  "STATE_RATE_LIMITER",
  "VERIFY_RATE_LIMITER",
  "WRITE_RATE_LIMITER",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasTomlAssignment(source, key, value) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${key}\\s*=\\s*"${escapedValue}"\\s*$`, "m").test(
    source
  );
}

function includesAll(source, values, context) {
  for (const value of values) {
    assert(source.includes(value), `${context} is missing ${value}`);
  }
}

assert(
  packageJson.devDependencies?.wrangler === "4.95.0",
  "Wrangler must be pinned to 4.95.0"
);

for (const [name, command] of Object.entries(expectedScripts)) {
  assert(packageJson.scripts?.[name] === command, `script ${name} drifted`);
}

assert(
  packageJson.scripts?.verify?.includes("npm run deploy:check"),
  "npm run verify must include deployment config checks"
);

assert(
  hasTomlAssignment(apiConfig, "name", "gaming-gauntlet-api"),
  "API Worker name must be gaming-gauntlet-api"
);
assert(
  hasTomlAssignment(apiConfig, "main", "apps/api/src/index.ts"),
  "API Worker entrypoint must stay apps/api/src/index.ts"
);
assert(
  hasTomlAssignment(apiConfig, "binding", "DB"),
  "API D1 binding must be DB"
);
assert(
  hasTomlAssignment(apiConfig, "database_name", "gaming-gauntlet-v1"),
  "API D1 database must be gaming-gauntlet-v1"
);
assert(
  hasTomlAssignment(apiConfig, "migrations_dir", "migrations"),
  "API D1 migrations_dir must stay migrations"
);
includesAll(apiConfig, requiredRateLimits, "API rate-limit bindings");
includesAll(
  apiConfig,
  [
    'pattern = "gaming-gauntlet.com/api/*"',
    'pattern = "www.gaming-gauntlet.com/api/*"',
    "[observability]",
    "enabled = true",
  ],
  "API deploy config"
);

assert(
  hasTomlAssignment(pagesConfig, "name", "gaming-gauntlet"),
  "Pages project name must be gaming-gauntlet"
);
assert(
  hasTomlAssignment(pagesConfig, "pages_build_output_dir", "dist"),
  "Pages build output must be dist relative to apps/web"
);
assert(
  hasTomlAssignment(pagesConfig, "compatibility_date", "2026-05-30"),
  "Pages compatibility_date drifted"
);
assert(
  !/^main\s*=/m.test(pagesConfig),
  "Pages config must not include a Worker main entrypoint"
);

assert(existsSync(migrationsPath), "migrations directory is missing");
assert(
  readdirSync(migrationsPath).some((entry) => entry.endsWith(".sql")),
  "migrations directory must contain SQL migrations"
);
console.log("Deployment config references the expected Cloudflare resources.");
