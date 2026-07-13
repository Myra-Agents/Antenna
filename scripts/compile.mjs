// Compile the harness to a standalone binary, injecting a descriptive build
// version (package version + short git sha when off a `v*` tag + `-dirty` when
// the tree has uncommitted changes) via `--define`. `smoke` reports it, so the
// app shows e.g. "Installed · v0.2.0+ab12cd3-dirty".
//
// Release builds run on a clean `v*` tag → the descriptive version collapses to
// the bare version, so CI can keep calling `bun build --compile` directly.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const base = pkg.version;
const sha = git("rev-parse --short HEAD");
const dirty = git("status --porcelain") !== "";
const atTag = (() => {
  try {
    execSync("git describe --tags --exact-match --match 'v*'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let version = base;
if (sha && !atTag) version += `+${sha}`;
if (dirty) version += "-dirty";

const target = process.env.BUN_TARGET ?? "bun-darwin-arm64";
const outfile = process.env.OUTFILE ?? "dist/myra-harness";

execSync(
  `bun build --compile --minify --target ${target} ` +
    `--define MYRA_HARNESS_BUILD_VERSION='${JSON.stringify(version)}' ` +
    `--outfile ${outfile} src/index.ts`,
  { stdio: "inherit" },
);
console.log(`[compile] harness ${version} -> ${outfile} (${target})`);
