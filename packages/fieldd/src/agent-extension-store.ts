import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentExtensionKeep,
  type AgentExtensionServerDefinition,
  AgentProfileSetId,
} from "@vibefield/contracts";
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

/** The keychain service every profile's entry is kept under; the account is the profile's id. */
export const EXTENSION_VALUES_SERVICE = "VibeField agent server values";

export type ExtensionKeep = AgentExtensionKeep;

const empty = (): ExtensionKeep => ({ version: 1, servers: {}, values: [], given: {} });

export interface AgentExtensionStoreOptions {
  /** `<userRoot>/agents/extensions` (LAYOUT.AGENT_EXTENSIONS_DIR) */
  dir: string;
  secrets: SecretStore;
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

  /** The profile is gone: its keep and its keychain entry go with it. */
  forgetProfile(setId: string): Promise<void> {
    return this.enqueue(setId, async () => {
      this.keeps.delete(setId);
      await rm(this.fileOf(setId), { force: true });
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
