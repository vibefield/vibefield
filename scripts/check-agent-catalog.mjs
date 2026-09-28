#!/usr/bin/env node
// Wall R23 — "the catalog is honoured by the pins" — and R23b, the literal lint
// (thinking-ar-agent-catalog.md §4, AC-2; AC-D5, AC-D10, AC-D11 RULED 2026-09-22;
// hardened by AC-7 the same day, after two reviews of AC-2).
//
// The agent catalog (`packages/contracts/src/agent-catalog.ts`) is a table of
// DECISIONS typed by hand: which agents VibeField offers, under which name, with
// which capabilities. A hand-typed table drifts; one proved against the pinned
// siblings at every preflight cannot. This script is that proof. It reads the
// generated projection `packages/contracts/gen/agent-catalog.json` — never the
// TypeScript (a root .mjs must not import it) — after checking the sha256 of
// `src/agent-catalog.ts` the projection records against the source on disk (a
// projection generated from another source is STALE, and judged by nobody), and
// holds every row to BOTH pins:
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
//   the rosetta half (§4.2) — the LOCK's rosettad (`rosettadBinary()`: the cargo
//     sibling's own build, cargo asked without a lane's CARGO_TARGET_DIR) run as
//     `discover --json --home <empty dir>`: one `{event:"discovery", agent,
//     dataRoot, …}` line per registered adapter, whether or not the root exists
//     (witnessed at e8d907ab: nine lines, exit 0). Under --require-rosetta that
//     build is the ONLY binary asked — a FIELDD_ROSETTAD_BIN naming any other
//     file (by device and inode, never by spelling) is a FAIL naming both. A
//     daily run honours the variable (the dev runner hands fieldd the same one)
//     with a WARN when it is not the lock's build.
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
// A missing counterpart is judged by what the row CLAIMS, never by its status
// (§6's lifecycle): a provider the pin no longer composes, or a kind rosetta no
// longer registers, is a FAIL only when the row claims a capability that needs
// it — a removed provider's row stays as a record (`declined`, or a
// `deprecated` row whose history still indexes). And a root is proved by the
// pin that HAS one: a provider composed without a profiles port has no native
// root, so rosetta's data_root alone proves that row's layoutRoot.
//
// Verdicts (§4.1 / §4.2), each a FAIL unless marked:
//   pin-compose     the pin does not compose a row's provider AND the row
//                   claims a capability only puppeteer supplies
//   pin-claim       a row claims a capability the pin does not implement
//                   (AC-D5), or claims one with no puppeteer seam at all
//   pin-root        a row's layoutRoot ≠ the pin's folded native observation
//                   root (only where the pin has a root)
//   pin-undecided   the pin composes a provider no row decides on
//   kind-registered rosetta does not register a row's kind AND the row claims
//                   history
//   kind-root       a row's layoutRoot ≠ the kind's registered data_root
//   kind-undecided  rosetta registers a kind no row decides on
//   history-seam    a row claims history with no rosetta seam (a table fact:
//                   enforced even when rosettad is absent)
//   candidate       WARN — the pin implements what an offered row does not claim
//   unverified      WARN — no rosettad to ask (AC-D10); a FAIL under
//                   --require-rosetta, which `pnpm siblings:pin` passes and
//                   preflight passes in CI, where the workflow builds the binary
//   bin-foreign     WARN — FIELDD_ROSETTAD_BIN is not the lock's build; a FAIL
//                   under --require-rosetta
//   stale           WARN, --require-rosetta only — the lock's rosettad is older
//                   than a source in its checkout, so it may predate the pin
//                   (`pnpm siblings:pin` builds first; CI and hand runs see it)
// plus the checker's own honesty: a malformed projection (catalog-shape), a
// stale one (catalog-stale), or a half that could not run (pin-probe,
// kind-probe) is red, never a silent pass. A class not registered in CLASSES
// cannot be emitted at all.
//
// R23b (--literals, §4.3; AC-D11): no string literal equal to a catalog id or a
// rosetta kind in the product trees (R23B_TREES — packages/*/src,
// plugins/*/src, examples/plugins/*/src, apps/*/src as TS/TSX;
// apps/ios/VibeFieldKit/Sources and apps/ios/App as Swift), outside the catalog
// itself and the ALLOW-LIST below: each entry justified and holding an EXACT
// literal count, so a new literal in an allowed file is as red as one anywhere
// else. AR-L1's teeth: a table of names is not a licence to branch on one.
// Comments and test files are out of scope, and symlinked directories and files
// are never walked (a committed symlink once walked another checkout). The
// matcher lexes string tokens and compares them EXACTLY — no fuzzy patterns.
// OUT OF SCOPE BY CONSTRUCTION: an agent named as an IDENTIFIER (a TS object key
// or enum member, a Swift `case claude` or `.claude`) is no string token; review
// and the catalog's readers own that shape, this lint cannot see it.
//
// The checker's own tripwire: the self-test drives the verdicts, the readers,
// the lexers, the walk and BOTH drivers (runEnforce / runLiterals, end to end
// over rotten projections and canned facts) through fixtures, and --enforce and
// --literals run it in-process FIRST, refusing to judge while it is red.
//
// Usage: node scripts/check-agent-catalog.mjs [--self-test] [--enforce [--require-rosetta]] [--literals]
//        node scripts/check-agent-catalog.mjs --help
//   --enforce          R23: the real catalog against the real pins
//   --require-rosetta  (implies --enforce) only the lock's rosettad may answer,
//                      and a missing one FAILs instead of WARNing
//   --rosettad <path>  (with --enforce) the lock's rosettad as the caller already
//                      resolved it — preflight and siblings:pin pass it, so this
//                      script does not ask cargo a second time
//   --literals         R23b over the product trees
//   --self-test        print the checker's own fixtures (every mode runs them)
//   --help             this text — alone; beside a mode it exits 2, never 0 unrun
// Exit: 0 pass · 1 any FAIL, or a red self-test · 2 a usage error.
// Output: `FAIL R23…` lines on stderr, `WARN R23…` lines on stdout (preflight
// lifts the WARN lines into its own report — a child's output embedded in a
// message is indented, so the child's own WARN lines are never lifted as R23's),
// a facts table, a summary line.
// Node >=22 ESM, builtins only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
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
const REGENERATE = "pnpm --filter @vibefield/contracts gen:schema";

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
/** The puppeteer port that implements each puppeteer-owned capability. */
const PORT_FOR = {
  spawn: "createSession",
  resume: "launch.provider.resume",
  reattach: "attachSession",
  usage: "accountUsage",
  distribution: "distribution",
  personas: "profiles",
};
/** The capabilities rosetta supplies: a claim to one needs a rosetta seam
 * (history-seam) and a kind the pin registers (kind-registered). */
const ROSETTA_CAPABILITIES = ["history"];

/** Every capability is owned by exactly one sibling, and every owned name is a
 * capability. A capability owned by neither would be claimable and proved by
 * nobody — so the table refuses to load rather than pass it. */
function capabilityOwnershipProblems(capabilities, portFor, rosettaOwned) {
  const problems = [];
  for (const c of capabilities) {
    const owners = (Object.hasOwn(portFor, c) ? 1 : 0) + (rosettaOwned.includes(c) ? 1 : 0);
    if (owners === 0) {
      problems.push(`\`${c}\` has no owner — add it to PORT_FOR or ROSETTA_CAPABILITIES`);
    } else if (owners > 1) {
      problems.push(`\`${c}\` is owned twice — PORT_FOR and ROSETTA_CAPABILITIES both name it`);
    }
  }
  for (const c of [...Object.keys(portFor), ...rosettaOwned]) {
    if (!capabilities.includes(c)) problems.push(`\`${c}\` is owned but is not a capability`);
  }
  return problems;
}
{
  const problems = capabilityOwnershipProblems(CAPABILITIES, PORT_FOR, ROSETTA_CAPABILITIES);
  if (problems.length > 0) {
    throw new Error(`check-agent-catalog: the capability table is broken: ${problems.join("; ")}`);
  }
}
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

