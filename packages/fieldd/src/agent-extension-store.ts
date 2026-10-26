import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AgentExtensionChange,
  AgentExtensionKeep,
  type AgentExtensionServerDefinition,
  AgentProfileSetId,
} from "@vibefield/contracts";
import { EXTENSION_SKILL_FOLDER_NAME, parseSkillFrontmatter } from "@vibefield/puppeteer-core";
import { RpcCallError } from "./native-link";
import type { SecretStore } from "./plugin-settings";

// AR-S4d — WHAT A PROFILE KEEPS ONCE (pass 24, S1). The lens is the agents'
// own evidence; this is the little VibeField keeps beside it that no agent
// keeps for the profile: each MCP server's definition (what it runs or where
// it is, and the NAMES of the variables it reads), the names it keeps a value
// for, and which names it gave each agent by that agent's own add.
//
// The VALUES live in the OS keychain — one entry per profile, a map of name
// to value — and are read for one purpose: starting an agent the profile gave
// them to. They are never written under the user root, never sent back on the
// wire, and never logged. An agent is given only the names of the servers
// VibeField itself gave it, so a key for one server never reaches an agent
// that does not run it.
//
// AR-S4d2 — THE PROFILE'S SKILLS FOLDER: one copy of each skill the profile
// keeps, `<skillsDir>/<set>/<name>/`, which every agent in the profile is
// given a link to where it looks (puppeteer places the links). An entry is a
// folder with a SKILL.md, or a link to one in `~/.agents/skills` once Codex
// took it there. A skill comes in by a copy of a folder the person names
// (Add skill), or by an agent's own folder moving here (puppeteer's move).
// And O1: what each agent held of the profile's own at the last read, so a
// read can say what changed outside VibeField since.

/** The keychain service every profile's entry is kept under; the account is the profile's id. */
export const EXTENSION_VALUES_SERVICE = "VibeField agent server values";

export type ExtensionKeep = AgentExtensionKeep;

/** What one agent held of the profile's own at a read: names, each with whether it was on. */
export interface SeenAgent {
  servers: Record<string, boolean>;
  skills: Record<string, boolean>;
}

/** A skill in the profile's folder. */
export interface KeptSkill {
  name: string;
  /** `<skillsDir>/<set>/<name>` */
  folder: string;
  /** Set when the entry is a link (Codex took the copy to the shared folder): where it points. */
  linkTarget?: string;
  description?: string;
}

/** A folder a person names for Add skill, read before anything is copied. */
export interface SkillSource {
  /** Its folder's name: what the profile keeps it under. */
  name: string;
  /** The folder, absolute. */
  folder: string;
  description?: string;
}

/** A change made outside VibeField is said for three days, or until VibeField turns that cell. */
const CHANGE_KEPT_MS = 3 * 24 * 60 * 60_000;
/** The lines a profile keeps at most, the newest. */
const MAX_CHANGES = 20;
/** A skill folder copied in: small, like the agents' own (instructions and a few scripts). */
const SKILL_LIMITS = { entries: 2_000, bytes: 50 * 1024 * 1024 };
/** How many entries of the profile's folder a read lists. */
const MAX_KEPT_SKILLS = 512;

const empty = (): ExtensionKeep => ({ version: 1, servers: {}, values: [], given: {} });

export interface AgentExtensionStoreOptions {
  /** `<userRoot>/agents/extensions` (LAYOUT.AGENT_EXTENSIONS_DIR) */
  dir: string;
  /** `<userRoot>/agents/skills` (LAYOUT.AGENT_SKILLS_DIR) */
  skillsDir: string;
  secrets: SecretStore;
  /** The OS user's home, which `~/` in a folder a person names is. */
  home?: string;
  /** Test seam: how big a folder Add skill copies (production: 2,000 entries, 50 MB). */
  skillLimits?: { entries: number; bytes: number };
  now?: () => Date;
}

