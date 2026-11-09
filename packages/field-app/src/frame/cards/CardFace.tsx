import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { agentMark } from "@vibefield/puppeteer-view-sdk/toolkit";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import type { Card, FileFace as FileFaceData, SessionFace, TextShow } from "./cards-model";
import { AGENT_STATE_WORDS, cardName, HAND_WORDS, WAITING_WORDS } from "./cards-words";
import "./cards.css";

/**
 * One card of the hand (track HN, HN-D1 "one stock, six faces"; DESIGN.md §5 "The hand's cards
 * are paper", §8 "The hand"): the same white stock for every kind, the kind's glyph printed in two
 * corners as a playing card prints its index, and one thing on its face, its name first. A picture
 * is printed on it; an agent's card is the one dark stock. Controller-free: the fan, the held
 * layer, the carried card and the catalog all draw a card through this, and each sets where it
 * stands, its turn and its lift on its own wrapper (the `--vf-cards-*` properties `cards.css`
 * reads).
 */

/** How a card's first face prints today (OB-1a: this face's look, unchanged; §7's marks replace it). */
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

/** The index each kind prints in its corners: a fanned hand is read by them. */
export const CARD_INDEX: Readonly<Record<CardLook, GlyphName>> = {
  text: "snippets",
  file: "code",
  agent: "agents",
  term: "terminal",
  msg: "message",
  pict: "capture",
};

export interface CardFaceProps {
  readonly card: Card;
  /** Picked up (HN-D5): the same card, its type set finer inside so the whole of it reads. */
  readonly held?: boolean;
  /** The reach brought it forward: its × shows inside its top right, across from the index. */
  readonly reached?: boolean;
  readonly onRemove?: () => void;
}

