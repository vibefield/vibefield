import type { AgentCapability, AgentCatalogEntry, AgentCatalogReaders } from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// AC-3 — the catalog's word on an id before a door acts, shared by every agent
// service (the runtime, the profiles, the distribution): the same refusal, the
// same details, wherever the door lives. thinking-ar-agent-catalog.md §5.2.

/** A door that STARTS something needs the capability offered: no row is
 * NOT_FOUND (no such agent here); a row that does not offer it is
 * PRECONDITION_FAILED `{reason: "unsupported-agent", status, capability}`. */
export function requireOffered(
  catalog: AgentCatalogReaders,
  provider: string,
  capability: AgentCapability,
): AgentCatalogEntry {
  const row = catalog.entry(provider);
  if (row === undefined) {
    throw new RpcCallError("NOT_FOUND", `no agent ${provider} in the catalog`, false, {
      provider,
      reason: "unsupported-agent",
    });
  }
  if (!catalog.isOffered(provider, capability)) {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      `${row.label} is ${row.status} here and does not offer ${capability}`,
      false,
      { provider, reason: "unsupported-agent", status: row.status, capability },
    );
  }
  return row;
}

/** A door that CONTINUES something (a resume, a login) needs the agent
 * visible, not offered: a deprecated agent's sessions still resume. */
export function requireVisible(catalog: AgentCatalogReaders, provider: string, act: string): void {
  if (catalog.isVisible(provider)) return;
  const row = catalog.entry(provider);
  throw new RpcCallError(
    "PRECONDITION_FAILED",
    `${row?.label ?? provider} is ${row?.status ?? "not in the catalog"} here; cannot ${act}`,
    false,
    { provider, reason: "unsupported-agent", status: row?.status ?? "no-row" },
  );
}
