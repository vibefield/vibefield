import type { ChipType, ObjectRef } from "@vibefield/contracts";
import { catalogEntry, doorCanName } from "@vibefield/contracts";
import type { Card, Face, ImageFace, RefFace } from "./cards-model";
import { OUTSIDE_WORDS, PLACE_WORDS, TARGET_WORDS } from "./cards-words";

// WHERE A FACE LANDS (OB-1b; `draft/thinking-objects-at-work.md` §4.3, §4.4, OB-D12): the one authority for what each
// face does at each destination, what choosing it says, and why one that cannot land stands faint. The bloom's view and
// the drag's label read this; neither re-derives a rule or a sentence. PURE, save `doorCanNameRun`'s small cache.

/** Where a card is let go. `can`: can the door name this run? A synchronous read of what is cached, never a round
 * trip: the bloom opens with no wait. `browser`: the desk holds the kind that opens an address. */
export type Destination =
  | {
      readonly at: "agent-pane";
      readonly run: string;
      readonly handle: string;
      /** the catalog's label: "Copilot" */
      readonly agentLabel: string;
      readonly can: boolean;
    }
  | { readonly at: "shell-pane"; readonly name: string }
  | { readonly at: "chat"; readonly spark: string; readonly handle: string }
  | {
      readonly at: "desk";
      /** it holds the kind that opens an address */
      readonly browser?: boolean;
      /** false: this window has no still door, so a snapshot's pixels are out of reach */
      readonly stills?: boolean;
    };

export type Landing =
  | { readonly lands: true; readonly verb: string; readonly noun: string }
  | { readonly lands: false; readonly reason: string };

export interface Bud {
  readonly face: string;
  readonly type: ChipType;
  readonly label: string;
  /** what choosing does, at 40%: "Hand over" · "Paste" (DESIGN.md §8); empty when it cannot land */
  readonly verb: string;
  /** what it does it to, at full ink: "the live map" · "its outline"; empty when it cannot land */
  readonly noun: string;
  readonly lands: boolean;
  /** only when it cannot land: faint and dashed with these words */
  readonly reason?: string;
}

export interface BloomModel {
  /** "claude·2 · Godview", the one line under the words */
  readonly where: string;
  /** the first face that fits; null when none does: no bloom, the drag says the first reason, the card goes home */
  readonly hub: string | null;
  /** every face, in the card's order, so a face that can't land keeps its place */
  readonly buds: readonly Bud[];
  /** exactly one fits: play it at once, no bloom. null when you must draw the bloom. */
  readonly onlyFit: string | null;
}

/** §4.4's reasons and the words a bud says. */
export const LANDING_WORDS = {
  /** a live object on a pane that has no agent in it */
  noAgent: "Nothing in this pane can work on it",
  noDeskObjects: (agent: string) => `${agent} can't work on desk objects yet`,
  deskNoFile: "The desk can't hold a file yet",
  deskNoSession: "The desk can't hold an agent yet",
  /** a link on a desk that holds no browser pane */
  deskNoPage: "The desk can't open a page yet",
  open: "Open",
  aPane: "a browser pane at it",
  goTo: "Go to",
  it: "it",
  hand: "Hand over",
  add: "Add",
  paste: "Paste",
} as const;

/** How a face's word is said in a sentence: an acronym stands, the rest in lower case. PURE. */
function spoken(label: string): string {
  return label === label.toUpperCase() ? label : label.toLowerCase();
}

/** A text face's noun: "its outline"; a label that is already a phrase ("Its words") as it is. PURE. */
function itsNoun(label: string): string {
  return /^its /iu.test(label) ? spoken(label) : `its ${spoken(label)}`;
}

/** The live object's noun: a label that says it ("Live page"), else its kind's last word ("the live map"). PURE. */
function liveNoun(face: RefFace): string {
  const label = spoken(face.label);
  if (label.includes(" ")) return label;
  return `live ${spoken(face.kindName.split(/\s+/u).at(-1) ?? face.kindName)}`;
}

