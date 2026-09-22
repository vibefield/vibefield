#!/usr/bin/env node
// Wall R23 — "the catalog is honoured by the pins" — and R23b, the literal lint
// (thinking-ar-agent-catalog.md §4, AC-2; AC-D5, AC-D10, AC-D11 RULED 2026-09-22).
//
// The agent catalog (`packages/contracts/src/agent-catalog.ts`) is a table of
// DECISIONS typed by hand: which agents VibeField offers, under which name, with
// which capabilities. A hand-typed table drifts; one proved against the pinned
// siblings at every preflight cannot. This script is that proof. It reads the
// generated projection `packages/contracts/gen/agent-catalog.json` — never the
// TypeScript (a root .mjs must not import it) — and holds every row to BOTH pins:
//
//   the puppeteer half (§4.1) — `createBuiltinProviders()` from the pinned
//     checkout, resolved THROUGH FIELDD'S OWN DEPENDENCY EDGE (createRequire from
//     packages/fieldd/package.json: the R20 door, so this script loads exactly
//     what fieldd may load — builtin-providers and runtime — and nothing else).
//     Per provider: the ports (createSession ⇒ spawn · launch.provider.resume ⇒
//     resume · attachSession ⇒ reattach · accountUsage ⇒ usage · distribution ⇒
//     distribution · a profiles port that declares support.supported ⇒ personas)
//     and the native layout root, read the way fieldd's `kindFor` reads it
//     (agent-runtime.ts: `runtime.profiles(id)` → the native-default profile →
//     `runtime.profileObservationRoot`) and folded to `~/…` as fieldd's `tilde`
//     folds it.
//   the rosetta half (§4.2) — the pinned rosettad (FIELDD_ROSETTAD_BIN when the
//     launching shell names one, else the lock's build — the same resolution the
//     dev runner hands fieldd) run as `discover --json --home <empty dir>`: one
//     `{event:"discovery", agent, dataRoot, …}` line per registered adapter,
//     whether or not the root exists (witnessed at e8d907ab: nine lines, exit 0).
//
// The puppeteer sibling ships TypeScript source (`exports` → ./src/index.ts,
// with `.js` specifiers Node's own type stripping cannot resolve), so that half
// runs in a CHILD process: `node --import tsx` — tsx resolved through the
// contracts package, whose gen:schema already runs on it, so preflight needs no
// install beyond the workspace's own. The child gets a SCRUBBED environment and
// a fake empty HOME: an agent's native root must not depend on who runs the gate
// (CODEX_HOME, CLAUDE_CONFIG_DIR, XDG_DATA_HOME in a developer's shell would
// otherwise move a root), and nothing may touch the real home. rosettad runs
// under the same scrub. Constructing the runtime spawns nothing — providers are
// objects, the profile store here is in memory, and the host refuses every call.
//
// Verdicts (§4.1 / §4.2), each a FAIL unless marked:
//   pin-compose     a row's seams.puppeteer.provider is not composed by the pin
//   pin-claim       a row claims a capability the pin does not implement (AC-D5)
//   pin-root        a row's layoutRoot ≠ the pin's folded native observation root
//   pin-undecided   the pin composes a provider no row decides on
//   kind-registered a row's seams.rosetta.kind is not in rosetta's registry
//   kind-root       a row's layoutRoot ≠ the kind's registered data_root
//   kind-undecided  rosetta registers a kind no row decides on
//   history-seam    a row claims history with no rosetta seam (a table fact:
//                   enforced even when rosettad is absent)
//   candidate       WARN — the pin implements what an offered row does not claim
//   unverified      WARN — no rosettad to ask (AC-D10); a FAIL under
//                   --require-rosetta, which `pnpm siblings:pin` passes and
//                   preflight passes in CI, where the workflow builds the binary
//   stale           WARN, --require-rosetta only — the rosettad is older than a
//                   source in its checkout, so it may predate the new pin
// plus the checker's own honesty: a malformed projection (catalog-shape) or a
// half that could not run (pin-probe, kind-probe) is red, never a silent pass.
//
// R23b (--literals, §4.3; AC-D11): no string literal equal to a catalog id or a
// rosetta kind in `packages/*/src/**/*.{ts,tsx}` or
// `apps/ios/VibeFieldKit/Sources/**/*.swift`, outside the catalog itself and the
// ALLOW-LIST below (each entry justified). AR-L1's teeth: a table of names is not
// a licence to branch on one. Comments and test files are out of scope; the
// matcher lexes string tokens and compares them EXACTLY — no fuzzy patterns.
//
// Usage: node scripts/check-agent-catalog.mjs [--enforce [--require-rosetta]] [--literals] [--self-test]
//   --enforce          the real catalog against the real pins; exit 1 on any FAIL
//   --require-rosetta  (with --enforce) a missing rosettad FAILs instead of WARNing
//   --literals         R23b over the product sources; exit 1 on any FAIL
//   --self-test        rotten fixtures must produce exactly the expected
//                      verdicts, one per FAIL class — else the checker is broken
// Output: `FAIL R23…` lines on stderr, `WARN R23…` lines on stdout (preflight
// lifts the WARN lines into its own report), a facts table, a summary line.
// Node >=22 ESM, builtins only.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { newestSourceMtime, readLock, rosettadBinary, siblingDir } from "./siblings.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT), "..");
const CATALOG_JSON = "packages/contracts/gen/agent-catalog.json";
const CATALOG_SOURCE = "packages/contracts/src/agent-catalog.ts";

/** The capabilities a row may claim (contracts' AGENT_CAPABILITIES, which the
 * projection's `offers` keys must match exactly). */
const CAPABILITIES = [
  "spawn",
  "resume",
  "reattach",
  "history",
  "usage",
  "distribution",
  "personas",
];
/** The puppeteer port that implements each capability — `history` is
 * rosetta's, so it has none here. */
const PORT_FOR = {
  spawn: "createSession",
  resume: "launch.provider.resume",
  reattach: "attachSession",
  usage: "accountUsage",
  distribution: "distribution",
  personas: "profiles",
};
const PUPPETEER_CAPABILITIES = Object.keys(PORT_FOR);
const STATUSES = new Set(["supported", "preview", "deprecated", "declined"]);
/** A row under these statuses is being OFFERED, so an unclaimed port on it is a
 * candidate worth a warning; a deprecated or declined row already decided. */
const OFFERED = new Set(["supported", "preview"]);
/** The packages this script loads from the puppeteer pin — both inside fieldd's
 * R20 door (scripts/check-import-boundaries.mjs), both resolved from fieldd's
 * manifest. The walls' textual matcher sees `import`/`require` of a literal, not
 * a `createRequire(…).resolve`, so this list is the whole of the rule here. */
const FIELDD_DOOR = {
  providers: "@vibecook/puppeteer-builtin-providers",
  runtime: "@vibecook/puppeteer-runtime",
};

// R23b's allow-list: files that may carry an agent id as a string literal, each
// with its reason. A stale entry (the file is gone, or no longer holds a literal)
// is itself a FAIL — an entry that allows nothing would silently allow the next
// literal someone adds to that file.
const R23B_ALLOW = [
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldInput/ReplyChips.swift",
    why: "an explicit one-literal table: the reply chips' transport keyed by provider (K-D4) — a LIVE AR-L1 exception AC-5 made explicit and tested; retire it when the field row's blocker carries its transport (owed)",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldAgents/MockAgentField.swift",
    why: "the DEBUG fleet's fixture ids: seeded demo agents in a fixed order, never compared to a live row",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldSwarm/Lab/SwarmLabFixtures.swift",
    why: "the swarm design lab's fixture ids (-vf-swarm-lab, D-i15): fixture data behind a debug flag",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldSwarm/MarksAtlas.swift",
    why: "the mark atlas: build-time glyph tiles keyed by provider id — presentation; AC-5 keys it by the mirrored catalog fixture",
  },
  {
    file: "packages/field-app/src/design-system/PaneFramePreview.tsx",
    why: "the design catalog's fixture adapter (docs/UI_SYSTEM.md): sample agent.subscribe rows fed to the shipping pane frame — fixture data, never compared",
  },
];

