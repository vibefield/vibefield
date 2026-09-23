import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type {
  AgentInstallation,
  DistributionFailure,
  ReleaseSnapshot,
  UpdateReceipt,
} from "@vibecook/puppeteer-core";
import {
  type AgentRuntime,
  availableUpdate,
  type ReleaseCheckResult,
  type UpdatePlan,
} from "@vibecook/puppeteer-runtime";
import {
  AGENT_DISTRIBUTION_FORMAT,
  AGENT_OPERATION_OUTPUT_BYTES,
  type AgentAvailableUpdate,
  type AgentDistributionRecord,
  AgentDistributionRecord as AgentDistributionRecordSchema,
  type AgentInstall,
  type AgentOperation,
  type AgentRelease,
  type AgentReleaseFailure,
  type AgentsInstallsResult,
  type AgentsOperationsResult,
  type AgentsReleasesParams,
  type AgentsReleasesResult,
  type AgentsRevealParams,
  type AgentsRevealResult,
  type AgentsSetActiveParams,
  type AgentsSetActiveResult,
  type AgentsUpdateResult,
  type AgentUpdatePlan,
  type AgentUpdateReceipt,
  LAYOUT,
} from "@vibefield/contracts";
import { durableRenameSync, type Logger } from "@vibefield/logging";
import { withUsersLock } from "@vibefield/users";
import { RpcCallError } from "./native-link";

// AGENT DISTRIBUTION (AR-2; AR-D15/D16/D22; the Agents settings section,
// 2026-09-22): the installs puppeteer classifies, the release facts it learns,
// the vendor's own updater run under the root lock, and the one choice
// VibeField owns there — which executable new spawns use. Carved out of the
// agent runtime service by domain, with the three things the settings section
// needed and nothing else: a release check that is KEPT (so a page opens on
// "checked 09:41:20" without checking on its own — §8, AR-D22), the command an
// update will run (named before anyone presses Update), and the update's own
// output while it runs (display text, never parsed — RFC 006: the outcome is
// the receipt's re-inspection).
//
// What never crosses a door from here: an update transcript (opaque, 0600,
// machine scope), and a path a caller spelled — Show in Finder reveals only a
// path this daemon's own inventory holds.

/** One frame per tick per subscriber, trailing edge (PF5's constant): an
 * updater's output arrives in bursts, a panel needs at most one repaint a tick. */
const OPERATIONS_TICK_MS = 16;
/** The raw text an operation keeps before it is re-drawn into its tail: enough
 * to settle a progress bar's carriage returns without holding a transcript. */
const OPERATION_RAW_BYTES = 4 * AGENT_OPERATION_OUTPUT_BYTES;

function emptyDistributionRecord(now: () => Date): AgentDistributionRecord {
  return { format: AGENT_DISTRIBUTION_FORMAT, providers: {}, updatedAt: now().toISOString() };
}

/** `machine/agents/distribution.json` (AR-D16): read tolerantly by anyone,
 * written by ONE writer at a time under the root lock (R6), published
 * atomically. Reads re-read the file every time — a resident fieldd's
 * "refresh" is simply the next read; no watcher is needed to be current. */
export class DistributionRecordStore {
  constructor(private readonly opts: { rootReal: string; now: () => Date; logger: Logger }) {}

  path(): string {
    return join(this.opts.rootReal, ...LAYOUT.MACHINE_DISTRIBUTION_FILE);
  }

  updatesDir(): string {
    return join(this.opts.rootReal, ...LAYOUT.MACHINE_UPDATES_DIR);
  }