/** What a face offers a place that takes it as words: a pane's paste, or a chip in a draft. Null when it holds nothing
 * to give. */
function asWords(face: Face): string | null {
  switch (face.type) {
    case "text":
      return itsNoun(face.label);
    case "image":
      return face.path === undefined && face.bytes === undefined
        ? null
        : `the ${spoken(face.label)}'s path`;
    case "file":
      return face.path === undefined && face.atPlay === undefined
        ? null
        : `the ${spoken(face.label)}'s path`;
    case "link":
      return "the address";
    case "session":
      return "the session";
    case "ref":
      return `the ${liveNoun(face)}`;
  }
}

function missingReason(face: Face): string {
  return face.type === "file" ? OUTSIDE_WORDS.fileNoPath : TARGET_WORDS.pictureNoFile;
}

/** §4.4: one face at one destination. PURE. */
export function landing(face: Face, to: Destination): Landing {
  if (to.at === "desk") return ontoDesk(face, to);
  if (face.type === "ref") {
    if (to.at === "shell-pane") return { lands: false, reason: LANDING_WORDS.noAgent };
    if (to.at === "agent-pane" && !to.can) {
      return { lands: false, reason: LANDING_WORDS.noDeskObjects(to.agentLabel) };
    }
    return {
      lands: true,
      verb: to.at === "chat" ? LANDING_WORDS.add : LANDING_WORDS.hand,
      noun: `the ${liveNoun(face)}`,
    };
  }
  const noun = asWords(face);
  if (noun === null) return { lands: false, reason: missingReason(face) };
  return { lands: true, verb: to.at === "chat" ? LANDING_WORDS.add : LANDING_WORDS.paste, noun };
}

function ontoDesk(face: Face, to: Extract<Destination, { at: "desk" }>): Landing {
  switch (face.type) {
    case "text":
      return { lands: true, verb: PLACE_WORDS.desk, noun: PLACE_WORDS.note };
    case "image":
      // a print is made from pixels: its own, or a snapshot's through the still door
      return face.bytes === undefined && (face.path === undefined || to.stills === false)
        ? { lands: false, reason: TARGET_WORDS.deskNoPicture }
        : { lands: true, verb: PLACE_WORDS.desk, noun: PLACE_WORDS.print };
    case "file":
      return { lands: false, reason: LANDING_WORDS.deskNoFile };
    case "link":
      return to.browser === true
        ? { lands: true, verb: LANDING_WORDS.open, noun: LANDING_WORDS.aPane }
        : { lands: false, reason: LANDING_WORDS.deskNoPage };
    case "session":
      return { lands: false, reason: LANDING_WORDS.deskNoSession };
    case "ref":
      return { lands: true, verb: LANDING_WORDS.goTo, noun: LANDING_WORDS.it };
  }
}

/** The one line that names where a card lands. PURE. */
function whereOf(to: Destination): string {
  switch (to.at) {
    case "agent-pane":
      return `${to.handle} · Godview`;
    case "shell-pane":
      return `${to.name} · Godview`;
    case "chat":
      return `${to.handle} · Chat`;
    case "desk":
      return "The desk";
  }
}

/** A card of one face has no choice to name: the place's own sentence says it (DESIGN.md §8 "The hand"). PURE. */
function soleWords(face: Face, to: Destination): { readonly verb: string; readonly noun: string } {
  switch (to.at) {
    case "agent-pane":
      return { verb: PLACE_WORDS.pane, noun: to.handle };
    case "shell-pane":
      return { verb: PLACE_WORDS.pane, noun: to.name };
    case "chat":
      return { verb: PLACE_WORDS.prompt, noun: to.handle };
    case "desk":
      return {
        verb: PLACE_WORDS.desk,
        noun: face.type === "image" ? PLACE_WORDS.print : PLACE_WORDS.note,
      };
  }
}