// --- the catalog projection --------------------------------------------------

/** Parse and shape-check the generated projection. Returns `{ rows, problems }`
 * — a problem is a `catalog-shape` FAIL, and with any problem the verdicts are
 * not computed (a half-read table proves nothing). The contracts schema is the
 * authority on a row; this is the subset the gate's own reasoning depends on. */
function validateCatalog(json) {
  const problems = [];
  const rows = json?.catalog;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: [], problems: ["`catalog` is not a non-empty array"] };
  }
  const seen = { id: new Set(), provider: new Set(), kind: new Set() };
  const unique = (key, value, where) => {
    if (seen[key].has(value)) problems.push(`${where}: ${key} \`${value}\` appears twice`);
    seen[key].add(value);
  };
  rows.forEach((row, index) => {
    const where = `row ${index}${typeof row?.id === "string" ? ` (\`${row.id}\`)` : ""}`;
    if (row === null || typeof row !== "object") {
      problems.push(`${where}: not an object`);
      return;
    }
    if (typeof row.id !== "string" || row.id.length === 0) problems.push(`${where}: no id`);
    else unique("id", row.id, where);
    if (!STATUSES.has(row.status)) problems.push(`${where}: status \`${row.status}\` is unknown`);
    if (row.layoutRoot !== null && typeof row.layoutRoot !== "string") {
      problems.push(`${where}: layoutRoot is neither a string nor null`);
    }
    const p = row.seams?.puppeteer;
    const r = row.seams?.rosetta;
    if (row.seams === null || typeof row.seams !== "object") problems.push(`${where}: no seams`);
    else {
      if (p !== null && typeof p?.provider !== "string") {
        problems.push(`${where}: seams.puppeteer is neither {provider} nor null`);
      } else if (p !== null) unique("provider", p.provider, where);
      if (r !== null && typeof r?.kind !== "string") {
        problems.push(`${where}: seams.rosetta is neither {kind} nor null`);
      } else if (r !== null) unique("kind", r.kind, where);
    }
    const offers = row.offers;
    if (offers === null || typeof offers !== "object") problems.push(`${where}: no offers`);
    else {
      const keys = Object.keys(offers).sort();
      if (keys.join() !== [...CAPABILITIES].sort().join()) {
        problems.push(
          `${where}: offers keys are {${keys.join(", ")}}, expected {${CAPABILITIES.join(", ")}}`,
        );
      }
      for (const c of CAPABILITIES) {
        if (typeof offers[c] !== "boolean") problems.push(`${where}: offers.${c} is not a boolean`);
      }
    }
  });
  return { rows, problems };
}

function loadCatalog(path = join(REPO_ROOT, CATALOG_JSON)) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      rows: [],
      problems: [
        `${relative(REPO_ROOT, path)} is missing or unparseable (${error.message}) — regenerate it: pnpm --filter @vibefield/contracts gen:schema`,
      ],
    };
  }
  return validateCatalog(json);
}

// --- verdicts (pure: the catalog × the facts → findings) ----------------------

/** A finding: its level, its verdict class, the thing it is about (a row id, a
 * provider, a kind, a file:line), and the sentence a maintainer acts on. */
const fail = (cls, subject, message) => ({ level: "FAIL", cls, subject, message });
const warn = (cls, subject, message) => ({ level: "WARN", cls, subject, message });
const spell = (root) => (root === null ? "none" : `\`${root}\``);

/** The puppeteer half's verdicts. `facts.providers[]` is what the probe read:
 * `{ id, label, ports: {<capability>: bool}, profilesPort, root, rootVia }`. */
function judgePuppeteer(rows, facts) {
  const findings = [];
  const composed = new Map(facts.providers.map((p) => [p.id, p]));
  for (const row of rows) {
    const provider = row.seams.puppeteer?.provider ?? null;
    if (provider === null) {
      for (const c of PUPPETEER_CAPABILITIES) {
        if (row.offers[c]) {
          findings.push(
            fail(
              "pin-claim",
              row.id,
              `the catalog claims \`${c}\` for \`${row.id}\`; the row has no puppeteer seam`,
            ),
          );
        }
      }
      continue;
    }
    const pin = composed.get(provider);
    if (pin === undefined) {
      findings.push(
        fail(
          "pin-compose",
          row.id,
          `\`${row.id}\`: the pin does not compose \`${provider}\` (seams.puppeteer.provider)`,
        ),
      );
      continue;
    }
    for (const c of PUPPETEER_CAPABILITIES) {
      if (row.offers[c] && !pin.ports[c]) {
        const refused = c === "personas" && pin.profilesPort;
        findings.push(
          fail(
            "pin-claim",
            row.id,
            refused
              ? `the catalog claims \`personas\` for \`${row.id}\`; the pin's \`profiles\` port declares support.supported: false (puppeteer refuses to create a profile for it)`
              : `the catalog claims \`${c}\` for \`${row.id}\`; the pin implements no \`${PORT_FOR[c]}\``,
          ),
        );
      } else if (!row.offers[c] && pin.ports[c] && OFFERED.has(row.status)) {
        findings.push(
          warn(
            "candidate",
            row.id,
            `candidate: \`${row.id}\` could offer \`${c}\` — the pin implements \`${PORT_FOR[c]}\``,
          ),
        );
      }
    }
    // The root is the JOIN fact: it binds only a row that joins (a rosetta seam,
    // or a root it names). A protocol row with neither has nothing to spell.
    if (row.seams.rosetta !== null || row.layoutRoot !== null) {
      if (row.layoutRoot !== pin.root) {
        findings.push(
          fail(
            "pin-root",
            row.id,
            `\`${row.id}\`: layoutRoot ${spell(row.layoutRoot)} ≠ the pin's native observation root ${spell(pin.root)} — both siblings must spell one root`,
          ),
        );
      }
    }
  }
  const decided = new Set(rows.map((row) => row.seams.puppeteer?.provider).filter(Boolean));
  for (const p of facts.providers) {
    if (!decided.has(p.id)) {
      findings.push(
        fail(
          "pin-undecided",
          p.id,
          `no decision for \`${p.id}\`: add a row (declined is a decision)`,
        ),
      );
    }
  }
  return findings;
}

/** The rows' own history claims — a table fact, so it holds with or without a
 * rosettad to ask (also a contracts-test invariant; stated at the gate too). */
function judgeHistorySeams(rows) {
  return rows
    .filter((row) => row.offers.history && row.seams.rosetta === null)
    .map((row) =>
      fail(
        "history-seam",
        row.id,
        `the catalog claims \`history\` for \`${row.id}\`; the row has no rosetta seam`,
      ),
    );
}

