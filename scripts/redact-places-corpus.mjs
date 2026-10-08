#!/usr/bin/env node
// PJ-1 (build-pj.md L8) — the project-places corpus, REDACTED into fieldd's
// golden fixture. The corpus (draft/project-places/test/real-mbp.json: one
// Mac's places as its index saw them; synthetic.json: two made-up desktops,
// the review's traps and the truth labels) names a person's handle, other
// people's organizations, repositories, folders, branches, commit SHAs and a
// scratchpad's encoded home path, and this repository is public. So every
// such string becomes a RANDOM token, drawn fresh on every run and kept
// consistent within it, and no mapping is stored: the fixture cannot be
// dictionary-reversed, and rerunning the script changes every token.
//
// What survives is exactly what the grouping engine reads — EQUALITY
// structure: two paths, owners or SHAs are equal after redaction iff they were
// before; two spellings that differ only in case still differ only in case;
// a folder and a repository that are "the same word" (`vibe-field`,
// `vibefield`: equal once lowercased and stripped of punctuation) still are;
// the engine's own path vocabulary (`~`, `/`, drive roots, the system temp
// roots, the agent catalog's task root `~/Documents/Codex/*/*`) is kept as
// written. Session counts and times are kept (they order places and pick a
// name). Dropped: names rosetta stored, its sanitized remotes, short heads,
// agent tallies, `alsoPaths`, any session title. A path under a temp root is
// CUT: what lies between the root and the folder's own name becomes one token
// (a scratchpad's encoded home path and session id with it).
//
// The witness (packages/fieldd/test/project-grouping-witness.test.ts) runs on
// this fixture; the faithfulness of the redaction is shown by running the same
// witness on the unredacted corpus OUTSIDE the repo (`--plain <file>` writes
// the assembled corpus there, unredacted, and nothing else) and comparing.
//
//   node scripts/redact-places-corpus.mjs [<corpus dir>] [--plain <out.json>]
//
// <corpus dir> defaults to draft/project-places/test (the owner's checkout,
// where `draft/` lives); the output is
// packages/fieldd/test/fixtures/projects/places-corpus.json, formatted by
// biome. Before writing, the script checks every path segment, owner,
// repository, branch, host and SHA in its output against the tokens it minted
// and the vocabulary it keeps, and refuses to write anything else.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages/fieldd/test/fixtures/projects/places-corpus.json");

const args = process.argv.slice(2);
const plainAt = args.indexOf("--plain");
const plainOut = plainAt === -1 ? null : args[plainAt + 1];
const positional =
  plainAt === -1 ? args : args.filter((_, i) => i !== plainAt && i !== plainAt + 1);
const corpusDir = resolve(positional[0] ?? join(ROOT, "draft/project-places/test"));

const real = JSON.parse(readFileSync(join(corpusDir, "real-mbp.json"), "utf8"));
const syn = JSON.parse(readFileSync(join(corpusDir, "synthetic.json"), "utf8"));

// ── the corpus, assembled as the witness reads it ───────────────────────────

const idOf = (p) => `${p.device}:${p.path}`;
const truth = syn.truth;
const byId = new Map([...real, ...syn.places].map((p) => [idOf(p), p]));

// The witness's roles, found by STRUCTURE so this file names no folder: the
// main checkout is the busiest Mac place of the product's own truth group; the
// clone whose deletion must not re-key it is the first other Mac member in
// corpus order; the person's one link is the only judgment spanning desktops.
const productLabel = "vibefield";
const macMembers = truth[productLabel].filter((id) => id.startsWith("mbp:") && byId.has(id));
const project = [...macMembers].sort(
  (a, b) => (byId.get(b).sessions || 0) - (byId.get(a).sessions || 0),
)[0];
const order = new Map([...real, ...syn.places].map((p, i) => [idOf(p), i]));
const clone = macMembers
  .filter((id) => id !== project)
  .sort((a, b) => order.get(a) - order.get(b))[0];
const spanning = Object.entries(truth).filter(
  ([label, ids]) =>
    label.startsWith("?") &&
    Array.isArray(ids) &&
    new Set(ids.map((id) => id.slice(0, id.indexOf(":")))).size > 1,
);
if (spanning.length !== 1)
  throw new Error(`expected one cross-desktop judgment, got ${spanning.length}`);
const link = spanning[0][1];

