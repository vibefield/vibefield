// THE SIMULATOR'S ACTS (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts", §8 "An act that is a choice",
// §13's drawings kinds hand the bar's renderer): SIMULATOR SETTINGS…, which wears its own drawing (a phone with a slider)
// and picks the phone up to reading size through the desk's hold, its settings rising as a sheet on its glass
// (setup-dialog.ts); and FINISH, a choice (ICE I62) of the model's launch finishes by name, each with its dot (a swatch
// pill on the bar), the current one checked where every selected phone wears it — a finish taken sets every selected
// phone in ONE transaction, one undo step. The same two stand on the selection bar and in the tools in hand beside Home.
//
// Superseded here: Finish turned each phone to its model's next launch colour, one undo step a phone (`nextFinish`,
// `finishPhones`), and Simulator settings… opened the form in the window's dialog unless the phone was in hand.

import type {
  ActChoice,
  ActChoiceTaken,
  Entity,
  HeldToolApi,
  HeldToolDef,
  MenuActionDef,
  World,
} from "@vibefield/plugin-sdk/desk";
import { configureSimulators, phoneCellOf, phoneLocalOf, simulatorSettings } from "./attach";
import { DEFAULT_MODEL, PROP } from "./ids";
import { finishOf, modelOf } from "./law";
import type { PhoneModel } from "./model";
import { SIMULATOR_FINISHES } from "./theme";

export const SETUP_ACT = "simulator-settings";
export const FINISH_ACT = "finish";

/** Simulator settings…'s own drawing (DESIGN.md §13, track OM): a phone with a slider — its body, its earpiece, and a knob on
 * the slider's rail — stroked 2 in the 24 box. */
export const SETTINGS_GLYPH = {
  path: "M8 3.5h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z M10.5 6.5h3M9.5 13h5M12 11.2v3.6",
};

/** What a finish write reads and writes through: the world and the transaction (a menu act's api, a tool's). */
export type PhoneWriteApi = Pick<HeldToolApi, "world" | "transact">;

type Props = Readonly<Record<string, unknown>>;

/** The phone's model as its props hold it — a free string (an id this build's catalog lacks draws as the default). */
const modelOfProps = (props: Props): PhoneModel => {
  const model = props[PROP.model];
  return modelOf(typeof model === "string" && model.length > 0 ? model : DEFAULT_MODEL);
};
/** The finish a phone wears: its prop when it is its model's own, else its model's first. */
const wornBy = (model: PhoneModel, props: Props): string => {
  const finish = props[PROP.finish];
  return finishOf(model, typeof finish === "string" ? finish : "");
};

/** A material note at a finish name's end — the band's metal, which the name of the colour does not carry. */
const MATERIAL = / \((?:steel|titanium|aluminium)\)$/u;

/** A finish's name as the list says it: its token's last " · " part, less the band's metal ("Space Gray (steel)" reads
 * "Space Gray"; "(PRODUCT)RED" stays whole). An unknown key is its own name. */
export function finishName(key: string): string {
  const token = SIMULATOR_FINISHES[key]?.token;
  if (token === undefined) return key;
  const last = token.split(" · ").at(-1) ?? token;
  return last.replace(MATERIAL, "");
}

/** The model every phone is, or undefined: none, or phones of different models (they share no finishes). */
function sharedModel(phones: readonly Props[]): PhoneModel | undefined {
  const first = phones[0];
  if (first === undefined) return undefined;
  const model = modelOfProps(first);
  return phones.every((p) => modelOfProps(p) === model) ? model : undefined;
}

/**
 * THE FINISH CHOICES NOW (ICE I62): one of the model's launch finishes a choice, in its order — its name, its dot, the
 * current one marked where every phone wears it (none marked: Mixed). Phones of different models share no list: [].
 */
export function finishChoices(phones: readonly Props[]): ActChoice[] {
  const model = sharedModel(phones);
  if (model === undefined) return [];
  const worn = phones.map((p) => wornBy(model, p));
  const on = worn.every((f) => f === worn[0]) ? worn[0] : undefined;
  return model.finishes.flatMap((key) => {
    const token = SIMULATOR_FINISHES[key];
    if (token === undefined) return [];
    return [
      {
        id: key,
        label: finishName(key),
        swatch: token.css,
        ...(on === key ? { current: true } : {}),
      },
    ];
  });
}

/** Finish stands faint where its phones share no list, or before the desk's DOM half has read the cell it writes. */
const finishNow = (world: World, phones: readonly Props[]) =>
  finishChoices(phones).length === 0 || phoneCellOf(world) === undefined
    ? { enabled: false }
    : undefined;

/**
 * A FINISH TAKEN: every phone set to it in ONE transaction (one undo step), each phone's props written whole with its new
 * finish. False where nothing was written — no choice, a finish their model lacks, phones of different models, every phone
 * wearing it already, no cell read yet, or a read-only document.
 */
export function chooseFinish(
  api: PhoneWriteApi,
  entities: readonly Entity[],
  taken: ActChoiceTaken | undefined,
): boolean {
  // the act is a choice: the bar lists its choices, and nothing is written until one is taken
  if (taken === undefined || entities.length === 0) return false;
  const cell = phoneCellOf(api.world);
  if (cell === undefined) return false;
  const phones = entities.map((e) => ({ e, props: (api.world.get(e, cell) ?? {}) as Props }));
  const model = sharedModel(phones.map((p) => p.props));
  if (model === undefined || !model.finishes.includes(taken.id)) return false;
  const writes = phones.filter((p) => wornBy(model, p.props) !== taken.id);
  if (writes.length === 0) return false;
  return api.transact((tx) => {
    for (const { e, props } of writes) tx.edit(e).set(cell, { ...props, [PROP.finish]: taken.id });
  });
}

/** Simulator settings… stands faint where the desk lends no hold (it could not pick the phone up), or before the desk's DOM
 * half is mounted (no sheet would rise). */
const settingsNow = (world: World) =>
  phoneLocalOf(world)?.hold() === undefined || phoneCellOf(world) === undefined
    ? { enabled: false }
    : undefined;

/** THE SELECTION BAR'S ACTS (DESIGN.md §9 "The simulator's acts"): Simulator settings…, then Finish. */
export const PHONE_ACTS: readonly MenuActionDef[] = [
  {
    id: SETUP_ACT,
    label: "Simulator settings…",
    glyph: SETTINGS_GLYPH,
    state: (c) => settingsNow(c.world),
    run: (api) => {
      simulatorSettings(api.world, api.entities);
    },
  },
  {
    id: FINISH_ACT,
    label: "Finish",
    choices: (c) => finishChoices(c.entities.map((e) => c.props(e))),
    state: (c) =>
      finishNow(
        c.world,
        c.entities.map((e) => c.props(e)),
      ),
    run: (api, taken) => {
      chooseFinish(api, api.entities, taken);
    },
  },
];

/** THE SAME TWO IN HAND (DESIGN.md §8 "Tools in hand"; ICE I62), after Home: the phone in hand's settings and its finish. */
export const PHONE_HELD_ACTS: readonly HeldToolDef[] = [
  {
    id: SETUP_ACT,
    label: "Simulator settings…",
    kind: "action",
    glyph: SETTINGS_GLYPH,
    run: (api) => {
      configureSimulators(api.world, [api.entity]);
    },
  },
  {
    id: FINISH_ACT,
    label: "Finish",
    kind: "action",
    choices: (c) => finishChoices([c.props()]),
    state: (c) => finishNow(c.world, [c.props()]),
    run: (api, taken) => {
      chooseFinish(api, [api.entity], taken);
    },
  },
];
