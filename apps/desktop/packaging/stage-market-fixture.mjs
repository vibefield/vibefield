#!/usr/bin/env node
// `node packaging/stage-market-fixture.mjs [--runs listed,tampered,forged,offline,update]
// [--plugins <own>,<community>] -- <command…>` — MK-6's plugin list, staged for the market's runs
// and removed after them (desk-gates row 37; the smoke's rows are
// `packages/electron-shell/src/testing/smoke-market.ts`).
//
// It writes, into a temporary directory, a plugin list as the registry rung will serve one: index
// v1 (`RegistryIndex`) with its `listing` and `featured`, its detached signature, the artifacts it
// pins by sha256, and the pictures its listings pin by sha256. The list is signed by a key pair
// minted here in memory; only the PUBLIC key leaves this process, to fieldd, and nothing secret is
// ever written (EL7). Its plugins:
//   - VibeField's own, listed at rung R1: the example desk clock (`examples/plugins/desk-clock`, as
//     `pnpm build:all` built it);
//   - a community one, listed with no rung: a desk dial by a maker outside VibeField
//     (`acme.desk-dial`, the clock's kind under a type of its own, built here by plugin-build as
//     stage-kind-fixtures.mjs builds its dial);
//   - the maintainers' pick: VibeField's own.
// `--plugins` names two built plugin folders in their place (its test's fixtures; nothing built).
// The list verifies against its public key before anything launches. Then each run gets its OWN
// copy, and the command is run keyed to that copy alone: `FIELDD_PLUGIN_REGISTRY_URL` its
// `index.json`, `FIELDD_PLUGIN_REGISTRY_KEY` the public key (fieldd's development seam,
// registry-seam.ts), `FIELDD_PLUGIN_DEV_ROOTS` empty (so the example clock comes from the list
// alone), and `VF_MARKET_FIXTURE` saying which run:
//   listed   — the copy as signed;
//   tampered — one byte of VibeField's own artifact flipped: the list still verifies, its pin not;
//   forged   — the same bytes signed again by a STRANGER's key, minted here and dropped;
//   offline  — the address fieldd is handed names a file that is not there;
//   update   — beside the list, a second one signed by the same key: VibeField's own at 0.2.0,
//              asking for one power more (`canvas.write`); the smoke copies it over the first.
// Every run runs, whatever the one before said; the exit is the first red run's code, 0 when all
// are green; the temporary directory goes either way.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(message) {
  process.stderr.write(
    `stage-market-fixture: ${message}\nusage: stage-market-fixture.mjs [--runs a,b] [--plugins own,community] -- <command…>\n`,
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator < 0 || separator === argv.length - 1) usage("no command after --");
const command = argv.slice(separator + 1);
const options = {};
for (let i = 0; i < separator; i++) {
  const name = argv[i];
  if ((name !== "--runs" && name !== "--plugins") || i + 1 >= separator) usage(`unknown ${name}`);
  options[name.slice(2)] = argv[++i];
}
const given = options.plugins?.split(",").filter(Boolean);
if (given !== undefined && given.length !== 2)
  usage("--plugins names two built plugin folders: VibeField's own, then a community one");

// The workspace's sources run as plugin-build's bin runs them (stage-kind-fixtures.mjs's recipe):
// Node strips the types, an extensionless relative import is retried as `.ts`, and a `.wgsl`
// import is its text (plugin-build's own `wgsl()` rule).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".wgsl")) {
      const text = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        source: `export default ${JSON.stringify(text)};\n`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const contracts = await load("packages/contracts/src/index.ts");
const { canonicalJson } = await load("tooling/plugin-build/src/canonical.ts");
const { generateRegistryKeypair, signRegistryIndex, verifyRegistryIndex } = await load(
  "tooling/plugin-build/src/registry-sign.ts",
);
const { listBundleMembers, packVfplugin } = await load("tooling/plugin-build/src/pack.ts");
const { MARKET_FIXTURE_ENV, MARKET_PICTURE, MARKET_RUNS, marketRows } = await load(
  "packages/electron-shell/src/testing/smoke-market.ts",
);
const { FIELDD_PLUGIN_REGISTRY_KEY_ENV, FIELDD_PLUGIN_REGISTRY_URL_ENV } = contracts;

const runs = (options.runs ?? MARKET_RUNS.join(",")).split(",").filter(Boolean);
for (const run of runs) if (!MARKET_RUNS.includes(run)) usage(`no run named ${run}`);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
/** The two secrets the packaging scripts read (bundled-plugins.mjs): never handed to a run, as
 * stage-bundled-fixture.mjs keeps the first from its runs (EL7). */
