// PJ-1 — the project-places corpus as the engine reads it, and the witness
// over it (thinking-project-places.md §4.4; build-pj.md L8). The corpus keeps
// the prototype's shape (draft/project-places/test: a place with its device,
// path, raw remotes, roots and `contains`), so this adapter plays the OWNER:
// it derives each place's facts the way a desktop does (the normalizer, the
// identity remote, the owner's kind) and turns `contains` — "this place holds
// that place's commit from `depth` before its tip" — into samples and hits.
// Both the redacted fixture and the unredacted corpus go through it, so equal
// witnesses mean a faithful redaction.
import { createHash } from "node:crypto";
import { PlaceFacts, type PlaceSample } from "@vibefield/contracts";
import {
  type GroupingInput,
  type GroupingIntents,
  type GroupingPlace,
  type GroupingResult,
  groupPlaces,
} from "../src/projects/grouping";
import { identityRemoteOf, normalizeRemotes } from "../src/projects/normalize";
import { homeRelativeOf, placeKindOf } from "../src/projects/place-kind";

export interface CorpusDevice {
  readonly id: string;
  readonly label?: string;
  readonly home: string;
  readonly os?: string;
  readonly caseless?: boolean;
}

export interface CorpusPlace {
  readonly device: string;
  readonly path: string;
  readonly exists?: boolean;
  readonly mounted?: boolean;
  readonly git?: {
    readonly remotes?: Readonly<Record<string, string>>;
    readonly push?: string;
    readonly roots?: readonly string[];
    readonly branch?: string;
    readonly shallow?: boolean;
    readonly emptyRoot?: boolean;
    readonly contains?: ReadonlyArray<{ readonly place: string; readonly depth: number }>;
    readonly aliases?: Readonly<Record<string, string>>;
  } | null;
  readonly sessions?: number;
  readonly firstAt?: number | null;
  readonly lastAt?: number | null;
  readonly acted?: boolean;
  readonly adversarial?: string;
}

export interface PlacesCorpus {
  readonly devices: readonly CorpusDevice[];
  readonly taskRoots: readonly string[];
  readonly mac: readonly CorpusPlace[];
  readonly synthetic: readonly CorpusPlace[];
  /** label → placeIds, or `@scratch` (every place the owner calls temp) */
  readonly truth: Readonly<Record<string, readonly string[] | string>>;
  readonly trapLabels: readonly string[];
  readonly roles: {
    readonly project: string;
    readonly clone: string;
    readonly link: readonly string[];
  };
}

export const placeIdOf = (p: CorpusPlace): string => `${p.device}:${p.path}`;

const hex = (text: string): string => createHash("sha1").update(text).digest("hex");
/** a real SHA stays itself; a redacted token becomes a 40-hex one */
export const commitOf = (text: string): string => (/^[0-9a-f]{40}$/.test(text) ? text : hex(text));
const sampleOf = (placeId: string, depth: number): string => hex(`sample\0${placeId}\0${depth}`);

/** Each place's facts as its owner would publish them. */
export function corpusInput(corpus: PlacesCorpus, places: readonly CorpusPlace[]): GroupingInput {
  const devices = new Map(corpus.devices.map((d) => [d.id, d]));
  // a place publishes a sample at every depth some other place was found to hold
  const samples = new Map<string, PlaceSample[]>();
  for (const p of places) {
    for (const c of p.git?.contains ?? []) {
      const list = samples.get(c.place) ?? [];
      if (!list.some((s) => s.depth === c.depth))
        list.push({ sha: sampleOf(c.place, c.depth), depth: c.depth });
      samples.set(c.place, list);
    }
  }
  const byDevice = new Map<string, GroupingPlace[]>();
  for (const p of places) {
    const device = devices.get(p.device);
    if (device === undefined) throw new Error(`no device ${p.device}`);
    const placeId = placeIdOf(p);
    const git = p.git ?? null;
    const remotes = git?.remotes ?? {};
    const aliases = git?.aliases;
    const identity = git !== null ? identityRemoteOf(remotes, git.push, aliases) : null;
    const root = git?.roots?.[0];
    const homeRelative = homeRelativeOf(p.path, device.home);
    const facts = PlaceFacts.parse({
      placeId,
      path: p.path,
      aliases: [],
      kind: placeKindOf(p.path, { home: device.home, taskRoots: corpus.taskRoots }),
      caseless: device.os === "windows" || device.caseless === true,
      exists: p.exists !== false,
      mounted: p.mounted !== false,
      git: git !== null,
      ...(homeRelative !== undefined ? { homeRelative } : {}),
      ...(identity !== null ? { identityRemote: identity } : {}),
      remotes: git !== null ? normalizeRemotes(remotes, aliases) : [],
      ...(root !== undefined && !git?.shallow && !git?.emptyRoot ? { root: commitOf(root) } : {}),
      ...(git?.branch ? { branch: git.branch } : {}),
      samples: (samples.get(placeId) ?? []).sort((a, b) => a.depth - b.depth),
      hits: (git?.contains ?? []).map((c) => ({
        placeId: c.place,
        sha: sampleOf(c.place, c.depth),
        depth: c.depth,
      })),
      observedAt: 0,
    });
    const list = byDevice.get(p.device) ?? [];
    list.push({
      facts,
      ...(p.sessions !== undefined ? { sessions: p.sessions } : {}),
      ...(p.firstAt != null ? { firstAt: p.firstAt } : {}),
      ...(p.lastAt != null ? { lastAt: p.lastAt } : {}),
      ...(p.acted !== undefined ? { acted: p.acted } : {}),
    });
    byDevice.set(p.device, list);
  }
  return { devices: [...byDevice].map(([deviceId, ps]) => ({ deviceId, places: ps })) };
}

