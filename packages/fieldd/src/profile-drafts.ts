import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AgentProfileDraftsFile, emptyAgentProfileDrafts } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// The profiles Add a profile… made and no sign-in has kept yet (track AO, AO-5a;
// AO-D14, ruled (a) by James 2026-10-27). A profile is made as its first sign-in
// starts — the login writes into its folder — and is kept once its agent says
// who signed in; until then fieldd notes it here, the feed marks it `draft`,
// `agents.profileSets.discard` may delete it, and every start deletes a noted
// profile no sign-in has kept. A profile made before AO-5a was never noted, so
// none is ever swept. fieldd's truth, one file per user
// (`LAYOUT.AGENT_PROFILE_DRAFTS_FILE`), loaded once and written whole and
// atomically on change — the setup ledger's discipline (setup-ledger.ts).

export interface ProfileDraftsStoreOptions {
  /** the note's absolute path (LAYOUT.AGENT_PROFILE_DRAFTS_FILE under the user root) */
  path: string;
  now?: () => Date;
  logger?: Logger;
}

export class ProfileDraftsStore {
  private record: AgentProfileDraftsFile;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(private readonly opts: ProfileDraftsStoreOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    this.record = this.load();
  }

  /** whether this set is a draft no sign-in has kept */
  has(setId: string): boolean {
    return Object.hasOwn(this.record.drafts, setId);
  }

  /** every noted set, oldest first */
  list(): string[] {
    return Object.entries(this.record.drafts)
      .sort(([, a], [, b]) => a.at.localeCompare(b.at))
      .map(([setId]) => setId);
  }

  /** Note a set just made as a draft. */
  note(setId: string): void {
    if (this.has(setId)) return;
    this.record.drafts[setId] = { at: this.now().toISOString() };
    this.commit();
  }

  /** The set is kept, discarded or gone: it leaves the note. Returns whether it was noted. */
  clear(setId: string): boolean {
    if (!this.has(setId)) return false;
    this.record = {
      ...this.record,
      drafts: Object.fromEntries(Object.entries(this.record.drafts).filter(([id]) => id !== setId)),
    };
    this.commit();
    return true;
  }

  private commit(): void {
    const bytes = `${JSON.stringify(this.record, null, 2)}\n`;
    mkdirSync(dirname(this.opts.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.path}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    durableRenameSync(tmp, this.opts.path);
  }

  private load(): AgentProfileDraftsFile {
    let text: string;
    try {
      text = readFileSync(this.opts.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAgentProfileDrafts();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = AgentProfileDraftsFile.safeParse(parsed);
    if (record.success) return record.data;
    // An unreadable note is set aside, never silently overwritten. The drafts it
    // named are then neither swept nor discardable — they stay as ordinary
    // profiles, which loses nothing a person made — and the bytes stay for a
    // human to look at.
    const aside = `${this.opts.path}.unreadable-${Date.now()}`;
    this.logger.error(
      "fieldd.agents.drafts_unreadable",
      "The profile drafts note is unreadable; set aside, starting from an empty note",
      undefined,
      { aside, issue: record.error.issues[0]?.message ?? "invalid json" },
    );
    try {
      renameSync(this.opts.path, aside);
    } catch {
      // nothing more to do: the next note overwrites it
    }
    return emptyAgentProfileDrafts();
  }
}