/** Every class a finding may carry; `fail()` and `warn()` refuse any other, so
 * a new verdict cannot ship unnamed. The VERDICT classes are the ones judge()
 * derives from the table and the facts — the self-test demands a rotten row
 * provoking each, so a new one cannot ship untested either. */
const VERDICT_CLASSES = [
  "pin-compose",
  "pin-claim",
  "pin-root",
  "pin-undecided",
  "kind-registered",
  "kind-root",
  "kind-undecided",
  "history-seam",
];
const CLASSES = new Set([
  ...VERDICT_CLASSES,
  "candidate",
  "unverified",
  "bin-foreign",
  "stale",
  "pin-probe",
  "kind-probe",
  "catalog-shape",
  "catalog-stale",
  "literal",
  "allow-count",
]);

// R23b's allow-list: files that may carry an agent id as a string literal, each
// with its reason and the EXACT number of literals it allows. Any other count is
// a FAIL: more is a new literal (a decision, not a free ride on the entry), fewer
// is a spare allowance that would absorb the next literal silently (at zero,
// retire the entry).
const R23B_ALLOW = [
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldInput/ReplyChips.swift",
    count: 1,
    why: "an explicit one-literal table: the reply chips' transport keyed by provider (K-D4) — a LIVE AR-L1 exception AC-5 made explicit and tested; retire it when the field row's blocker carries its transport (owed)",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldAgents/MockAgentField.swift",
    count: 4,
    why: "the DEBUG fleet's fixture ids: seeded demo agents in a fixed order, never compared to a live row",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldSwarm/Lab/SwarmLabFixtures.swift",
    count: 1,
    why: "the swarm design lab's fixture ids (-vf-swarm-lab, D-i15): fixture data behind a debug flag",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldSwarm/MarksAtlas.swift",
    count: 29,
    why: "the mark atlas: build-time glyph tiles keyed by provider id — presentation; AC-5 keys it by the mirrored catalog fixture",
  },
  {
    file: "packages/field-app/src/design-system/PaneFramePreview.tsx",
    count: 6,
    why: "the design catalog's fixture adapter (docs/UI_SYSTEM.md): sample agent.subscribe rows fed to the shipping pane frame — fixture data, never compared",
  },
  // AR-S1…S5 and IOS-9 (landed while AC was in review) — the design catalog's
  // fixture data for Settings → Agents, Agent Profiles, Extensions and the
  // Godview profile tabs, the terminal miniature's one sample agent, and the
  // History tab's sample corpus: presentation, never compared to a live row.
  {
    file: "packages/field-app/src/design-system/profiles-fixtures.ts",
    count: 41,
    why: "Agent Profiles' fixture data for the design catalog (AR-S2): sample sign-ins, usage rows and installs per provider — fixture data, never compared",
  },
  {
    file: "packages/field-app/src/design-system/agents-fixtures.ts",
    count: 20,
    why: "Settings → Agents' fixture data for the design catalog (AR-S1): sample installs, releases, personas and operations — fixture data, never compared",
  },
  {
    file: "packages/field-app/src/design-system/godview-profiles-fixtures.ts",
    count: 16,
    why: "the Godview profile tabs' fixture door (AR-S5): sample providers, profile sets and sessions on the stage — fixture data, never compared",
  },
  {
    file: "packages/field-app/src/design-system/extensions-fixtures.ts",
    count: 15,
    why: "Extensions' fixture lens for the design catalog (AR-S4b), the contracts fixture's twin, and its runs (AR-S4c: an act, a server's sign-in; AR-S4d2: a skill's owner, a change made outside VibeField; AR-S4e: a plugin's update; AR-S4e2: an agent's catalog, a check's run and an install's pane, each the contracts fixture's twin) — fixture data, never compared",
  },
  {
    file: "packages/field-app/src/design-system/ProfilesSettingsPreview.tsx",
    count: 9,
    why: "the Agent Profiles catalog preview's own sample rows (AR-S2/S4; AR-S4d2: the skill moved for Codex, its confirm open; AR-S4e: the plugin pages' two sample agents): fixture data fed to the shipping views, never compared",
  },
  {
    file: "packages/field-app/src/panels/terminal/GodviewMiniature.tsx",
    count: 1,
    why: "Settings → Terminal's miniature (GT-7d): one sample agent pane drawn from a fixed frame — fixture data, never compared",
  },
  {
    file: "apps/ios/VibeFieldKit/Sources/FieldHistory/HistoryCorpus.swift",
    count: 23,
    why: "the History tab's sample corpus (IOS-9b, H-D4): the record's six screens drawn over fixture values until the wire carries the corpus — fixture data, never compared",
  },
];

/** The trees R23b lexes, relative to the repo root (`*` is one directory
 * level; a tree that does not exist is skipped — apps/desktop has no src). */
const R23B_TREES = [
  { glob: "packages/*/src", pattern: /\.tsx?$/ },
  { glob: "plugins/*/src", pattern: /\.tsx?$/ },
  { glob: "examples/plugins/*/src", pattern: /\.tsx?$/ },
  { glob: "apps/*/src", pattern: /\.tsx?$/ },
  { glob: "apps/ios/VibeFieldKit/Sources", pattern: /\.swift$/ },
  { glob: "apps/ios/App", pattern: /\.swift$/ },
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

/** sha256 of a source, LF-normalised — gen-catalog.ts's digest, byte for byte. */
function sourceDigest(path) {
  return createHash("sha256")
    .update(readFileSync(path, "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");
}

/** Read the projection, prove it was generated from the source on disk, and
 * shape-check it. Returns `{ rows, problems, stale }`: `stale` is null or the
 * sentence a maintainer acts on (a `catalog-stale` FAIL). With either, the
 * verdicts are not computed — a table the source no longer says proves
 * nothing, and judging the last generated one would answer the wrong question
 * about the row just edited. */
function loadCatalog(
  path = join(REPO_ROOT, CATALOG_JSON),
  sourcePath = join(REPO_ROOT, CATALOG_SOURCE),
) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      rows: [],
      problems: [
        `${relative(REPO_ROOT, path)} is missing or unparseable (${error.message}) — regenerate it: ${REGENERATE}`,
      ],
      stale: null,
    };
  }
  let stale = null;
  let digest = null;
  try {
    digest = sourceDigest(sourcePath);
  } catch (error) {
    stale = `projection stale — cannot read ${CATALOG_SOURCE} to compare (${error.message})`;
  }
  const recorded = json?.source?.sha256;
  if (digest !== null && recorded !== digest) {
    stale = `projection stale — run ${REGENERATE} (${CATALOG_JSON} ${
      typeof recorded === "string"
        ? `was generated from source ${recorded.slice(0, 12)}…; ${CATALOG_SOURCE} on disk is ${digest.slice(0, 12)}…`
        : "records no source digest"
    })`;
  }
  return { ...validateCatalog(json), stale };
}

// --- verdicts (pure: the catalog × the facts → findings) ----------------------

/** A finding: its level, its verdict class, the thing it is about (a row id, a
 * provider, a kind, a file:line), and the sentence a maintainer acts on. */
function finding(level, cls, subject, message) {
  if (!CLASSES.has(cls)) {
    throw new Error(`check-agent-catalog: finding class \`${cls}\` is not registered in CLASSES`);
  }
  return { level, cls, subject, message };
}
const fail = (cls, subject, message) => finding("FAIL", cls, subject, message);
const warn = (cls, subject, message) => finding("WARN", cls, subject, message);
const spell = (root) => (root === null ? "none" : `\`${root}\``);
const quoted = (names) => names.map((name) => `\`${name}\``).join(", ");