/** The rosetta half's verdicts. `facts` is `{ kinds: Map<kind, dataRoot> }`. */
function judgeRosetta(rows, facts) {
  const findings = [];
  for (const row of rows) {
    const kind = row.seams.rosetta?.kind ?? null;
    if (kind === null) continue;
    if (!facts.kinds.has(kind)) {
      findings.push(
        fail(
          "kind-registered",
          row.id,
          `\`${row.id}\`: rosetta's pin registers no kind \`${kind}\` — rosettad would refuse to start on an enrollment naming it`,
        ),
      );
      continue;
    }
    const dataRoot = facts.kinds.get(kind);
    if (row.layoutRoot !== dataRoot) {
      findings.push(
        fail(
          "kind-root",
          row.id,
          `\`${row.id}\`: layoutRoot ${spell(row.layoutRoot)} ≠ rosetta's data_root \`${dataRoot}\` for kind \`${kind}\``,
        ),
      );
    }
    if (!row.offers.history && OFFERED.has(row.status)) {
      findings.push(
        warn(
          "candidate",
          row.id,
          `candidate: \`${row.id}\` could offer \`history\` — rosetta registers kind \`${kind}\``,
        ),
      );
    }
  }
  const decided = new Set(rows.map((row) => row.seams.rosetta?.kind).filter(Boolean));
  for (const [kind, dataRoot] of facts.kinds) {
    if (!decided.has(kind)) {
      findings.push(
        fail(
          "kind-undecided",
          kind,
          `no decision for rosetta kind \`${kind}\` (data_root \`${dataRoot}\`): add a row (declined is a decision)`,
        ),
      );
    }
  }
  return findings;
}

/** Every verdict for one run. A half's facts are either `{ ok: true, … }` or
 * `{ ok: false, cls, message }` (it could not run): a puppeteer half that did
 * not run is red; a rosetta half with no binary is `unverified` — a WARN, or a
 * FAIL under --require-rosetta (AC-D10). */
function judge(rows, puppeteer, rosetta, { requireRosetta = false } = {}) {
  const findings = [];
  if (puppeteer.ok) findings.push(...judgePuppeteer(rows, puppeteer));
  else findings.push(fail(puppeteer.cls, "puppeteer", puppeteer.message));
  findings.push(...judgeHistorySeams(rows));
  if (rosetta.ok) findings.push(...judgeRosetta(rows, rosetta));
  else if (rosetta.cls === "unverified") {
    findings.push(
      requireRosetta
        ? fail(
            "unverified",
            "rosettad",
            `${rosetta.message} — REQUIRED here (--require-rosetta, AC-D10)`,
          )
        : warn("unverified", "rosettad", rosetta.message),
    );
  } else findings.push(fail(rosetta.cls, "rosettad", rosetta.message));
  return findings;
}

// --- the puppeteer probe (runs in the tsx child) ------------------------------

/** puppeteer's absolute path in rosetta's `~/…` spelling — fieldd's `tilde`
 * (packages/fieldd/src/agent-runtime.ts), clause for clause. */
function tilde(path, home, separator = sep) {
  const posix = (p) => p.split(separator).join("/");
  if (path === home) return "~";
  return path.startsWith(`${home}${separator}`)
    ? `~/${posix(path.slice(home.length + 1))}`
    : posix(path);
}

/** Which catalog capabilities one composed provider implements. `personas` is
 * the profiles port only when that port declares support: the registry lists no
 * profile for, and onboarding refuses to create one for, a provider whose port
 * says `supported: false` (puppeteer runtime/src/profiles/{registry,onboarding}.ts). */
function portsOf(provider) {
  const profilesPort = provider.profiles !== undefined && provider.profiles !== null;
  return {
    id: provider.descriptor.id,
    label: provider.descriptor.label,
    ports: {
      spawn: typeof provider.createSession === "function",
      resume: provider.launch?.provider?.resume === true,
      reattach: typeof provider.attachSession === "function",
      usage: provider.accountUsage !== undefined && provider.accountUsage !== null,
      distribution: provider.distribution !== undefined && provider.distribution !== null,
      personas: profilesPort && provider.profiles.provider?.support?.supported === true,
    },
    profilesPort,
  };
}

/** The provider's native layout root, folded, and how it was read. fieldd's own
 * path first — the runtime's native-default profile and `profileObservationRoot`
 * (`kindFor`). A profiles port that declares support false gets no native-default
 * profile from the registry, so its root is asked of the port itself, with the
 * native-default profile the registry would have built (the runtime's exported
 * `nativeDefaultProfileId` and label): the same function the runtime delegates
 * to, on the same inputs. */
async function rootOf(provider, runtime, home, helpers) {
  if (provider.profiles === undefined || provider.profiles === null) {
    return { root: null, rootVia: null };
  }
  const id = provider.descriptor.id;
  const native = (await runtime.profiles(id)).find((p) => p.kind === "native-default");
  if (native !== undefined) {
    const raw = await runtime.profileObservationRoot(native.id);
    return { root: raw === undefined ? null : tilde(raw, home), rootVia: "runtime" };
  }
  const declared = provider.profiles.provider?.support?.nativeDefaultRoot;
  if (typeof declared !== "string") return { root: null, rootVia: null };
  const raw = provider.profiles.observationRoot({
    id: helpers.nativeDefaultProfileId(id),
    provider: id,
    label: helpers.nativeDefaultLabel,
    kind: "native-default",
    dataRoot: declared,
    createdAt: new Date(0).toISOString(),
  });
  return { root: tilde(raw, home), rootVia: "port" };
}

/** The child's whole job: compose the pin the way fieldd does and write what it
 * implements to `outFile`. HOME is the parent's fake empty directory. */
async function probePuppeteer(outFile) {
  const fromFieldd = createRequire(join(REPO_ROOT, "packages", "fieldd", "package.json"));
  const load = (name) => import(pathToFileURL(fromFieldd.resolve(name)).href);
  const builtin = await load(FIELDD_DOOR.providers);
  const runtimePackage = await load(FIELDD_DOOR.runtime);
  const home = homedir();
  const providers = builtin.createBuiltinProviders();
  const refuse = (what) => () => {
    throw new Error(`check-agent-catalog: the probe host never ${what}`);
  };
  // fieldd's construction (agent-runtime.ts), minus everything a probe must not
  // have: an in-memory profile store instead of the user root's file, a roots
  // directory nothing allocates into, a host that refuses every call.
  const runtime = runtimePackage.createAgentRuntime({
    host: { spawnTerminal: refuse("spawns"), automateTerminal: refuse("automates") },
    defaultCwd: home,
    providers,
    profiles: {
      store: { load: async () => undefined, save: async () => {} },
      rootsDirectory: join(home, "profile-roots"),
    },
  });
  const helpers = {
    nativeDefaultProfileId: runtimePackage.nativeDefaultProfileId,
    nativeDefaultLabel: runtimePackage.NATIVE_DEFAULT_PROFILE_LABEL,
  };
  const facts = [];
  for (const provider of providers) {
    facts.push({ ...portsOf(provider), ...(await rootOf(provider, runtime, home, helpers)) });
  }
  await runtime.dispose();
  writeFileSync(outFile, `${JSON.stringify({ home, providers: facts }, null, 2)}\n`);
}

/** The scrubbed environment both halves run under: a fake home, and only what a
 * process needs to start on each platform. */
