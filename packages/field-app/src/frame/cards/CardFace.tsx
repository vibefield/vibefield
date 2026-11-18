import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { agentMark } from "@vibefield/puppeteer-view-sdk/toolkit";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import { headOf, nameOnFace, wordsOnFace } from "./card-fit";
import { type Card, cardType, type FileFace, type SessionFace, type TextShow } from "./cards-model";
import { AGENT_STATE_WORDS, cardName, HAND_WORDS, WAITING_WORDS } from "./cards-words";
import { TYPE_GLYPH } from "./type-glyphs";
import "./cards.css";

/**
 * One card of the hand (DESIGN.md §5 "The hand's cards are paper", §8 "A card"; *Card Stock* round 5, ruled with
 * CS-D5…D12 on 2026-11-09; item 405): every card is the same printed stock under one face of three things and one line
 * of words — its type's glyph, then its name; the window, what it holds, seen; its faces, as their types' glyphs along
 * its foot. A card picked up is the same face at 2.4×. The agent's card keeps its own dark face until its window
 * (FACE-b). Controller-free: the fan, the held layer, the carried card and the catalog all draw a card through this,
 * and each sets where it stands, its turn and its lift on its own wrapper (the `--vf-cards-*` properties `cards.css`
 * reads).
 */

/** How a card's first face prints today: the dark stock keys on "agent", the composer's chip names its kind by it. */
export type CardLook = "text" | "file" | "agent" | "term" | "msg" | "pict";

/** The look a card's first face prints with. PURE. */
export function cardLook(card: Card): CardLook {
  const face = card.faces[0];
  switch (face.type) {
    case "text":
      return face.show.as === "words" ? "text" : face.show.as;
    case "file":
      return "file";
    case "session":
      return "agent";
    case "image":
    case "ref":
      return "pict";
    case "link":
      return "text";
  }
}

export interface CardFaceProps {
  readonly card: Card;
  /** Picked up (§8 "Picking one up"): the same face at 2.4×; the press's held print keys on it. */
  readonly held?: boolean;
  /** The reach brought it forward: its chip shows on its top right corner. */
  readonly reached?: boolean;
  readonly onRemove?: () => void;
}

export function CardFace({
  card,
  held = false,
  reached = false,
  onRemove,
}: CardFaceProps): ReactElement {
  const first = card.faces[0];
  return (
    <div
      className="vf-card"
      data-kind={cardLook(card)}
      data-card={card.id}
      {...(held ? { "data-held": "" } : {})}
      {...(card.waiting === true ? { "data-waiting": "" } : {})}
    >
      <i className="vf-card-stock" aria-hidden="true" />
      <div className="vf-card-face">
        {first.type === "session" ? <AgentFace face={first} /> : <PrintedFace card={card} />}
      </div>
      <i className="vf-card-gloss" aria-hidden="true" />
      {reached && (
        <button
          type="button"
          className="vf-card-x"
          title={HAND_WORDS.removeKey}
          aria-label={HAND_WORDS.removeCard(cardName(card))}
          aria-keyshortcuts="Backspace"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.();
          }}
        >
          <FieldGlyph name="close" size={13} />
        </button>
      )}
    </div>
  );
}

/** A copy that starts at a prompt is named by its command. */
const PROMPT = /^\$\s+/u;

/** The one line of words the head prints: a terminal copy's command without its prompt; a drag from another app its
 * kind while it is on its way (HN-D2); else the card's own name; always one line. PURE. */
export function faceName(card: Card): string {
  const face = card.faces[0];
  if (card.waiting === true) {
    if (face.type === "image") return WAITING_WORDS.image;
    if (face.type === "file") return face.name === "" ? WAITING_WORDS.file : face.name;
    return WAITING_WORDS.text;
  }
  const name =
    face.type === "text" && face.show.as === "term"
      ? face.show.first.replace(PROMPT, "")
      : card.title;
  return name.replace(/\s+/gu, " ").trim();
}

/** THE ROUND 5 FACE: its type, then its name; the window; its faces along its foot, in the bloom's order, each by its
 * glyph (corrected 2026-11-18: since OB-1b and the card's bloom a card has more than one face). */
