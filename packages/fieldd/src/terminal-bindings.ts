import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import { TerminalBinding, type TerminalBindingsFile } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// SB-2 (AR-7g) — THE SHELL IS BORN UNDER ITS PROFILE. A `terminal.create` that
// names an Agent Profile (puppeteer's profile set) is born with that profile's
// binding environment: the variables that route each agent the shell starts to
// the set's sign-in for it. puppeteer owns the variables — which exist, what
// they name, what they hold — and VibeField spells none of them (AR-L1): the
// map is opaque here, passed through the create's fence and on to the floor,
// never branched on, named, logged or recorded.

/** One Agent Profile's binding, as the agent runtime answers it for a birth
 * (`TerminalServiceOptions.profileBinding`). The variables are OPAQUE: they
 * pass the fence and reach the shell, nothing else. The native set is `bound`
 * with none — its agents run in their own folders. */
export type TerminalProfileBinding =
  | { state: "bound"; label: string; variables: Record<string, string> }
  /** no set by that id (never made, or deleted since) */
  | { state: "unknown" }
  /** the agent runtime could not be asked */
  | { state: "unavailable"; reason: string }
  /** the set exists and its binding could not be made */
  | { state: "failed"; label: string; reason: string };

/** How the daemon answers `TerminalServiceOptions.profileBinding` from the
 * agent runtime: the set (`runtime.profileSet`), its sign-ins — the active
 * accounts, one per provider — and puppeteer's `profileBindingEnvironment` over
 * them, which merges each account's variables and throws on an account it does
 * not know or a provider bound twice. The native set is the agents' own
 * folders: it binds nothing and is never handed to the runtime to bind. */