const SECRETS = ["VIBEFIELD_BUNDLED_INDEX_SECRET", "VIBEFIELD_SMOKE_BUNDLED_SECRET"];
/** the launching shell's own list, if it named one, never reaches a run: each run names its own;
 * and neither secret above reaches one */
const withoutSeam = (env) => {
  const out = { ...env };
  delete out[FIELDD_PLUGIN_REGISTRY_URL_ENV];
  delete out[FIELDD_PLUGIN_REGISTRY_KEY_ENV];
  for (const name of SECRETS) delete out[name];
  return out;
};

const tmp = mkdtempSync(join(tmpdir(), "vf-market-fixture-"));
const remove = () => {
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`MARKET_FIXTURE_REMOVED ${JSON.stringify({ root: tmp })}\n`);
};
const refuse = (message) => {
  process.stderr.write(`stage-market-fixture: ${message}\n`);
  remove();
  process.exit(1);
};

/** A PNG of one colour, `w` × `h`: a picture whose size says which it is (MARKET_PICTURE). */
function png(w, h, [r, g, b]) {
  const line = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) line.set([r, g, b], 1 + x * 3);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter set, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => line)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pristine = join(tmp, "pristine");
mkdirSync(join(pristine, "artifacts"), { recursive: true });

/** One picture beside the index, by day and by night: its path and its pin. */
function picture(id, name, sizes, day, night) {
  const out = {};
  for (const [side, colour] of [
    ["day", day],
    ["night", night],
  ]) {
    const path = `listing/${id}/${name}-${side}.png`;
    const bytes = png(sizes[side].w, sizes[side].h, colour);
    mkdirSync(dirname(join(pristine, path)), { recursive: true });
    writeFileSync(join(pristine, path), bytes);
    out[side] = { path, sha256: sha256(bytes) };
  }
  return out;
}

/** A built plugin folder's manifest, or the refusal: never a guess. */
function manifestIn(dir) {
  const file = join(dir, "vibefield.plugin.json");
  if (!existsSync(file)) refuse(`${dir} holds no vibefield.plugin.json`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const entry = manifest.entries?.renderer;
  if (typeof entry === "string" && !existsSync(join(dir, entry)))
    refuse(`${manifest.id} is not built: ${entry} is missing (pnpm build:all builds it)`);
  return manifest;
}

/** The community dial (above): the clock's kind under a type of its own, built by plugin-build. */
async function buildDial(clockDir, clockManifest) {
  const { buildPlugin } = await load("tooling/plugin-build/src/build.ts");
  const dialType = "acme.desk-dial";
  const dir = join(tmp, "build", "desk-dial");
  const at = (path) => JSON.stringify(join(clockDir, "src", path));
  const clockRow = clockManifest.contributes.objects[0];
  const manifest = {
    ...clockManifest,
    id: dialType,
    title: "Desk dial",
    description: "A minute dial for the desk, by a maker outside VibeField (MK-6's fixture)",
    version: "1.0.0",
    activation: [`onObject:${dialType}`],
    contributes: {
      ...clockManifest.contributes,
      objects: [
        {
          ...clockRow,
          type: dialType,
          title: "Dial",
          props: { ...clockRow.props, seconds: { kind: "boolean", default: false } },
          provides: [dialType, "desk.object", "desk.containable"],
          binding: { kind: "dial" },
          tray: { ...clockRow.tray, label: "Dial" },
        },
      ],
    },
  };
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "vibefield.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "vf-market-dial", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "src", "renderer.ts"),
    [
      "// MK-6's community fixture (packaging/stage-market-fixture.mjs): the desk clock's kind",
      "// under a type of its own, by a maker outside VibeField; staged for the market's runs.",
      `import base from ${at("renderer.ts")};`,
      `import { clockKind } from ${at("kind.ts")};`,
      `export const dial = { kind: { ...clockKind(), name: ${JSON.stringify(dialType)} } };`,
      "export default base;",
      "",
    ].join("\n"),
  );
  const report = await buildPlugin({ root: dir });
  if (!report.ok) refuse(`the community dial did not build (${report.stages.length} stages ran)`);
  return dir;
}

// ── the plugins ─────────────────────────────────────────────────────────────────────────────────
const ownDir =
  given === undefined ? join(repo, "examples/plugins/desk-clock") : resolve(given[0] ?? "");
