import type {
  AgentModelChoice,
  AgentModelControl,
  AgentModelSelection,
  AgentModelsResult,
  AgentProfileSet,
  AgentProviderSummary,
  ProjectRecipe,
} from "@vibefield/contracts";
import type { RoomMenuGroup, RoomMenuItem } from "@vibefield/rosetta-room";

// HISTORY'S NEW AGENT, ITS WAYS TO START (PJ-6d; `build-pj6.md` Q1–Q3, Q7;
// DESIGN.md §8 "History", New agent). After "Starts in", the rows say HOW: the
// project's recipe first (the last launch's agent, model, effort and Agent
// Profile, PJ-D13), then each agent under each Agent Profile it can run in at
// its own model and effort (Q2), each with "Another model…" beside it, which
// turns the rows to that agent's and profile's MODELS — the agent's own picker
// as fieldd last read it (`agent.models`, Q1) — and a model with controls to
// its values (Q3: the effort the project last chose for that model checked).
//
// Every id here is the agent's own and opaque (AR-L1): a model id and a
// control id are carried from the catalog to `agent.spawn` and compared only
// to each other, never to a word of ours; labels come from the agent catalog
// (`agent.providers`) and the picker. Pure: the rows are a function of the
// page, the model and what the controller holds; the controller turns pages
// (`HistoryHostActs.page`) and starts (`newAgent`).

/** Where New agent's rows are: the first page, or a page Another… turned to,
 * for the project and folder it was turned in (a page for another folder is
 * read as the first page). */
export type LaunchPage =
  | { readonly kind: "home" }
  | {
      readonly kind: "models";
      readonly project: string;
      readonly folder: string | null;
      readonly provider: string;
      readonly profileSet: string;
    }
  | {
      readonly kind: "controls";
      readonly project: string;
      readonly folder: string | null;
      readonly provider: string;
      readonly profileSet: string;
      readonly modelId: string;
      /** which of the model's controls this page asks (0: the first) */
      readonly step: number;
      /** the values the pages before it chose, by control id */
      readonly chosen: Readonly<Record<string, string>>;
    };

export const FIRST_PAGE: LaunchPage = { kind: "home" };

/** A picker as the controller holds it: being read for the first time, the
 * door's answer (a catalog, a failure, or both), or a door that could not be
 * asked at all. */
export type HeldModels =
  | { readonly state: "reading" }
  | { readonly state: "answered"; readonly answer: AgentModelsResult }
  | { readonly state: "unasked"; readonly reason: string };

/** The key a picker is held by: an agent under an Agent Profile. */
export function modelsKey(provider: string, profileSet: string): string {
  return `${provider}\u001f${profileSet}`;
}

/** What a start asks for, beyond the folder. */
export interface LaunchChoice {
  readonly provider: string;
  readonly profileSet?: string | undefined;
  readonly modelSelection?: AgentModelSelection | undefined;
}

/** What the rows need from History's controller. */
export interface LaunchContext {
  readonly project: string;
  readonly folder: string | null;
  readonly providers: readonly AgentProviderSummary[];
  /** the Agent Profiles (`agents.profileSets.list`); empty when unread */
  readonly profileSets: readonly AgentProfileSet[];
  readonly recipe: ProjectRecipe | undefined;
  readonly models: ReadonlyMap<string, HeldModels>;
  /** why nothing can start in the folder, or null */
  readonly why: string | null;
  /** epoch ms, for a picker's age */
  readonly now: number;
  /** start in the folder (absent: the rows are drawn, never pressed) */
  readonly start: ((choice: LaunchChoice) => void) | null;
  readonly page: (page: LaunchPage) => void;
}

/** One agent under one Agent Profile, as a row names it. */
interface Launcher {
  readonly provider: AgentProviderSummary;
  /** absent: no profile was read, so the spawn names none (fieldd's default) */
  readonly profile: { readonly id: string; readonly label: string } | undefined;
}

/** The agents New agent offers: this desktop's, installed and able to start
 * (the catalog's ids — `agent.providers` — never a literal, R23), newest used
 * first. */
export function startableAgents(
  providers: readonly AgentProviderSummary[],
): AgentProviderSummary[] {
  return providers
    .filter(
      (provider) =>
        provider.available && provider.offers?.spawn !== false && provider.status !== "declined",
    )
    .sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0));
}