const KEPT_PLACE = [
  "device",
  "path",
  "exists",
  "mounted",
  "sessions",
  "firstAt",
  "lastAt",
  "acted",
];
const KEPT_FLAGS = ["adversarial", "synthetic"];
const KEPT_GIT = [
  "remotes",
  "push",
  "roots",
  "branch",
  "shallow",
  "emptyRoot",
  "contains",
  "aliases",
];
const DROPPED = new Set([
  "name",
  "alsoPaths",
  "rosettaGitRepo",
  "agents",
  "recent",
  "head",
  "title",
]);

function pick(object, keys, where) {
  for (const key of Object.keys(object)) {
    if (!keys.includes(key) && !DROPPED.has(key)) {
      throw new Error(
        `${where}: unknown field ${key} — decide whether it is personal, then list it`,
      );
    }
  }
  return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
}

function assemble(place) {
  const out = pick(place, [...KEPT_PLACE, ...KEPT_FLAGS, "git"], idOf(place));
  delete out.git;
  if (place.git) out.git = pick(place.git, KEPT_GIT, `${idOf(place)} git`);
  else out.git = null;
  return out;
}

const corpus = {
  devices: syn.devices.map((d) => ({
    id: d.id,
    label: d.label,
    home: d.home,
    os: d.os,
    ...(d.caseless ? { caseless: true } : {}),
  })),
  taskRoots: syn.taskRoots,
  mac: real.map(assemble),
  synthetic: syn.places.map(assemble),
  truth,
  trapLabels: [productLabel, "c11-tool"],
  roles: { project, clone, link },
};

if (plainOut) {
  writeFileSync(resolve(plainOut), `${JSON.stringify(corpus, null, 1)}\n`);
  console.log(`wrote the UNREDACTED corpus to ${resolve(plainOut)} (keep it out of the repo)`);
  process.exit(0);
}

// ── the redaction ─────────────────────────────────────────────────────────

/** The engine's own path vocabulary, and words that name no one. */
const KEEP = new Set([
  "",
  "~",
  ".",
  "..",
  "…",
  "tmp",
  "private",
  "var",
  "folders",
  "T",
  "AppData",
  "Local",
  "Temp",
  "Documents",
  "Codex",
  "Users",
  "users",
]);
const KEEP_BRANCHES = new Set(["main", "master"]);
/** Hosts are kept, so each must be a public forge, an example name or an
 * alias that names no one; anything else stops the script. */
const HOSTS = new Set(["github.com", "github-work", "ghe.corp.example"]);
const LABELS_KEPT = new Set(["home", "scratch"]);

const minted = new Set();
function word(length) {
  for (;;) {
    let out = "";
    for (const byte of randomBytes(length)) out += String.fromCharCode(97 + (byte % 26));
    if (!minted.has(out) && !KEEP.has(out)) {
      minted.add(out);
      return out;
    }
  }
}
const length = () => 6 + (randomBytes(1)[0] % 6);

/** A segment's token: one random word per "same word" class (lowercased,
 * punctuation stripped), a separator dropped in at random for each distinct
 * lowercase spelling, and a random case pattern for each distinct raw one —
 * so equality, case-insensitive equality and same-word equality all survive,
 * and length, punctuation and case do not. */
const classes = new Map();
function segment(raw) {
  if (KEEP.has(raw) || /^[A-Za-z]:$/.test(raw)) return raw;
  if (/[^\x20-\x7e]/.test(raw))
    throw new Error("a segment outside printable ASCII: decide its token rule");
  const lower = raw.toLowerCase();
  const same = lower.replace(/[^a-z0-9]/g, "");
  if (same === "") return raw.replace(/[A-Za-z0-9]/g, "");
  let cls = classes.get(same);
  if (cls === undefined) {
    cls = { base: word(length()), spellings: new Map() };
    classes.set(same, cls);
  }
  let spelling = cls.spellings.get(lower);
  if (spelling === undefined) {
    const taken = new Set([...cls.spellings.values()].map((s) => s.lower));
    let lowered = cls.base;
    while (taken.has(lowered)) {
      const at = 1 + (randomBytes(1)[0] % (cls.base.length - 1));
      const mark = randomBytes(1)[0] % 2 === 0 ? "-" : "_";
      lowered = `${cls.base.slice(0, at)}${mark}${cls.base.slice(at)}`;
    }
    spelling = { lower: lowered, cases: new Map() };
    cls.spellings.set(lower, spelling);
    minted.add(lowered);
  }
  let token = spelling.cases.get(raw);
  if (token === undefined) {
    const taken = new Set(spelling.cases.values());
    token = spelling.lower;
    while (taken.has(token)) {
      token = [...spelling.lower]
        .map((ch) => (randomBytes(1)[0] % 2 === 0 ? ch.toUpperCase() : ch))
        .join("");
    }
    spelling.cases.set(raw, token);
    minted.add(token);
  }
  return token;
}

