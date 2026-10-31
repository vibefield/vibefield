import {
  AGENT_CATALOG,
  type AgentModelControl,
  type AgentModelSelection,
  type AgentModelsResult,
  type AgentProfileSet,
  type AgentProviderSummary,
  type SparkSummary,
} from "@vibefield/contracts";
import type { NewSparkSheetViewProps } from "../chat/NewSparkSheetView";
import {
  agentLine,
  agentMenuOf,
  effortOf,
  type NewSparkPort,
  profileChipsOf,
  reachOf,
  refusalOf,
  sparkAgentsOf,
  startsOf,
} from "../chat/new-spark";
import { FIXTURE_NOW } from "./chat-fixtures";
import { FIXTURE_NATIVE, FIXTURE_WORK } from "./profiles-fixtures";

// The New spark sheet on fixtures (SP-1c; docs/UI_SYSTEM.md): what fieldd would answer the sheet — the agents it
// offers, the Agent Profiles, an agent's picker, a hatch — behind the product's own port (`NewSparkPort`), and the
// sheet's still states read through the product's own helpers (`chat/new-spark.ts`). The catalog's first three agents
// stand in, never a literal id (R23b): the first takes VibeField's tools, the second declares the briefing with a
// process the door cannot name, and the third declares none.

export const NEW_SPARK_STATES = ["live", "menu", "profiles", "taken"] as const;
export type NewSparkState = (typeof NEW_SPARK_STATES)[number];

export const NEW_SPARK_STATE_LABEL: Record<NewSparkState, string> = {
  live: "Live",
  menu: "Agent menu",
  profiles: "Profiles",
  taken: "Name taken",
};

/** The face the still plates are dealt, so a plate draws the same star every time. */
export const FIXTURE_SEED = 0x2f6a91c3;

const THINKER = AGENT_CATALOG[0];

const PROVIDERS: AgentProviderSummary[] = [
  {
    id: THINKER.id,
    label: THINKER.label,
    available: true,
    resumable: true,
    personas: [],
    briefing: {
      mcpServers: true,
      allowTools: true,
      instructions: true,
      mcpServerProcess: "terminal",
    },
  },
  {
    id: AGENT_CATALOG[1].id,
    label: AGENT_CATALOG[1].label,
    available: true,
    resumable: true,
    personas: [],
    briefing: {
      mcpServers: true,
      allowTools: true,
      instructions: true,
      mcpServerProcess: "app-server",
    },
  },
  {
    id: AGENT_CATALOG[2].id,
    label: AGENT_CATALOG[2].label,
    available: true,
    resumable: false,
    personas: [],
  },
];

const EFFORT: AgentModelControl = {
  id: "effort",
  label: "Effort",
  role: "effort",
  values: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  defaultValue: "medium",
};

function modelsOf(provider: string, profileSet: string): AgentModelsResult {
  return {
    provider,
    profileSet,
    catalog: {
      provider,
      cwd: "/fixture",
      observedAt: new Date(FIXTURE_NOW - 4 * 60_000).toISOString(),
      source: { kind: "native-protocol", freshness: "live" },
      completeness: "complete",
      customModels: false,
      models: [
        { id: "deep", label: "Deep", description: "For the long, hard ones", controls: [EFFORT] },
        { id: "quick", label: "Quick", description: "For the small things", controls: [EFFORT] },
      ],
    },
    refreshing: false,
  };
}

/** The sheet's doors on fixtures: This Mac alone, or This Mac and Work; a hatch that lands, or one a name refuses. */
export function newSparkFixturePort({
  sets = [FIXTURE_NATIVE],
  refuse,
}: {
  sets?: readonly AgentProfileSet[];
  refuse?: "name-taken";
} = {}): NewSparkPort {
  return {
    providers: async () => PROVIDERS,
    profileSets: async () => sets,
    models: async (provider, profileSet) => modelsOf(provider, profileSet),
    hatch: async (params) => {
      await new Promise((settle) => setTimeout(settle, 600));
      if (refuse !== undefined)
        throw Object.assign(new Error(`${params.name} is taken`), { details: { reason: refuse } });
      const at = new Date(FIXTURE_NOW).toISOString();
      const slug = params.name.toLowerCase().replace(/[^0-9a-z]/g, "");
      const spark: SparkSummary = {
        id: `sp-${slug.padEnd(6, "0").slice(0, 32)}`,
        name: params.name,
        face: { seed: params.face.seed },
        agent: params.agent,
        ...(params.modelSelection === undefined ? {} : { modelSelection: params.modelSelection }),
        profiles: [...params.profiles],
        thinksUnder: params.thinksUnder,
        folder: `/fixture/sparks/${params.name.toLowerCase()}`,
        createdAt: at,
        updatedAt: at,
      };
      return spark;
    },
  };
}

/** A still plate: the shipping view's props, made by the product's own readings of the fixtures. */
export function newSparkPlateOf(state: Exclude<NewSparkState, "live">): NewSparkSheetViewProps {
  const agents = sparkAgentsOf(PROVIDERS);
  const thinker = agents[0];
  const base: NewSparkSheetViewProps = {
    name: "Polaris",
    seed: FIXTURE_SEED,
    play: 1,
    agentId: THINKER.id,
    agentLine: agentLine(thinker, undefined, undefined),
    menuOpen: false,
    menu: [],
    refusal: null,
    creating: false,
  };
  if (state === "menu") {
    const answer = modelsOf(THINKER.id, FIXTURE_NATIVE.id);
    const selection: AgentModelSelection = { modelId: "deep", controls: { effort: "high" } };
    const model = answer.catalog?.models.find((choice) => choice.id === selection.modelId);
    return {
      ...base,
      agentLine: agentLine(thinker, model, selection),
      menuOpen: true,
      menu: agentMenuOf(agents, THINKER.id, { state: "read", answer }, selection),
      effort: effortOf(model, selection),
    };
  }
  if (state === "profiles") {
    const sets = [FIXTURE_NATIVE, FIXTURE_WORK];
    const chosen = [FIXTURE_NATIVE.id, FIXTURE_WORK.id];
    return {
      ...base,
      profileLabel: FIXTURE_NATIVE.label,
      profiles: {
        chips: profileChipsOf(sets, chosen, FIXTURE_NATIVE.id),
        reach: reachOf(3, startsOf(sets, chosen, FIXTURE_NATIVE.id, agents)),
      },
    };
  }
  const taken = Object.assign(new Error("Vela is taken"), { details: { reason: "name-taken" } });
  return { ...base, name: "Vela", refusal: refusalOf(taken, { name: "Vela" }) };
}
