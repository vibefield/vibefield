import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  emptySetupLedger,
  SetupLedger,
  type SetupMomentKey,
  type SetupMomentState,
  type SetupStep,
  type SetupStepState,
  setupMomentState,
  setupStepState,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// The Setup Assistant's ledger (track AO, AO-2; design-03 §4.3's `setup.*`):
// which of its steps this user answered and which they put off, so a quit
// resumes at the first unanswered pane (W6) and Settings' "Finish setting up"
// lists what was put off. fieldd's truth, one file per user
// (`LAYOUT.SETUP_LEDGER_FILE`), loaded once and written atomically on change —
// the enrollment record's discipline (agent-index.ts), for a smaller record.

export interface SetupLedgerStoreOptions {
  /** the ledger's absolute path (LAYOUT.SETUP_LEDGER_FILE under the user root) */
  path: string;
  now?: () => Date;
  logger?: Logger;
}

export class SetupLedgerStore {
  private ledger: SetupLedger;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly listeners = new Set<(ledger: SetupLedger) => void>();

  constructor(private readonly opts: SetupLedgerStoreOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    this.ledger = this.load();
  }

  /** a deep copy — callers never hold the live ledger */
  snapshot(): SetupLedger {
    return structuredClone(this.ledger);
  }

  /** Record one step's answer. Declarative: the answer it already holds is not
   * written again. A row a newer build wrote for this step is replaced, since
   * the person has just answered it here. Returns whether the ledger changed. */
  answer(step: SetupStep, state: SetupStepState): boolean {
    if (setupStepState(this.ledger, step) === state) return false;
    this.ledger.steps[step] = { state, at: this.now().toISOString() };
    this.commit();
    return true;
  }

  /** AO-6b (AO-D15) — record one moment's answer beside the steps (Not now
   * retires it for good). Declarative, and a newer build's row for it is
   * replaced, as `answer` does. Returns whether the ledger changed. */
  moment(moment: SetupMomentKey, state: SetupMomentState): boolean {
    if (setupMomentState(this.ledger, moment) === state) return false;
    this.ledger.moments = {
      ...(this.ledger.moments ?? {}),
      [moment]: { state, at: this.now().toISOString() },
    };
    this.commit();
    return true;
  }

  /** Hide Finish setting up, or show it again. Returns whether it changed. */
  hide(hidden: boolean): boolean {
    if (this.ledger.hidden === hidden) return false;
    this.ledger.hidden = hidden;
    this.commit();
    return true;
  }

  /** Every change, as a fresh snapshot. */
  onChange(listener: (ledger: SetupLedger) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(): void {
    const bytes = `${JSON.stringify(this.ledger, null, 2)}\n`;
    mkdirSync(dirname(this.opts.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.path}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    durableRenameSync(tmp, this.opts.path);
    for (const listener of [...this.listeners]) listener(this.snapshot());
  }

  private load(): SetupLedger {
    let text: string;
    try {
      text = readFileSync(this.opts.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySetupLedger();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const ledger = SetupLedger.safeParse(parsed);
    if (ledger.success) return ledger.data;
    // An unreadable ledger is set aside, never silently overwritten: the steps
    // it held are asked again (their homes still hold every one of them), and
    // the bytes stay for a human to look at.
    const aside = `${this.opts.path}.unreadable-${Date.now()}`;
    this.logger.error(
      "fieldd.setup.ledger_unreadable",
      "The setup ledger is unreadable; set aside, starting from an empty ledger",
      undefined,
      { aside, issue: ledger.error.issues[0]?.message ?? "invalid json" },
    );
    try {
      renameSync(this.opts.path, aside);
    } catch {
      // nothing more to do: the next answer overwrites it
    }
    return emptySetupLedger();
  }
}