function PrintedFace({ card }: { readonly card: Card }): ReactElement {
  const type = cardType(card);
  const name = nameOnFace(faceName(card), type === "file");
  return (
    <>
      <div className="vf-card-head">
        <FieldGlyph name={TYPE_GLYPH[type]} size={10.4} className="vf-card-type" />
        <div className="vf-card-name" style={{ "--card-name": `${name.px}px` } as CSSProperties}>
          {name.text}
        </div>
      </div>
      {windowOf(card)}
      <div className="vf-card-faces">
        {card.faces.map((face) => (
          <FieldGlyph key={face.id} name={TYPE_GLYPH[face.type]} size={7.4} />
        ))}
      </div>
    </>
  );
}

/** The window: what the card holds, seen, with nothing said about it. */
function windowOf(card: Card): ReactElement {
  const face = card.faces[0];
  const waiting = card.waiting === true;
  switch (face.type) {
    case "text":
      return waiting ? (
        <div className="vf-card-window" data-window="text" />
      ) : (
        <TextWindow show={face.show} />
      );
    case "image":
      return <PictureWindow kind="image" picture={face} waiting={waiting} />;
    case "file":
      return <FileWindow face={face} waiting={waiting} />;
    case "ref":
      // its still, as its Picture face is, until its own window: the mat and the live pin (FACE-b)
      return <PictureWindow kind="ref" picture={face.still} waiting={false} />;
    case "link":
      // its page, bare, until FACE-b draws its bar and its page
      return <div className="vf-card-window" data-window="link" />;
    case "session":
      return <div className="vf-card-window" data-window="session" />;
  }
}

/** The most of its words a text window ever sets: past this its eleven lines are full. */
const WORDS_SHOWN = 600;

/** TEXT — what follows its name (a mail's body under its subject), or all of it when that is all it says. */
function TextWindow({ show }: { readonly show: TextShow }): ReactElement {
  switch (show.as) {
    case "words":
      return <WordsWindow words={show.body === "" ? show.title : show.body} />;
    case "msg":
      return <WordsWindow words={show.words} />;
    case "term":
      return <ConsoleWindow show={show} />;
  }
}

function WordsWindow({ words }: { readonly words: string }): ReactElement {
  const shown = headOf(words, WORDS_SHOWN);
  const fit = wordsOnFace(shown);
  const set = {
    "--card-words": `${fit.px}px`,
    "--card-pitch": `${fit.pitch}px`,
    "--card-lines": fit.lines,
  } as CSSProperties;
  return (
    <div className="vf-card-window" data-window="text">
      <p className="vf-card-words" style={set}>
        {shown}
      </p>
    </div>
  );
}

/** Each line of `text` with where it starts in it (its key), at most `max`. PURE. */
function linesOf(
  text: string,
  max: number,
): ReadonlyArray<{ readonly at: number; readonly line: string }> {
  const out: Array<{ at: number; line: string }> = [];
  let at = 0;
  for (const line of text.split("\n")) {
    if (out.length >= max) break;
    out.push({ at, line });
    at += line.length + 1;
  }
  return out;
}

/** A terminal window's lines: ten at most, the most of them it reads. */
const CONSOLE_LINES = 10;
const CONSOLE_SHOWN = 1200;
/** The test runner's summary line: its count of passes in the pass ink. */
const PASSED = /^(Tests\s+)(\d+ passed)(.*)$/u;

/** TERMINAL — what it printed, in mono, each line from its first mark: a prompt's command in bold, a pass in the pass
 * ink, the one colour a terminal card prints. A copy that is one line shows that line. */
function ConsoleWindow({
  show,
}: {
  readonly show: Extract<TextShow, { as: "term" }>;
}): ReactElement {
  const rest = show.rest.replace(/\n+$/u, "");
  const lines = linesOf(headOf(rest !== "" ? rest : show.first, CONSOLE_SHOWN), CONSOLE_LINES);
  return (
    <div className="vf-card-window" data-window="term">
      <div className="vf-card-out">
        {lines.map(({ at, line }) => (
          <ConsoleLine key={at} line={line.trimStart()} />
        ))}
      </div>
    </div>
  );
}

