import { type ReactElement, useEffect, useState } from "react";
import { AgentPageView, AgentsShelfView, agentSubpage } from "../panels/agents/AgentsView";
import type { SettingsSubpage } from "../panels/SettingsDialog";
import { type AgentsFixtureState, FIXTURE_AGENTS_NOW, fixtureAgentShelf } from "./agents-fixtures";

// The Agents settings section on fixture doors: the shipping shelf and agent
// page, one production state at a time. Acts are inert here except the way in
// and out of an agent's page, which the Settings header carries.

const inert = (): void => undefined;

export function AgentsSettingsPreview({
  state,
  onSubpage,
}: {
  state: AgentsFixtureState;
  onSubpage: (subpage: SettingsSubpage | null) => void;
}): ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  const items = fixtureAgentShelf(state);
  const item = open === null ? undefined : items.find((candidate) => candidate.provider === open);
  const label = item?.label;

  useEffect(() => {
    onSubpage(label === undefined ? null : agentSubpage(label, () => setOpen(null)));
  }, [label, onSubpage]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  if (item !== undefined) {
    return (
      <AgentPageView
        item={item}
        machineScope
        now={FIXTURE_AGENTS_NOW}
        onUpdate={inert}
        onReveal={inert}
      />
    );
  }
  return (
    <AgentsShelfView
      state={state === "loading" ? "loading" : state === "unavailable" ? "unavailable" : "ready"}
      items={items}
      unavailable={
        state === "unavailable"
          ? {
              title: "Agents aren't available",
              description:
                "The agents on this Mac couldn't be read — the daemon is starting up. Try again in a moment.",
              retry: true,
            }
          : null
      }
      machineScope
      checking={false}
      now={FIXTURE_AGENTS_NOW}
      onCheck={inert}
      onRescan={inert}
      onUpdate={inert}
      onOpen={setOpen}
    />
  );
}
