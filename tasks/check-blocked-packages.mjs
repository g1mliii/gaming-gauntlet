/* global console, process */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const packageLockPath = path.join(workspaceRoot, "package-lock.json");

const blockedPackages = new Map([
  [
    "axios",
    {
      versions: new Set(["1.14.1", "0.30.4"]),
      advisory:
        "known-malicious publish reported on 2026-03-31; pinned away via npm overrides",
    },
  ],
  [
    "plain-crypto-js",
    {
      versions: new Set(["4.2.1"]),
      advisory:
        "known-malicious publish reported on 2026-03-31; package should not resolve to this build",
    },
  ],
]);

function collectPackageJsonFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === ".wrangler" ||
      entry.name === "output" ||
      entry.name === "test-results"
    ) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPackageJsonFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name === "package.json") {
      files.push(entryPath);
    }
  }

  return files;
}

function parseJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function scanManifest(filePath, findings) {
  const manifest = parseJson(filePath);
  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];

  for (const section of sections) {
    const deps = manifest[section];
    if (!deps) {
      continue;
    }

    for (const [name, spec] of Object.entries(deps)) {
      const blocked = blockedPackages.get(name);
      if (!blocked || !blocked.versions.has(spec)) {
        continue;
      }

      findings.push(
        `${path.relative(workspaceRoot, filePath)} declares ${name}@${spec} in ${section} (${blocked.advisory})`,
      );
    }
  }
}

function scanLockfile(findings) {
  if (!existsSync(packageLockPath)) {
    findings.push("package-lock.json is missing; lockfile verification could not run");
    return;
  }

  const lockfile = parseJson(packageLockPath);
  const packages = lockfile.packages ?? {};

  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!metadata?.version) {
      continue;
    }

    const packageName =
      metadata.name ??
      (packagePath.startsWith("node_modules/")
        ? packagePath.slice("node_modules/".length)
        : null);

    if (!packageName) {
      continue;
    }

    const blocked = blockedPackages.get(packageName);
    if (!blocked || !blocked.versions.has(metadata.version)) {
      continue;
    }

    findings.push(
      `package-lock.json resolves ${packageName}@${metadata.version} at ${packagePath || "<root>"} (${blocked.advisory})`,
    );
  }
}

const findings = [];

for (const manifestPath of collectPackageJsonFiles(workspaceRoot)) {
  scanManifest(manifestPath, findings);
}

scanLockfile(findings);

if (findings.length > 0) {
  console.error("Blocked packages detected:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Dependency denylist check passed.");