/** How many leading segments of a `/`-split path are a system temp root. */
function tempRoot(parts) {
  if (parts[0] !== "") {
    const at = parts.findIndex(
      (p, i) => p === "AppData" && parts[i + 1] === "Local" && parts[i + 2] === "Temp",
    );
    return at === -1 ? 0 : at + 3;
  }
  if (parts[1] === "tmp") return 2;
  if (parts[1] === "private" && parts[2] === "tmp") return 3;
  const v = parts[1] === "private" ? 2 : 1;
  if (parts[v] === "var" && parts[v + 1] === "folders") {
    const t = parts.indexOf("T", v + 2);
    return t !== -1 && t <= v + 4 ? t + 1 : v + 2;
  }
  return 0;
}

const MAC_HOME = /^\/Users\/[^/]+(?=\/|$)/;
function path(raw) {
  const windows = raw.includes("\\");
  const text = windows ? raw : raw.replace(MAC_HOME, "~");
  const parts = text.split(windows ? "\\" : "/");
  const root = tempRoot(parts);
  if (root > 0 && parts.length - root >= 2) {
    const middle = parts.slice(root, -1).join("/");
    return [...parts.slice(0, root), segment(middle), segment(parts.at(-1))].join(
      windows ? "\\" : "/",
    );
  }
  return parts.map(segment).join(windows ? "\\" : "/");
}

const id = (raw) => {
  const at = raw.indexOf(":");
  return `${raw.slice(0, at)}:${path(raw.slice(at + 1))}`;
};

