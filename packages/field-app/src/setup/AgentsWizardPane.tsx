import { AgentCatalogResult } from "@vibefield/contracts/agent-catalog";
import { AgentsInstallsResult } from "@vibefield/contracts/agent-index";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { type AgentsInventory, AgentsWizardPaneView } from "./AgentsPaneView";
import { agentsPaneModel } from "./agents-pane";
import { answerSetupStep } from "./ledger";

// The Agents pane on the Setup Assistant's glass (track AO, AO-5; DESIGN.md §8
// "The Setup Assistant's agent chapter" — Agents). It opens on the inventory
// fieldd read at boot (`agents.installs`) joined with the catalog, so most
// people see their agents at once and press Continue. Continue records the
// step: answered when an agent is on this Mac, put off when none is (Get, with
// AO-7, is where a first one comes from); before the inventory answers it moves
// on and records nothing, as History's pane does.

/** How the pane ended: an answer recorded, or nothing known to record. */
export type AgentsPaneEnd = "answered" | "later" | "skipped";

const ASK_EVERY_MS = 1_000;
const GIVE_UP_MS = 15_000;

/** The catalog and the inventory, asked again while fieldd starts, for a
 * bounded while; Look again reads the Mac afresh (`refresh` runs each agent's
 * own version command, which takes seconds). */
export function useAgentsInventory(client: FielddClient): {
  inventory: AgentsInventory;
  lookingAgain: boolean;
  lookAgain: () => void;
} {
  const [inventory, setInventory] = useState<AgentsInventory>({ kind: "looking" });
  const [lookingAgain, setLookingAgain] = useState(false);
  const alive = useRef(true);
  const read = useCallback(
    async (refresh: boolean): Promise<AgentsInventory> => {
      const [catalog, found] = await Promise.all([
        client.request("agent.catalog", {}).then((answer) => AgentCatalogResult.parse(answer)),
        client
          .request("agents.installs", refresh ? { refresh: true } : {})
          .then((answer) => AgentsInstallsResult.parse(answer)),
      ]);
      return { kind: "found", model: agentsPaneModel(catalog.catalog, found.installs) };
    },
    [client],
  );
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const ask = (): void => {
      read(false).then(
        (answer) => {
          if (alive.current) setInventory(answer);
        },
        () => {
          if (!alive.current) return;
          if (Date.now() - startedAt >= GIVE_UP_MS) {
            setInventory({ kind: "unavailable" });
            return;
          }
          timer = setTimeout(ask, ASK_EVERY_MS);
        },
      );
    };
    ask();
    return () => {
      alive.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [read]);
  const lookAgain = useCallback((): void => {
    setLookingAgain(true);
    read(true)
      .then(
        (answer) => {
          if (alive.current) setInventory(answer);
        },
        () => undefined,
      )
      .finally(() => {
        if (alive.current) setLookingAgain(false);
      });
  }, [read]);
  return { inventory, lookingAgain, lookAgain };
}

export function AgentsWizardPane({
  onDone,
  onBack,
}: {
  onDone: (end: AgentsPaneEnd) => void;
  onBack?: (() => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const { inventory, lookingAgain, lookAgain } = useAgentsInventory(client);
  const [moreOpen, setMoreOpen] = useState(false);
  // The pane ends once, however it ends.
  const ended = useRef(false);
  const onContinue = (): void => {
    if (ended.current) return;
    ended.current = true;
    if (inventory.kind !== "found") {
      onDone("skipped");
      return;
    }
    const end = inventory.model.first ? "later" : "answered";
    // a refused write is the ledger's loss, never the person's: the step still
    // lives in Settings → Agents
    void answerSetupStep(client, "agents", end).catch(() => undefined);
    onDone(end);
  };
  return (
    <AgentsWizardPaneView
      inventory={inventory}
      moreOpen={moreOpen}
      onToggleMore={() => setMoreOpen((open) => !open)}
      lookingAgain={lookingAgain}
      onLookAgain={lookAgain}
      onContinue={onContinue}
      onBack={onBack}
    />
  );
}
