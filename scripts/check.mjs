import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
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
