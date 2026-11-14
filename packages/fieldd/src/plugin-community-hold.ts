import type { RegistryListedAs } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { failureCode } from "./plugin-install";
import type { CommunityGate, CommunityVerdict, PluginRegistryService } from "./plugin-registry";

// The stop (MK-O3, O3-C, 2026-11-12; James's pick "Stop" on his docket, 2026-11-11 22:33:55Z, which
// the plugins page's store agrees with at 23:03:23Z; `mk-o3/PLAN-O3C.md`, accepted by VF-PM
// 08:31:12Z): community plugins off means none of their code runs. Each is held as if turned off;
// nothing is removed, and turning community plugins back on brings them back as they were.
//
// Two halves, both the daemon's:
//   - `communityGate`: the registry's gate, asked once per registry refresh (`plugin-registry.ts`):
//     allowed, or the held plugin list's lookup, read once. A read that fails is said by its reason
//     code alone and holds every plugin from the plugin list (VF-PM's ask 6).
//   - `CommunityHold`: what the hold does to code already running. It watches the registry's
//     `changed`, whichever road refreshed it (the switch, a plugin list read afresh, an install,
//     another desktop's act). A plugin newly held gets plugins.disable's teardown; one let go that
//     the person wants on starts fresh, as an enable does. Neither writes a record or publishes to
//     your other desktops: the hold is not the person's act on that plugin. Each move logs one
//     diagnostics line, never an audit row (VF-PM's ask 7).
//
// The row's `held` field decides nothing here: the registry's own set does (`isHeld`).

export interface CommunityGateDeps {
  /** whether community plugins may run now: the daemon's one read, shared with the installer's
   * gate */
  allowed: () => Promise<boolean>;
  /** the held plugin list's lookup, read and re-verified once (`plugin-catalog.ts`,
   * `listedAsLookup`) */
  listedAs: () => Promise<(id: string) => RegistryListedAs>;
  logger?: Logger;
}

/** The registry's gate. A read that fails is logged by its reason code, never its text, and thrown
 * on, so the registry holds every plugin from the plugin list for that refresh. */
export function communityGate(deps: CommunityGateDeps): CommunityGate {
  const log = (deps.logger ?? createNoopLogger()).child({ component: "plugin.community" });
  return async (): Promise<CommunityVerdict> => {
    try {
      if (await deps.allowed()) return { allowed: true };
      return { allowed: false, listedAs: await deps.listedAs() };
    } catch (error) {
      log.warn(
        "fieldd.plugin_registry.community_gate_failed",
        "Whether community plugins may run could not be read; every plugin from the plugin list is held",
        { reason: failureCode(error) },
      );
      throw error;
    }
  };
}

export interface CommunityHoldDeps {
  /** What the hold reads of the registry: its rows, its own held set, a refresh, and its `changed`.
   * `on` is named apart: an EventEmitter's `on` returns its own class, so a picked `on` would ask
   * for the whole registry. */
  plugins: Pick<PluginRegistryService, "list" | "isHeld" | "refresh"> & {
    on(event: "changed", listener: () => void): unknown;
  };
  /** the same read the gate makes; `switchMoved` refreshes only when its answer moved */
  allowed: () => Promise<boolean>;
  /** plugins.disable's teardown: the service stopped, tokens revoked, connections dropped, children
   * killed, endpoints and MCP withdrawn */
  teardown: (pluginId: string) => Promise<void>;
  /** a fresh start, as an enable's */
  restart: (pluginId: string) => void;
  logger?: Logger;
}

export class CommunityHold {
  private readonly log: Logger;
  /** the registry ids held as last seen; those held when it starts never ran code, so nothing is
   * torn down for them */
  private held: Set<string>;
  private acts: Promise<void> = Promise.resolve();
  private refreshes: Promise<void> = Promise.resolve();
  /** the last answer `switchMoved` read; null before the first, and after a read that failed */
  private allowedWas: boolean | null = null;

  constructor(private readonly deps: CommunityHoldDeps) {
    this.log = (deps.logger ?? createNoopLogger()).child({ component: "plugin.community" });
    this.held = this.heldNow();
    deps.plugins.on("changed", () => this.observe());
  }

  /** An app preference moved, here or on another desktop (the settings doc says `changed` for `app`
   * on every merge). The registry is read again only when the answer to "may community plugins run"
   * moved; the first call always reads, and so does one after a failed answer, whose refresh the
   * gate then holds closed. */
  async switchMoved(): Promise<void> {
    const now = await this.deps.allowed().catch(() => null);
    if (now !== null && now === this.allowedWas) return;
    this.allowedWas = now;
    await this.refresh();
  }

  /** The registry refreshed, one call at a time, so the gate is read again; what moved is acted on
   * as it lands. It never rejects: a refresh that fails is said by its reason code, and the rows
   * stand as they were. */
  refresh(): Promise<void> {
    const turn = this.refreshes.then(async () => {
      try {
        await this.deps.plugins.refresh();
      } catch (error) {
        this.log.warn(
          "fieldd.plugin_registry.community_refresh_failed",
          "The plugins could not be read again after community plugins changed; they stand as they were",
          { reason: failureCode(error) },
        );
      }
    });
    this.refreshes = turn;
    return turn;
  }

  /** Every act queued so far, done (the tests', and a caller that must wait for the teardown). */
  settled(): Promise<void> {
    return this.acts;
  }

  private heldNow(): Set<string> {
    const { plugins } = this.deps;
    return new Set(plugins.list().flatMap((row) => (plugins.isHeld(row.id) ? [row.id] : [])));
  }

  private observe(): void {
    const now = this.heldNow();
    const rows = new Map(this.deps.plugins.list().map((row) => [row.id, row] as const));
    for (const id of now) if (!this.held.has(id)) this.queue(id, true);
    for (const id of this.held)
      if (!now.has(id) && rows.get(id)?.enabled === true) this.queue(id, false);
    this.held = now;
  }

  private queue(pluginId: string, held: boolean): void {
    this.log.info(
      "fieldd.plugin_registry.community_hold",
      held
        ? "A community plugin is held while community plugins are off"
        : "A held plugin runs again",
      { pluginId, held },
    );
    this.acts = this.acts.then(async () => {
      try {
        if (held) await this.deps.teardown(pluginId);
        else this.deps.restart(pluginId);
      } catch (error) {
        this.log.warn(
          "fieldd.plugin_registry.community_hold_failed",
          "A community plugin's hold could not be carried out in full",
          { pluginId, held, reason: failureCode(error) },
        );
      }
    });
  }
}