/** What a drop on this destination offers: the buds, the hub and whether one fit alone. PURE. */
export function bloomOf(card: Card, to: Destination): BloomModel {
  const lone = card.faces.length === 1;
  const buds = card.faces.map((face): Bud => {
    const base = { face: face.id, type: face.type, label: face.label };
    // a card from another app says what it holds only once it is let go (HN-D2)
    if (card.waiting === true) return { ...base, lands: true, ...soleWords(face, to) };
    const said = landing(face, to);
    if (!said.lands) return { ...base, lands: false, verb: "", noun: "", reason: said.reason };
    const { verb, noun } = lone ? soleWords(face, to) : said;
    return { ...base, lands: true, verb, noun };
  });
  const fits = buds.filter((bud) => bud.lands);
  return {
    where: whereOf(to),
    hub: fits[0]?.face ?? null,
    buds,
    onlyFit: fits.length === 1 ? (fits[0]?.face ?? null) : null,
  };
}

/** The drag's label before letting go: how many ways, the one verb, or the first reason (no ring). PURE. */
export function dragLabelOf(
  model: BloomModel,
  name: string,
): { readonly ok: boolean; readonly label: string } {
  const fits = model.buds.filter((bud) => bud.lands);
  if (fits.length === 0) return { ok: false, label: model.buds[0]?.reason ?? "" };
  const [one] = fits;
  if (fits.length === 1 && one !== undefined) return { ok: true, label: `${one.verb} ${one.noun}` };
  return { ok: true, label: `Let go: ${fits.length} ways into ${name}` };
}

/** A face of a card by its id; the first when the id names none. PURE. */
export function faceOf(card: Card, id: string): Face {
  return card.faces.find((face) => face.id === id) ?? card.faces[0];
}

/** A ref face's words, as the model reads them (§4.4): the kind and title for the model, the ref for its tools. PURE. */
export function refWords(face: RefFace): string {
  const refs: readonly ObjectRef[] = [face.ref, ...(face.more ?? [])];
  if (refs.length > 1) {
    return `${refs.length} desk objects (${refs.join(", ")}): call object_open on each`;
  }
  return `the ${spoken(face.kindName)} “${face.title}” (desk object ${face.ref}): call object_open on it`;
}

/** An image face that has a file now, or still needs one written at the play (OB-D10 A). PURE. */
export function needsPictureFile(face: Face): face is ImageFace {
  return face.type === "image" && face.path === undefined && face.bytes !== undefined;
}

// ── The door's naming of runs ───────────────────────────────────────────────────────────────

const namedAgents = new Map<string, boolean>();
const namedRuns = new Map<string, boolean>();

/** Whether the door can name this agent's runs, from what it declares: it takes MCP servers, in a process the door can name. PURE. */
export function agentDoorCanName(
  briefing:
    | {
        readonly mcpServers?: boolean | undefined;
        readonly mcpServerProcess?: string | undefined;
      }
    | undefined,
): boolean {
  return briefing?.mcpServers === true && doorCanName(briefing.mcpServerProcess);
}

/** What fieldd declared of an agent (`agent.providers`). */
export function noteAgentNameable(agentId: string, can: boolean): void {
  namedAgents.set(agentId, can);
}

/** What the window's board says of one run: false, its door is off for this process; null, it says nothing of its own. */
export function noteRunNameable(run: string, can: boolean | null): void {
  if (can === null) namedRuns.delete(run);
  else namedRuns.set(run, can);
}

/** Whether the door can name a run: the run's own word, else its agent's as fieldd declared it, else until fieldd has answered
 * the catalog's (`offers.spark`). Synchronous: the bloom opens with no wait. */
export function doorCanNameRun(run: string, agentId: string): boolean {
  return (
    namedRuns.get(run) ?? namedAgents.get(agentId) ?? catalogEntry(agentId)?.offers.spark === true
  );
}

/** Test seam. */
export function resetRunNameCacheForTest(): void {
  namedRuns.clear();
  namedAgents.clear();
}