export class AgentExtensionStore {
  private readonly keeps = new Map<string, ExtensionKeep>();
  /** one change at a time per profile: the file and the keychain entry are read, then written */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(private readonly opts: AgentExtensionStoreOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  /** The profile's keep: its file, or nothing kept when there is none. */
  async read(setId: string): Promise<ExtensionKeep> {
    const known = this.keeps.get(setId);
    if (known !== undefined) return known;
    let keep = empty();
    try {
      const parsed = AgentExtensionKeep.safeParse(
        JSON.parse(await readFile(this.fileOf(setId), "utf8")),
      );
      // a file this build cannot read keeps nothing, and the next change rewrites it whole
      if (parsed.success) keep = parsed.data;
    } catch {
      // no file: nothing kept yet
    }
    this.keeps.set(setId, keep);
    return keep;
  }

  /** A server's definition, kept for the profile. */
  keep(setId: string, name: string, definition: AgentExtensionServerDefinition): Promise<void> {
    return this.change(setId, (keep) => {
      keep.servers[name] = { definition, keptAt: this.now().toISOString() };
    });
  }

  /**
   * Values for names the profile's servers read, into its keychain entry, and
   * their names into the keep. The keychain is written first: a name is never
   * listed without its value.
   */
  keepValues(setId: string, values: Readonly<Record<string, string>>): Promise<void> {
    const names = Object.keys(values);
    if (names.length === 0) return Promise.resolve();
    return this.change(setId, async (keep) => {
      const kept = await this.entry(setId);
      await this.opts.secrets.set(
        EXTENSION_VALUES_SERVICE,
        setId,
        JSON.stringify({ ...kept, ...values }),
      );
      keep.values = [...new Set([...keep.values, ...names])].sort();
    });
  }

  /** An agent's add ran: these are the names it is given with that server. */
  give(setId: string, provider: string, name: string, names: readonly string[]): Promise<void> {
    return this.change(setId, (keep) => {
      keep.given[provider] = { ...keep.given[provider], [name]: [...names].sort() };
    });
  }

  /** The agent let the server go: it is given nothing for it any more. */
  take(setId: string, provider: string, name: string): Promise<void> {
    return this.change(setId, (keep) => {
      const given = keep.given[provider];
      if (given === undefined || !(name in given)) return;
      delete given[name];
      if (Object.keys(given).length === 0) delete keep.given[provider];
    });
  }

  /**
   * The values an agent VibeField starts in the profile is given: those of the
   * names it was given with the servers VibeField gave it. Nothing when it was
   * given none — then the keychain is not opened at all.
   */
  async launchValues(setId: string, provider: string): Promise<Record<string, string> | undefined> {
    if (!AgentProfileSetId.safeParse(setId).success) return undefined;
    const keep = await this.read(setId);
    const kept = new Set(keep.values);
    const names = new Set(
      Object.values(keep.given[provider] ?? {})
        .flat()
        .filter((name) => kept.has(name)),
    );
    if (names.size === 0) return undefined;
    const entry = await this.entry(setId);
    const values: Record<string, string> = {};
    for (const name of names) {
      const value = entry[name];
      if (value !== undefined) values[name] = value;
    }
    return Object.keys(values).length === 0 ? undefined : values;
  }

  /** The profile's skills folder, absolute; it may not exist yet. */
  libraryOf(setId: string): string {
    if (!AgentProfileSetId.safeParse(setId).success) {
      throw new RpcCallError("PRECONDITION_FAILED", `not an Agent Profile id: ${setId}`, false);
    }
    return join(this.opts.skillsDir, setId);
  }

  /** The skills the profile keeps: each entry of its folder that is a skill, or a link to one. */
  async keptSkills(setId: string): Promise<KeptSkill[]> {
    const library = this.libraryOf(setId);
    let names: string[];
    try {
      names = (await readdir(library)).filter((name) => !name.startsWith(".")).sort();
    } catch {
      return [];
    }
    const kept: KeptSkill[] = [];
    for (const name of names.slice(0, MAX_KEPT_SKILLS)) {
      if (!EXTENSION_SKILL_FOLDER_NAME.test(name)) continue;
      const folder = join(library, name);
      try {
        const entry = await lstat(folder);
        const linkTarget = entry.isSymbolicLink()
          ? resolve(library, await readlink(folder))
          : undefined;
        const description = await describeSkill(folder);
        if (description === null) continue;
        kept.push({
          name,
          folder,
          ...(linkTarget !== undefined ? { linkTarget } : {}),
          ...(description !== undefined ? { description } : {}),
        });
      } catch {
        // an entry that went away, or a link to nothing: not a skill any more
      }
    }
    return kept;
  }

  /**
   * A folder a person names for Add skill, read and checked before anything is
   * copied: absolute or from `~/`, a folder holding a SKILL.md, under a name a
   * skills folder can take, not inside the profile's own folder, and small.
   */
  async inspectSkill(setId: string, from: string): Promise<SkillSource> {
    const home = this.opts.home;
    const given = from.trim();
    const fromHome = given === "~" || given.startsWith("~/");
    if (fromHome && home === undefined)
      throw refusal("no-folder", "a folder from ~ needs the home");
    const path = fromHome ? join(home!, given.slice(1)) : given;
    if (!isAbsolute(path) || path.includes("\0")) {
      throw refusal("no-folder", "Name a folder on this Mac: a full path, or one from ~/");
    }
    const folder = resolve(path);
    const found = await stat(folder).catch(() => undefined);
    if (found === undefined) throw refusal("no-folder", `There is no folder at ${given}`);
    if (!found.isDirectory()) throw refusal("no-folder", `${given} is a file, not a folder`);
    const description = await describeSkill(folder);
    if (description === null) {
      throw refusal("no-skill", `${given} has no SKILL.md, so it is not a skill`);
    }
    const name = basename(folder);
    if (!EXTENSION_SKILL_FOLDER_NAME.test(name)) {
      throw refusal("bad-name", `A skill's folder can't be named ${name}`);
    }
    const library = await realpath(this.libraryOf(setId)).catch(() => this.libraryOf(setId));
    const inside = relative(library, await realpath(folder));
    if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) {
      throw refusal("kept", `${name} is already in this profile's skills folder`);
    }
    await measure(folder, this.opts.skillLimits ?? SKILL_LIMITS);
    return { name, folder, ...(description !== undefined ? { description } : {}) };
  }

