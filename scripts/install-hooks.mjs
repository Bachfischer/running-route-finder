import { spawnSync } from "node:child_process";
if (process.env.CI) {
  console.log("CI: Git hooks are enforced by the check job.");
  process.exit(0);
}
const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
});
if (probe.status !== 0) {
  console.log("No Git checkout: skipping local hooks.");
  process.exit(0);
}
const current = spawnSync(
  "git",
  ["config", "--local", "--get", "core.hooksPath"],
  { encoding: "utf8" },
).stdout.trim();
if (current && current !== ".githooks") {
  console.error(
    `Existing hooksPath ${current} preserved. Chain its pre-commit to: node scripts/check.mjs --staged`,
  );
  process.exit(1);
}
const result = spawnSync(
  "git",
  ["config", "--local", "core.hooksPath", ".githooks"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log("Enabled .githooks/pre-commit and pre-push.");
