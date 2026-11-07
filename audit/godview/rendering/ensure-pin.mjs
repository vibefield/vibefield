import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const SHA = "748d015a7e393112e0a91dad80111fdf5abe6583";
const SHIPPED_SWARM = "f61988caffbf2bae2ca99a9f7c0a57ebf7c1a117";
const PIN_SWARM = "d8a7b53b43be8cdcab2e95f6d541b66e46a9357a";
const PIN_RAIN = "3591dd36fa1e1b1da07d02bd494f506d49167197";
const dest = join(import.meta.dirname, ".pin", "puppeteer");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function materialize() {
  if (existsSync(join(dest, ".git")) || existsSync(join(dest, "packages", "views"))) return;
  mkdirSync(dirname(dest), { recursive: true });
  const cached = "/tmp/puppeteer-748d015";
  if (existsSync(join(cached, ".git")) && git(cached, ["rev-parse", "HEAD"]) === SHA) {
    symlinkSync(cached, dest);
    return;
  }
  execFileSync(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", "https://github.com/vibefield/puppeteer.git", dest],
    { stdio: "inherit" },
  );
  execFileSync("git", ["fetch", "--depth", "1", "origin", SHA], { cwd: dest, stdio: "inherit" });
  execFileSync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: dest, stdio: "inherit" });
}

materialize();
const head = git(dest, ["rev-parse", "HEAD"]);
if (head !== SHA) throw new Error(`pin HEAD ${head} is not ${SHA}`);
const swarm = git(dest, ["rev-parse", `HEAD:packages/views/src/views/swarm/AgentSwarm.tsx`]);
const rain = git(dest, ["rev-parse", `HEAD:packages/views/src/views/rain/RainView.tsx`]);
if (swarm !== PIN_SWARM) throw new Error(`AgentSwarm blob ${swarm} is not the 748d015 view`);
if (swarm === SHIPPED_SWARM) throw new Error("pin resolved the shipped 0.3.3 swarm");
if (rain !== PIN_RAIN) throw new Error(`RainView blob ${rain} is not the 748d015 view`);
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8"));
const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
if (names.some((name) => name.startsWith("@vibefield/puppeteer"))) {
  throw new Error("rendering package.json must not depend on published puppeteer packages");
}
if (lstatSync(dest).isSymbolicLink() || existsSync(dest)) {
  process.stdout.write(`pin ${head} swarm ${swarm.slice(0, 12)} rain ${rain.slice(0, 12)}\n`);
}