function scrubbedEnv(home) {
  const env = { HOME: home, USERPROFILE: home };
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

const tail = (text, lines = 12) => (text ?? "").trim().split("\n").slice(-lines).join("\n");

/** Run the probe child and read its facts, or `{ ok: false, cls: "pin-probe" }`. */
function readPuppeteerFacts() {
  let loader;
  try {
    loader = createRequire(join(REPO_ROOT, "packages", "contracts", "package.json")).resolve("tsx");
  } catch (error) {
    return {
      ok: false,
      cls: "pin-probe",
      message: `the puppeteer half needs tsx (packages/contracts' devDependency) and cannot resolve it (${error.message}) — pnpm install`,
    };
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "vf-catalog-pin-")));
  try {
    const home = join(scratch, "home");
    mkdirSync(home);
    const out = join(scratch, "facts.json");
    const child = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(loader).href, SCRIPT, "--probe-puppeteer", out],
      {
        cwd: REPO_ROOT,
        env: scrubbedEnv(home),
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (child.error !== undefined || child.status !== 0 || !existsSync(out)) {
      const why =
        child.error?.code === "ETIMEDOUT"
          ? "did not finish in 120 s"
          : `exited ${child.status ?? child.signal ?? child.error?.message}`;
      return {
        ok: false,
        cls: "pin-probe",
        message: `the puppeteer probe ${why} — is ../puppeteer at the pin and installed?\n${tail(`${child.stdout}\n${child.stderr}`)}`,
      };
    }
    try {
      return { ok: true, ...JSON.parse(readFileSync(out, "utf8")) };
    } catch (error) {
      return {
        ok: false,
        cls: "pin-probe",
        message: `the puppeteer probe wrote facts this checker cannot read (${error.message})`,
      };
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- the rosetta half -----------------------------------------------------------

/** The rosettad this run asks, by the dev runner's rule
 * (tooling/dev-runner/src/electron-stack.mjs): the launching shell's
 * FIELDD_ROSETTAD_BIN wins, else the lock's cargo sibling's build. */
function resolveRosettad() {
  const explicit = process.env.FIELDD_ROSETTAD_BIN;
  if (explicit !== undefined && explicit !== "") {
    return { path: explicit, from: "FIELDD_ROSETTAD_BIN" };
  }
  const built = rosettadBinary(REPO_ROOT);
  if (built === null) return { path: null, from: "siblings.lock.json names no cargo sibling" };
  if (built.path === null) {
    return { path: null, from: `cargo cannot resolve ${built.name}'s target directory` };
  }
  return { path: built.path, from: `${built.name}'s build (pnpm siblings:build)` };
}

/** `rosettad discover --json` output → Map<kind, dataRoot>. Tolerant of other
 * events (the trailing `profile` report) and of unknown fields; strict about a
 * line that is not JSON, a discovery without its two facts, a kind named twice,
 * or no discovery at all — any of those means this is not the registry. */
function parseDiscover(stdout) {
  const kinds = new Map();
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`rosettad discover printed a line that is not JSON: ${line.slice(0, 160)}`);
    }
    if (event === null || typeof event !== "object" || event.event !== "discovery") continue;
    if (
      typeof event.agent !== "string" ||
      event.agent === "" ||
      typeof event.dataRoot !== "string"
    ) {
      throw new Error(`a discovery event without agent/dataRoot: ${line.slice(0, 160)}`);
    }
    if (kinds.has(event.agent)) throw new Error(`rosettad discover named \`${event.agent}\` twice`);
    kinds.set(event.agent, event.dataRoot);
  }
  if (kinds.size === 0) {
    throw new Error(
      "rosettad discover reported no adapter — the registry is read from its discovery events (RO-9 asks for `rosettad adapters --json`)",
    );
  }
  return kinds;
}

/** The pinned binary's registry, or why there is none. `requireRosetta` adds the
 * pin-time staleness warning: a binary older than the checkout's sources may
 * predate the revision just pinned (mtimes are all a binary without a version
 * flag offers, so it stays a warning — cargo may decline to rebuild a file it
 * does not compile, and a FAIL no build can clear would be a trap). */
function readRosettaFacts({ requireRosetta = false } = {}) {
  const bin = resolveRosettad();
  if (bin.path === null || !existsSync(bin.path)) {
    const why =
      bin.from === "FIELDD_ROSETTAD_BIN"
        ? `FIELDD_ROSETTAD_BIN names no file: ${bin.path}`
        : `rosettad is not built — pnpm siblings:build: ${bin.path ?? bin.from}`;
    return { ok: false, cls: "unverified", message: `rosetta half UNVERIFIED (${why})` };
  }
  const notes = [];
  if (requireRosetta) {
    const lock = readLock(REPO_ROOT);
    const entry = Object.entries(lock?.siblings ?? {}).find(([, e]) => e.cargo);
    if (entry !== undefined) {
      const newest = newestSourceMtime(siblingDir(REPO_ROOT, entry[1]));
      if (newest !== null && statSync(bin.path).mtimeMs < newest) {
        notes.push(
          warn(
            "stale",
            "rosettad",
            `rosettad (${bin.path}) is older than a source in ${entry[0]} — this run read THAT build's registry; if the pin moved rosetta, run \`pnpm siblings:build\` and re-run`,
          ),
        );
      }
    }
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "vf-catalog-kinds-")));
  try {
    const run = spawnSync(bin.path, ["discover", "--json", "--home", scratch], {
      env: scrubbedEnv(scratch),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (run.error !== undefined || run.status !== 0) {
      return {
        ok: false,
        cls: "kind-probe",
        message: `${bin.path} discover --json ${run.error?.code === "ETIMEDOUT" ? "did not finish in 60 s" : `exited ${run.status ?? run.signal ?? run.error?.message}`} — a present binary that cannot answer is red (rebuild: pnpm siblings:build)\n${tail(run.stderr)}`,
      };
    }
    try {
      return { ok: true, bin: bin.path, kinds: parseDiscover(run.stdout), notes };
    } catch (error) {
      return { ok: false, cls: "kind-probe", message: `${bin.path}: ${error.message}` };
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- R23b: the literal lint -----------------------------------------------------

const IDENT = /[A-Za-z0-9_$]/;
// After these a `/` opens a regex literal (the usual heuristic, narrowed for
// TSX: `<`, `>` and `}` are left out, because `</a>` and `size={12} />` put a
// slash after them and treating the rest of the line as a regex would hide a
// literal on it).
const REGEX_AFTER_CHAR = new Set([..."(,=:[!&|?{;+-*%~^"]);
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** Every complete, substitution-free string literal in a TS/TSX source, with
 * its line: `"…"`, `'…'`, and a template with no `${}`. Comments are skipped; a
 * regex literal is stepped over; a quote that does not close on its line (JSX
 * text's apostrophe) is dropped. A lexer, not a parser — enough to compare
 * tokens exactly. */
function tsStringLiterals(source) {
  const found = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let prevChar = "";
  let prevWord = "";
  const templates = []; // brace depth saved at each open `${`
  let depth = 0;
  // i is just past a backtick (fresh) or a substitution's closing `}` (resumed)
  const readTemplate = (fresh) => {
    const startLine = line;
    let value = "";
    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        if (source[i + 1] === "\n") line += 1;
        value += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        i += 1;
        if (fresh) found.push({ line: startLine, value });
        prevChar = "`";
        prevWord = "";
        return;
      }
      if (c === "$" && source[i + 1] === "{") {
        templates.push(depth);
        depth = 0;
        i += 2;
        prevChar = "{";
        prevWord = "";
        return;
      }
      if (c === "\n") line += 1;
      value += c;
      i += 1;
    }
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = source[j];
        if (d === "\\") {
          if (source[j + 1] === "\n") line += 1;
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          break;
        }
        if (d === "\n") break;
        j += 1;
      }
      if (closed) {
        found.push({ line, value: source.slice(i + 1, j) });
        i = j + 1;
      } else {
        i = j;
      }
      prevChar = c;
      prevWord = "";
      continue;
    }
    if (c === "`") {
      i += 1;
      readTemplate(true);
      continue;
    }
    if (
      c === "/" &&
      (prevChar === "" || REGEX_AFTER_CHAR.has(prevChar) || REGEX_AFTER_WORD.has(prevWord))
    ) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (inClass) {
          if (d === "]") inClass = false;
        } else if (d === "[") {
          inClass = true;
        } else if (d === "/") {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        j += 1;
        while (j < n && /[a-z]/i.test(source[j])) j += 1;
        i = j;
        prevChar = "/";
        prevWord = "";
        continue;
      }
      // no closing slash on the line: a division after all
    }
    if (IDENT.test(c)) {
      let j = i;
      while (j < n && IDENT.test(source[j])) j += 1;
      prevWord = source.slice(i, j);
      prevChar = source[j - 1];
      i = j;
      continue;
    }
    if (templates.length > 0) {
      if (c === "{") depth += 1;
      else if (c === "}") {
        if (depth === 0) {
          depth = templates.pop();
          i += 1;
          readTemplate(false);
          continue;
        }
        depth -= 1;
      }
    }
    prevChar = c;
    prevWord = "";
    i += 1;
  }
  return found;
}