const URL_REMOTE = /^([a-z][a-z0-9+.-]*:\/\/)([^@/]*@)?([^/:]+)(:\d+)?\/(.*)$/i;
const SCP_REMOTE = /^([^@/:]+@)?([^/:]+):(.*)$/;
const LOCAL_REMOTE = /^(file:|[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/|~)/i;

/** `head` (scheme and user), `host`, `lead` (port and separator), the path's
 * `segments` and its `suffix` (`.git`, a trailing slash). */
function parseRemote(raw) {
  const url = URL_REMOTE.exec(raw);
  const scp = url === null ? SCP_REMOTE.exec(raw) : null;
  let parts;
  if (url !== null) {
    if (url[2]?.includes(":")) throw new Error("a remote carries a secret in its userinfo");
    parts = {
      head: `${url[1]}${url[2] ?? ""}`,
      host: url[3],
      lead: `${url[4] ?? ""}/`,
      body: url[5],
    };
  } else if (scp !== null) {
    parts = { head: scp[1] ?? "", host: scp[2], lead: ":", body: scp[3] };
  } else {
    throw new Error("a remote of no known shape");
  }
  if (/[?#%]/.test(parts.body)) throw new Error("a remote with a query, fragment or escape");
  const suffix = parts.body.match(/(\.git)?\/?$/)[0];
  const segments = parts.body.slice(0, parts.body.length - suffix.length).split("/");
  return { head: parts.head, host: parts.host, lead: parts.lead, segments, suffix };
}

function remote(raw) {
  if (LOCAL_REMOTE.test(raw)) return path(raw);
  const r = parseRemote(raw);
  if (!HOSTS.has(r.host.toLowerCase()))
    throw new Error(`a host not on the kept list (${r.host.length} chars)`);
  return `${r.head}${r.host}${r.lead}${r.segments.map(segment).join("/")}${r.suffix}`;
}

const shas = new Map();
function sha(raw) {
  let token = shas.get(raw);
  if (token === undefined) {
    token = `commit-${word(10)}`;
    shas.set(raw, token);
  }
  return token;
}

const branch = (raw) => (KEEP_BRANCHES.has(raw) ? raw : raw.split("/").map(segment).join("/"));

const labels = new Map();
function label(raw) {
  if (LABELS_KEPT.has(raw)) return raw;
  const open = raw.startsWith("?");
  const bare = open ? raw.slice(1) : raw;
  let token = labels.get(bare);
  if (token === undefined) {
    token = word(length());
    labels.set(bare, token);
  }
  return open ? `?${token}` : token;
}

function redactPlace(p) {
  const out = { ...p, path: path(p.path) };
  if (p.git) {
    const g = { ...p.git };
    if (g.remotes) {
      g.remotes = Object.fromEntries(Object.entries(g.remotes).map(([n, u]) => [n, remote(u)]));
    }
    if (g.roots) g.roots = g.roots.map(sha);
    if (g.branch) g.branch = branch(g.branch);
    if (g.contains) g.contains = g.contains.map((c) => ({ place: id(c.place), depth: c.depth }));
    out.git = g;
  }
  return out;
}

const redacted = {
  "//": [
    "PJ-1 — GENERATED by scripts/redact-places-corpus.mjs from the project-places corpus (thinking-project-places.md §4.4): one real Mac's 161 places (`mac`) and two synthetic desktops' 31 (`synthetic`, the review's traps C8a, C8b, C10, C11, C13, C15, C19 marked `adversarial`).",
    "Every owner, repository, folder, branch and commit SHA is a RANDOM token drawn for this run alone; no mapping exists. Equality survives, and nothing else: rerunning the script changes every token and must leave every witness count unchanged.",
    "`truth`: the corpus's labels for which places are one project; `?`-labelled sets are judgment calls (J1–J11 on the Files & History Docket) left OUT of every score until the person rules on them. `trapLabels` and `roles` name what the witness scores and which places its invariants touch.",
  ],
  devices: corpus.devices.map((d) => ({ ...d, home: path(d.home) })),
  taskRoots: corpus.taskRoots,
  mac: corpus.mac.map(redactPlace),
  synthetic: corpus.synthetic.map(redactPlace),
  truth: Object.fromEntries(
    Object.entries(corpus.truth).map(([l, ids]) => [
      label(l),
      Array.isArray(ids) ? ids.map(id) : ids,
    ]),
  ),
  trapLabels: corpus.trapLabels.map(label),
  roles: { project: id(project), clone: id(clone), link: link.map(id) },
};

// ── the self-check: every component is minted or kept, or nothing is written ─

const problems = [];
const known = (s) => minted.has(s) || KEEP.has(s) || /^[A-Za-z]:$/.test(s);
function checkPath(p, where) {
  for (const part of p.split(/[\\/]/)) {
    if (!known(part) && !/^[^A-Za-z0-9]*$/.test(part))
      problems.push(`${where}: ${part.length}-char segment`);
  }
}
for (const d of redacted.devices) checkPath(d.home, `device ${d.id}`);
for (const p of [...redacted.mac, ...redacted.synthetic]) {
  checkPath(p.path, "path");
  for (const c of p.git?.contains ?? [])
    checkPath(c.place.slice(c.place.indexOf(":") + 1), "contains");
  for (const r of p.git?.roots ?? []) if (!/^commit-[a-z]{10}$/.test(r)) problems.push("a root");
  if (p.git?.branch && !KEEP_BRANCHES.has(p.git.branch)) {
    for (const part of p.git.branch.split("/")) if (!known(part)) problems.push("a branch");
  }
  for (const u of Object.values(p.git?.remotes ?? {})) {
    if (LOCAL_REMOTE.test(u)) {
      checkPath(u, "local remote");
      continue;
    }
    const r = parseRemote(u);
    if (!HOSTS.has(r.host.toLowerCase())) problems.push("a remote host");
    for (const s of r.segments) if (!known(s)) problems.push("a remote segment");
  }
}
for (const ids of Object.values(redacted.truth)) {
  if (Array.isArray(ids)) for (const i of ids) checkPath(i.slice(i.indexOf(":") + 1), "truth");
}
const text = JSON.stringify(redacted);
if (/[0-9a-f]{40}/.test(text)) problems.push("a 40-hex string");
if (/\/Users\/|-Users-/.test(text)) problems.push("a /Users/ path");
if (problems.length > 0) {
  console.error(`refusing to write: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(redacted, null, 2)}\n`);
execFileSync("pnpm", ["exec", "biome", "format", "--write", OUT], { cwd: ROOT, stdio: "inherit" });
console.log(
  `wrote ${redacted.mac.length} + ${redacted.synthetic.length} places to ${OUT.slice(ROOT.length + 1)} (${minted.size} tokens this run, none kept)`,
);
