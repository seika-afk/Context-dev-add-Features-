#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const argv = process.argv.slice(2);
const entryIndex = argv.findIndex((arg) => !arg.startsWith("-"));

if (entryIndex === -1) {
  console.error("tsx shim: missing entrypoint");
  process.exit(1);
}

const entryArg = argv[entryIndex];
const entryPath = path.resolve(process.cwd(), entryArg);
const passthroughArgs = argv.slice(entryIndex + 1);

if (!fs.existsSync(entryPath)) {
  console.error(`tsx shim: entrypoint not found: ${entryArg}`);
  process.exit(1);
}

const ext = path.extname(entryPath).toLowerCase();
const supportsDirectNode = ext === ".js" || ext === ".mjs" || ext === ".cjs";

if (supportsDirectNode) {
  const result = spawnSync(process.execPath, [entryPath, ...passthroughArgs], {
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

const tempDir = fs.mkdtempSync(path.join(path.dirname(entryPath), ".tsx-shim-"));
const tempFile = path.join(
  tempDir,
  `${path.basename(entryPath, ext)}.mjs`
);

try {
  fs.writeFileSync(tempFile, fs.readFileSync(entryPath, "utf8"));

  const result = spawnSync(process.execPath, [tempFile, ...passthroughArgs], {
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
