import { NOTE_TYPE } from "@vibecook/ice/desk/objects";
import {
  OBJECT_LIMITS,
  type ObjectAgentFace,
  type ObjectRef,
  utf8ByteLength,
} from "@vibefield/contracts";
import { type AgentHalf, agentReadApi } from "@vibefield/plugin-sdk/desk";
import {
  type Face,
  type ImageFace,
  type RefFace,
  wordsShowOf,
} from "../../../frame/cards/cards-model";
import type { ObjectWords } from "../desk-object-words";

// THE DESK'S COPY — WHAT A SELECTION IS CALLED, AND THE WORDS IT KEEPS (HN-D3; DESIGN.md §8 "Make a card", "The
// missing face"; R15 as amended 13:40Z, DK-D26, PT-4 ruling 5). Pure: from the selected objects as the host reads them —
// each one's type, its words (the mount's human name and, for a missing face, why) and its durable props.
//   ITS NAME — the title its picture card carries into the hand: ANY KIND its name ("Clock"); SEVERAL "N objects"; a
//   MISSING FACE its type's name (the manifest's, else the type id — never its word: the card names what it is, the bar
//   says why it is missing); AN OBJECT SHOWING A LIVE PAGE (a browser pane) what its page is CALLED — the page's title,
//   else its address as its kind prints it (the mount's LIVE service says it, by the object's durable key) — its first
//   24 characters, as the chip cut a note's writing.
//   ITS WORDS — the durable text the objects keep (a note's writing, a pad's lines): a lone note's are its TEXT card,
//   and any copy's are what the system clipboard is given — beside its picture, in the picture's one write (LC-19).

/** How much of a live page's name a copy carries (DK-14's chip cut: "its first 24 characters"). */
export const NAME_CHARS = 24;

/** One selected object as the host read it. */
export interface CopiedObject {
  readonly type: string;
  readonly words: ObjectWords;
  /** Its durable props (the cells of its groups, merged). */
  readonly props: Readonly<Record<string, unknown>>;
  /** PT-4: what the live page it shows is called — its title, else its address as printed; absent: it shows none. */
  readonly live?: string;
  /** Its durable key on the board, when the board has one. */
  readonly key?: string;
  /** What its kind offers an agent (OB-2); absent: no agent half, so Picture only. */
  readonly agent?: CopiedAgent;
}

/** A writing's first `n` characters — its runs of white space one space, cut with "…" when there is more; null when
 * there is nothing written. Counted by code point, so a character is never split. */
export function firstChars(text: string, n: number = NAME_CHARS): string | null {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat === "") return null;
  const chars = Array.from(flat);
  return chars.length <= n ? flat : `${chars.slice(0, n).join("").trimEnd()}…`;
}