function ConsoleLine({ line }: { readonly line: string }): ReactElement {
  if (PROMPT.test(line)) {
    return (
      <div>
        <span className="vf-card-prompt">$ </span>
        <b>{line.replace(PROMPT, "")}</b>
      </div>
    );
  }
  const passed = PASSED.exec(line);
  if (passed !== null) {
    return (
      <div data-quiet="">
        {"Tests "}
        <b className="vf-card-pass">{passed[2]}</b>
        {passed[3]}
      </div>
    );
  }
  const parts: ReactNode[] = [];
  let from = 0;
  for (let mark = line.indexOf("✓"); mark >= 0; mark = line.indexOf("✓", from)) {
    parts.push(
      line.slice(from, mark),
      <b key={mark} className="vf-card-pass">
        ✓
      </b>,
    );
    from = mark + 1;
  }
  parts.push(line.slice(from));
  return <div>{parts}</div>;
}

/** A file window's first lines, as a page: what fills 110. */
const FILE_LINES = 20;
const FILE_SHOWN = 4000;
/** A comment's line, quieter than the code. */
const QUIET = /^\s*(\/\*\*|\*|\*\/|\/\/)/u;

/** FILE — its first lines as a page, no line numbers, the comment quieter than the code, fading out; a file that is
 * not words is a blank page (what it is and how big is said in the bar over it, held). Waiting, it says letting go
 * shows it. */
function FileWindow({
  face,
  waiting,
}: {
  readonly face: FileFace;
  readonly waiting: boolean;
}): ReactElement {
  if (waiting) {
    return (
      <div className="vf-card-window" data-window="file">
        <p className="vf-card-wait">{WAITING_WORDS.letGo}</p>
      </div>
    );
  }
  const lines =
    face.lines === undefined || face.lines === ""
      ? []
      : linesOf(headOf(face.lines, FILE_SHOWN), FILE_LINES);
  return (
    <div className="vf-card-window" data-window="file">
      {lines.length > 0 && (
        <div className="vf-card-lines">
          {lines.map(({ at, line }) => (
            <div key={at} {...(QUIET.test(line) ? { "data-quiet": "" } : {})}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** IMAGE (and a ref, until its own window) — the picture itself, filling the window about its middle; its ground
 * until it loads, and in place of a still main no longer keeps, never a broken image. Waiting, the ground alone. */
function PictureWindow({
  kind,
  picture,
  waiting,
}: {
  readonly kind: "image" | "ref";
  readonly picture: { readonly src: string };
  readonly waiting: boolean;
}): ReactElement {
  const [broken, setBroken] = useState<string | null>(null);
  const shown = !waiting && picture.src !== "" && broken !== picture.src;
  const ground = waiting ? { "data-waiting": "" } : {};
  return (
    <div className="vf-card-window" data-window={kind} {...ground}>
      {shown && (
        <img src={picture.src} alt="" draggable={false} onError={() => setBroken(picture.src)} />
      )}
    </div>
  );
}

/** The agent's mark: the SDK's own when it has one for this agent (branding, never behaviour — AR-L1), else the
 * kit's `agents` glyph. */
function CardMark({ agent }: { readonly agent: string | undefined }): ReactElement {
  if (agent !== undefined && agentMark(agent).kind === "path") {
    return <AgentIcon providerId={agent} />;
  }
  return <FieldGlyph name="agents" size={38} />;
}

/** AGENT — the one dark card, until its window (FACE-b): its handle, its project behind the project's dot (high on
 * the card, so it shows at rest), its mark, and its state at its foot. */
function AgentFace({ face }: { readonly face: SessionFace }): ReactElement {
  return (
    <>
      <div className="vf-card-body">
        <div className="vf-card-handle">{face.handle}</div>
        {face.project !== undefined && (
          <div className="vf-card-project">
            {face.projectInk !== undefined && (
              <i
                aria-hidden="true"
                style={{ "--card-project": projectInk(face.projectInk) } as CSSProperties}
              />
            )}
            {face.project}
          </div>
        )}
        <div className="vf-card-mark">
          <CardMark agent={face.agent} />
        </div>
      </div>
      {face.state !== undefined && (
        <div
          className="vf-card-state"
          data-tone={face.state === "waiting" ? "attention" : face.state}
        >
          <i aria-hidden="true" />
          {AGENT_STATE_WORDS[face.state]}
        </div>
      )}
    </>
  );
}