export function CardFace({
  card,
  held = false,
  reached = false,
  onRemove,
}: CardFaceProps): ReactElement {
  const look = cardLook(card);
  const index = CARD_INDEX[look];
  return (
    <div
      className="vf-card"
      data-kind={look}
      data-card={card.id}
      {...(held ? { "data-held": "" } : {})}
      {...(card.waiting === true ? { "data-waiting": "" } : {})}
    >
      <i className="vf-card-stock" aria-hidden="true" />
      <div className="vf-card-face">
        <FieldGlyph name={index} size={12} className="vf-card-ix" />
        <FieldGlyph name={index} size={12} className="vf-card-ix vf-card-ix-tail" />
        {faceOf(card)}
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

function faceOf(card: Card): ReactElement {
  const face = card.faces[0];
  const waiting = card.waiting === true;
  switch (face.type) {
    case "text":
      return textFaceOf(face.show, waiting);
    case "file":
      return <FileFace face={face} waiting={waiting} />;
    case "session":
      return <AgentFace face={face} />;
    case "image":
      return <PictFace picture={face} title={card.title} waiting={waiting} />;
    case "link":
      return (
        <TextFace show={{ title: face.title, body: face.url, bare: true }} waiting={waiting} />
      );
    case "ref":
      return <PictFace picture={face.still} title={card.title} waiting={waiting} />;
  }
}

function textFaceOf(show: TextShow, waiting: boolean): ReactElement {
  switch (show.as) {
    case "words":
      return <TextFace show={show} waiting={waiting} />;
    case "term":
      return <TermFace show={show} />;
    case "msg":
      return <MsgFace show={show} />;
  }
}

/** A text card's name as its face prints it: a sentence keeps its own stop and a title that is
 * one gets a full stop; a bare line (an error, a command, a list) gets none. PURE. */
export function cardTitle(show: { readonly title: string; readonly bare: boolean }): string {
  return show.bare || /[.!?…:]$/u.test(show.title) ? show.title : `${show.title}.`;
}

/** TEXT — the words themselves; the first sentence is their name, run in bold. A drag from
 * another app says only its kind until it is let go (HN-D2). */
function TextFace({
  show,
  waiting,
}: {
  readonly show: { readonly title: string; readonly body: string; readonly bare: boolean };
  readonly waiting: boolean;
}): ReactElement {
  if (waiting) {
    return (
      <div className="vf-card-body">
        <p className="vf-card-words">
          <b>{WAITING_WORDS.text}</b>
        </p>
      </div>
    );
  }
  return (
    <div className="vf-card-body">
      <p className="vf-card-words">
        <b>{cardTitle(show)}</b> {show.body}
      </p>
    </div>
  );
}

/** FILE — its name, where it lives, and its first lines fading into the stock (or its facts when
 * it has no lines). Waiting, it says how many and that letting go shows them. */
function FileFace({
  face,
  waiting,
}: {
  readonly face: FileFaceData;
  readonly waiting: boolean;
}): ReactElement {
  if (waiting) {
    return (
      <div className="vf-card-body">
        <div className="vf-card-name">{face.name === "" ? WAITING_WORDS.file : face.name}</div>
        <div className="vf-card-path">{WAITING_WORDS.letGo}</div>
      </div>
    );
  }
  return (
    <div className="vf-card-body">
      <div className="vf-card-name">{face.name}</div>
      {face.folder !== undefined && <div className="vf-card-path">{face.folder}</div>}
      {face.lines !== undefined && face.lines !== "" ? (
        <pre className="vf-card-lines">{face.lines}</pre>
      ) : face.facts !== undefined ? (
        <div className="vf-card-path" data-facts="">
          {face.facts}
        </div>
      ) : null}
    </div>
  );
}

/** The agent's mark: the SDK's own when it has one for this agent (branding, never behaviour —
 * AR-L1), else the kit's `agents` glyph. */
function CardMark({ agent }: { readonly agent: string | undefined }): ReactElement {
  if (agent !== undefined && agentMark(agent).kind === "path") {
    return <AgentIcon providerId={agent} />;
  }
  return <FieldGlyph name="agents" size={38} />;
}

/** AGENT — the one dark card: its handle, its project behind the project's dot (high on the card,
 * so it shows at rest), its mark, and its state at its foot. */
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

/** A copy that starts at a prompt is named by its command. */
const PROMPT = /^\$\s+/u;
/** The test runner's summary line: a pass, inked. */
const PASSED = /Tests\s+\d+ passed/u;

/** A ✓ in the pass ink. */
function tick(key: number): ReactElement {
  return (
    <span key={key} className="vf-card-pass">
      ✓
    </span>
  );
}

/** What a pane printed, its passes inked — a ✓, and the runner's "Tests N passed" line in bold.
 * A pass is the one colour a terminal card prints. */
function inked(out: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const line of out.split("\n")) {
    if (at > 0) nodes.push("\n");
    if (PASSED.test(line)) {
      nodes.push(<b key={at}>{line}</b>);
    } else {
      let from = 0;
      for (let mark = line.indexOf("✓"); mark >= 0; mark = line.indexOf("✓", from)) {
        nodes.push(line.slice(from, mark), tick(at + mark));
        from = mark + 1;
      }
      nodes.push(line.slice(from));
    }
    at += line.length + 1;
  }
  return nodes;
}

/** TERMINAL — the command is its name; what it printed runs under it, cut by the card's edge as a
 * pane cuts it. A copy that does not start at a prompt is all output. */
function TermFace({ show }: { readonly show: Extract<TextShow, { as: "term" }> }): ReactElement {
  const command = PROMPT.test(show.first) ? show.first.replace(PROMPT, "") : null;
  const parts = command === null ? [show.first, show.rest] : [show.rest];
  const out = parts.filter((part) => part !== "").join("\n");
  return (
    <div className="vf-card-body">
      {command !== null && (
        <div className="vf-card-cmd">
          <span>$</span> {command}
        </div>
      )}
      {out !== "" && <pre className="vf-card-out">{inked(out)}</pre>}
    </div>
  );
}

/** MESSAGE — who said it, then what they said. */
function MsgFace({ show }: { readonly show: Extract<TextShow, { as: "msg" }> }): ReactElement {
  return (
    <div className="vf-card-body">
      <div className="vf-card-who">
        <b>{show.speaker}</b>
        <span>{show.time}</span>
      </div>
      <p className="vf-card-words">{show.words}</p>
    </div>
  );
}

/** A picture's own proportion as its face mounts it: never taller than square, never wider than
 * 2.2, so the face's column always holds it; 1.4 while its size is unknown. PURE. */
export function pictureRatio(size: { readonly width: number; readonly height: number }): number {
  if (size.width <= 0 || size.height <= 0) return 1.4;
  return Math.round(Math.min(2.2, Math.max(1, size.width / size.height)) * 1000) / 1000;
}

/** PICTURE — the picture, printed in the face's column, named under it with its size. Waiting,
 * the capture glyph on a faint ground inside a hairline, and its kind. */
function PictFace({
  picture,
  title,
  waiting,
}: {
  readonly picture: { readonly src: string; readonly width: number; readonly height: number };
  readonly title: string;
  readonly waiting: boolean;
}): ReactElement {
  // A still main no longer keeps (its ring moved on under another window's captures) shows the
  // picture's ground, never a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  const shown = !waiting && picture.src !== "" && broken !== picture.src;
  return (
    <div className="vf-card-body">
      <div
        className="vf-card-photo"
        style={{ "--card-ar": pictureRatio(picture) } as CSSProperties}
        {...(waiting ? { "data-waiting": "" } : {})}
      >
        {waiting && <FieldGlyph name="capture" size={20} />}
        {shown && (
          <img src={picture.src} alt="" draggable={false} onError={() => setBroken(picture.src)} />
        )}
      </div>
      <div className="vf-card-name">{waiting ? WAITING_WORDS.image : title}</div>
      {!waiting && picture.width > 0 && picture.height > 0 && (
        <div className="vf-card-size">{`${picture.width} × ${picture.height}`}</div>
      )}
    </div>
  );
}