/** Every complete single-line string literal in a Swift source (`"…"` and raw
 * `#"…"#`), with its line. Comments (nested, as Swift nests them) are skipped;
 * a multi-line `"""` string is stepped over — its value always holds a newline,
 * so it can never equal an id. */
function swiftStringLiterals(source) {
  const found = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = source[i];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      let nesting = 1;
      i += 2;
      while (i < n && nesting > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          nesting += 1;
          i += 2;
        } else if (source[i] === "*" && source[i + 1] === "/") {
          nesting -= 1;
          i += 2;
        } else {
          if (source[i] === "\n") line += 1;
          i += 1;
        }
      }
      continue;
    }
    if (c === '"' || c === "#") {
      let j = i;
      while (source[j] === "#") j += 1;
      const hashes = j - i;
      if (source[j] !== '"') {
        i = j > i ? j : i + 1; // `#if`, `#selector`: not a string
        continue;
      }
      if (source.startsWith('"""', j)) {
        const close = `"""${"#".repeat(hashes)}`;
        let k = source.indexOf(close, j + 3);
        if (k === -1) k = n;
        for (let m = i; m < k; m += 1) if (source[m] === "\n") line += 1;
        i = k + close.length;
        continue;
      }
      const close = `"${"#".repeat(hashes)}`;
      let k = j + 1;
      let closed = false;
      while (k < n && source[k] !== "\n") {
        if (hashes === 0 && source[k] === "\\") {
          k += 2;
          continue;
        }
        if (source.startsWith(close, k)) {
          closed = true;
          break;
        }
        k += 1;
      }
      if (closed) {
        found.push({ line, value: source.slice(j + 1, k) });
        i = k + close.length;
      } else {
        i = k;
      }
      continue;
    }
    i += 1;
  }
  return found;
}

function isTestPath(relPath) {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (/\.(?:test|spec)\.[cm]?tsx?$/.test(base)) return true;
  return relPath.split("/").some((seg) => seg === "test" || seg === "tests" || seg === "__tests__");
}

function walkFiles(dir, pattern, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, pattern, out);
    else if (entry.isFile() && pattern.test(entry.name)) out.push(full);
  }
  return out;
}

/** The ids R23b forbids: every catalog id and every seam's own spelling. */
function literalIds(rows) {
  const ids = new Set();
  for (const row of rows) {
    ids.add(row.id);
    if (row.seams.puppeteer !== null) ids.add(row.seams.puppeteer.provider);
    if (row.seams.rosetta !== null) ids.add(row.seams.rosetta.kind);
  }
  return ids;
}

/** Scan `root`'s product sources for id literals. Returns the hits outside the
 * allow-list, the count each allow-list entry absorbed, and the entries that
 * allow nothing (stale). */
function scanLiterals(root, ids, allow) {
  const files = [];
  let packages = [];
  try {
    packages = readdirSync(join(root, "packages"), { withFileTypes: true });
  } catch {
    packages = [];
  }
  for (const pkg of packages) {
    if (pkg.isDirectory()) walkFiles(join(root, "packages", pkg.name, "src"), /\.tsx?$/, files);
  }
  walkFiles(join(root, "apps", "ios", "VibeFieldKit", "Sources"), /\.swift$/, files);
  const allowed = new Map(allow.map((entry) => [entry.file, 0]));
  const hits = [];
  let scanned = 0;
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join("/");
    // An ambient `.d.ts` stays in: a literal TYPE naming an agent is the same
    // enumeration a literal value is.
    if (rel === CATALOG_SOURCE || isTestPath(rel)) continue;
    scanned += 1;
    const source = readFileSync(abs, "utf8");
    const literals = rel.endsWith(".swift")
      ? swiftStringLiterals(source)
      : tsStringLiterals(source);
    for (const { line, value } of literals) {
      if (!ids.has(value)) continue;
      if (allowed.has(rel)) allowed.set(rel, allowed.get(rel) + 1);
      else hits.push({ file: rel, line, value });
    }
  }
  const stale = allow.filter((entry) => allowed.get(entry.file) === 0);
  return { hits, allowed, stale, scanned };
}

function judgeLiterals(scan, root) {
  const findings = scan.hits.map((hit) =>
    fail(
      "literal",
      `${hit.file}:${hit.line}`,
      `${hit.file}:${hit.line} "${hit.value}" — an agent id literal in product code; read the catalog (catalogEntry, isOffered, visibleCatalog, …) instead (AR-L1)`,
    ),
  );
  for (const entry of scan.stale) {
    findings.push(
      fail(
        "allow-stale",
        entry.file,
        existsSync(join(root, entry.file))
          ? `allow-list entry ${entry.file} holds no agent id literal any more — retire the entry (an entry that allows nothing would allow the next literal silently)`
          : `allow-list entry ${entry.file} names a file that does not exist — retire or correct it`,
      ),
    );
  }
  return findings;
}

// --- reporting -----------------------------------------------------------------

function emit(findings, wall) {
  for (const f of findings) {
    if (f.level === "WARN") console.log(`WARN ${wall}: ${f.message}`);
  }
  for (const f of findings) {
    if (f.level === "FAIL") console.error(`FAIL ${wall}: ${f.message}`);
  }
}

function printPuppeteerFacts(facts) {
  if (!facts.ok) return;
  console.log(
    `R23 puppeteer pin — ${facts.providers.length} provider(s) composed (${FIELDD_DOOR.providers} through fieldd's edge, under tsx):`,
  );
  for (const p of facts.providers) {
    const ports = PUPPETEER_CAPABILITIES.filter((c) => p.ports[c]).join(" ");
    const via =
      p.rootVia === "port"
        ? "  (profiles port declares support false: no native-default profile; root read from the port)"
        : "";
    console.log(`  ${p.id.padEnd(12)} ${ports.padEnd(52)} ${p.root ?? "—"}${via}`);
  }
}