/** The puppeteer half's verdicts. `facts.providers[]` is what the probe read:
 * `{ id, label, ports: {<capability>: bool}, profilesPort, root, rootVia }`. */
function judgePuppeteer(rows, facts) {
  const findings = [];
  const composed = new Map(facts.providers.map((p) => [p.id, p]));
  for (const row of rows) {
    const provider = row.seams.puppeteer?.provider ?? null;
    const claims = PUPPETEER_CAPABILITIES.filter((c) => row.offers[c]);
    if (provider === null) {
      for (const c of claims) {
        findings.push(
          fail(
            "pin-claim",
            row.id,
            `the catalog claims \`${c}\` for \`${row.id}\`; the row has no puppeteer seam`,
          ),
        );
      }
      continue;
    }
    const pin = composed.get(provider);
    if (pin === undefined) {
      // §6: a provider removed upstream keeps its row as a RECORD — declined,
      // or deprecated while its history still indexes — and the seam column
      // stays as the historical fact it is. Only a claim the pin would have to
      // supply makes the absence a failure.
      if (claims.length > 0) {
        findings.push(
          fail(
            "pin-compose",
            row.id,
            `\`${row.id}\`: the pin does not compose \`${provider}\` (seams.puppeteer.provider), yet the row claims ${quoted(claims)} — drop the claims (a removed provider's row stays as a record) or restore the provider`,
          ),
        );
      }
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
    // or a root it names), and only where the pin HAS a root — a provider
    // composed without a profiles port spells none, and rosetta's data_root
    // alone then proves the row's layoutRoot (kind-root).
    if (
      pin.root !== null &&
      (row.seams.rosetta !== null || row.layoutRoot !== null) &&
      row.layoutRoot !== pin.root
    ) {
      findings.push(
        fail(
          "pin-root",
          row.id,
          `\`${row.id}\`: layoutRoot ${spell(row.layoutRoot)} ≠ the pin's native observation root ${spell(pin.root)} — both siblings must spell one root`,
        ),
      );
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

/** The rows' own rosetta claims — a table fact, so it holds with or without a
 * rosettad to ask (also a contracts-test invariant; stated at the gate too). */
function judgeHistorySeams(rows) {
  const findings = [];
  for (const row of rows) {
    if (row.seams.rosetta !== null) continue;
    for (const c of ROSETTA_CAPABILITIES) {
      if (!row.offers[c]) continue;
      findings.push(
        fail(
          "history-seam",
          row.id,
          `the catalog claims \`${c}\` for \`${row.id}\`; the row has no rosetta seam`,
        ),
      );
    }
  }
  return findings;
}

/** The rosetta half's verdicts. `facts` is `{ kinds: Map<kind, dataRoot> }`. */
function judgeRosetta(rows, facts) {
  const findings = [];
  for (const row of rows) {
    const kind = row.seams.rosetta?.kind ?? null;
    if (kind === null) continue;
    const claims = ROSETTA_CAPABILITIES.filter((c) => row.offers[c]);
    if (!facts.kinds.has(kind)) {
      // As on the puppeteer side: a kind rosetta no longer registers is a
      // record on a row that claims nothing of it; a claim makes it a failure.
      if (claims.length > 0) {
        findings.push(
          fail(
            "kind-registered",
            row.id,
            `\`${row.id}\`: rosetta's pin registers no kind \`${kind}\`, yet the row claims ${quoted(claims)} — rosettad would refuse to start on an enrollment naming it`,
          ),
        );
      }
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
    for (const c of ROSETTA_CAPABILITIES) {
      if (!row.offers[c] && OFFERED.has(row.status)) {
        findings.push(
          warn(
            "candidate",
            row.id,
            `candidate: \`${row.id}\` could offer \`${c}\` — rosetta registers kind \`${kind}\``,
          ),
        );
      }
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

/** The last lines of a child's output, each indented two spaces. Embedded in a
 * FAIL message, a child's own `WARN …` line must never reach column 0, where
 * preflight — which lifts every `WARN ` line from both streams — would report
 * it as R23's. */
const tail = (text, lines = 12) =>
  (text ?? "")
    .trim()
    .split("\n")
    .slice(-lines)
    .map((line) => `  ${line}`)
    .join("\n");

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

/** The lock's rosettad: the cargo sibling's own build, where its OWN
 * configuration puts it (siblings.mjs asks cargo without a lane's
 * CARGO_TARGET_DIR). `path` is null when the lock names no cargo sibling or
 * cargo cannot resolve the target directory; `from` says why, or where. */
function lockRosettad(root = REPO_ROOT) {
  const built = rosettadBinary(root);
  if (built === null) return { path: null, from: "siblings.lock.json names no cargo sibling" };
  if (built.path === null) {
    return { path: null, from: `cargo cannot resolve ${built.name}'s target directory` };
  }
  return { path: built.path, from: `${built.name}'s build (pnpm siblings:build)` };
}

/** A file's identity, for "is this the lock's binary": device and inode — a
 * symlink, a hard link and a differently-cased spelling on a case-insensitive
 * volume all name ONE file — else the native realpath where a filesystem
 * reports no inode; null when nothing is there. Node's JS realpathSync keeps
 * the caller's letter case, so it cannot answer this question. */
function fileIdentity(path) {
  try {
    const stat = statSync(path, { bigint: true });
    return stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : `path:${realpathSync.native(path)}`;
  } catch {
    return null;
  }
}

/** Which rosettad this run asks, and what the choice itself finds (pure: the
 * caller supplies the variable, the lock's build and a file identity). Under
 * --require-rosetta the answer is the LOCK's build, always — siblings:pin and
 * CI prove the PIN's registry, never a shell's — and a FIELDD_ROSETTAD_BIN
 * naming any other file is a FAIL naming both. A daily run honours the
 * variable (the dev runner hands fieldd the same one) with a WARN when it is
 * not the lock's build; a variable naming no file is left to the UNVERIFIED
 * warning, which says exactly that. */
function chooseRosettad({ explicit, lock, requireRosetta, identify = fileIdentity }) {
  const named = explicit !== undefined && explicit !== "";
  const id = named ? identify(explicit) : null;
  const lockId = lock.path === null ? null : identify(lock.path);
  if (!named || (id !== null && id === lockId)) {
    return { path: lock.path, from: lock.from, findings: [] };
  }
  const lockSpelled =
    lock.path === null
      ? `none — ${lock.from}`
      : lockId === null
        ? `${lock.path}, not built`
        : lock.path;
  if (requireRosetta) {
    return {
      path: lock.path,
      from: lock.from,
      findings: [
        fail(
          "bin-foreign",
          "rosettad",
          `FIELDD_ROSETTAD_BIN names ${explicit}${id === null ? " (no such file)" : ""}, not the lock's build (${lockSpelled}) — --require-rosetta proves the catalog against the pin's own rosettad only: unset FIELDD_ROSETTAD_BIN (pnpm siblings:build makes the lock's build)`,
        ),
      ],
    };
  }
  return {
    path: explicit,
    from: "FIELDD_ROSETTAD_BIN",
    findings:
      id === null
        ? []
        : [
            warn(
              "bin-foreign",
              "rosettad",
              `FIELDD_ROSETTAD_BIN (${explicit}) is not the lock's build (${lockSpelled}) — this run read THAT binary's registry, which need not be the pin's`,
            ),
          ],
  };
}

/** The pin-time staleness warning (pure): the rosettad asked is older than a
 * source in its checkout, so it may predate the revision just pinned. mtimes
 * are all a binary without a version flag offers, so it stays a WARN — cargo
 * may decline to rebuild for a file it does not compile, and a FAIL no build
 * can clear would be a trap. */
function staleNote({ bin, binMtimeMs, newestSourceMs, sibling }) {
  if (newestSourceMs === null || binMtimeMs >= newestSourceMs) return null;
  return warn(
    "stale",
    "rosettad",
    `rosettad (${bin}) is older than a source in ${sibling} — this run read THAT build's registry; if the pin moved rosetta, run \`pnpm siblings:build\` and re-run`,
  );
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

/** The chosen rosettad's registry, or why there is none. Every return carries
 * `notes`: what the choice found (bin-foreign) and, under --require-rosetta,
 * the staleness warning — findings that must reach the report whether or not
 * the half then runs. */
function readRosettaFacts({
  requireRosetta = false,
  env = process.env,
  lock = lockRosettad(),
} = {}) {
  const bin = chooseRosettad({ explicit: env.FIELDD_ROSETTAD_BIN, lock, requireRosetta });
  const notes = [...bin.findings];
  if (bin.path === null || !existsSync(bin.path)) {
    const why =
      bin.from === "FIELDD_ROSETTAD_BIN"
        ? `FIELDD_ROSETTAD_BIN names no file: ${bin.path}`
        : `rosettad is not built — pnpm siblings:build: ${bin.path ?? bin.from}`;
    return { ok: false, cls: "unverified", message: `rosetta half UNVERIFIED (${why})`, notes };
  }
  if (requireRosetta) {
    const entry = Object.entries(readLock(REPO_ROOT)?.siblings ?? {}).find(([, e]) => e.cargo);
    if (entry !== undefined) {
      const note = staleNote({
        bin: bin.path,
        binMtimeMs: statSync(bin.path).mtimeMs,
        newestSourceMs: newestSourceMtime(siblingDir(REPO_ROOT, entry[1])),
        sibling: entry[0],
      });
      if (note !== null) notes.push(note);
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
        notes,
      };
    }
    try {
      return { ok: true, bin: bin.path, kinds: parseDiscover(run.stdout), notes };
    } catch (error) {
      return { ok: false, cls: "kind-probe", message: `${bin.path}: ${error.message}`, notes };
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
// literal on it). The arrow `=>` is the exception to `>`: an arrow's body never
// starts with a division, so a `/` there is a regex (lexed as the token "=>").
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
 * text's apostrophe, or a quote inside a regex read as division) is no string,
 * and lexing resumes right AFTER it, so a literal later on the line is still
 * seen. A lexer, not a parser — enough to compare tokens exactly. */
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
      let continued = 0; // line continuations inside the string, counted only if it closes
      let closed = false;
      while (j < n) {
        const d = source[j];
        if (d === "\\") {
          if (source[j + 1] === "\n") continued += 1;
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
      prevChar = c;
      prevWord = "";
      if (closed) {
        found.push({ line, value: source.slice(i + 1, j) });
        line += continued;
        i = j + 1;
      } else {
        i += 1; // no string: resume right after the quote
      }
      continue;
    }
    if (c === "`") {
      i += 1;
      readTemplate(true);
      continue;
    }
    if (
      c === "/" &&
      (prevChar === "" ||
        prevChar === "=>" ||
        REGEX_AFTER_CHAR.has(prevChar) ||
        REGEX_AFTER_WORD.has(prevWord))
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
    prevChar = c === ">" && source[i - 1] === "=" ? "=>" : c;
    prevWord = "";
    i += 1;
  }
  return found;
}

/** A Swift multi-line string's value, as Swift reads it: the lines BETWEEN the
 * delimiter lines, each without the closing delimiter's indentation — the
 * delimiters' own line breaks are not part of it, so a body whose one line
 * reads `claude` IS the string "claude". Null for a body Swift would refuse
 * (no line break, or a closing delimiter that is not alone on its line). */
function swiftMultilineValue(body) {
  const lines = body.split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines.length < 2) return null;
  const indent = lines[lines.length - 1];
  if (!/^[ \t]*$/.test(indent)) return null;
  return lines
    .slice(1, -1)
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
    .join("\n");
}

/** Every complete string literal in a Swift source (`"…"`, raw `#"…"#`, and
 * multi-line `"""…"""` with its Swift value), with its line — a multi-line one
 * at its first content line. Comments (nested, as Swift nests them) are
 * skipped. */
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
        const value = swiftMultilineValue(source.slice(j + 3, k));
        if (value !== null) found.push({ line: line + 1, value });
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

/** Every file under `dir` matching `pattern`. A symlinked directory or file is
 * never followed: a Dirent reports a link as neither directory nor file. */
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

/** One tree glob (`*` = one directory level) → the directories that exist
 * under `root`, never reached through a symlink. */
function expandTree(root, glob) {
  let dirs = [root];
  for (const segment of glob.split("/")) {
    const next = [];
    for (const dir of dirs) {
      if (segment === "*") {
        let entries = [];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          entries = [];
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            next.push(join(dir, entry.name));
          }
        }
      } else {
        const candidate = join(dir, segment);
        try {
          if (lstatSync(candidate).isDirectory()) next.push(candidate);
        } catch {
          // absent: this tree has no such directory
        }
      }
    }
    dirs = next;
  }
  return dirs;
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

/** R23b's raw-text pre-filter: a NECESSARY condition, never a verdict. Every
 * literal the lexers can report equal to an id is spelled in the source as the
 * id between two quotes (both lexers take a single-line literal's raw inner
 * text, escapes and all) or, in Swift, as a multi-line string's lone content
 * line (its value is de-indented, so the id stands alone on its line). A file
 * matching neither cannot hold an id literal, and is read but not lexed. */
function quotedIdPattern(ids, swift) {
  const alternatives = [...ids].map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const quoted = `["'\`](?:${alternatives})["'\`]`;
  return new RegExp(swift ? `${quoted}|^[ \\t]*(?:${alternatives})[ \\t]*$` : quoted, "m");
}

/** Scan `root`'s product trees for id literals. Returns the hits outside the
 * allow-list, the count each allow-list entry absorbed, how many files were
 * read and how many of them the pre-filter sent to a lexer. */
function scanLiterals(root, ids, allow, trees = R23B_TREES) {
  const files = new Set();
  for (const tree of trees) {
    for (const dir of expandTree(root, tree.glob)) {
      for (const file of walkFiles(dir, tree.pattern)) files.add(file);
    }
  }
  const allowed = new Map(allow.map((entry) => [entry.file, 0]));
  const hits = [];
  const patterns =
    ids.size === 0 ? null : { ts: quotedIdPattern(ids, false), swift: quotedIdPattern(ids, true) };
  let scanned = 0;
  let lexed = 0;
  for (const abs of [...files].sort()) {
    const rel = relative(root, abs).split(sep).join("/");
    // An ambient `.d.ts` stays in: a literal TYPE naming an agent is the same
    // enumeration a literal value is.
    if (rel === CATALOG_SOURCE || isTestPath(rel)) continue;
    scanned += 1;
    const source = readFileSync(abs, "utf8");
    const swift = rel.endsWith(".swift");
    if (patterns === null || !(swift ? patterns.swift : patterns.ts).test(source)) continue;
    lexed += 1;
    const literals = swift ? swiftStringLiterals(source) : tsStringLiterals(source);
    for (const { line, value } of literals) {
      if (!ids.has(value)) continue;
      if (allowed.has(rel)) allowed.set(rel, allowed.get(rel) + 1);
      else hits.push({ file: rel, line, value });
    }
  }
  return { hits, allowed, scanned, lexed };
}

function judgeLiterals(scan, allow, root) {
  const findings = scan.hits.map((hit) =>
    fail(
      "literal",
      `${hit.file}:${hit.line}`,
      `${hit.file}:${hit.line} "${hit.value}" — an agent id literal in product code; read the catalog (catalogEntry, isOffered, visibleCatalog, …) instead (AR-L1)`,
    ),
  );
  for (const entry of allow) {
    const found = scan.allowed.get(entry.file) ?? 0;
    let problem = null;
    if (!existsSync(join(root, entry.file))) {
      problem = `names a file that does not exist — retire or correct it`;
    } else if (!Number.isInteger(entry.count) || entry.count < 1) {
      problem = `carries count ${entry.count} — an entry states the exact number of literals it allows (at least 1; one allowing none is retired)`;
    } else if (found > entry.count) {
      problem = `allows ${entry.count} agent id literal(s) and the file holds ${found} — a new literal in an allowed file is still a decision: read the catalog instead, or raise the count with its reason`;
    } else if (found < entry.count) {
      problem = `allows ${entry.count} agent id literal(s) and the file holds ${found} — lower the count${found === 0 ? " (to none: retire the entry)" : ""}, so the spare allowance cannot absorb the next literal silently`;
    }
    if (problem !== null) {
      findings.push(fail("allow-count", entry.file, `allow-list entry ${entry.file} ${problem}`));
    }
  }
  return findings;
}

// --- reporting -----------------------------------------------------------------

function emit(findings, wall, out = console) {
  for (const f of findings) {
    if (f.level === "WARN") out.log(`WARN ${wall}: ${f.message}`);
  }
  for (const f of findings) {
    if (f.level === "FAIL") out.error(`FAIL ${wall}: ${f.message}`);
  }
}

function printPuppeteerFacts(facts, out = console) {
  if (!facts.ok) return;
  out.log(
    `R23 puppeteer pin — ${facts.providers.length} provider(s) composed (${FIELDD_DOOR.providers} through fieldd's edge, under tsx):`,
  );
  for (const p of facts.providers) {
    const ports = PUPPETEER_CAPABILITIES.filter((c) => p.ports[c]).join(" ");
    const via =
      p.rootVia === "port"
        ? "  (profiles port declares support false: no native-default profile; root read from the port)"
        : "";
    out.log(`  ${p.id.padEnd(12)} ${ports.padEnd(52)} ${p.root ?? "—"}${via}`);
  }
}

function printRosettaFacts(facts, out = console) {
  if (!facts.ok) return;
  out.log(
    `R23 rosetta pin — ${facts.kinds.size} kind(s) registered (${facts.bin} discover --json):`,
  );
  for (const [kind, dataRoot] of [...facts.kinds].sort(([a], [b]) => a.localeCompare(b))) {
    out.log(`  ${kind.padEnd(12)} ${dataRoot}`);
  }
}

/** The projection's own failures (malformed, stale) as findings. */
function projectionFindings({ problems, stale }) {
  return [
    ...problems.map((p) => fail("catalog-shape", "catalog", `${CATALOG_JSON} is malformed: ${p}`)),
    ...(stale === null ? [] : [fail("catalog-stale", "catalog", stale)]),
  ];
}

/** R23, one run. Every input is a parameter so the self-test drives this very
 * function end to end over a rotten projection and canned facts. */
function runEnforce({
  requireRosetta = false,
  lock,
  root = REPO_ROOT,
  readPuppeteer = readPuppeteerFacts,
  readRosetta = readRosettaFacts,
  out = console,
} = {}) {
  const loaded = loadCatalog(join(root, CATALOG_JSON), join(root, CATALOG_SOURCE));
  const unjudged = projectionFindings(loaded);
  if (unjudged.length > 0) {
    emit(unjudged, "R23", out);
    out.error("check-agent-catalog: FAIL — the projection cannot be judged [--enforce]");
    return 1;
  }
  const { rows } = loaded;
  const puppeteer = readPuppeteer();
  const rosetta = readRosetta({ requireRosetta, ...(lock === undefined ? {} : { lock }) });
  printPuppeteerFacts(puppeteer, out);
  printRosettaFacts(rosetta, out);
  const findings = [
    ...judge(rows, puppeteer, rosetta, { requireRosetta }),
    ...(rosetta.notes ?? []),
  ];
  emit(findings, "R23", out);
  const failures = findings.filter((f) => f.level === "FAIL").length;
  const warnings = findings.length - failures;
  const mode = `--enforce${requireRosetta ? " --require-rosetta" : ""}`;
  if (failures > 0) {
    out.error(
      `check-agent-catalog: FAIL — ${failures} failure(s), ${warnings} warning(s) over ${rows.length} catalog row(s) [${mode}]`,
    );
    return 1;
  }
  const honoured = rosetta.ok
    ? "honoured by both pins"
    : "honoured by the puppeteer pin — the rosetta half UNVERIFIED";
  out.log(
    `check-agent-catalog: pass — ${rows.length} catalog row(s) ${honoured}, ${warnings} warning(s) [${mode}]`,
  );
  return 0;
}

/** R23b, one run — parameterised like runEnforce, for the same reason. */
function runLiterals({ root = REPO_ROOT, allow = R23B_ALLOW, out = console } = {}) {
  const loaded = loadCatalog(join(root, CATALOG_JSON), join(root, CATALOG_SOURCE));
  const unjudged = projectionFindings(loaded);
  if (unjudged.length > 0) {
    emit(unjudged, "R23b", out);
    out.error("check-agent-catalog: FAIL — no ids to lint for [--literals]");
    return 1;
  }
  const ids = literalIds(loaded.rows);
  const scan = scanLiterals(root, ids, allow);
  out.log(
    `R23b — ${scan.scanned} product source(s) read, ${scan.lexed} lexed (the rest quote no id) for ${ids.size} agent id(s) (${R23B_TREES.map((t) => t.glob).join(", ")}):`,
  );
  for (const entry of allow) {
    out.log(
      `  allow-listed  ${entry.file} (${scan.allowed.get(entry.file)} of ${entry.count} literal(s)) — ${entry.why}`,
    );
  }
  const findings = judgeLiterals(scan, allow, root);
  emit(findings, "R23b", out);
  if (findings.length > 0) {
    const counts = findings.filter((f) => f.cls === "allow-count").length;
    out.error(
      `check-agent-catalog: FAIL — ${scan.hits.length} literal(s) outside the catalog and the allow-list, ${counts} allow-list entr(ies) off their count [--literals]`,
    );
    return 1;
  }
  out.log(
    "check-agent-catalog: pass — no agent id literal outside the catalog and the allow-list [--literals]",
  );
  return 0;
}

// --- self-test ------------------------------------------------------------------
// Rotten fixtures through the SAME functions --enforce and --literals use, and
// the two drivers end to end. Every VERDICT class is provoked by the rotten
// catalog (the provoked set is derived from the fixture and compared with
// VERDICT_CLASSES, never counted by hand); the clean counterpart produces
// nothing; the readers (ports, the root, the fold, the discover parser, the
// binary choice, the staleness note, the embedded tail, the capability table,
// the projection's shape and source digest, the lexers, the walk) are each held
// to fixtures. Nothing here touches a sibling or the network.

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

/** The canned puppeteer pin the verdict fixtures and the enforce driver share. */
function fixturePuppeteer() {
  return {
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
      // composed WITHOUT a profiles port: no native root to spell
      pinned("nu", ["spawn"]),
    ],
  };
}

/** The canned rosetta registry: the rotten catalog's, or the clean one's. */
function fixtureRosetta({ clean = false } = {}) {
  return {
    ok: true,
    bin: "fixture",
    notes: [],
    kinds: new Map([
      ["alpha-code", "~/.alpha"],
      ["beta", clean ? "~/.beta" : "~/.beta-data"],
      ["eps", clean ? "~/.eps" : "~/.eps-history"],
      ["zeta", "~/.zeta"],
      ["xi", "~/.xi"],
      ["nu", "~/.nu"],
    ]),
  };
}

function rottenCatalog() {
  return [
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
    // pin-compose: the pin composes no `ghost`, and the row claims spawn
    row("ghost", { offers: { spawn: true } }),
    // pin-root: the row takes rosetta's spelling, the pin spells another;
    // candidate WARN: the pin implements distribution, the row does not claim it
    row("eps", {
      seams: { puppeteer: { provider: "eps" }, rosetta: { kind: "eps" } },
      layoutRoot: "~/.eps-history",
      offers: { spawn: true, resume: true, history: true },
    }),
    // kind-registered: rosetta registers no `omega`, and the row claims history
    row("omega", {
      seams: { puppeteer: null, rosetta: { kind: "omega" } },
      layoutRoot: "~/.omega",
      offers: { history: true },
    }),
    // pin-claim: a puppeteer capability claimed with no puppeteer seam at all
    row("iota", { seams: { puppeteer: null, rosetta: null }, offers: { spawn: true } }),
    // §6 — a provider REMOVED upstream keeps its row as a record:
    //   declined, both counterparts gone, claiming nothing → nothing
    row("lam", {
      status: "declined",
      seams: { puppeteer: { provider: "lam" }, rosetta: { kind: "lam" } },
      layoutRoot: "~/.lam",
      surfaces: { desktop: false, phone: false },
    }),
    //   deprecated, still claiming resume the pin can no longer supply → pin-compose
    row("mu", { status: "deprecated", offers: { resume: true } }),
    //   deprecated, the provider gone, history still indexed by a registered kind → nothing
    row("xi", {
      status: "deprecated",
      seams: { puppeteer: { provider: "xi" }, rosetta: { kind: "xi" } },
      layoutRoot: "~/.xi",
      offers: { history: true },
    }),
    // composed without a profiles port (the pin has no root): rosetta's
    // data_root alone proves the layoutRoot → nothing
    row("nu", {
      seams: { puppeteer: { provider: "nu" }, rosetta: { kind: "nu" } },
      layoutRoot: "~/.nu",
      offers: { spawn: true, history: true },
    }),
    // (no row for `delta` → pin-undecided; none for `zeta` → kind-undecided)
  ];
}

const ROTTEN_EXPECTED = [
  "FAIL pin-claim beta",
  "FAIL kind-root beta",
  "FAIL history-seam gamma",
  "FAIL pin-compose ghost",
  "FAIL pin-root eps",
  "WARN candidate eps",
  "FAIL kind-registered omega",
  "FAIL pin-claim iota",
  "FAIL pin-compose mu",
  "FAIL pin-undecided delta",
  "FAIL kind-undecided zeta",
];

/** The rotten catalog with every rot removed: the same pins find nothing. */
function cleanCatalog() {
  const rotten = new Map(rottenCatalog().map((r) => [r.id, r]));
  const without = (id, capability) => ({
    ...rotten.get(id),
    offers: { ...rotten.get(id).offers, [capability]: false },
  });
  return [
    rotten.get("alpha"),
    without("beta", "reattach"),
    without("gamma", "history"),
    row("delta", {
      status: "declined",
      layoutRoot: null,
      offers: {},
      surfaces: { desktop: false, phone: false },
    }),
    {
      ...rotten.get("eps"),
      layoutRoot: "~/.eps",
      offers: { ...rotten.get("eps").offers, distribution: true },
    },
    row("zeta", {
      seams: { puppeteer: null, rosetta: { kind: "zeta" } },
      layoutRoot: "~/.zeta",
      offers: { history: true },
    }),
    rotten.get("lam"),
    without("mu", "resume"),
    rotten.get("xi"),
    rotten.get("nu"),
  ];
}

function selfTestVerdicts(check) {
  const puppeteer = fixturePuppeteer();
  const rosetta = fixtureRosetta();
  const rotten = rottenCatalog();
  const findings = judge(rotten, puppeteer, rosetta);
  const got = findings.map((f) => `${f.level} ${f.cls} ${f.subject}`);
  check(
    "a rotten catalog produces exactly the expected findings — no more, no fewer",
    JSON.stringify([...got].sort()) === JSON.stringify([...ROTTEN_EXPECTED].sort()),
    `got ${JSON.stringify(got)}`,
  );
  const provoked = new Set(
    ROTTEN_EXPECTED.filter((g) => g.startsWith("FAIL ")).map((g) => g.split(" ")[1]),
  );
  const unprovoked = VERDICT_CLASSES.filter((cls) => !provoked.has(cls));
  check(
    "…and the fixture provokes every VERDICT class (derived from the fixture, compared with the registry)",
    unprovoked.length === 0,
    `no rotten row provokes ${JSON.stringify(unprovoked)}`,
  );
  const cited = findings.find((f) => f.cls === "pin-root")?.message ?? "";
  check(
    "a root mismatch names both spellings",
    cited.includes("`~/.eps-history`") && cited.includes("`~/.eps`"),
    cited,
  );
  const removed = findings.find((f) => f.cls === "pin-compose" && f.subject === "mu")?.message;
  check(
    "a removed provider is red only for what the row still claims, and the message names it",
    (removed ?? "").includes("`resume`") &&
      !findings.some((f) => ["lam", "xi", "nu"].includes(f.subject)),
    `${removed} | ${JSON.stringify(findings.filter((f) => ["lam", "xi", "nu"].includes(f.subject)))}`,
  );

  const clean = cleanCatalog();
  const cleanFindings = judge(clean, puppeteer, fixtureRosetta({ clean: true }));
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
    JSON.stringify(broken.filter((f) => f.level === "FAIL").map((f) => f.cls)) ===
      JSON.stringify(["pin-probe", "kind-probe"]),
    JSON.stringify(broken),
  );
  let unregistered = false;
  try {
    fail("made-up", "x", "a class nobody named");
  } catch {
    unregistered = true;
  }
  check("a finding class not registered in CLASSES cannot be emitted", unregistered, "accepted");
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
    tilde("/h/.agent-one", "/h", "/"),
    tilde("/h", "/h", "/"),
    tilde("/h/.local/share/agent-two", "/h", "/"),
    tilde("/hx/.agent-one", "/h", "/"),
    tilde("C:\\Users\\j\\.agent-three", "C:\\Users\\j", "\\"),
  ];
  check(
    "the fold is fieldd's tilde (a prefix impostor is not home)",
    JSON.stringify(folds) ===
      JSON.stringify([
        "~/.agent-one",
        "~",
        "~/.local/share/agent-two",
        "/hx/.agent-one",
        "~/.agent-three",
      ]),
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

  // The binary choice (AC-7): the pin's registry is the lock's build's.
  const identities = {
    "/lock/rosettad": "1:42",
    "/alias/rosettad": "1:42",
    "/lane/rosettad": "1:7",
  };
  const lock = { path: "/lock/rosettad", from: "rosetta's build (pnpm siblings:build)" };
  const pick = (explicit, requireRosetta) =>
    chooseRosettad({
      explicit,
      lock,
      requireRosetta,
      identify: (p) => identities[p] ?? null,
    });
  const brief = (choice) =>
    `${choice.path}|${choice.findings.map((f) => `${f.level} ${f.cls}`).join(",")}`;
  const choices = [
    brief(pick(undefined, false)),
    brief(pick("", true)),
    brief(pick("/alias/rosettad", true)),
    brief(pick("/lane/rosettad", true)),
    brief(pick("/gone/rosettad", true)),
    brief(pick("/lane/rosettad", false)),
    brief(pick("/gone/rosettad", false)),
  ];
  const foreign = pick("/lane/rosettad", true).findings[0]?.message ?? "";
  check(
    "the binary choice: --require-rosetta asks the lock's build only (a foreign FIELDD_ROSETTAD_BIN is a FAIL naming both); a daily run honours it with a WARN",
    JSON.stringify(choices) ===
      JSON.stringify([
        "/lock/rosettad|",
        "/lock/rosettad|",
        "/lock/rosettad|",
        "/lock/rosettad|FAIL bin-foreign",
        "/lock/rosettad|FAIL bin-foreign",
        "/lane/rosettad|WARN bin-foreign",
        "/gone/rosettad|",
      ]) &&
      foreign.includes("/lane/rosettad") &&
      foreign.includes("/lock/rosettad"),
    `${JSON.stringify(choices)} | ${foreign}`,
  );

  const scratch = mkdtempSync(join(tmpdir(), "vf-catalog-identity-"));
  try {
    const one = join(scratch, "rosettad");
    const other = join(scratch, "other");
    writeFileSync(one, "a binary\n");
    writeFileSync(other, "a binary\n");
    linkSync(one, join(scratch, "hard-link"));
    const ids = [one, join(scratch, "hard-link"), other, join(scratch, "absent")].map(fileIdentity);
    check(
      "the file identity: two spellings of one file are one binary, a copy is another, an absent one is none",
      ids[0] !== null && ids[0] === ids[1] && ids[2] !== ids[0] && ids[3] === null,
      JSON.stringify(ids),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const stale = [
    staleNote({ bin: "/b", binMtimeMs: 1, newestSourceMs: 2, sibling: "s" }),
    staleNote({ bin: "/b", binMtimeMs: 2, newestSourceMs: 2, sibling: "s" }),
    staleNote({ bin: "/b", binMtimeMs: 2, newestSourceMs: null, sibling: "s" }),
  ];
  check(
    "the staleness note: a build older than a source in its checkout WARNs; a fresh one, or no sources, says nothing",
    stale[0]?.level === "WARN" &&
      stale[0]?.cls === "stale" &&
      stale[1] === null &&
      stale[2] === null,
    JSON.stringify(stale),
  );

  const embedded = `FAIL R23: ${
    fail("kind-probe", "rosettad", `rosettad exited 1\n${tail("WARN the daemon's own line\nboom")}`)
      .message
  }`.split("\n");
  check(
    "a child's output embedded in a FAIL message is indented, so preflight never lifts its WARN lines as R23's",
    embedded.length === 3 &&
      embedded.slice(1).every((l) => l.startsWith("  ")) &&
      !embedded.some((l) => l.startsWith("WARN ")),
    JSON.stringify(embedded),
  );

  check(
    "the capability table: every capability owned by exactly one sibling (and a broken table is named three ways)",
    capabilityOwnershipProblems(CAPABILITIES, PORT_FOR, ROSETTA_CAPABILITIES).length === 0 &&
      capabilityOwnershipProblems([...CAPABILITIES, "sandbox"], PORT_FOR, ROSETTA_CAPABILITIES)
        .length === 1 &&
      capabilityOwnershipProblems(CAPABILITIES, { ...PORT_FOR, history: "x" }, ROSETTA_CAPABILITIES)
        .length === 1 &&
      capabilityOwnershipProblems(
        CAPABILITIES,
        { ...PORT_FOR, teleport: "x" },
        ROSETTA_CAPABILITIES,
      ).length === 1,
    "the ownership check disagrees with its fixtures",
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
      '<p>Don\'t</p> <Mark agent="alpha" />',
      '(s) => /["\']/.test(s) || s === "alpha"',
      "const k = (s) => /'/.test(s); const m = 'beta';",
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
    "9:alpha",
    "10:alpha",
    "11:beta",
  ];
  check(
    "the TS lexer: literals kept; comments, templates with substitutions, regexes (after `=>` too) and unclosed quotes (JSX apostrophes) handled without losing the rest of the line",
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
      '  let n = """',
      "    beta",
      '    """',
      '  let o = #"""',
      '  a "gamma" line',
      '  """#',
    ].join("\n"),
  ).map((l) => `${l.line}:${l.value}`);
  check(
    "the Swift lexer: nested comments, raw strings, escapes, multi-line strings lexed to their Swift value",
    JSON.stringify(swiftFound) ===
      JSON.stringify([
        "1:alpha",
        "2:gamma",
        '3:a\\"q',
        "5:alpha",
        "6:delta",
        "8:beta",
        '11:a "gamma" line',
      ]),
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
      "packages/demo/src/grew.ts": 'export const MARKS = ["alpha", "gamma"];\n',
      "packages/demo/src/used-to-hold-one.ts": "export const nothing = 0;\n",
      "apps/ios/VibeFieldKit/Sources/Demo/Roster.swift":
        'switch id { case "beta-kind": break } // "alpha"\n',
      "apps/ios/App/Main.swift": 'let first = "gamma"\n',
      "apps/ios/App/Multi.swift": 'let m = """\n    gamma\n    """\n',
      "apps/demo/src/cli.ts": 'export const d = "alpha";\n',
      "plugins/demo/src/elsewhere.ts": 'export const r = "alpha";\n',
      "plugins/demo/test/elsewhere.ts": 'export const r = "alpha";\n',
      "examples/plugins/demo/src/sample.tsx": 'export const S = () => <Mark agent="gamma" />;\n',
      "tooling/demo/src/out-of-scope.ts": 'export const r = "alpha";\n',
      "elsewhere/linked.ts": 'export const r = "alpha";\n',
    };
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(tmp, file)), { recursive: true });
      writeFileSync(join(tmp, file), body);
    }
    // A symlinked directory inside a product tree must never be walked (a
    // committed symlink once walked another checkout). A junction on win32,
    // which needs no privilege; the type is ignored elsewhere.
    let linked = true;
    try {
      symlinkSync(
        join(tmp, "elsewhere"),
        join(tmp, "packages", "demo", "src", "linked"),
        "junction",
      );
    } catch {
      linked = false;
    }
    const allow = [
      { file: "packages/demo/src/presentation.ts", count: 1, why: "fixture" },
      { file: "packages/demo/src/grew.ts", count: 1, why: "fixture" },
      { file: "packages/demo/src/used-to-hold-one.ts", count: 1, why: "fixture" },
      { file: "packages/demo/src/gone.ts", count: 1, why: "fixture" },
    ];
    const ids = literalIds([
      row("alpha", { seams: { puppeteer: { provider: "alpha" }, rosetta: { kind: "beta-kind" } } }),
      row("gamma"),
    ]);
    const scan = scanLiterals(tmp, ids, allow);
    const findings = judgeLiterals(scan, allow, tmp).map((f) => `${f.cls} ${f.subject}`);
    const expected = [
      "literal packages/demo/src/branch.ts:1",
      "literal packages/demo/src/kind.tsx:1",
      "literal packages/demo/src/deep/fixtures/row.ts:1",
      "literal apps/ios/VibeFieldKit/Sources/Demo/Roster.swift:1",
      "literal apps/ios/App/Main.swift:1",
      "literal apps/ios/App/Multi.swift:2",
      "literal apps/demo/src/cli.ts:1",
      "literal plugins/demo/src/elsewhere.ts:1",
      "literal examples/plugins/demo/src/sample.tsx:1",
      "allow-count packages/demo/src/grew.ts",
      "allow-count packages/demo/src/used-to-hold-one.ts",
      "allow-count packages/demo/src/gone.ts",
    ];
    check(
      "the lint: every product tree in scope; comments, tests, other trees, symlinks and the catalog out; each allow-list entry held to its exact count; the pre-filter skips only files quoting no id",
      linked &&
        JSON.stringify([...findings].sort()) === JSON.stringify([...expected].sort()) &&
        scan.allowed.get("packages/demo/src/presentation.ts") === 1 &&
        scan.allowed.get("packages/demo/src/grew.ts") === 2 &&
        scan.lexed < scan.scanned,
      `${linked ? "" : "(could not create the symlink) "}${JSON.stringify(findings)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Both drivers end to end, over a scratch root holding a catalog source and a
 * projection generated "from" it: what the exit code says is what the self-test
 * asserts, so a driver that ignored its own findings cannot pass. */
function selfTestDrivers(check) {
  const tmp = mkdtempSync(join(tmpdir(), "vf-catalog-drivers-"));
  const capture = () => {
    const lines = [];
    const push = (text) => lines.push(...String(text).split("\n"));
    return { lines, out: { log: push, error: push } };
  };
  try {
    const source = join(tmp, CATALOG_SOURCE);
    const projection = join(tmp, CATALOG_JSON);
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(dirname(projection), { recursive: true });
    writeFileSync(source, "export const AGENT_CATALOG = [] as const; // the self-test's source\n");
    const digest = sourceDigest(source);
    const project = (catalog, sha256 = digest) =>
      writeFileSync(
        projection,
        `${JSON.stringify({ source: { file: "src/agent-catalog.ts", sha256 }, catalog }, null, 2)}\n`,
      );
    const enforce = (clean) => {
      const { lines, out } = capture();
      const status = runEnforce({
        root: tmp,
        readPuppeteer: fixturePuppeteer,
        readRosetta: () => fixtureRosetta({ clean }),
        out,
      });
      return { status, lines };
    };

    project(rottenCatalog());
    const rotten = enforce(false);
    check(
      "the enforce driver: a rotten projection over canned pins exits 1 and says why",
      rotten.status === 1 &&
        rotten.lines.some((l) => l.startsWith("FAIL R23: `ghost`")) &&
        rotten.lines.some((l) => l.startsWith("check-agent-catalog: FAIL")),
      `exit ${rotten.status}: ${JSON.stringify(rotten.lines.slice(-3))}`,
    );
    project(cleanCatalog());
    const clean = enforce(true);
    check(
      "…and a clean projection over the same pins exits 0",
      clean.status === 0 && clean.lines.some((l) => l.startsWith("check-agent-catalog: pass")),
      `exit ${clean.status}: ${JSON.stringify(clean.lines.slice(-3))}`,
    );
    project(cleanCatalog(), "0".repeat(64));
    const stale = enforce(true);
    writeFileSync(projection, `${JSON.stringify({ catalog: cleanCatalog() })}\n`);
    const unsourced = enforce(true);
    check(
      "…and a projection generated from another source (or recording none) exits 1 unjudged: projection stale",
      [stale, unsourced].every(
        (run) =>
          run.status === 1 &&
          run.lines.some((l) => l.includes(`projection stale — run ${REGENERATE}`)) &&
          !run.lines.some((l) => l.startsWith("R23 puppeteer pin")),
      ),
      `exit ${stale.status}/${unsourced.status}: ${JSON.stringify([...stale.lines, ...unsourced.lines])}`,
    );

    project(cleanCatalog());
    const hit = join(tmp, "packages", "demo", "src", "hit.ts");
    mkdirSync(dirname(hit), { recursive: true });
    writeFileSync(hit, 'export const on = (id: string) => id === "alpha";\n');
    const literals = () => {
      const { lines, out } = capture();
      return { status: runLiterals({ root: tmp, allow: [], out }), lines };
    };
    const red = literals();
    rmSync(hit);
    const green = literals();
    check(
      "the literals driver: an id literal exits 1 naming its file:line; without it, exit 0",
      red.status === 1 &&
        red.lines.some((l) => l.includes("packages/demo/src/hit.ts:1")) &&
        green.status === 0,
      `exit ${red.status}/${green.status}: ${JSON.stringify([...red.lines, ...green.lines])}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Every fixture. Verbose prints each check (--self-test); otherwise only a
 * failure's lines and one summary line — the form every mode runs first. */
async function runSelfTest({ verbose = true } = {}) {
  let passed = 0;
  let failed = 0;
  const check = (name, ok, detail) => {
    if (ok) passed += 1;
    else failed += 1;
    if (verbose || !ok) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) console.log(`        ${detail}`);
  };
  selfTestVerdicts(check);
  await selfTestReaders(check);
  selfTestLiterals(check);
  selfTestDrivers(check);
  if (verbose)
    console.log(failed === 0 ? "\nself-test: all passed" : "\nself-test: FAILURES present");
  else if (failed === 0) console.log(`R23 self-test: ${passed} check(s) passed`);
  else console.log(`R23 self-test: ${failed} of ${passed + failed} check(s) FAILED`);
  return failed === 0;
}

// --- entry ---------------------------------------------------------------------

const USAGE = [
  "usage: node scripts/check-agent-catalog.mjs [--self-test] [--enforce [--require-rosetta]] [--literals]",
  "       node scripts/check-agent-catalog.mjs --help",
  "  --enforce          prove every catalog row against the pinned puppeteer and rosetta (R23)",
  "  --require-rosetta  implies --enforce: only the lock's rosettad may answer, and a missing one FAILs (siblings:pin, CI — AC-D10)",
  "  --rosettad <path>  with --enforce: the lock's rosettad as the caller resolved it (no second cargo metadata)",
  "  --literals         no agent id literal in the product trees outside the allow-list (R23b)",
  "  --self-test        print the checker's own fixtures (every mode runs them first)",
  "  --help             this text, alone",
].join("\n");

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--probe-puppeteer") {
    // the tsx child (readPuppeteerFacts): never invoked by hand
    await probePuppeteer(argv[1]);
    process.exit(0);
  }
  // `--rosettad <path>` (or `--rosettad=<path>`) is the one option with a value:
  // the lock's rosettad as the caller already resolved it (preflight and
  // siblings:pin hold it), so --enforce does not ask cargo a second time.
  // FIELDD_ROSETTAD_BIN keeps its meaning beside it, and under
  // --require-rosetta it must still BE this build.
  const args = [];
  let rosettad;
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k];
    if (arg === "--rosettad" || arg.startsWith("--rosettad=")) {
      const value = arg === "--rosettad" ? argv[k + 1] : arg.slice("--rosettad=".length);
      if (arg === "--rosettad") k += 1;
      if (value === undefined || value === "" || value.startsWith("--")) {
        console.error("check-agent-catalog: --rosettad takes a path (see --help)");
        process.exit(2);
      }
      rosettad = value;
      continue;
    }
    args.push(arg);
  }
  const has = (flag) => args.includes(flag);
  // An argument this script does not know is refused, never ignored: a caller's
  // typo (`--enforc`) would otherwise select no mode and exit 0 — a gate that
  // passes without having run. `--help` beside a mode is the same trap.
  const known = new Set(["--enforce", "--require-rosetta", "--literals", "--self-test", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`check-agent-catalog: unknown argument(s): ${unknown.join(" ")} (see --help)`);
    process.exit(2);
  }
  if (has("--help")) {
    if (argv.length > 1) {
      console.error(
        "check-agent-catalog: --help runs alone — beside a mode it would exit 0 without having run it",
      );
      process.exit(2);
    }
    console.log(USAGE);
    process.exit(0);
  }
  if (args.length === 0) {
    console.log(USAGE);
    process.exit(2);
  }
  const enforce = has("--enforce") || has("--require-rosetta");
  const literals = has("--literals");
  if (rosettad !== undefined && !enforce) {
    console.error(
      "check-agent-catalog: --rosettad names the lock's rosettad for --enforce — without it, it selects nothing",
    );
    process.exit(2);
  }
  // The walls' lesson (preflight.mjs, 2026-07-23): a broken checker's green is
  // no green. The self-test runs FIRST, in this process, whatever the mode, so
  // no caller (preflight, siblings:pin, catalog:check, a hand) reaches a
  // verdict through a checker whose own fixtures are red.
  const selfTestOk = await runSelfTest({ verbose: has("--self-test") });
  if (!selfTestOk) {
    if (enforce || literals) {
      console.error(
        "check-agent-catalog: FAIL — the checker's own self-test is red (above); R23/R23b not run",
      );
    }
    process.exit(1);
  }
  let status = 0;
  if (enforce) {
    const lock =
      rosettad === undefined
        ? undefined
        : { path: rosettad, from: "the lock's build, as the caller resolved it (--rosettad)" };
    status = Math.max(status, runEnforce({ requireRosetta: has("--require-rosetta"), lock }));
  }
  if (literals) status = Math.max(status, runLiterals());
  process.exit(status);
}
