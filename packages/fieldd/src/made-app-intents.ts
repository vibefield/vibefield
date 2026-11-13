import { createHash } from "node:crypto";
import { type ArtifactMarkResult, MADE_APP_LIMITS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import type { SettingsDocService } from "./settings-doc";

// MA-3h — Keep, the short path (James, 2026-11-13 01:29:54Z: "agree"). The person's kept apps are rows of the
// settings document (design-06 §1; contracts' SETTINGS_DOC_SECTIONS.MADE_APPS_KEPT), which crosses every desktop of
// the account as settings do (DS-5b). A row's key is the fold key's sha256, never the fold key: a hosted fold key is a
// URL, and the document crosses every desktop. The same digest is the audit's target for a mark (and 64 lowercase hex
// is also a valid mille item id, should the drive's path come back: a1's answers, 2026-11-13).
//  - ONE object answers both injected readers: made-app-service's `MadeAppIntentReader` (`of`, `on`) and
//    index-apps-mesh's (`of`, `onChanged`). Each asks by the fold key it holds and hashes it here.
//  - It opens only once the settings document is read, so neither reader decides an idle close (or a fold) before this
//    boot knows who keeps what (A6, as Keep needs it).
//  - It tells its listeners only when the kept map moved: a local write, or a merge that changed it. Another section's
//    merge tells nothing.
//  - A write past MADE_APP_LIMITS.INTENTS is refused RESOURCE_EXHAUSTED, not retryable, and writes nothing (`full`
//    says so before the daemon audits). Stopping is never refused.
// Hide was dropped (James, 2026-11-13): nothing here hides an app, and an answer's `hidden` is always false.

/** A kept app's key in the settings document: the fold key's sha256, 64 lowercase hex. */
export function madeAppKeptKey(foldKey: string): string {
  return createHash("sha256").update(foldKey, "utf8").digest("hex");
}

/** A keep past MADE_APP_LIMITS.INTENTS: nothing is written, and nothing a retry changes until one is stopped. */
export function madeAppKeptFull(): RpcCallError {
  return new RpcCallError(
    "RESOURCE_EXHAUSTED",
    `at most ${MADE_APP_LIMITS.INTENTS} apps can be kept`,
    false,
    { limit: MADE_APP_LIMITS.INTENTS },
  );
}

export interface MadeAppKeptIntentsOptions {
  /** the writer's clock, epoch ms (a test seam) */
  now?: () => number;
  logger?: Logger;
}

export class MadeAppKeptIntents {
  readonly #settings: SettingsDocService;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #listeners = new Set<() => void>();
  readonly #onSettings = (event: { section: string }): void => {
    if (event.section === "madeApps") this.#refresh();
  };
  #kept = new Map<string, number>();

  private constructor(settings: SettingsDocService, options: MadeAppKeptIntentsOptions) {
    this.#settings = settings;
    this.#now = options.now ?? Date.now;
    this.#log = options.logger ?? createNoopLogger();
  }

  /** Read the settings document first, then listen to it. */
  static async open(
    settings: SettingsDocService,
    options: MadeAppKeptIntentsOptions = {},
  ): Promise<MadeAppKeptIntents> {
    const intents = new MadeAppKeptIntents(settings, options);
    intents.#kept = await settings.keptApps();
    settings.on("changed", intents.#onSettings);
    return intents;
  }

  /** The merged intent for one fold key: kept, or none. */
  of(foldKey: string): { kept: true } | undefined {
    return this.#kept.has(madeAppKeptKey(foldKey)) ? { kept: true } : undefined;
  }

  /** made-app-service's reader: called whenever the kept apps moved. */
  on(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** index-apps-mesh's reader: the same listeners. */
  onChanged(listener: () => void): () => void {
    return this.on(listener);
  }

  /** Whether a mark would be refused by the bound: a new keep past MADE_APP_LIMITS.INTENTS. */
  full(foldKey: string, kept: boolean): boolean {
    if (!kept || this.#kept.has(madeAppKeptKey(foldKey))) return false;
    return this.#kept.size >= MADE_APP_LIMITS.INTENTS;
  }

  /** Keep an app, or stop keeping it, in this desktop's replica: the answer once the write is made. */
  async mark(foldKey: string, kept: boolean, by: string): Promise<ArtifactMarkResult> {
    const written = await this.#settings.setKept(madeAppKeptKey(foldKey), kept, this.#now(), by);
    if (written === "full") throw madeAppKeptFull();
    this.#refresh();
    return { foldKey, kept, hidden: false };
  }

  dispose(): void {
    this.#settings.off("changed", this.#onSettings);
    this.#listeners.clear();
  }

  #refresh(): void {
    const next = this.#settings.keptAppsNow();
    if (next.size === this.#kept.size && [...next.keys()].every((key) => this.#kept.has(key))) {
      return;
    }
    this.#kept = next;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        this.#log.warn("fieldd.made_apps.kept_listener_failed", "A kept-apps listener threw", {
          error: error instanceof Error ? error.name : String(error),
        });
      }
    }
  }
}
