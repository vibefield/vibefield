import { AGENT_CATALOG, type AgentProviderSummary } from "@vibefield/contracts";
import { useEffect, useRef, useState } from "react";
import { canBeSpark, type NewSparkPort } from "./new-spark";

// THE NIGHT'S AGENTS (track ES; DESIGN.md §8 "Chat's list", Empty: the night; §7 Off; §9 Chat's words) — whether New
// spark is live on the night before the first spark. One reading with the sheet's (`sparkAgentsOf`): an agent installed
// here (`available`) that the catalog lets be a spark (`canBeSpark`, `offers.spark`). None here, and the night is Off:
// New spark off from the kit's own button, the sentence naming the agents that can, and Open Agents settings. While the
// agents are read, or where they could not be, New spark stays live — the sheet says why at its foot
// (`CANNOT_LIST_AGENTS`), never the night.

/** What the night knows of this device's agents. */
export type NightAgents =
  | { readonly state: "reading" }
  /** `here`: the agents installed here that can be a spark; `elsewhere`: the ones that can and are not here, named;
   * `providers`: the agents as read, which fill the starters (ES-4; absent on a still plate, whose starters keep their
   * ruled words) */
  | {
      readonly state: "read";
      readonly here: number;
      readonly elsewhere: readonly string[];
      readonly providers?: readonly AgentProviderSummary[] | undefined;
    }
  | { readonly state: "unread" };

/** The night's door: `agent.providers`, the sheet's own read. */
export type NightAgentsDoor = Pick<NewSparkPort, "providers">;

const READING: NightAgents = { state: "reading" };
const UNREAD: NightAgents = { state: "unread" };

/** `agent.providers` read for the night. Where fieldd lists no agent that can be a spark, the catalog's own spark rows
 * are named, so the sentence never stands empty. */
export function nightAgentsOf(providers: readonly AgentProviderSummary[]): NightAgents {
  const sparks = providers.filter(canBeSpark);
  const here = sparks.filter((provider) => provider.available).length;
  const elsewhere = sparks
    .filter((provider) => !provider.available)
    .map((provider) => provider.label);
  if (here === 0 && elsewhere.length === 0)
    return { state: "read", here, elsewhere: catalogSparkLabels() };
  return { state: "read", here, elsewhere };
}

/** The agents the night read, for the starters (ES-4): null while they are read, "failed" where they could not be (or
 * a still plate carries none). */
export function nightProviders(
  agents: NightAgents,
): readonly AgentProviderSummary[] | null | "failed" {
  if (agents.state === "reading") return null;
  if (agents.state === "unread") return "failed";
  return agents.providers ?? "failed";
}

/** Off (§7): the agents were read and none here can be a spark — the names of the ones that can, for the sentence;
 * null while the night is live. */
export function nightOffNames(agents: NightAgents): readonly string[] | null {
  return agents.state === "read" && agents.here === 0 ? agents.elsewhere : null;
}

/** §9's Off sentence: "A spark thinks with Claude Code, which isn't on this Mac yet."; with two, "Claude Code or
 * Codex, which aren't …"; with more, "Claude Code, Codex or Grok, which aren't …". */
export function offWords(names: readonly string[]): string {
  const which = names.length === 1 ? "which isn't" : "which aren't";
  return `A spark thinks with ${orWords(names)}, ${which} on this Mac yet.`;
}

/** The night's agents, read each time the night stands (`standing`: Chat is the view and holds no spark), and again
 * as the window takes focus back while it is Off: an agent installed meanwhile (after Open Agents settings, in a
 * terminal) turns New spark on. A reading stands until the next one lands, so the night never flickers back to
 * reading; with no door it is unread, and live. */
export function useNightAgents(door: NightAgentsDoor | undefined, standing: boolean): NightAgents {
  const [agents, setAgents] = useState<NightAgents>(READING);
  // read by the focus listener: whether a new reading could turn New spark on
  const offNow = useRef(false);
  offNow.current = nightOffNames(agents) !== null;
  useEffect(() => {
    if (!standing) return;
    if (door === undefined) {
      setAgents(UNREAD);
      return;
    }
    let live = true;
    const read = (): void => {
      void door.providers().then(
        (providers) => {
          if (!live) return;
          // the reading keeps the agents it read, for the starters (ES-4)
          const reading = nightAgentsOf(providers);
          setAgents(reading.state === "read" ? { ...reading, providers } : reading);
        },
        () => {
          if (live) setAgents(UNREAD);
        },
      );
    };
    read();
    const again = (): void => {
      if (offNow.current) read();
    };
    window.addEventListener("focus", again);
    return () => {
      live = false;
      window.removeEventListener("focus", again);
    };
  }, [door, standing]);
  return agents;
}

function orWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

function catalogSparkLabels(): string[] {
  return AGENT_CATALOG.filter((row) => row.offers.spark).map((row) => row.label);
}
