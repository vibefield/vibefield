import { createHash } from "node:crypto";
import { familyOf } from "../project-family";

// PJ-1 INTERIM (lane pj1b) — DELETED at the rebase onto pj1a. A copy of the
// shape pj1a writes in contracts `project-places.ts` (`PlaceFacts`,
// `PlaceFactsList`), and stand-ins for its normalizer, so the scanner, the
// catalog enrichment and the replica's reading can be built and tested before
// the contract lands. Everything here is replaced by an import:
//   PlaceFacts / readPlaceFacts  → contracts `PlaceFacts` / `PlaceFactsList`
//   normalizeRemote(s), identityRemoteOf → fieldd `projects/normalize.ts`
//   placeIdFor                   → whatever pj1a names (opaque, mesh-unique)

export interface PlaceSampleFact {
  sha: string;
  depth: number;
}

export interface PlaceHitFact {
  placeId: string;
  sha: string;
  depth: number;
}

/** One place as its OWNER publishes it on its catalog project row (L1). */
export interface PlaceFacts {
  placeId: string;
  path: string;
  aliases: string[];
  kind: "home" | "temp" | "task" | "project";
  caseless: boolean;
  exists: boolean;
  mounted: boolean;
  git: boolean;
  homeRelative?: string;
  identityRemote?: string;
  remotes: string[];
  root?: string;
  branch?: string;
  worktreeOf?: string;
  samples: PlaceSampleFact[];
  hits: PlaceHitFact[];
  gitRefused?: string;
  observedAt: number;
}

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const KINDS = new Set(["home", "temp", "task", "project"]);

const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmpty = (value: unknown): value is string => isString(value) && value.length > 0;

function readSample(raw: unknown): PlaceSampleFact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { sha, depth } = raw as { sha?: unknown; depth?: unknown };
  return isString(sha) && SHA.test(sha) && Number.isInteger(depth) && (depth as number) >= 0
    ? { sha, depth: depth as number }
    : null;
}

function readHit(raw: unknown): PlaceHitFact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { placeId } = raw as { placeId?: unknown };
  const sample = readSample(raw);
  return sample !== null && isNonEmpty(placeId) ? { placeId, ...sample } : null;
}

/** One place, read tolerantly, or null when it cannot be read at all. */
function readPlace(raw: unknown): PlaceFacts | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const flags = ["caseless", "exists", "mounted", "git"] as const;
  if (!isNonEmpty(r["placeId"]) || !isNonEmpty(r["path"])) return null;
  if (!flags.every((flag) => typeof r[flag] === "boolean")) return null;
  if (typeof r["observedAt"] !== "number" || !Number.isFinite(r["observedAt"])) return null;
  if (!Array.isArray(r["aliases"]) || !Array.isArray(r["remotes"])) return null;
  if (!Array.isArray(r["samples"]) || !Array.isArray(r["hits"])) return null;
  const samples = r["samples"].map(readSample);
  const hits = r["hits"].map(readHit);
  // a SHA that is not hex is a place this reader will not hand to git: the
  // whole place goes, never a part of it
  if (samples.some((s) => s === null) || hits.some((h) => h === null)) return null;
  if (r["root"] !== undefined && !(isString(r["root"]) && SHA.test(r["root"]))) return null;
  const optional = (key: string): string | undefined =>
    isNonEmpty(r[key]) ? (r[key] as string) : undefined;
  const place: PlaceFacts = {
    ...(r as object),
    placeId: r["placeId"],
    path: r["path"],
    aliases: r["aliases"].filter(isNonEmpty),
    kind: KINDS.has(r["kind"] as string) ? (r["kind"] as PlaceFacts["kind"]) : "project",
    caseless: r["caseless"] as boolean,
    exists: r["exists"] as boolean,
    mounted: r["mounted"] as boolean,
    git: r["git"] as boolean,
    remotes: r["remotes"].filter(isNonEmpty),
    samples: samples as PlaceSampleFact[],
    hits: hits as PlaceHitFact[],
    observedAt: r["observedAt"] as number,
  };
  for (const key of [
    "homeRelative",
    "identityRemote",
    "root",
    "branch",
    "worktreeOf",
    "gitRefused",
  ] as const) {
    const value = optional(key);
    if (value === undefined) delete place[key];
    else place[key] = value;
  }
  return place;
}

/** A row's places as a reader takes them (contracts `PlaceFactsList`): a place
 * it cannot read is dropped and the rest kept; anything not a list is none. */
export function readPlaceFacts(raw: unknown): PlaceFacts[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((place) => {
    const read = readPlace(place);
    return read === null ? [] : [read];
  });
}

/** The normalizer's stand-in (pj1a's `normalizeRemote`, same signature):
 * DS-D9's family (`familyOf`), its host replaced by the ssh alias's HostName
 * (C10). A local path is no key here (the real normalizer says `local:`,
 * which never joins). */
export function normalizeRemote(
  url: string | null | undefined,
  aliases?: Readonly<Record<string, string>>,
): string | null {
  const family = familyOf(url);
  if (family === undefined) return null;
  const slash = family.indexOf("/");
  const host = family.slice(0, slash);
  const alias = Object.entries(aliases ?? {}).find(([name]) => name.toLowerCase() === host)?.[1];
  return alias === undefined ? family : `${alias.toLowerCase()}${family.slice(slash)}`;
}

/** Every remote's key, deduplicated in git's order (pj1a's `normalizeRemotes`). */
export function normalizeRemotes(
  remotes: Readonly<Record<string, string>>,
  aliases?: Readonly<Record<string, string>>,
): string[] {
  const keys = new Set<string>();
  for (const url of Object.values(remotes)) {
    const key = normalizeRemote(url, aliases);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** E1 — the identity remote (pj1a's `identityRemoteOf`): the named push
 * remote › `origin` › the only remote, normalized; null for a local path. */
export function identityRemoteOf(
  remotes: Readonly<Record<string, string>>,
  pushRemote?: string,
  aliases?: Readonly<Record<string, string>>,
): string | null {
  const names = Object.keys(remotes);
  const pick =
    pushRemote !== undefined && Object.hasOwn(remotes, pushRemote)
      ? pushRemote
      : Object.hasOwn(remotes, "origin")
        ? "origin"
        : names.length === 1
          ? names[0]
          : undefined;
  const key = pick === undefined ? null : normalizeRemote(remotes[pick], aliases);
  return key !== null && !key.startsWith("local:") ? key : null;
}

/** A place's id: opaque, unique across the mesh (the device is in it). */
export function placeIdFor(device: string, path: string): string {
  return `pl_${createHash("sha256").update(`${device}\u0000${path}`).digest("hex").slice(0, 24)}`;
}