  read(): AgentDistributionRecord {
    let text: string;
    try {
      text = readFileSync(this.path(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptyDistributionRecord(this.opts.now);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = AgentDistributionRecordSchema.safeParse(parsed);
    if (record.success) return record.data;
    const aside = `${this.path()}.unreadable-${Date.now()}`;
    this.opts.logger.error(
      "fieldd.agents.distribution_unreadable",
      "Distribution record is unreadable; set aside, starting from an empty record",
      undefined,
      { aside, issue: record.error.issues[0]?.message ?? "invalid json" },
    );
    try {
      renameSync(this.path(), aside);
    } catch {
      // the next publish overwrites it
    }
    return emptyDistributionRecord(this.opts.now);
  }

  /** Read-modify-write under the root lock. `fn` returns whether it changed
   * anything; unchanged records are not rewritten. */
  async mutate(
    fn: (record: AgentDistributionRecord) => boolean,
  ): Promise<{ changed: boolean; record: AgentDistributionRecord }> {
    return await withUsersLock(this.opts.rootReal, "mutate", {}, () => {
      const record = this.read();
      const changed = fn(record);
      if (changed) {
        record.updatedAt = this.opts.now().toISOString();
        this.publish(record);
      }
      return { changed, record };
    });
  }

  private publish(record: AgentDistributionRecord): void {
    mkdirSync(dirname(this.path()), { recursive: true, mode: 0o700 });
    const tmp = `${this.path()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    durableRenameSync(tmp, this.path());
  }
}

/** Reveal a path in the OS file manager — the shell provider's internal door,
 * late-bound (the daemon builds this service before its api). */
export type RevealPath = (path: string) => Promise<void>;

export interface AgentDistributionServiceOptions {
  runtime: AgentRuntime;
  /** the machine record; null = no machine scope (no VibeField root above the user root) */
  store: DistributionRecordStore | null;
  /** null = no shell provider is registered (a headless or unit daemon) */
  revealPath: () => RevealPath | null;
  now: () => Date;
  logger: Logger;
}

interface OperationEntry {
  provider: string;
  kind: string;
  state: AgentOperation["state"];
  startedAt: string;
  finishedAt?: string;
  /** ANSI-stripped output, capped at OPERATION_RAW_BYTES from the end */
  raw: string;
  dropped: boolean;
  receipt?: AgentUpdateReceipt;
}

/** The `agents.*` distribution doors' service. Auditing is the caller's (the
 * daemon wraps `update` and `setActive` in `audit.required`). */
export class AgentDistributionService {
  private readonly operations = new Map<string, OperationEntry>();
  private readonly listeners = new Set<(snapshot: AgentsOperationsResult) => void>();
  private tick: NodeJS.Timeout | null = null;

  constructor(private readonly opts: AgentDistributionServiceOptions) {}

  /** Whether the doors that write the machine scope can. */
  hasMachineScope(): boolean {
    return this.opts.store !== null;
  }

  /** A FRESH inspection (the vendor's version command runs per candidate) with
   * the machine record's choice folded over puppeteer's own `active`, and what
   * Update would run for each install — named before anyone presses it. */
  async installs(provider?: string): Promise<AgentsInstallsResult> {
    const installations = await this.opts.runtime.inspectInstallations({
      ...(provider !== undefined ? { providerId: provider } : {}),
      refresh: true,
    });
    const plans = await Promise.all(
      installations.map((install) => this.plan(install.provider, install.executable)),
    );
    const installs = projectInstalls(installations, this.opts.store?.read()).map(
      (install, index) => {
        const plan = plans[index];
        return plan === undefined ? install : { ...install, update: plan };
      },
    );
    return { installs, machineScope: this.hasMachineScope() };
  }

  /** The agent's own oracle always; the declared network detectors only when
   * this call or the provider's recorded preference says so. A check that
   * consulted anything is KEPT in the machine record; `cached: true` runs
   * nothing and answers that record, re-judged against today's installs. */
  async releases(params: AgentsReleasesParams): Promise<AgentsReleasesResult> {
    const known = new Map(this.opts.runtime.distributionProviders().map((p) => [p.id, p]));
    const providers = params.provider !== undefined ? [params.provider] : [...known.keys()];
    if (params.cached === true) return await this.cachedReleases(providers);

    const record = this.opts.store?.read();
    const checks = await Promise.all(
      providers.map(async (providerId) => {
        const network = params.network === true || record?.providers[providerId]?.network === true;
        const result = await this.opts.runtime.checkReleases({ providerId, network });
        // A check that asked nothing — no oracle, the network off — learned
        // nothing, and must not stand in the record as "checked, all current".
        const consulted = known.get(providerId)?.nativeUpdateCheck === true || network;
        return { result, keep: known.has(providerId) && consulted };
      }),
    );
    const kept = checks.filter((check) => check.keep).map((check) => check.result);
    if (this.opts.store !== null && kept.length > 0) {
      try {
        await this.opts.store.mutate((r) => {
          for (const result of kept) {
            r.providers[result.provider] = {
              ...r.providers[result.provider],
              lastCheckedAt: result.checkedAt,
              lastReleases: releaseRows(result),
            };
          }
          return true;
        });
      } catch (error) {
        // The answer stands; only its keeping failed. Say so, never throw it.
        this.opts.logger.warn(
          "fieldd.agents.release_record_failed",
          "A release check could not be kept in the machine record",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    const results = checks.map((check) => check.result);
    return {
      releases: results.flatMap(releaseRows),
      available: results.flatMap((result) =>
        result.available === undefined ? [] : [{ provider: result.provider, ...result.available }],
      ),
      checked: kept.map((result) => ({ provider: result.provider, at: result.checkedAt })),
    };
  }

  /** The vendor's own updater, its output published as it runs, then the
   * receipt into the machine record. The root lock is held for the record's
   * read-modify-write only, never across the updater (minutes): the lock is
   * the users file's, shared by every fieldd on this device. One update per
   * provider at a time — a second is a CONFLICT, never a race of two updaters. */
  async update(provider: string): Promise<AgentsUpdateResult> {
    const store = this.requireMachineScope();
    if (this.operations.get(provider)?.state === "running") {
      throw new RpcCallError("CONFLICT", `an update of ${provider} is already running`, true, {
        provider,
      });
    }
    const operation: OperationEntry = {
      provider,
      kind: "update",
      state: "running",
      startedAt: this.opts.now().toISOString(),
      raw: "",
      dropped: false,
    };
    this.operations.set(provider, operation);
    this.publish();
    let receipt: UpdateReceipt;
    try {
      receipt = await this.opts.runtime.updateInstallation({
        providerId: provider,
        onOutput: (chunk) => {
          appendOutput(operation, chunk);
          this.publish();
        },
      });
    } catch (error) {
      this.finish(operation);
      throw error;
    }
    const projected = projectReceipt(receipt);
    try {
      await store.mutate((record) => {
        record.providers[provider] = { ...record.providers[provider], lastUpdate: receipt };
        return true;
      });
    } finally {
      this.finish(operation, projected);
    }
    this.opts.logger.info("fieldd.agents.updated", "Agent update ran", {
      provider,
      status: receipt.status,
      ...(receipt.exitCode !== undefined ? { exitCode: receipt.exitCode } : {}),
    });
    return { receipt: projected };
  }

  /** Record which of the provider's installs new spawns use (from the next
   * boot: the runtime binds it at construction). */
  async setActive(params: AgentsSetActiveParams): Promise<AgentsSetActiveResult> {
    const store = this.requireMachineScope();
    const installations = await this.opts.runtime.inspectInstallations({
      providerId: params.provider,
      refresh: true,
    });
    const chosen = installations.find(
      (i) => i.executable === params.executable || i.realPath === params.executable,
    );
    if (chosen === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `no ${params.provider} install at ${params.executable}`,
        false,
        { provider: params.provider, executable: params.executable },
      );
    }
    const { changed, record } = await store.mutate((r) => {
      const current = r.providers[params.provider];
      if (current?.activeExecutable === chosen.executable) return false;
      r.providers[params.provider] = { ...current, activeExecutable: chosen.executable };
      return true;
    });
    return { changed, installs: projectInstalls(installations, record) };
  }

  /** Show one of a provider's installs in the OS file manager — a path THIS
   * daemon inventoried, never one a caller spelled. */
  async reveal(params: AgentsRevealParams): Promise<AgentsRevealResult> {
    const installations = await this.opts.runtime.inspectInstallations({
      providerId: params.provider,
    });
    const install = installations.find(
      (i) => i.executable === params.executable || i.realPath === params.executable,
    );
    if (install === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `no ${params.provider} install at ${params.executable}`,
        false,
        { provider: params.provider, executable: params.executable },
      );
    }
    const reveal = this.opts.revealPath();
    if (reveal === null) {
      throw new RpcCallError("UNAVAILABLE", "no desktop shell is attached to reveal a path", true, {
        service: "shell",
        state: "no-shell-provider",
      });
    }
    // The file the row shows (the launcher a PATH resolves), else the file that runs.
    await reveal(isAbsolute(install.executable) ? install.executable : install.realPath);
    return { revealed: true };
  }

  /** The running and last-finished operation per provider. */
  operationsSnapshot(): AgentsOperationsResult {
    return { operations: [...this.operations.values()].map(projectOperation) };
  }

  /** Whole snapshots, coalesced to the tick. */
  subscribeOperations(listener: (snapshot: AgentsOperationsResult) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.tick !== null) clearTimeout(this.tick);
    this.tick = null;
    this.listeners.clear();
  }

  private async cachedReleases(providers: readonly string[]): Promise<AgentsReleasesResult> {
    const record = this.opts.store?.read();
    if (record === undefined) return { releases: [], available: [], checked: [] };
    // The inventory as puppeteer holds it (no version commands run): enough to
    // re-judge a kept check against an install an update has since moved.
    const installations = await this.opts.runtime.inspectInstallations({});
    const installs = projectInstalls(installations, record);
    const releases: AgentsReleasesResult["releases"] = [];
    const available: AgentAvailableUpdate[] = [];
    const checked: { provider: string; at: string }[] = [];
    for (const provider of providers) {
      const entry = record.providers[provider];
      if (entry?.lastCheckedAt === undefined) continue;
      checked.push({ provider, at: entry.lastCheckedAt });
      const rows = entry.lastReleases ?? [];
      releases.push(...rows);
      const active = installs.find((install) => install.provider === provider && install.active);
      if (active === undefined) continue;
      const update = availableUpdate(rows.filter(isChanneledRelease), {
        ...(active.version !== undefined ? { version: active.version } : {}),
        ...(active.releaseChannel === "stable" || active.releaseChannel === "preview"
          ? { releaseChannel: active.releaseChannel }
          : {}),
      });
      if (update !== undefined) available.push({ provider, ...update });
    }
    return { releases, available, checked };
  }

  /** What Update would run for one install; undefined when no plan could be
   * formed (the adapter's failure is logged, never guessed over). */
  private async plan(provider: string, executable: string): Promise<AgentUpdatePlan | undefined> {
    let outcome: UpdatePlan | DistributionFailure;
    try {
      outcome = await this.opts.runtime.planUpdate({ providerId: provider, executable });
    } catch (error) {
      this.opts.logger.warn("fieldd.agents.update_plan_failed", "An update plan threw", {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    if ("status" in outcome) return undefined;
    const { recipe } = outcome;
    return {
      kind: recipe.kind,
      ...(outcome.argv !== undefined ? { command: outcome.argv } : {}),
      ...(recipe.kind === "manual" ? { instructions: recipe.instructions } : {}),
    };
  }

  private finish(operation: OperationEntry, receipt?: AgentUpdateReceipt): void {
    operation.state = "finished";
    operation.finishedAt = this.opts.now().toISOString();
    if (receipt !== undefined) operation.receipt = receipt;
    this.publish();
  }

  private publish(): void {
    if (this.tick !== null || this.listeners.size === 0) return;
    this.tick = setTimeout(() => {
      this.tick = null;
      const snapshot = this.operationsSnapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          this.opts.logger.warn(
            "fieldd.agents.operations_frame_failed",
            "An operations subscriber's frame failed",
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      }
    }, OPERATIONS_TICK_MS);
    this.tick.unref?.();
  }

  private requireMachineScope(): DistributionRecordStore {
    if (this.opts.store === null) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "this daemon has no machine scope (no VibeField root above its user root); agent distribution is read-only here",
        false,
        { service: "agents", state: "no-machine-scope" },
      );
    }
    return this.opts.store;
  }
}

/** Per provider: the record's choice when it names one of the installs, else
 * puppeteer's own resolution. */
export function projectInstalls(
  installations: readonly AgentInstallation[],
  record: AgentDistributionRecord | undefined,
): AgentInstall[] {
  const chosen = new Map<string, string>();
  for (const install of installations) {
    const active = record?.providers[install.provider]?.activeExecutable;
    if (active !== undefined && (install.executable === active || install.realPath === active))
      chosen.set(install.provider, install.realPath);
  }
  return installations.map((install) => ({
    ...install,
    active: chosen.has(install.provider)
      ? chosen.get(install.provider) === install.realPath
      : install.active,
  }));
}

/** The contract's receipt: the outcome, never the transcript path or the
 * before/after inspections (those stay in the machine record). */
export function projectReceipt(receipt: UpdateReceipt): AgentUpdateReceipt {
  return {
    provider: receipt.provider,
    status: receipt.status,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    ...(receipt.exitCode !== undefined ? { exitCode: receipt.exitCode } : {}),
    ...(receipt.message !== undefined ? { message: receipt.message } : {}),
  };
}

function releaseRows(result: ReleaseCheckResult): Array<AgentRelease | AgentReleaseFailure> {
  return [
    ...result.releases.map((release: ReleaseSnapshot) => ({ ...release })),
    ...result.failures.map((failure: DistributionFailure) => ({ ...failure })),
  ];
}

function isChanneledRelease(
  row: AgentRelease | AgentReleaseFailure,
): row is AgentRelease & { channel: "stable" | "preview" } {
  return "version" in row && (row.channel === "stable" || row.channel === "preview");
}

function projectOperation(operation: OperationEntry): AgentOperation {
  const { output, truncated } = displayTail(operation.raw, operation.dropped);
  return {
    provider: operation.provider,
    kind: operation.kind,
    state: operation.state,
    startedAt: operation.startedAt,
    ...(operation.finishedAt !== undefined ? { finishedAt: operation.finishedAt } : {}),
    output,
    truncated,
    ...(operation.receipt !== undefined ? { receipt: operation.receipt } : {}),
  };
}

// ── the output as a person reads it ──
//
// A vendor updater writes for a terminal: colour escapes, cursor moves, and
// progress bars redrawn in place with carriage returns. The panel is plain
// text, so the escapes go and each line keeps what a terminal would have left
// on it. This is DISPLAY — nothing reads meaning from it (RFC 006).

// ESC-introduced sequences: CSI (colour, cursor), OSC (titles, links; BEL- or
// ST-terminated), and the two-byte escapes; then any other control byte
// except the three a text panel keeps.
const ESCAPES =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal control bytes is the point
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal control bytes is the point
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripTerminalControls(chunk: string): string {
  return chunk.replace(ESCAPES, "").replace(CONTROLS, "");
}

function appendOutput(operation: OperationEntry, chunk: string): void {
  operation.raw += stripTerminalControls(chunk);
  if (operation.raw.length > OPERATION_RAW_BYTES) {
    operation.raw = operation.raw.slice(operation.raw.length - OPERATION_RAW_BYTES);
    operation.dropped = true;
  }
}

/** Each line as a terminal would have left it after its carriage returns (a
 * redraw keeps the last non-empty draw), then the last
 * `AGENT_OPERATION_OUTPUT_BYTES` of it. */
export function displayTail(raw: string, dropped = false): { output: string; truncated: boolean } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const drawn = lines.map((line) => {
    if (!line.includes("\r")) return line;
    const draws = line.split("\r").filter((draw) => draw.length > 0);
    return draws.at(-1) ?? "";
  });
  let output = drawn.join("\n");
  let truncated = dropped;
  if (output.length > AGENT_OPERATION_OUTPUT_BYTES) {
    output = output.slice(output.length - AGENT_OPERATION_OUTPUT_BYTES);
    const firstBreak = output.indexOf("\n");
    // never start on half a line
    if (firstBreak !== -1) output = output.slice(firstBreak + 1);
    truncated = true;
  }
  return { output, truncated };
}