/** An object's durable text: the `text` it keeps (a note's writing, a pad's lines), or null. */
export function durableText(props: Readonly<Record<string, unknown>>): string | null {
  const text = props["text"];
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/** A lone NOTE's writing — its copy is a text card of these words (HN-D3: "one note → a text card"). Null for
 * anything else, and for a note with nothing written, which is copied as its picture. */
export function noteWords(objects: readonly CopiedObject[]): string | null {
  const [one, ...rest] = objects;
  if (one === undefined || rest.length > 0 || one.type !== NOTE_TYPE) return null;
  return durableText(one.props);
}

/** The words a copy gives the system clipboard: the durable text the objects keep, in selection order, a blank line
 * between two; null when none keeps any (a clock, a print — its picture alone). A picture card carries them beside
 * its picture, in the same one write (HN-5, LC-19). */
export function copiedWords(objects: readonly CopiedObject[]): string | null {
  const texts = objects.flatMap((o) => {
    const text = durableText(o.props);
    return text === null ? [] : [text];
  });
  return texts.length === 0 ? null : texts.join("\n\n");
}

/** What one kind offers: its declared faces and its handlers (OB-2). */
export interface CopiedAgent {
  readonly faces: readonly ObjectAgentFace[];
  readonly half: AgentHalf;
}

/** How large words may be and still ride the card from the press: the most one tool answers. Past it they wait for the play. */
export const FACE_TEXT_PRESS_BYTES = OBJECT_LIMITS.TOOL_BYTES;

export interface FacesAsked {
  readonly objects: readonly CopiedObject[];
  /** the host's capture, when one could be taken */
  readonly picture: ImageFace | null;
  /** fieldd's names for the objects with an agent half, in order; empty: no Live */
  readonly refs: readonly ObjectRef[];
  /** what the card is called */
  readonly title: string;
  /** an object's props as they are at the play; null: it has gone */
  readonly readNow: (object: CopiedObject) => Readonly<Record<string, unknown>> | null;
}

type Handler = (api: ReturnType<typeof agentReadApi>) => string;

/** Run a face's handler; null when it throws. */
function run(handler: Handler, props: Readonly<Record<string, unknown>>): string | null {
  try {
    return handler(agentReadApi(props));
  } catch {
    return null;
  }
}

/** A handler that reads the object as it is at the play. */
function readerAtPlay(
  object: CopiedObject,
  handler: Handler,
  readNow: FacesAsked["readNow"],
): () => string | null {
  return () => {
    const props = readNow(object);
    return props === null ? null : run(handler, props);
  };
}

/** One declared face of one object, at the press (`studies/kit.md`): null when it has nothing to give. */
function handledFace(
  object: CopiedObject,
  half: AgentHalf,
  face: ObjectAgentFace,
  asked: FacesAsked,
): Face | null {
  const id = face.id;
  const handler = id === undefined ? undefined : half.faces?.[id];
  if (id === undefined || handler === undefined) return null;
  const base = { id, label: face.label ?? id };
  if (face.type === "file") {
    return {
      ...base,
      type: "file",
      name: `${asked.title}.${id}`,
      ...(face.mime === undefined ? {} : { mime: face.mime }),
      atPlay: readerAtPlay(object, handler, asked.readNow),
    };
  }
  const given = run(handler, object.props);
  if (given === null || given.trim() === "") return null;
  if (face.type === "link") return { ...base, type: "link", url: given, title: asked.title };
  if (face.type !== "text") return null;
  const late = utf8ByteLength(given) > FACE_TEXT_PRESS_BYTES;
  const text = late ? "" : given;
  return {
    ...base,
    type: "text",
    format: face.format ?? "plain",
    ...(face.language === undefined ? {} : { language: face.language }),
    text,
    show: wordsShowOf(text),
    ...(late ? { atPlay: readerAtPlay(object, handler, asked.readNow) } : {}),
  };
}

/** The Live face: fieldd's name for the object and the same capture as its Picture. No name or no picture, no Live. */
function liveFace(asked: FacesAsked, face?: ObjectAgentFace): RefFace | null {
  const [ref, ...more] = asked.refs;
  const { picture, objects } = asked;
  if (ref === undefined || picture === null) return null;
  return {
    id: face?.id ?? "live",
    type: "ref",
    label: face?.label ?? "Live",
    ref,
    kindName: objects.length > 1 ? `${objects.length} objects` : (objects[0]?.words.title ?? ""),
    title: asked.title,
    still: { src: picture.src, width: picture.width, height: picture.height },
    ...(more.length === 0 ? {} : { more }),
  };
}

/** Every face a copy offers, in the kind's order (OB-D2), from its agent half. A kind with none gets its Picture and no Live; several
 * selected get one Live naming each and one Picture. PURE, save what a handler does. */
export function kindFacesOf(asked: FacesAsked): readonly Face[] {
  const { objects, picture } = asked;
  const shot: readonly Face[] = picture === null ? [] : [picture];
  const [one, ...others] = objects;
  const agent = one?.agent;
  if (others.length > 0) {
    const live = liveFace(asked);
    return live === null ? shot : [live, ...shot];
  }
  if (one === undefined || agent === undefined) return shot;
  const declared = agent.faces.flatMap((face): readonly Face[] => {
    if (face.type === "ref") {
      const live = liveFace(asked, face);
      return live === null ? [] : [live];
    }
    if (face.type === "image") {
      return picture === null
        ? []
        : [{ ...picture, id: face.id ?? picture.id, label: face.label ?? picture.label }];
    }
    const made = handledFace(one, agent.half, face, asked);
    return made === null ? [] : [made];
  });
  // the host adds the Picture to every kind (§4.2), last, where the kind did not say where it goes
  return agent.faces.some((face) => face.type === "image") ? declared : [...declared, ...shot];
}

/** What a copy is called — its picture card's title (§8, R15's names, above). */
export function copyName(objects: readonly CopiedObject[]): string {
  if (objects.length > 1) return `${objects.length} objects`;
  const one = objects[0];
  if (one === undefined) return "Nothing";
  // an object showing a live page is called by its page (its title, else its address as printed)
  if (one.live !== undefined && one.words.state === null)
    return firstChars(one.live) ?? one.words.title;
  // any other kind — a missing face, drawn or not, an empty note — its type's human name
  return one.words.title;
}