// ── the witness ───────────────────────────────────────────────────────────

/** truth: placeId → label; a `?` label is a judgment call, out of the score */
export function truthOf(corpus: PlacesCorpus, places: readonly CorpusPlace[]): Map<string, string> {
  const truth = new Map<string, string>();
  for (const p of places) truth.set(placeIdOf(p), `self:${placeIdOf(p)}`);
  const devices = new Map(corpus.devices.map((d) => [d.id, d]));
  for (const [label, ids] of Object.entries(corpus.truth)) {
    if (ids === "@scratch") {
      // the runner's rule: every place the prototype's kindOf calls temp —
      // a task folder, or a temp folder with no identity remote
      for (const p of places) {
        const device = devices.get(p.device)!;
        const kind = placeKindOf(p.path, { home: device.home, taskRoots: corpus.taskRoots });
        const identity =
          p.git != null ? identityRemoteOf(p.git.remotes ?? {}, p.git.push, p.git.aliases) : null;
        if (kind === "task" || (kind === "temp" && identity === null))
          truth.set(placeIdOf(p), label);
      }
      continue;
    }
    for (const id of ids) if (truth.has(id)) truth.set(id, label);
  }
  return truth;
}

/** The prototype's `score`: pairwise precision and recall against a truth. */
export function score(result: GroupingResult, truth: ReadonlyMap<string, string>) {
  const groupOf = new Map<string, string>();
  for (const p of result.projects) {
    for (const pl of p.places) {
      groupOf.set(pl.placeId, p.key);
      for (const alias of pl.aliasIds) groupOf.set(alias, p.key);
    }
  }
  const ids = [...truth.keys()].filter((id) => !truth.get(id)!.startsWith("?") && groupOf.has(id));
  let tp = 0;
  const falseMerges: Array<[string, string]> = [];
  const falseSplits: Array<[string, string]> = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const same = truth.get(ids[a]!) === truth.get(ids[b]!);
      const grouped = groupOf.get(ids[a]!) === groupOf.get(ids[b]!);
      if (same && grouped) tp++;
      else if (!same && grouped) falseMerges.push([ids[a]!, ids[b]!]);
      else if (same && !grouped) falseSplits.push([ids[a]!, ids[b]!]);
    }
  }
  return { tp, falseMerges, falseSplits };
}

/** Everything the witness asserts, in a shape two corpora can be compared by:
 * counts, and the partition as sets of CORPUS INDICES (a place's position in
 * `mac` then `synthetic`), which redaction cannot move. */