/** The Agent Profiles an agent can run in (Q2, Godview's launcher's rule):
 * This Mac (the native set) for every agent; a managed profile only where it
 * holds a sign-in for the agent. In the profiles' own order. */
function profilesOf(
  provider: AgentProviderSummary,
  sets: readonly AgentProfileSet[],
): Launcher["profile"][] {
  if (sets.length === 0) return [undefined];
  return sets
    .filter(
      (set) =>
        set.kind === "native" ||
        (provider.offers?.personas === true &&
          set.personas.some((persona) => persona.provider === provider.id)),
    )
    .map((set) => ({ id: set.id, label: set.label }));
}

function launchersOf(context: LaunchContext): Launcher[] {
  return startableAgents(context.providers).flatMap((provider) =>
    profilesOf(provider, context.profileSets).map((profile) => ({ provider, profile })),
  );
}

/** The picker held for an agent under a profile, when it was answered. */
function catalogOf(context: LaunchContext, provider: string, profileSet: string) {
  const held = context.models.get(modelsKey(provider, profileSet));
  return held?.state === "answered" ? held.answer.catalog : undefined;
}

/** A model's controls as this project last chose them, when the recipe is
 * this agent's (another agent's model ids mean nothing here). */
function remembered(
  recipe: ProjectRecipe | undefined,
  provider: string,
  modelId: string,
): Readonly<Record<string, string>> | undefined {
  if (recipe === undefined || recipe.provider !== provider) return undefined;
  return recipe.controlsByModel[modelId];
}

/** A control's value as words: the picker's label, else its id as it is. */
function valueWords(control: AgentModelControl | undefined, value: string): string {
  return control?.values.find((candidate) => candidate.id === value)?.label ?? value;
}

/** "high", "high · on": a model's chosen controls in the picker's words, in
 * the picker's order (ids the picker no longer names after them). */
function controlsWords(
  choice: AgentModelChoice | undefined,
  controls: Readonly<Record<string, string>> | undefined,
): string | null {
  if (controls === undefined) return null;
  const ids = Object.keys(controls);
  if (ids.length === 0) return null;
  const known = choice?.controls.map((control) => control.id) ?? [];
  const ordered = [
    ...known.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !known.includes(id)),
  ];
  return ordered
    .map((id) =>
      valueWords(
        choice?.controls.find((control) => control.id === id),
        controls[id] as string,
      ),
    )
    .join(" · ");
}