function printRosettaFacts(facts) {
  if (!facts.ok) return;
  console.log(
    `R23 rosetta pin — ${facts.kinds.size} kind(s) registered (${facts.bin} discover --json):`,
  );
  for (const [kind, dataRoot] of [...facts.kinds].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${kind.padEnd(12)} ${dataRoot}`);
  }
}

function runEnforce({ requireRosetta }) {
  const { rows, problems } = loadCatalog();
  if (problems.length > 0) {
    const findings = problems.map((p) =>
      fail("catalog-shape", "catalog", `${CATALOG_JSON} is malformed: ${p}`),
    );
    emit(findings, "R23");
    console.error(`check-agent-catalog: FAIL — the projection cannot be judged [--enforce]`);
    return 1;
  }
  const puppeteer = readPuppeteerFacts();
  const rosetta = readRosettaFacts({ requireRosetta });
  printPuppeteerFacts(puppeteer);
  printRosettaFacts(rosetta);
  const findings = [
    ...judge(rows, puppeteer, rosetta, { requireRosetta }),
    ...(rosetta.notes ?? []),
  ];
  emit(findings, "R23");
  const failures = findings.filter((f) => f.level === "FAIL").length;
  const warnings = findings.length - failures;
  const mode = `--enforce${requireRosetta ? " --require-rosetta" : ""}`;
  if (failures > 0) {
    console.error(
      `check-agent-catalog: FAIL — ${failures} failure(s), ${warnings} warning(s) over ${rows.length} catalog row(s) [${mode}]`,
    );
    return 1;
  }
  const honoured = rosetta.ok
    ? "honoured by both pins"
    : "honoured by the puppeteer pin — the rosetta half UNVERIFIED";
  console.log(
    `check-agent-catalog: pass — ${rows.length} catalog row(s) ${honoured}, ${warnings} warning(s) [${mode}]`,
  );
  return 0;
}

function runLiterals() {
  const { rows, problems } = loadCatalog();
  if (problems.length > 0) {
    emit(
      problems.map((p) => fail("catalog-shape", "catalog", `${CATALOG_JSON} is malformed: ${p}`)),
      "R23b",
    );
    console.error("check-agent-catalog: FAIL — no ids to lint for [--literals]");
    return 1;
  }
  const ids = literalIds(rows);
  const scan = scanLiterals(REPO_ROOT, ids, R23B_ALLOW);
  console.log(
    `R23b — ${scan.scanned} product source(s) lexed for ${ids.size} agent id(s) (packages/*/src, apps/ios/VibeFieldKit/Sources):`,
  );
  for (const entry of R23B_ALLOW) {
    console.log(
      `  allow-listed  ${entry.file} (${scan.allowed.get(entry.file)} literal(s)) — ${entry.why}`,
    );
  }
  const findings = judgeLiterals(scan, REPO_ROOT);
  emit(findings, "R23b");
  if (findings.length > 0) {
    console.error(
      `check-agent-catalog: FAIL — ${scan.hits.length} literal(s) outside the catalog and the allow-list, ${scan.stale.length} stale allow-list entr(ies) [--literals]`,
    );
    return 1;
  }
  console.log(
    "check-agent-catalog: pass — no agent id literal outside the catalog and the allow-list [--literals]",
  );
  return 0;
}

// --- self-test ------------------------------------------------------------------
// Rotten fixtures through the SAME functions --enforce and --literals use. Every
// FAIL class the verdicts can produce is provoked exactly once by one rotten
// catalog; the clean counterpart must produce nothing; the readers (ports, the
// root, the fold, the discover parser, the projection's shape check, the lexers)
// are each held to fixtures. Nothing here touches a sibling or the network.

function row(id, overrides = {}) {
  const offers = Object.fromEntries(CAPABILITIES.map((c) => [c, false]));
  return {
    id,
    label: id,
    status: "preview",
    seams: { puppeteer: { provider: id }, rosetta: null },
    layoutRoot: null,
    admitted: "2026-09-22",
    decision: "self-test",
    surfaces: { desktop: true, phone: true },
    ...overrides,
    offers: { ...offers, ...(overrides.offers ?? {}) },
  };
}

function pinned(id, ports, root = null, extra = {}) {
  const all = Object.fromEntries(PUPPETEER_CAPABILITIES.map((c) => [c, ports.includes(c)]));
  return {
    id,
    label: id,
    ports: all,
    profilesPort: all.personas,
    root,
    rootVia: root === null ? null : "runtime",
    ...extra,
  };
}

const FULL = ["spawn", "resume", "reattach", "usage", "distribution", "personas"];

function selfTestVerdicts(check) {
  const puppeteer = {
    ok: true,
    providers: [
      pinned("alpha", FULL, "~/.alpha"),
      pinned("beta", ["spawn", "resume", "distribution", "personas"], "~/.beta"),
      pinned("gamma", ["spawn"]),
      pinned("delta", ["spawn", "resume", "distribution", "personas"], "~/.delta"),
      pinned("eps", ["spawn", "resume", "distribution"], "~/.eps", {
        profilesPort: true,
        rootVia: "port",
      }),
    ],
  };
  const rosetta = {
    ok: true,
    kinds: new Map([
      ["alpha-code", "~/.alpha"],
      ["beta", "~/.beta-data"],
      ["eps", "~/.eps-history"],
      ["zeta", "~/.zeta"],
    ]),
  };
  const rotten = [
    // clean: every claim implemented, both roots agree
    row("alpha", {
      status: "supported",
      seams: { puppeteer: { provider: "alpha" }, rosetta: { kind: "alpha-code" } },
      layoutRoot: "~/.alpha",
      offers: Object.fromEntries(CAPABILITIES.map((c) => [c, true])),
    }),
    // pin-claim (reattach: no attachSession) + kind-root (~/.beta vs ~/.beta-data)
    row("beta", {
      seams: { puppeteer: { provider: "beta" }, rosetta: { kind: "beta" } },
      layoutRoot: "~/.beta",
      offers: {
        spawn: true,
        resume: true,
        reattach: true,
        history: true,
        distribution: true,
        personas: true,
      },
    }),
    // history-seam: history with no rosetta seam
    row("gamma", { offers: { spawn: true, history: true } }),
    // pin-compose: the pin composes no `ghost`
    row("ghost", { offers: { spawn: true } }),
    // pin-root: the row takes rosetta's spelling, the pin spells another;
    // candidate WARN: the pin implements distribution, the row does not claim it
    row("eps", {
      seams: { puppeteer: { provider: "eps" }, rosetta: { kind: "eps" } },
      layoutRoot: "~/.eps-history",
      offers: { spawn: true, resume: true, history: true },
    }),
    // kind-registered: rosetta registers no `omega`
    row("omega", {
      seams: { puppeteer: null, rosetta: { kind: "omega" } },
      layoutRoot: "~/.omega",
      offers: { history: true },
    }),
    // (no row for `delta` → pin-undecided; none for `zeta` → kind-undecided)
  ];
  const expected = [
    "FAIL pin-claim beta",
    "FAIL kind-root beta",
    "FAIL history-seam gamma",
    "FAIL pin-compose ghost",
    "FAIL pin-root eps",
    "WARN candidate eps",
    "FAIL kind-registered omega",
    "FAIL pin-undecided delta",
    "FAIL kind-undecided zeta",
  ];
  const got = judge(rotten, puppeteer, rosetta).map((f) => `${f.level} ${f.cls} ${f.subject}`);
  check(
    "a rotten catalog produces exactly one finding per FAIL class (+ the one candidate WARN)",
    JSON.stringify([...got].sort()) === JSON.stringify([...expected].sort()),
    `got ${JSON.stringify(got)}`,
  );
  const classes = got.filter((g) => g.startsWith("FAIL")).map((g) => g.split(" ")[1]);
  check(
    "…and every verdict class is covered, none twice",
    new Set(classes).size === classes.length && classes.length === 8,
    `classes ${JSON.stringify(classes)}`,
  );
  const cited = judge(rotten, puppeteer, rosetta).find((f) => f.cls === "pin-root")?.message ?? "";
  check(
    "a root mismatch names both spellings",
    cited.includes("`~/.eps-history`") && cited.includes("`~/.eps`"),
    cited,
  );

  const cleanKinds = new Map([
    ["alpha-code", "~/.alpha"],
    ["beta", "~/.beta"],
    ["eps", "~/.eps"],
    ["zeta", "~/.zeta"],
  ]);
  const clean = [
    rotten[0],
    { ...rotten[1], offers: { ...rotten[1].offers, reattach: false } },
    { ...rotten[2], offers: { ...rotten[2].offers, history: false } },
    row("delta", {
      status: "declined",
      layoutRoot: null,
      offers: {},
      surfaces: { desktop: false, phone: false },
    }),
    { ...rotten[4], layoutRoot: "~/.eps", offers: { ...rotten[4].offers, distribution: true } },
    row("zeta", {
      seams: { puppeteer: null, rosetta: { kind: "zeta" } },
      layoutRoot: "~/.zeta",
      offers: { history: true },
    }),
  ];
  const cleanFindings = judge(clean, puppeteer, { ok: true, kinds: cleanKinds });
  check(
    "the same pins against a clean catalog produce nothing (a declined row is a decision)",
    cleanFindings.length === 0,
    JSON.stringify(cleanFindings),
  );

  // The personas rule: a profiles port that declares support false is not the
  // capability — the antigravity shape at the 2026-09-22 pin.
  const refusing = {
    ok: true,
    providers: [pinned("rho", ["spawn"], "~/.rho", { profilesPort: true, rootVia: "port" })],
  };
  const refused = judge(
    [
      row("rho", {
        seams: { puppeteer: { provider: "rho" }, rosetta: { kind: "rho" } },
        layoutRoot: "~/.rho",
        offers: { spawn: true, history: true, personas: true },
      }),
    ],
    refusing,
    { ok: true, kinds: new Map([["rho", "~/.rho"]]) },
  );
  check(
    "personas over a profiles port that declares support false is a failed claim",
    refused.length === 1 &&
      refused[0].cls === "pin-claim" &&
      refused[0].message.includes("support.supported: false"),
    JSON.stringify(refused),
  );

  // AC-D10: no rosettad is a WARN in a daily run, a FAIL when required; the
  // table's own history fact holds either way.
  const absent = { ok: false, cls: "unverified", message: "rosetta half UNVERIFIED (fixture)" };
  const orphan = row("hist", {
    seams: { puppeteer: null, rosetta: null },
    offers: { history: true },
  });
  const daily = judge([...clean, orphan], puppeteer, absent);
  const required = judge([...clean, orphan], puppeteer, absent, { requireRosetta: true });
  check(
    "no rosettad: WARN unverified daily, FAIL under --require-rosetta, history-seam enforced in both",
    daily.some((f) => f.level === "WARN" && f.cls === "unverified") &&
      required.some((f) => f.level === "FAIL" && f.cls === "unverified") &&
      [daily, required].every((fs) => fs.some((f) => f.cls === "history-seam")),
    JSON.stringify({ daily, required }),
  );
  const broken = judge(
    clean,
    { ok: false, cls: "pin-probe", message: "fixture" },
    { ok: false, cls: "kind-probe", message: "fixture" },
  );
  check(
    "a half that could not run is red, never a quiet pass",
    broken.filter((f) => f.level === "FAIL").length === 2,
    JSON.stringify(broken),
  );
}

async function selfTestReaders(check) {
  const provider = (id, extra) => ({
    descriptor: { id, label: id },
    createSession() {},
    ...extra,
  });
  const full = provider("full", {
    launch: { provider: { id: "full", label: "full", resume: true } },
    attachSession() {},
    accountUsage: {},
    distribution: {},
    profiles: {
      provider: { support: { supported: true, nativeDefaultRoot: "/h/.full/agent" } },
      observationRoot: (p) => p.dataRoot,
    },
  });
  const bare = provider("bare", {});
  const refusing = provider("refusing", {
    launch: { provider: { id: "refusing", label: "refusing", resume: false } },
    profiles: {
      provider: { support: { supported: false, nativeDefaultRoot: "/h/.refusing" } },
      observationRoot: (p) => (p.kind === "native-default" ? p.dataRoot : "/elsewhere"),
    },
  });
  const ports = (p) => {
    const read = portsOf(p);
    return PUPPETEER_CAPABILITIES.filter((c) => read.ports[c]).join(" ");
  };
  check(
    "the port reader: every port, a bare provider, a port that refuses",
    ports(full) === "spawn resume reattach usage distribution personas" &&
      ports(bare) === "spawn" &&
      ports(refusing) === "spawn" &&
      portsOf(refusing).profilesPort === true,
    `${ports(full)} | ${ports(bare)} | ${ports(refusing)}`,
  );

  const runtime = {
    profiles: async (id) =>
      id === "full"
        ? [
            { id: "full:managed-1", kind: "managed" },
            { id: "full:native-default", kind: "native-default" },
          ]
        : [],
    profileObservationRoot: async (profileId) =>
      profileId === "full:native-default" ? "/h/.full" : undefined,
  };
  const helpers = {
    nativeDefaultProfileId: (id) => `${id}:native-default`,
    nativeDefaultLabel: "Default",
  };
  const roots = await Promise.all(
    [full, refusing, bare].map((p) => rootOf(p, runtime, "/h", helpers)),
  );
  check(
    "the root reader: fieldd's runtime path first, the port for a refusing one, none without a port",
    JSON.stringify(roots) ===
      JSON.stringify([
        { root: "~/.full", rootVia: "runtime" },
        { root: "~/.refusing", rootVia: "port" },
        { root: null, rootVia: null },
      ]),
    JSON.stringify(roots),
  );

  const folds = [
    tilde("/h/.claude", "/h", "/"),
    tilde("/h", "/h", "/"),
    tilde("/h/.local/share/opencode", "/h", "/"),
    tilde("/hx/.claude", "/h", "/"),
    tilde("C:\\Users\\j\\.codex", "C:\\Users\\j", "\\"),
  ];
  check(
    "the fold is fieldd's tilde (a prefix impostor is not home)",
    JSON.stringify(folds) ===
      JSON.stringify(["~/.claude", "~", "~/.local/share/opencode", "/hx/.claude", "~/.codex"]),
    JSON.stringify(folds),
  );

  const discover = [
    '{"agent":"a-code","dataRoot":"~/.a","event":"discovery","installed":false,"someday":1}',
    '{"agent":"b","dataRoot":"~/.local/share/b","event":"discovery","installed":true}',
    '{"command":"discover","event":"profile","report":"files walked 0"}',
    "",
  ].join("\n");
  const kinds = parseDiscover(discover);
  const refuses = (text) => {
    try {
      parseDiscover(text);
      return false;
    } catch {
      return true;
    }
  };
  check(
    "the discover parser: discovery lines only, unknown fields ride, a bad line or none is red",
    JSON.stringify([...kinds]) ===
      JSON.stringify([
        ["a-code", "~/.a"],
        ["b", "~/.local/share/b"],
      ]) &&
      refuses("not json\n") &&
      refuses('{"event":"profile"}\n') &&
      refuses('{"event":"discovery","agent":"a"}\n') &&
      refuses(
        '{"event":"discovery","agent":"a","dataRoot":"~/.a"}\n{"event":"discovery","agent":"a","dataRoot":"~/.a"}\n',
      ),
    JSON.stringify([...kinds]),
  );

  const good = { catalog: [row("alpha"), row("beta")] };
  const shapes = [
    validateCatalog(good).problems.length,
    validateCatalog({}).problems.length,
    validateCatalog({ catalog: [row("alpha"), row("alpha")] }).problems.length,
    validateCatalog({
      catalog: [{ ...row("alpha"), offers: { ...row("alpha").offers, usage: "yes" } }],
    }).problems.length,
    validateCatalog({
      catalog: [{ ...row("alpha"), offers: { ...row("alpha").offers, teleport: true } }],
    }).problems.length,
    validateCatalog({ catalog: [{ ...row("alpha"), status: "someday" }] }).problems.length,
  ];
  check(
    "the projection's shape check: a good table passes; missing, duplicate, non-boolean, unknown-capability, unknown-status tables do not",
    shapes[0] === 0 && shapes.slice(1).every((count) => count > 0),
    JSON.stringify(shapes),
  );
}

function selfTestLiterals(check) {
  const tsFound = tsStringLiterals(
    [
      'const a = "alpha"; // "beta" in a comment',
      "/* 'beta'",
      "   still a comment `beta` */ const b = 'beta';",
      'const url = "https://example.test/alpha"; const c = "gamma";',
      'const re = /"/; const d = "delta";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: lexer input — TS source holding templates WITH substitutions, as text
      "const t = `alpha`; const u = `${a}alpha`; const v = `x${`beta`}`;",
      '<Mark agent="gamma" size={12} /> <p>Don\'t</p>',
      'const e = size / 2; const f = "alpha-code";',
    ].join("\n"),
  ).map((l) => `${l.line}:${l.value}`);
  const tsExpected = [
    "1:alpha",
    "3:beta",
    "4:https://example.test/alpha",
    "4:gamma",
    "5:delta",
    "6:alpha",
    "6:beta",
    "7:gamma",
    "8:alpha-code",
  ];
  check(
    "the TS lexer: literals kept, comments/templates-with-substitutions/regexes/JSX apostrophes handled",
    JSON.stringify(tsFound) === JSON.stringify(tsExpected),
    JSON.stringify(tsFound),
  );
  const swiftFound = swiftStringLiterals(
    [
      'case "alpha": return 1 // "beta"',
      '/* "beta" /* nested "beta" */ still "beta" */ let x = #"gamma"#',
      '#if DEBUG let y = "a\\"q" #endif',
      'let m = """',
      "alpha",
      '""" ; let z = "delta"',
    ].join("\n"),
  ).map((l) => `${l.line}:${l.value}`);
  check(
    "the Swift lexer: nested comments, raw strings, escapes, multi-line strings stepped over",
    JSON.stringify(swiftFound) === JSON.stringify(["1:alpha", "2:gamma", '3:a\\"q', "6:delta"]),
    JSON.stringify(swiftFound),
  );

  const tmp = mkdtempSync(join(tmpdir(), "vf-catalog-literals-"));
  try {
    const files = {
      "packages/demo/src/branch.ts": 'export const on = (id: string) => id === "alpha";\n',
      "packages/demo/src/kind.tsx": "export const K = () => <Mark agent='beta-kind' />;\n",
      "packages/demo/src/clean.ts":
        '// "alpha" named in prose\nexport const s = "alpha-beta"; /* \'alpha\' */\n',
      "packages/demo/src/deep/spec.test.ts": 'expect(x).toBe("alpha");\n',
      "packages/demo/src/deep/fixtures/row.ts": 'export const r = "gamma";\n',
      "packages/demo/test/row.ts": 'export const r = "alpha";\n',
      "packages/demo/lib/out-of-scope.ts": 'export const r = "alpha";\n',
      "packages/contracts/src/agent-catalog.ts": 'export const row = { id: "alpha" };\n',
      "packages/demo/src/presentation.ts": 'export const MARKS = { alpha: "alpha" };\n',
      "packages/demo/src/used-to-hold-one.ts": "export const nothing = 0;\n",
      "apps/ios/VibeFieldKit/Sources/Demo/Roster.swift":
        'switch id { case "beta-kind": break } // "alpha"\n',
      "plugins/demo/src/elsewhere.ts": 'export const r = "alpha";\n',
    };
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(tmp, file)), { recursive: true });
      writeFileSync(join(tmp, file), body);
    }
    const allow = [
      { file: "packages/demo/src/presentation.ts", why: "fixture" },
      { file: "packages/demo/src/used-to-hold-one.ts", why: "fixture" },
      { file: "packages/demo/src/gone.ts", why: "fixture" },
    ];
    const ids = literalIds([
      row("alpha", { seams: { puppeteer: { provider: "alpha" }, rosetta: { kind: "beta-kind" } } }),
      row("gamma"),
    ]);
    const scan = scanLiterals(tmp, ids, allow);
    const findings = judgeLiterals(scan, tmp).map((f) => `${f.cls} ${f.subject}`);
    const expected = [
      "literal packages/demo/src/branch.ts:1",
      "literal packages/demo/src/kind.tsx:1",
      "literal packages/demo/src/deep/fixtures/row.ts:1",
      "literal apps/ios/VibeFieldKit/Sources/Demo/Roster.swift:1",
      "allow-stale packages/demo/src/used-to-hold-one.ts",
      "allow-stale packages/demo/src/gone.ts",
    ];
    check(
      "the lint: product literals red; comments, tests, other trees and the catalog out of scope; allow-list absorbs, stale entries red",
      JSON.stringify([...findings].sort()) === JSON.stringify([...expected].sort()) &&
        scan.allowed.get("packages/demo/src/presentation.ts") === 1,
      JSON.stringify(findings),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runSelfTest() {
  let ok = true;
  const check = (name, passed, detail) => {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`);
    if (!passed) {
      console.log(`        ${detail}`);
      ok = false;
    }
  };
  selfTestVerdicts(check);
  await selfTestReaders(check);
  selfTestLiterals(check);
  console.log(ok ? "\nself-test: all passed" : "\nself-test: FAILURES present");
  return ok;
}

// --- entry ---------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  const args = process.argv.slice(2);
  if (args[0] === "--probe-puppeteer") {
    // the tsx child (readPuppeteerFacts): never invoked by hand
    await probePuppeteer(args[1]);
    process.exit(0);
  }
  const has = (flag) => args.includes(flag);
  // An argument this script does not know is refused, never ignored: a caller's
  // typo (`--enforc`) would otherwise select no mode and exit 0 — a gate that
  // passes without having run.
  const known = new Set(["--enforce", "--require-rosetta", "--literals", "--self-test", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`check-agent-catalog: unknown argument(s): ${unknown.join(" ")} (see --help)`);
    process.exit(2);
  }
  if (has("--help") || args.length === 0) {
    console.log(
      "usage: node scripts/check-agent-catalog.mjs [--enforce [--require-rosetta]] [--literals] [--self-test]\n" +
        "  --enforce          prove every catalog row against the pinned puppeteer and rosetta (R23)\n" +
        "  --require-rosetta  with --enforce: a missing rosettad FAILs (siblings:pin, CI — AC-D10)\n" +
        "  --literals         no agent id literal in product sources outside the allow-list (R23b)\n" +
        "  --self-test        rotten fixtures must produce exactly the expected verdicts",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  if (has("--self-test")) process.exit((await runSelfTest()) ? 0 : 1);
  let status = 0;
  if (has("--enforce") || has("--require-rosetta")) {
    status = Math.max(status, runEnforce({ requireRosetta: has("--require-rosetta") }));
  }
  if (has("--literals")) status = Math.max(status, runLiterals());
  process.exit(status);
}