  /**
   * A folder copied into the profile's skills folder under its own name — the
   * profile's one copy, which each agent is then given a link to. Never over
   * one already there; a copy that fails midway leaves nothing behind.
   */
  async keepSkill(setId: string, source: SkillSource): Promise<string> {
    const library = this.libraryOf(setId);
    const target = join(library, source.name);
    await mkdir(library, { recursive: true, mode: 0o700 });
    if ((await lstat(target).catch(() => undefined)) !== undefined) {
      throw new RpcCallError(
        "CONFLICT",
        `this Agent Profile already keeps a skill named ${source.name}`,
        false,
        { set: setId },
      );
    }
    const staging = join(library, `.${source.name}.${randomUUID()}.tmp`);
    try {
      // a folder named through a link is copied from where it is; links inside it stay links:
      // a skill's own files are copied, never what they point at
      await cp(await realpath(source.folder), staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    return target;
  }

  /**
   * O1: what the agents hold now against what the last read saw. A difference
   * in a cell VibeField did not turn since (`touched`) is a change made
   * outside it; one in a turned cell is VibeField's own, and settles that
   * cell's earlier line. An agent read for the first time, or not read now,
   * says nothing. Answers the profile's lines, newest last.
   */
  noticeChanges(
    setId: string,
    at: string,
    agents: Readonly<Record<string, SeenAgent>>,
    touched: ReadonlySet<string>,
  ): Promise<AgentExtensionChange[]> {
    let lines: AgentExtensionChange[] = [];
    return this.change(setId, (keep) => {
      const before = keep.seen;
      const found: AgentExtensionChange[] = [];
      for (const [provider, now] of Object.entries(agents)) {
        const then = before?.agents[provider];
        if (before === undefined || then === undefined) continue;
        for (const [kind, key] of [
          ["mcp-server", "servers"],
          ["skill", "skills"],
        ] as const) {
          const names = new Set([...Object.keys(then[key]), ...Object.keys(now[key])]);
          for (const name of names) {
            if (touched.has(changeKey(provider, kind, name))) continue;
            const was = then[key][name];
            const is = now[key][name];
            const change =
              was !== undefined && is === undefined
                ? "removed"
                : was === undefined && is !== undefined
                  ? "added"
                  : was === true && is === false
                    ? "off"
                    : was === false && is === true
                      ? "on"
                      : undefined;
            if (change !== undefined) {
              found.push({ provider, kind, name, change, since: before.at, at });
            }
          }
        }
      }
      const cutoff = Date.parse(at) - CHANGE_KEPT_MS;
      const kept = (keep.changes ?? []).filter(
        (line) =>
          Date.parse(line.at) >= cutoff &&
          !touched.has(changeKey(line.provider, line.kind, line.name)) &&
          // a newer line for the same cell says what it is now
          !found.some(
            (next) =>
              next.provider === line.provider && next.kind === line.kind && next.name === line.name,
          ),
      );
      lines = [...kept, ...found].slice(-MAX_CHANGES);
      if (lines.length > 0) keep.changes = lines;
      else delete keep.changes;
      const seen: NonNullable<ExtensionKeep["seen"]>["agents"] = { ...before?.agents };
      for (const [provider, now] of Object.entries(agents)) {
        seen[provider] = { servers: { ...now.servers }, skills: { ...now.skills } };
      }
      keep.seen = { at, agents: seen };
    }).then(() => lines);
  }

  /** The profile is gone: its keep, its skills folder and its keychain entry go with it. */
  forgetProfile(setId: string): Promise<void> {
    return this.enqueue(setId, async () => {
      this.keeps.delete(setId);
      await rm(this.fileOf(setId), { force: true });
      // a link in it goes, never the folder it points at (a skill Codex took to the shared folder stays there)
      await rm(this.libraryOf(setId), { recursive: true, force: true });
      await this.opts.secrets.delete(EXTENSION_VALUES_SERVICE, setId);
    });
  }

  private async entry(setId: string): Promise<Record<string, string>> {
    const raw = await this.opts.secrets.get(EXTENSION_VALUES_SERVICE, setId);
    if (raw === null) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entry: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string") entry[name] = value;
    }
    return entry;
  }

  private fileOf(setId: string): string {
    if (!AgentProfileSetId.safeParse(setId).success) {
      throw new RpcCallError("PRECONDITION_FAILED", `not an Agent Profile id: ${setId}`, false);
    }
    return join(this.opts.dir, `${setId}.json`);
  }

  /** Read the keep, change it, write it whole (0600, by a rename), in the profile's turn. */
  private change(
    setId: string,
    edit: (keep: ExtensionKeep) => void | Promise<void>,
  ): Promise<void> {
    return this.enqueue(setId, async () => {
      const keep = structuredClone(await this.read(setId));
      await edit(keep);
      await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
      const file = this.fileOf(setId);
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, `${JSON.stringify(keep, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await chmod(tmp, 0o600);
        await rename(tmp, file);
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
      this.keeps.set(setId, keep);
    });
  }

  private enqueue(setId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(setId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    this.queues.set(setId, settled);
    void settled.then(() => {
      if (this.queues.get(setId) === settled) this.queues.delete(setId);
    });
    return next;
  }
}

/** A cell, as O1 keys what VibeField turned. */
export function changeKey(provider: string, kind: "mcp-server" | "skill", name: string): string {
  return `${provider}\u0000${kind}\u0000${name}`;
}

/** A skill folder's description from its SKILL.md; null when it holds none (not a skill). */
async function describeSkill(folder: string): Promise<string | undefined | null> {
  const file = join(folder, "SKILL.md");
  const found = await stat(file).catch(() => undefined);
  if (found === undefined || !found.isFile()) return null;
  // the frontmatter is at the top; a large body is never read whole
  const head = found.size > 64 * 1024 ? "" : await readFile(file, "utf8").catch(() => "");
  const description = parseSkillFrontmatter(head).description;
  return description === undefined ? undefined : description.slice(0, 2_048);
}

/** A folder small enough to keep: so many entries and bytes at most, links counted, never followed. */
async function measure(folder: string, limits: { entries: number; bytes: number }): Promise<void> {
  let entries = 0;
  let bytes = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (depth > 16) throw tooBig("folders nested too deep");
    for (const name of await readdir(path)) {
      entries += 1;
      if (entries > limits.entries) throw tooBig(`more than ${limits.entries} files`);
      const child = join(path, name);
      const found = await lstat(child);
      if (found.isDirectory()) await walk(child, depth + 1);
      else {
        bytes += found.size;
        if (bytes > limits.bytes) {
          throw tooBig(`more than ${Math.round(limits.bytes / (1024 * 1024))} MB`);
        }
      }
    }
  };
  await walk(folder, 0);
}

function tooBig(what: string): RpcCallError {
  return refusal("too-big", `Too big to keep as a skill: ${what}`);
}

/** Why a folder a person named is not taken, with the reason the form shows it by. */
function refusal(reason: string, message: string): RpcCallError {
  return new RpcCallError("PRECONDITION_FAILED", message, false, { reason });
}
