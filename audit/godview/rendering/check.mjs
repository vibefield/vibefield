import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ENTRIES, HOLES, MODEL_STATE_IDS, PINS, assertCoverage } from "./inputs.mjs";

assertCoverage();
const dir = join(import.meta.dirname, "..", "fixtures");
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
if (files.length !== ENTRIES.length) {
  throw new Error(`fixture files ${files.length} entries ${ENTRIES.length}`);
}
const seen = new Set();
for (const name of files) {
  const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (data.fixtureId !== name.replace(/\.json$/u, "")) throw new Error(name);
  if (data.origin !== "synthetic" || data.syntheticLabel.length < 12) throw new Error(name);
  if (data.pins.puppeteer !== PINS.puppeteer || data.pins.vibefield !== PINS.vibefield) {
    throw new Error(`${name} pins`);
  }
  if (data.component.repo !== "puppeteer" || data.component.sha !== PINS.puppeteer) {
    throw new Error(`${name} component sha`);
  }
  if (!/^fix\.[a-z][a-z0-9.-]*$/u.test(data.fixtureId)) throw new Error(data.fixtureId);
  if (!/^state\.[a-z][a-z0-9_]*$/u.test(data.lifecycleStates[0])) throw new Error(name);
  seen.add(data.lifecycleStates[0]);
}
const covered = new Set([...seen, ...HOLES.map((hole) => hole.stateId)]);
for (const id of MODEL_STATE_IDS) {
  if (!covered.has(id)) throw new Error(`uncovered ${id}`);
}
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8"));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
if (deps.some((name) => name.startsWith("@vibefield/puppeteer"))) {
  throw new Error("published puppeteer dependency");
}
process.stdout.write(`fixtures ${files.length} holes ${HOLES.length} states ${MODEL_STATE_IDS.length}\n`);
