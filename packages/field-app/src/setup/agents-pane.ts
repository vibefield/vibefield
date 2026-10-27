import type { AgentCatalogEntryWire } from "@vibefield/contracts/agent-catalog";
import type { AgentInstall } from "@vibefield/contracts/agent-index";

// The Agents pane, as the Setup Assistant draws it (track AO, AO-5; DESIGN.md §8
// "The Setup Assistant's agent chapter" — Agents). Pure: which agents are on
// this Mac and ready, which the catalog supports that this Mac does not have,
// and which wait behind More agents. Every label is the catalog's (AR-L1); no
// agent is named here, and the order is the catalog's own.

/** One agent as the pane lists it. */
export interface AgentsPaneRow {
  /** the catalog id — puppeteer's provider id, for its mark */
  readonly provider: string;
  /** the catalog's label */
  readonly label: string;
  readonly state: "ready" | "missing";
  /** a ready agent's version and how it updates ("2.1.270 · updates itself") */
  readonly fact?: string;
}

export interface AgentsPaneModel {
  /** nothing VibeField runs is on this Mac: the pane asks for a first agent */
  readonly first: boolean;
  /** the agents on this Mac, then the supported ones it does not have */
  readonly rows: readonly AgentsPaneRow[];
  /** the preview agents this Mac does not have, behind More agents */
  readonly more: readonly AgentsPaneRow[];
}

/** Statuses an installed agent is listed under (a deprecated agent stays seen). */
const LISTED = new Set(["supported", "preview", "deprecated"]);

/** Join the catalog with the inventory, in the catalog's order. An install no
 * listed desktop row names is not drawn (a declined row never leaves fieldd).
 * Only an agent VibeField installs and updates (`offers.distribution`) is
 * offered to a Mac that lacks it — a protocol is not an agent to get. */
export function agentsPaneModel(
  catalog: readonly AgentCatalogEntryWire[],
  installs: readonly AgentInstall[],
): AgentsPaneModel {
  const rows = catalog.filter((row) => row.surfaces.desktop && LISTED.has(row.status));
  const ready: AgentsPaneRow[] = [];
  const missing: AgentsPaneRow[] = [];
  const more: AgentsPaneRow[] = [];
  for (const row of rows) {
    const own = installs.filter((install) => install.provider === row.id);
    const install = own.find((candidate) => candidate.active) ?? own[0];
    if (install !== undefined) {
      const fact = installFact(install);
      ready.push({
        provider: row.id,
        label: row.label,
        state: "ready",
        ...(fact !== undefined ? { fact } : {}),
      });
      continue;
    }
    if (row.offers.distribution !== true) continue;
    const entry: AgentsPaneRow = { provider: row.id, label: row.label, state: "missing" };
    if (row.status === "supported") missing.push(entry);
    else if (row.status === "preview") more.push(entry);
  }
  return { first: ready.length === 0, rows: [...ready, ...missing], more };
}

/** "2.1.270 · updates itself": the version the inventory read, and how the
 * agent stays current, each only when it is known. */
export function installFact(install: AgentInstall): string | undefined {
  const parts = [install.version, howItUpdates(install)].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Who keeps an install current, in a person's words: the agent itself when
 * its own updater is on, else the recipe an update would run. */
const RECIPE_WORDS: Record<string, string> = {
  "native-self-update": "its own updater",
  "npm-global": "npm",
  brew: "Homebrew",
  "installer-script": "its install script",
};

export function howItUpdates(install: AgentInstall): string | undefined {
  if (install.autoUpdate === "enabled") return "updates itself";
  const kind = install.update?.kind ?? install.method;
  return RECIPE_WORDS[kind];
}