const own = manifestIn(ownDir);
const theirsDir = given === undefined ? await buildDial(ownDir, own) : resolve(given[1] ?? "");
const theirs = manifestIn(theirsDir);

/** VibeField's own again at 0.2.0, asking for one power more: the update run's (the members its
 * pack carries, as built, and its manifest moved on). */
const ASKS = ["canvas.write"];
const NEXT = "0.2.0";
const ownNextDir = join(tmp, "build", "own-next");
mkdirSync(ownNextDir, { recursive: true });
for (const member of listBundleMembers(ownDir)) {
  if (member === "vibefield.plugin.json") continue;
  mkdirSync(dirname(join(ownNextDir, member)), { recursive: true });
  cpSync(join(ownDir, member), join(ownNextDir, member));
}
const ownNext = {
  ...own,
  version: NEXT,
  capabilities: [...(own.capabilities ?? []), ...ASKS],
};
writeFileSync(join(ownNextDir, "vibefield.plugin.json"), `${JSON.stringify(ownNext, null, 2)}\n`);

/** An object as its listing and the smoke's fixture both say it. */
const objectOf = (row) => ({
  type: row.type,
  label: row.tray?.label ?? row.title,
  category: row.tray?.category ?? "things",
});

const generatedAt = Date.now();
/** One release of a plugin: its artifact packed into `artifacts/`, its pin and its ranges. */
async function release(dir, manifest) {
  const { bytes, sha256: pin } = await packVfplugin({ rootDir: dir });
  const name = `${manifest.id}@${manifest.version}.vfplugin`;
  writeFileSync(join(pristine, "artifacts", name), bytes);
  return {
    release: {
      version: manifest.version,
      artifactUrl: `artifacts/${name}`,
      sha256: pin,
      minApp: manifest.engines.app,
      minContracts: manifest.engines.contracts,
      publishedAt: generatedAt,
    },
    size: bytes.length,
    name,
  };
}

/** What a listing says, as the registry's CI writes it from the manifest it rebuilt (MK-D12). Its
 * summary is a plain line of the stager's own: the clock's manifest description names its insides
 * (its WGSL, its pass, the SDK's door), and the summary shows in James's stills. */
function listing(manifest, publisherName, size, colours, summary) {
  return {
    title: manifest.title,
    summary,
    publisherName,
    spread: picture(manifest.id, "spread", MARKET_PICTURE.spread, colours.day, colours.night),
    objects: manifest.contributes.objects.map((row) => ({
      ...objectOf(row),
      stills: picture(manifest.id, "still", MARKET_PICTURE.still, colours.day, colours.night),
    })),
    size,
  };
}

const ownRelease = await release(ownDir, own);
const theirRelease = await release(theirsDir, theirs);
const ownNextRelease = await release(ownNextDir, ownNext);
const repoOf = (id) => `https://example.test/plugins/${id}`;
const ownListing = listing(
  own,
  "VibeField",
  ownRelease.size,
  { day: [232, 226, 210], night: [40, 44, 52] },
  "An analogue clock that lies on your desk.",
);
const theirListing = listing(
  theirs,
  "Acme",
  theirRelease.size,
  { day: [210, 226, 232], night: [52, 44, 40] },
  "A minute dial for your desk.",
);

/** The list at a moment, with VibeField's own entry as given. */
function indexOf(when, ownEntry) {
  return {
    schemaVersion: 1,
    generatedAt: when,
    plugins: {
      [own.id]: ownEntry,
      [theirs.id]: {
        id: theirs.id,
        repo: repoOf(theirs.id),
        latest: theirRelease.release,
        history: [],
        listing: theirListing,
      },
    },
    featured: [own.id],
  };
}
const first = indexOf(generatedAt, {
  id: own.id,
  repo: repoOf(own.id),
  latest: ownRelease.release,
  history: [],
  rung: "R1",
  listing: ownListing,
});
const second = indexOf(generatedAt + 60_000, {
  id: own.id,
  repo: repoOf(own.id),
  latest: ownNextRelease.release,
  history: [ownRelease.release],
  rung: "R1",
  listing: { ...ownListing, size: ownNextRelease.size },
});

