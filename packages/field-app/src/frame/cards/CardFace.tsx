import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { agentMark } from "@vibefield/puppeteer-view-sdk/toolkit";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import type {
  AgentCard,
  Card,
  CardKind,
  FileCard,
  MsgCard,
  PictCard,
  TermCard,
  TextCard,
} from "./cards-model";
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

/** The index each kind prints in its corners: a fanned hand is read by them. */
export const CARD_INDEX: Readonly<Record<CardKind, GlyphName>> = {
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
  const index = CARD_INDEX[card.kind];
  return (
    <div
      className="vf-card"
      data-kind={card.kind}
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
          <FieldGlyph name="close" size={9} />
        </button>
      )}
    </div>
  );
}

function faceOf(card: Card): ReactElement {
  switch (card.kind) {
    case "text":
      return <TextFace card={card} />;
    case "file":
      return <FileFace card={card} />;
    case "agent":
      return <AgentFace card={card} />;
    case "term":
      return <TermFace card={card} />;
    case "msg":
      return <MsgFace card={card} />;
    case "pict":
      return <PictFace card={card} />;
  }
}

/** A text card's name as its face prints it: a sentence keeps its own stop and a title that is
 * one gets a full stop; a bare line (an error, a command, a list) gets none. PURE. */
export function cardTitle(card: TextCard): string {
  return card.bare || /[.!?…:]$/u.test(card.title) ? card.title : `${card.title}.`;
}

/** TEXT — the words themselves; the first sentence is their name, run in bold. A drag from
 * another app says only its kind until it is let go (HN-D2). */
function TextFace({ card }: { readonly card: TextCard }): ReactElement {
  if (card.waiting === true) {
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
        <b>{cardTitle(card)}</b> {card.body}
      </p>
    </div>
  );
}

/** FILE — its name, where it lives, and its first lines fading into the stock (or its facts when
 * it has no lines). Waiting, it says how many and that letting go shows them. */
function FileFace({ card }: { readonly card: FileCard }): ReactElement {
  if (card.waiting === true) {
    return (
      <div className="vf-card-body">
        <div className="vf-card-name">{card.name === "" ? WAITING_WORDS.file : card.name}</div>
        <div className="vf-card-path">{WAITING_WORDS.letGo}</div>
      </div>
    );
  }
  return (
    <div className="vf-card-body">
      <div className="vf-card-name">{card.name}</div>
      {card.folder !== undefined && <div className="vf-card-path">{card.folder}</div>}
      {card.lines !== undefined && card.lines !== "" ? (
        <pre className="vf-card-lines">{card.lines}</pre>
      ) : card.facts !== undefined ? (
        <div className="vf-card-path" data-facts="">
          {card.facts}
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
function AgentFace({ card }: { readonly card: AgentCard }): ReactElement {
  return (
    <>
      <div className="vf-card-body">
        <div className="vf-card-handle">{card.handle}</div>
        {card.project !== undefined && (
          <div className="vf-card-project">
            {card.projectInk !== undefined && (
              <i
                aria-hidden="true"
                style={{ "--card-project": projectInk(card.projectInk) } as CSSProperties}
              />
            )}
            {card.project}
          </div>
        )}
        <div className="vf-card-mark">
          <CardMark agent={card.agent} />
        </div>
      </div>
      {card.state !== undefined && (
        <div
          className="vf-card-state"
          data-tone={card.state === "waiting" ? "attention" : card.state}
        >
          <i aria-hidden="true" />
          {AGENT_STATE_WORDS[card.state]}
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
function TermFace({ card }: { readonly card: TermCard }): ReactElement {
  const command = PROMPT.test(card.first) ? card.first.replace(PROMPT, "") : null;
  const parts = command === null ? [card.first, card.rest] : [card.rest];
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
function MsgFace({ card }: { readonly card: MsgCard }): ReactElement {
  return (
    <div className="vf-card-body">
      <div className="vf-card-who">
        <b>{card.speaker}</b>
        <span>{card.time}</span>
      </div>
      <p className="vf-card-words">{card.words}</p>
    </div>
  );
}

/** A picture's own proportion as its face mounts it: never taller than square, never wider than
 * 2.2, so the face's column always holds it; 1.4 while its size is unknown. PURE. */
export function pictureRatio(card: PictCard): number {
  if (card.width <= 0 || card.height <= 0) return 1.4;
  return Math.round(Math.min(2.2, Math.max(1, card.width / card.height)) * 1000) / 1000;
}

/** PICTURE — the picture, printed in the face's column, named under it with its size. Waiting,
 * the capture glyph on a faint ground inside a hairline, and its kind. */
function PictFace({ card }: { readonly card: PictCard }): ReactElement {
  // A still main no longer keeps (its ring moved on under another window's captures) shows the
  // picture's ground, never a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  const waiting = card.waiting === true;
  const shown = !waiting && card.src !== "" && broken !== card.src;
  return (
    <div className="vf-card-body">
      <div
        className="vf-card-photo"
        style={{ "--card-ar": pictureRatio(card) } as CSSProperties}
        {...(waiting ? { "data-waiting": "" } : {})}
      >
        {waiting && <FieldGlyph name="capture" size={20} />}
        {shown && (
          <img src={card.src} alt="" draggable={false} onError={() => setBroken(card.src)} />
        )}
      </div>
      <div className="vf-card-name">{waiting ? WAITING_WORDS.image : card.title}</div>
      {!waiting && card.width > 0 && card.height > 0 && (
        <div className="vf-card-size">{`${card.width} × ${card.height}`}</div>
      )}
    </div>
  );
}