export function runtimeProfileBinding(
  runtime: Pick<AgentRuntime, "profileSet" | "profileBindingEnvironment">,
): (profileSet: string) => Promise<TerminalProfileBinding> {
  return async (profileSet) => {
    let info: Awaited<ReturnType<AgentRuntime["profileSet"]>>;
    try {
      info = await runtime.profileSet(profileSet);
    } catch (error) {
      return { state: "unavailable", reason: messageOf(error) };
    }
    if (info === undefined) return { state: "unknown" };
    const label = info.set.label;
    if (info.set.kind === "native") return { state: "bound", label, variables: {} };
    try {
      const variables = await runtime.profileBindingEnvironment(
        info.profiles.map((account) => account.id),
      );
      return { state: "bound", label, variables };
    } catch (error) {
      return { state: "failed", label, reason: messageOf(error) };
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How long a birth this fieldd made may go unlisted before an inventory that
 * does not list it counts as its end. The floor lists a birth one reconcile
 * tick later (field-native's 100 ms floor); this is that tick on a loaded host,
 * with room to spare. A birth whose EXIT arrived waits for nothing. */
export const BINDING_BIRTH_GRACE_MS = 30_000;

export interface TerminalBindingStoreOptions {
  /** `<user root>/fieldd/terminal-bindings.json` (LAYOUT
   * `TERMINAL_BINDINGS_FILE`); absent = the record is kept in memory only */
  file?: string | undefined;
  logger?: Logger | undefined;
  /** test seam: the clock (default `Date.now`) */
  now?: (() => number) | undefined;
}

/** SB-2 — FIELDD'S RECORD of which shells were born under an Agent Profile:
 * session → set, and never a variable. Nothing below fieldd can hold it (the
 * floor's session options carry an owner label and nothing else), and the
 * floor outlives fieldd, so it is on disk (0600, written whole and renamed
 * durably): a restarted fieldd still says which profile a surviving shell was
 * born under. A row lives while its session does — the first inventory that
 * does not list it ends it, except for a birth still inside its grace window,
 * which no inventory has had the chance to list yet. A file that is not the
 * contract's is set aside (its name kept beside it) and the record starts
 * empty; a row that is not one is dropped and the rest are read. */
export class TerminalBindingStore {
  private readonly rows = new Map<string, TerminalBinding>();
  /** births this fieldd made that no inventory has listed yet, by when */
  private readonly unlisted = new Map<string, number>();
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(private readonly opts: TerminalBindingStoreOptions = {}) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? Date.now;
    this.load();
  }

  /** The set a session was born under, or undefined for an unbound one. */
  profileSetOf(sessionId: string): string | undefined {
    return this.rows.get(sessionId)?.profileSet;
  }

  /** Every row, oldest first. */
  list(): TerminalBinding[] {
    return [...this.rows.values()];
  }

  /** A bound birth, recorded the moment the floor answered it. */
  bind(sessionId: string, profileSet: string): void {
    const at = this.now();
    this.rows.set(sessionId, { sessionId, profileSet, boundAt: new Date(at).toISOString() });
    this.unlisted.set(sessionId, at);
    this.save();
  }

  /** An applied inventory: each row whose session it does not list has ended
   * — unless it is a birth still inside its grace window. */
  observe(listed: Iterable<string>): void {
    const live = new Set(listed);
    const at = this.now();
    let ended = 0;
    for (const sessionId of [...this.rows.keys()]) {
      if (live.has(sessionId)) {
        this.unlisted.delete(sessionId);
        continue;
      }
      const born = this.unlisted.get(sessionId);
      if (born !== undefined && at - born < BINDING_BIRTH_GRACE_MS) continue;
      this.rows.delete(sessionId);
      this.unlisted.delete(sessionId);
      ended += 1;
    }
    if (ended > 0) this.save();
  }

  /** The floor said a session's process ended: a birth that never reached an
   * inventory waits no longer — the next inventory that does not list it ends
   * its row. One the floor keeps after its exit is still listed, and kept. */
  exited(sessionId: string): void {
    this.unlisted.delete(sessionId);
  }

  private load(): void {
    const file = this.opts.file;
    if (file === undefined) return;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.logger.warn(
        "fieldd.terminal.bindings_unreadable",
        "The record of profile-bound shells could not be read; it starts empty",
        { error: messageOf(error) },
      );
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const shaped =
      typeof raw === "object" &&
      raw !== null &&
      (raw as { version?: unknown }).version === 1 &&
      Array.isArray((raw as { bindings?: unknown }).bindings);
    if (!shaped) {
      const aside = `${file}.unreadable-${this.now()}`;
      this.logger.warn(
        "fieldd.terminal.bindings_set_aside",
        "The record of profile-bound shells is not one this fieldd reads; it was set aside and starts empty",
        { aside },
      );
      try {
        renameSync(file, aside);
      } catch {
        // the next write replaces it
      }
      return;
    }
    let dropped = 0;
    for (const row of (raw as { bindings: unknown[] }).bindings) {
      const parsed = TerminalBinding.safeParse(row);
      if (parsed.success) this.rows.set(parsed.data.sessionId, parsed.data);
      else dropped += 1;
    }
    if (dropped > 0)
      this.logger.warn(
        "fieldd.terminal.bindings_rows_dropped",
        "Rows of the record of profile-bound shells were not rows; they were dropped",
        { dropped },
      );
  }

  /** The whole record, published so no reader sees it half-written: a private
   * temp file that cannot pre-exist, renamed durably, the mode re-asserted. A
   * write that fails leaves the record in memory and says so; the next change
   * writes it whole again. */
  private save(): void {
    const file = this.opts.file;
    if (file === undefined) return;
    const record: TerminalBindingsFile = { version: 1, bindings: this.list() };
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      durableRenameSync(tmp, file);
      if (process.platform !== "win32" && (statSync(file).mode & 0o777) !== 0o600)
        chmodSync(file, 0o600);
    } catch (error) {
      rmSync(tmp, { force: true });
      this.logger.warn(
        "fieldd.terminal.bindings_unwritten",
        "The record of profile-bound shells could not be written; it is kept in memory",
        { error: messageOf(error) },
      );
    }
  }
}
