import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import type {
  AgentModelCatalog,
  AgentModelsFailure,
  AgentModelsResult,
  AgentProfileSetId,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// PJ-6 (`draft/project-places/build-pj6.md`, Q1) — each agent's own model
// picker, as fieldd last read it, per agent and Agent Profile. The lists are
// the agent's own (puppeteer's `runtime.discoverModels`: Claude's stream-json
// `initialize`, Codex's `model/list`, …), never a table of ours; a read takes
// 0.2–3.2 s, so a launch menu opens on the catalog held here at once and a
// read runs behind it when that one is old. A failed read is held as its
// failure, in puppeteer's words — never as an empty list — beside the last
// catalog a read did find.
//
// In memory, per fieldd run: a restart reads again at the first ask, which
// waits for it. (Persisting the catalogs would open a restarted desktop's menu
// at once; it is not built — the lead's call.)

/** A read's deadline, puppeteer's own bound (`discoverModels`' `timeoutMs`;
 * its default too): the agent's startup included. */
export const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;
/** A held catalog this young is answered without a read behind it: a menu
 * opened twice in a minute starts one agent CLI, not two. A held FAILURE is
 * always read again behind its answer (a sign-in may have happened since). */
export const MODEL_CATALOG_FRESH_MS = 60_000;

type Discover = AgentRuntime["discoverModels"];

interface Held {
  catalog?: AgentModelCatalog | undefined;
  failure?: AgentModelsFailure | undefined;
  /** epoch ms the last read ended */
  readAt?: number | undefined;
  /** the read running now, which every ask in its time joins */
  reading?: Promise<void> | undefined;
}

export interface AgentModelCatalogsOptions {
  discover: Discover;
  now?: () => number;
  timeoutMs?: number;
  freshMs?: number;
  logger?: Logger;
}

export interface AgentModelsAsk {
  provider: string;
  profileSet?: AgentProfileSetId | undefined;
  /** the folder the read runs in (resolved by the caller) */
  cwd: string;
  refresh?: boolean | undefined;
}

export class AgentModelCatalogs {
  readonly #opts: AgentModelCatalogsOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  /** `provider \0 profileSet` (an empty set: the default profile, as a spawn names none) */
  readonly #held = new Map<string, Held>();

  constructor(opts: AgentModelCatalogsOptions) {
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "agent_models" });
    this.#now = opts.now ?? Date.now;
  }

  /** The held catalog for the ask's agent and profile, at once — a read runs
   * behind it when it is old or failed. With nothing held yet, or
   * `refresh`, the answer waits for a read (bounded by its deadline). */
  async read(ask: AgentModelsAsk): Promise<AgentModelsResult> {
    const key = `${ask.provider}\u0000${ask.profileSet ?? ""}`;
    let held = this.#held.get(key);
    if (held === undefined) {
      held = {};
      this.#held.set(key, held);
    }
    const empty = held.catalog === undefined && held.failure === undefined;
    if (ask.refresh === true || empty) {
      await this.#refresh(held, ask);
    } else if (
      held.failure !== undefined ||
      held.readAt === undefined ||
      this.#now() - held.readAt >= (this.#opts.freshMs ?? MODEL_CATALOG_FRESH_MS)
    ) {
      void this.#refresh(held, ask).catch((error: unknown) => {
        this.#logger.warn("fieldd.agents.models_read_failed", "A model picker read failed", {
          provider: ask.provider,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      });
    }
    return {
      provider: ask.provider,
      ...(ask.profileSet !== undefined ? { profileSet: ask.profileSet } : {}),
      ...(held.catalog !== undefined ? { catalog: held.catalog } : {}),
      ...(held.failure !== undefined ? { failure: held.failure } : {}),
      refreshing: held.reading !== undefined,
    };
  }

  /** One read for this agent and profile; an ask while one runs joins it. */
  #refresh(held: Held, ask: AgentModelsAsk): Promise<void> {
    if (held.reading !== undefined) return held.reading;
    const reading = this.#opts
      .discover({
        agent: ask.provider,
        cwd: ask.cwd,
        ...(ask.profileSet !== undefined ? { profileSet: ask.profileSet } : {}),
        timeoutMs: this.#opts.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS,
      })
      .then((result) => {
        const at = this.#now();
        held.readAt = at;
        if (result.status === "available") {
          held.catalog = result.catalog;
          held.failure = undefined;
        } else {
          held.failure = {
            status: result.status,
            code: result.code,
            message: result.message,
            at: new Date(at).toISOString(),
          };
        }
      })
      .finally(() => {
        held.reading = undefined;
      });
    held.reading = reading;
    return reading;
  }
}
