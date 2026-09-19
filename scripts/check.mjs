import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const staged = process.argv.includes("--staged");
function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
if (staged) {
  // Never silently validate unstaged changes instead of the committed source.
  const modified = spawnSync("git", ["diff", "--name-only", "-z"], {
    encoding: "utf8",
  })
    .stdout.split("\0")
    .filter(Boolean);
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .stdout.split("\0")
    .filter(Boolean);
  if (modified.length || untracked.length) {
    console.error(
      "Stage the complete change before committing so checks validate the committed source. Unstaged or untracked files:\n" +
        [...modified, ...untracked].join("\n"),
    );
    process.exit(1);
  }
}
const node = process.execPath;
mkdirSync("coverage", { recursive: true });
run(node, [
  "node_modules/prettier/bin/prettier.cjs",
  "--check",
  "app",
  "components",
  "lib",
  "scripts",
  "tests",
  ".github",
  "docs",
  "*.json",
  "*.yaml",
  "*.mjs",
  "*.ts",
  "README.md",
]);
run(node, [
  "node_modules/eslint/bin/eslint.js",
  "app",
  "components",
  "lib",
  "scripts",
  "tests",
  "*.mjs",
  "*.ts",
  "--max-warnings",
  "0",
]);
run(node, ["node_modules/typescript/bin/tsc", "--noEmit"]);
run(node, [
  "--experimental-strip-types",
  "--test",
  "--experimental-test-coverage",
  "--test-coverage-include=lib/*.ts",
  "--test-coverage-lines=90",
  "--test-coverage-functions=90",
  "--test-coverage-branches=80",
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=lcov",
  "--test-reporter-destination=coverage/lcov.info",
  "tests/*.test.mjs",
]);