export function witnessOf(corpus: PlacesCorpus) {
  const all = [...corpus.mac, ...corpus.synthetic];
  const index = new Map(all.map((p, i) => [placeIdOf(p), i]));
  const intents: GroupingIntents = {
    links: [{ a: corpus.roles.link[0]!, b: corpus.roles.link[1]!, at: 1 }],
  };

  const run = (places: readonly CorpusPlace[], withIntents?: GroupingIntents) =>
    groupPlaces({
      ...corpusInput(corpus, places),
      ...(withIntents !== undefined ? { intents: withIntents } : {}),
    });
  const shape = (result: GroupingResult) => {
    const buckets: Record<string, number> = {};
    for (const p of result.projects) if (p.bucket !== null) buckets[p.bucket] = p.places.length;
    const suggestions: Record<string, number> = {};
    for (const s of result.suggestions) suggestions[s.type] = (suggestions[s.type] ?? 0) + 1;
    const listed = result.projects.filter((p) => p.bucket === null);
    return {
      rows: result.projects.length,
      buckets,
      multiPlace: listed.filter((p) => p.places.length > 1).length,
      crossDevice: listed.filter((p) => p.devices.length > 1).length,
      suggestions,
      partition: result.projects
        .map((p) =>
          p.places
            .flatMap((pl) => [pl.placeId, ...pl.aliasIds])
            .map((id) => index.get(id)!)
            .sort((a, b) => a - b),
        )
        .sort((a, b) => a[0]! - b[0]!),
    };
  };

  const mac = run(corpus.mac);
  const mesh = run(all);
  const linked = run(all, intents);

  // the trap pairs: the adversarial places and the labels the runner adds
  const truth = truthOf(corpus, all);
  const trapIds = new Set(all.filter((p) => p.adversarial !== undefined).map((p) => placeIdOf(p)));
  const trapTruth = new Map(
    [...truth].filter(([id, label]) => trapIds.has(id) || corpus.trapLabels.includes(label)),
  );
  const traps = score(mesh, trapTruth);
  const clear = new Map([...truth].filter(([, label]) => label !== "home" && label !== "scratch"));
  const projects = score(mesh, clear);

  // exact groups: every clear multi-place truth group is one project, alone
  const labels = new Map<string, string[]>();
  for (const [id, label] of truth) {
    if (label.startsWith("self:") || label.startsWith("?")) continue;
    labels.set(label, [...(labels.get(label) ?? []), id]);
  }
  const keyOf = new Map<string, string>();
  for (const p of mesh.projects) {
    for (const pl of p.places) for (const id of [pl.placeId, ...pl.aliasIds]) keyOf.set(id, p.key);
  }
  let exact = 0;
  let clearGroups = 0;
  for (const [label, ids] of labels) {
    if (ids.length < 2) continue;
    clearGroups++;
    const keys = new Set(ids.map((id) => keyOf.get(id)));
    const project = mesh.projects.find((p) => p.key === [...keys][0]);
    const members = project?.places.flatMap((pl) => [pl.placeId, ...pl.aliasIds]) ?? [];
    if (
      keys.size === 1 &&
      members.every((id) => truth.get(id) === label || truth.get(id)!.startsWith("?"))
    ) {
      exact++;
    }
  }

  return {
    places: { mac: corpus.mac.length, mesh: all.length },
    mac: shape(mac),
    mesh: shape(mesh),
    meshLinked: shape(linked),
    trapPairs: { falseMerges: traps.falseMerges.length, falseSplits: traps.falseSplits.length },
    projectPairs: {
      truePairs: projects.tp,
      falseMerges: projects.falseMerges.length,
      falseSplits: projects.falseSplits.length,
    },
    exactGroups: `${exact}/${clearGroups}`,
    invariants: invariantsOf(corpus, all, run),
  };
}

/** The prototype runner's four invariants (run-grouping.mjs:160-179). */
function invariantsOf(
  corpus: PlacesCorpus,
  all: readonly CorpusPlace[],
  run: (places: readonly CorpusPlace[], intents?: GroupingIntents) => GroupingResult,
) {
  const { project, clone, link } = corpus.roles;
  const intents: GroupingIntents = { links: [{ a: link[0]!, b: link[1]!, at: 1 }] };
  const of = (r: GroupingResult) =>
    r.projects.find((p) => p.places.some((pl) => pl.placeId === project))!;
  const failures: string[] = [];

  const base = run(all);
  for (const result of [base, run(all, intents)]) {
    const keys = result.projects.map((p) => p.key);
    if (new Set(keys).size !== keys.length) failures.push("two projects share a key");
    for (const key of keys) {
      if (!/^p1:[a-z2-7]{26}$/.test(key)) failures.push(`a key names something: ${key}`);
    }
  }

  const less = run(all.filter((p) => placeIdOf(p) !== clone));
  if (of(base).key !== of(less).key || of(base).ink !== of(less).ink) {
    failures.push("deleting one clone re-keyed or re-inked the project");
  }

  const root = all.find((p) => placeIdOf(p) === project)!.git!.roots![0]!;
  const record = { id: "rec-vf", anchors: [`root:${commitOf(root)}`], ink: 7, createdAt: 1 };
  const bound = run(all, { ...intents, records: [record] });
  if (of(bound).key !== "r:rec-vf" || of(bound).ink !== 7) {
    failures.push("a record did not bind to its group, or its ink was re-dealt");
  }
  const unnamed = { id: "rec-b", anchors: [`root:${commitOf(root)}`], createdAt: 2 };
  const two = run(all, { ...intents, records: [record, unnamed] });
  if (of(two).key !== "r:rec-vf" || (of(two).alsoCalled ?? []).length > 0) {
    failures.push("the older record lost its group, or an unnamed record became a name");
  }
  const named = { id: "rec-c", anchors: [`root:${commitOf(root)}`], name: "Field", createdAt: 0 };
  const three = run(all, { ...intents, records: [record, named] });
  if (
    of(three).key !== "r:rec-c" ||
    of(three).name !== "Field" ||
    of(three).alsoCalled !== undefined
  ) {
    failures.push("the oldest record did not name its group");
  }
  return failures;
}