const keys = generateRegistryKeypair();
/** The list's exact bytes, schema-checked, signed by `secretKey` and verified before it is kept. */
function writeSigned(dir, index, secretKey, publicKey) {
  const parsed = contracts.RegistryIndex.safeParse(index);
  if (!parsed.success) refuse(`the staged list fails its schema: ${parsed.error.message}`);
  // a listing, a rung or the pick the schema catches goes unshown rather than refusing the list
  // (`plugin-distribution.ts`), so each is held here to have parsed
  for (const [id, entry] of Object.entries(index.plugins)) {
    const read = parsed.data.plugins[id];
    if (read?.listing === undefined) refuse(`${id}'s staged listing does not parse`);
    if (entry.rung !== undefined && read.rung !== entry.rung)
      refuse(`${id}'s staged rung does not parse`);
  }
  if (parsed.data.featured === undefined) refuse("the staged pick does not parse");
  const bytes = Buffer.from(canonicalJson(index), "utf8");
  const signature = signRegistryIndex(bytes, secretKey);
  if (!verifyRegistryIndex(bytes, signature, publicKey))
    refuse("the staged list does not verify against its own public key");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.sig"), signature);
}
writeSigned(pristine, first, keys.secretKey, keys.publicKey);
writeSigned(join(pristine, "next"), second, keys.secretKey, keys.publicKey);

/** A plugin as the smoke's fixture says it. */
const told = (manifest) => ({
  id: manifest.id,
  title: manifest.title,
  version: manifest.version,
  objects: manifest.contributes.objects.map(objectOf),
});

/** One run's own copy of the stage, changed as the run says, and what the smoke is told of it. */
function prepare(run) {
  const stage = join(tmp, run);
  cpSync(pristine, stage, { recursive: true });
  const index = join(stage, "index.json");
  if (run === "tampered") {
    const file = join(stage, "artifacts", ownRelease.name);
    const bytes = readFileSync(file);
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    writeFileSync(file, bytes);
  }
  if (run === "forged") {
    const stranger = generateRegistryKeypair();
    writeFileSync(
      join(stage, "index.json.sig"),
      signRegistryIndex(readFileSync(index), stranger.secretKey),
    );
  }
  const address = pathToFileURL(run === "offline" ? join(stage, "absent", "index.json") : index);
  const fixture = {
    run,
    list: address.href,
    vibefield: told(own),
    community: told(theirs),
    featured: first.featured,
    next:
      run === "update"
        ? {
            version: NEXT,
            asks: ASKS,
            index: join(stage, "next", "index.json"),
            signature: join(stage, "next", "index.json.sig"),
            into: index,
            intoSignature: join(stage, "index.json.sig"),
          }
        : null,
  };
  return { address: address.href, fixture };
}

process.stdout.write(
  `MARKET_FIXTURE ${JSON.stringify({
    root: tmp,
    runs,
    plugins: Object.keys(first.plugins),
    featured: first.featured,
    tampered: ownRelease.name,
    keyClass: "dev",
  })}\n`,
);

let child = null;
let stopped = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopped = signal;
    child?.kill(signal);
  });
}

let exit = 0;
const verdicts = {};
for (const run of runs) {
  if (stopped !== null) break;
  const { address, fixture } = prepare(run);
  const code = await new Promise((resolveRun) => {
    child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: {
        ...withoutSeam(process.env),
        FIELDD_PLUGIN_DEV_ROOTS: "",
        [FIELDD_PLUGIN_REGISTRY_URL_ENV]: address,
        [FIELDD_PLUGIN_REGISTRY_KEY_ENV]: keys.publicKey,
        [MARKET_FIXTURE_ENV]: JSON.stringify(fixture),
      },
    });
    child.once("error", (error) => {
      process.stderr.write(`stage-market-fixture: ${command[0]} did not start: ${error.message}\n`);
      resolveRun(2);
    });
    child.once("exit", (status, signal) => resolveRun(status ?? (signal === null ? 1 : 2)));
  });
  child = null;
  process.stdout.write(`MARKET_FIXTURE_RUN ${JSON.stringify({ run, exit: code })}\n`);
  verdicts[run] = code;
  if (code !== 0 && exit === 0) exit = code;
}
// one line for the landing gate's verdict (scripts/gate-landing.mjs quotes it): every run's exit,
// and, by name, the parked rows each run left out (C36), so a green landing's verdict names them;
// `marketRows` over the `VF_MARKET_ROWS` each run was handed, as the run reads it (`{}`: none)
const parked = Object.fromEntries(
  Object.keys(verdicts)
    .map((run) => [run, marketRows(run, process.env).parked.map((row) => row.name)])
    .filter(([, names]) => names.length > 0),
);
const done = { runs: verdicts, parked, ...(stopped !== null ? { stopped } : {}) };
process.stdout.write(`MARKET_FIXTURE_DONE ${JSON.stringify(done)}\n`);
remove();
process.exit(stopped !== null && exit === 0 ? 1 : exit);