/** "As of 3 min ago": a picker's age, from its read's own time. */
export function pickerAge(observedAt: string, now: number): string {
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return "As of an unknown time";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "As of just now";
  if (minutes < 60) return `As of ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `As of ${hours} h ago`;
  return `As of ${Math.floor(hours / 24)} d ago`;
}

/** A failed read in a person's words: a sign-in is asked for plainly, else
 * the agent's own sentence. */
function failureWords(failure: { readonly status: string; readonly message: string }): string {
  return failure.status === "auth-required" ? "Sign in to see models" : failure.message;
}

/* ── the first page ─────────────────────────────────────────────────────── */

/** Last used: the project's recipe, checked — or nothing before a launch. */
function lastUsedRows(context: LaunchContext): RoomMenuItem[] {
  const recipe = context.recipe;
  if (recipe === undefined) return [];
  const provider = context.providers.find((candidate) => candidate.id === recipe.provider);
  const agent = provider?.label ?? recipe.provider;
  const profile = context.profileSets.find((set) => set.id === recipe.profileSet);
  const catalog = catalogOf(context, recipe.provider, recipe.profileSet);
  const selection = recipe.selection;
  const choice =
    selection === undefined
      ? undefined
      : catalog?.models.find((model) => model.id === selection.modelId);
  const controls = selection === undefined ? undefined : recipe.controlsByModel[selection.modelId];
  const words = [
    agent,
    selection === undefined ? "its own" : (choice?.label ?? selection.modelId),
    selection === undefined ? null : controlsWords(choice, controls),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const label = `${words} — ${profile?.label ?? recipe.profileSet}`;
  const startable = provider !== undefined && startableAgents([provider]).length === 1;
  const why =
    context.why ??
    (!startable
      ? `${agent} is not offered here`
      : context.profileSets.length > 0 && profile === undefined
        ? "its Agent Profile is gone"
        : null);
  const start = context.start;
  return [
    {
      key: "recipe",
      label,
      checked: true,
      aside: "last used",
      ...(why !== null ? { disabled: true, detail: why } : {}),
      ...(start !== null && why === null
        ? {
            onSelect: () =>
              start({
                provider: recipe.provider,
                profileSet: recipe.profileSet,
                ...(selection !== undefined
                  ? {
                      modelSelection: {
                        modelId: selection.modelId,
                        ...(selection.custom !== undefined ? { custom: selection.custom } : {}),
                        ...(controls !== undefined && Object.keys(controls).length > 0
                          ? { controls: { ...controls } }
                          : {}),
                      },
                    }
                  : {}),
              }),
          }
        : {}),
    },
  ];
}

/** Each agent under each Agent Profile, at its own model and effort, with
 * Another model… beside it. */
function agentRows(context: LaunchContext, another: (launcher: Launcher) => RoomMenuItem["act"]) {
  const start = context.start;
  return launchersOf(context).map((launcher): RoomMenuItem => {
    const { provider, profile } = launcher;
    return {
      key: `${provider.id}\u001f${profile?.id ?? ""}`,
      label: provider.label,
      aside: profile?.label ?? "its own",
      ...(context.why !== null ? { disabled: true, detail: context.why } : {}),
      ...(start !== null && context.why === null
        ? {
            onSelect: () =>
              start({
                provider: provider.id,
                ...(profile !== undefined ? { profileSet: profile.id } : {}),
              }),
          }
        : {}),
      ...(profile !== undefined && context.why === null ? { act: another(launcher) } : {}),
    };
  });
}

/** The first page's groups after "Starts in". */
export function firstPageGroups(
  context: LaunchContext,
  chevron: () => RoomMenuItem["mark"],
): RoomMenuGroup[] {
  const lastUsed = lastUsedRows(context);
  const another = (launcher: Launcher): RoomMenuItem["act"] => ({
    key: "another",
    label: `Another model for ${launcher.provider.label} — ${launcher.profile?.label ?? ""}`,
    content: chevron(),
    onPress: () =>
      context.page({
        kind: "models",
        project: context.project,
        folder: context.folder,
        provider: launcher.provider.id,
        profileSet: launcher.profile?.id ?? "",
      }),
  });
  return [
    ...(lastUsed.length > 0 ? [{ key: "last-used", title: "Last used", items: lastUsed }] : []),
    { key: "agents", title: "Agent", items: agentRows(context, another) },
  ];
}

/* ── the models page and the controls page ─────────────────────────────── */

/** Whether a page was turned for this project and folder (else: the first). */
export function pageHolds(page: LaunchPage, project: string, folder: string | null): boolean {
  return page.kind !== "home" && page.project === project && page.folder === folder;
}

/** A model's controls as the start asks for them: the chosen ones, or none. */
function selectionOf(
  modelId: string,
  chosen: Readonly<Record<string, string>>,
): AgentModelSelection {
  return {
    modelId,
    ...(Object.keys(chosen).length > 0 ? { controls: { ...chosen } } : {}),
  };
}

/** The models page: back, then the agent's own picker — or why it is not. */
export function modelsPageGroups(
  context: LaunchContext,
  page: Extract<LaunchPage, { kind: "models" }>,
  back: RoomMenuItem["mark"],
): { groups: RoomMenuGroup[]; count: number } {
  const provider = context.providers.find((candidate) => candidate.id === page.provider);
  const agent = provider?.label ?? page.provider;
  const profile = context.profileSets.find((set) => set.id === page.profileSet);
  const held = context.models.get(modelsKey(page.provider, page.profileSet));
  const start = context.start;
  const rows: RoomMenuItem[] = [];
  const answer = held?.state === "answered" ? held.answer : undefined;
  const catalog = answer?.catalog;
  if (held === undefined || held.state === "reading")
    rows.push({ key: "reading", label: `Reading ${agent}'s models…`, disabled: true });
  else if (held.state === "unasked")
    rows.push({
      key: "unasked",
      label: `Can't see ${agent}'s models`,
      detail: held.reason,
      disabled: true,
    });
  else if (catalog === undefined)
    rows.push({
      key: "failed",
      label: answer?.failure !== undefined ? failureWords(answer.failure) : `${agent} lists none`,
      disabled: true,
    });
  else {
    const recipe = context.recipe;
    const recipeModel =
      recipe !== undefined &&
      recipe.provider === page.provider &&
      recipe.profileSet === page.profileSet
        ? recipe.selection?.modelId
        : undefined;
    for (const model of catalog.models) {
      const kept = controlsWords(model, remembered(recipe, page.provider, model.id));
      rows.push({
        key: `model\u001f${model.id}`,
        label: model.label,
        ...(model.description !== undefined ? { detail: model.description } : {}),
        ...(kept !== null ? { aside: kept } : {}),
        checked: model.id === recipeModel,
        filterText: `${model.label} ${model.description ?? ""} ${model.group ?? ""}`,
        ...(start !== null
          ? {
              onSelect: () =>
                model.controls.length > 0
                  ? context.page({
                      kind: "controls",
                      project: page.project,
                      folder: page.folder,
                      provider: page.provider,
                      profileSet: page.profileSet,
                      modelId: model.id,
                      step: 0,
                      chosen: {},
                    })
                  : start({
                      provider: page.provider,
                      profileSet: page.profileSet,
                      modelSelection: selectionOf(model.id, {}),
                    }),
            }
          : {}),
      });
    }
    const said = [
      pickerAge(catalog.observedAt, context.now),
      answer?.refreshing === true ? "reading again" : null,
      answer?.failure !== undefined ? `the last read failed: ${answer.failure.message}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
    rows.push({ key: "age", label: said, disabled: true });
  }
  const backRow: RoomMenuItem = {
    key: "back",
    mark: back,
    label: "All agents",
    onSelect: () => context.page(FIRST_PAGE),
  };
  return {
    groups: [
      { key: "back", items: [backRow] },
      {
        key: "models",
        title: `${agent} — ${profile?.label ?? page.profileSet}`,
        items: rows,
      },
    ],
    count: catalog?.models.length ?? 0,
  };
}

/** A control's page: back to the models, its own, then each value. */
export function controlsPageGroups(
  context: LaunchContext,
  page: Extract<LaunchPage, { kind: "controls" }>,
  back: RoomMenuItem["mark"],
): RoomMenuGroup[] | null {
  const catalog = catalogOf(context, page.provider, page.profileSet);
  const model = catalog?.models.find((candidate) => candidate.id === page.modelId);
  const control = model?.controls[page.step];
  if (model === undefined || control === undefined) return null;
  const kept = remembered(context.recipe, page.provider, model.id);
  const start = context.start;
  const next = (chosen: Readonly<Record<string, string>>) => () => {
    if (page.step + 1 < model.controls.length) {
      context.page({ ...page, step: page.step + 1, chosen });
      return;
    }
    start?.({
      provider: page.provider,
      profileSet: page.profileSet,
      modelSelection: selectionOf(model.id, chosen),
    });
  };
  const keptValue = kept?.[control.id];
  const rows: RoomMenuItem[] = [
    {
      key: "own",
      label: "its own",
      ...(kept !== undefined ? { checked: keptValue === undefined } : {}),
      ...(start !== null ? { onSelect: next(page.chosen) } : {}),
    },
    ...control.values.map(
      (value): RoomMenuItem => ({
        key: `value\u001f${value.id}`,
        label: value.label,
        ...(kept !== undefined ? { checked: keptValue === value.id } : {}),
        ...(control.defaultValue === value.id ? { aside: "its default" } : {}),
        ...(start !== null ? { onSelect: next({ ...page.chosen, [control.id]: value.id }) } : {}),
      }),
    ),
  ];
  return [
    {
      key: "back",
      items: [
        {
          key: "back",
          mark: back,
          label: "Models",
          onSelect: () =>
            context.page({
              kind: "models",
              project: page.project,
              folder: page.folder,
              provider: page.provider,
              profileSet: page.profileSet,
            }),
        },
      ],
    },
    { key: "controls", title: `${model.label} — ${control.label}`, items: rows },
  ];
}
