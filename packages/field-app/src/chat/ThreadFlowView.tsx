import type { ComposeSayChip } from "@vibefield/contracts";
import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import { SparkFace, type SparkStatus } from "@vibefield/design-kit/spark-face";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChatStarter } from "./ChatStarter";
import { CrewCardView } from "./CrewCardView";
import type { CrewCard } from "./crew-card";
import { chipWordsOf, FLOW_WORDS, type Flow, type FlowItem } from "./transcript-items";
import { type InlineRun, type MarkdownBlock, markdownBlocksOf } from "./transcript-markdown";
import "./thread-flow.css";

// THE FLOW, DRAWN (TH-1; DESIGN.md §8 "Chat's thread") — controller-free, so the catalog mounts this exact markup on
// fixture lines. The flow scrolls under the thread's head: it opens at its foot and stays there while new rows land;
// scrolled up, it stays where it was put. Your words stand at the right in a bubble with their chips and receipt;
// Vela's beside its face, a still that leads once per run of its rows, drawn in the named subset as text (React
// escapes every run, so nothing an agent writes is markup); its tools one quiet line a turn, opened on a press; the
// hello as the first row; Thinking… at the foot. Each row's root says its kind (`data-row`).

export interface ThreadFlowViewProps {
  flow: Flow;
  /** the spark's name, as the flow's own words say it */
  name: string;
  /** the spark's face, for the leads (stills) */
  face: { readonly seed: number; readonly status: SparkStatus };
  /** a starter pressed in the hello: its words, sent as Send sends (absent: the catalog) */
  onStarter?: ((words: string) => void) | undefined;
  /** a send into the thread runs: the starters wait */
  sending?: boolean | undefined;
  /** ES-4 — this Mac's agents and board are being read: the hello's starters hold their places, wordless */
  startersHeld?: boolean | undefined;
  /** "Earlier conversations" pressed */
  onEarlier?: (() => void) | undefined;
  /** the tool lines that open drawn opened (their keys): a catalog plate's */
  opened?: readonly string[] | undefined;
  /** SP-1e2 — each crew's card, by its id, hung under its act line (`crewCardsOf`; absent: none) */
  crews?: ReadonlyMap<string, CrewCard> | undefined;
  /** a crew card's row pressed: that member's pane in Godview (absent: the catalog) */
  onCrewRow?: ((runtimeRunId: string) => void) | undefined;
  /** a crew card's Open in Godview pressed (absent: the catalog) */
  onOpenGodview?: (() => void) | undefined;
  /** the members whose reveal runs now */
  revealing?: ReadonlySet<string> | undefined;
}

const ACT_GLYPHS: Readonly<Record<string, GlyphName>> = {
  wake: "resume",
  answer: "check",
  notify: "message",
  crew: "agents",
};

export function ThreadFlowView({
  flow,
  name,
  face,
  onStarter,
  sending = false,
  startersHeld = false,
  onEarlier,
  opened,
  crews,
  onCrewRow,
  onOpenGodview,
  revealing,
}: ThreadFlowViewProps): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(opened));
  const items = flow.state === "ready" ? flow.items : null;
  // it opens at its foot, and follows new rows while it is there
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || items === null || !atFoot.current) return;
    element.scrollTop = element.scrollHeight;
  }, [items]);
  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;
    atFoot.current = element.scrollHeight - element.scrollTop - element.clientHeight < 4;
  }, []);
  const toggle = useCallback((key: string) => {
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  if (flow.state !== "ready") {
    return (
      <div className="vf-chat-flow" data-flow-state={flow.state}>
        <p className="vf-chat-flow-words" role="status">
          {flow.state === "reading"
            ? FLOW_WORDS.reading(name)
            : FLOW_WORDS.unreadable(name, flow.reason)}
        </p>
      </div>
    );
  }
  const lead = (shown: boolean): ReactElement =>
    shown ? (
      <SparkFace seed={face.seed} status={face.status} size={28} />
    ) : (
      <span className="vf-chat-msg-gap" aria-hidden="true" />
    );
  const row = (item: FlowItem): ReactElement => {
    switch (item.kind) {
      case "earlier":
        return (
          <button
            key={item.key}
            type="button"
            className="vf-chat-flow-earlier"
            data-row="earlier"
            onClick={onEarlier}
          >
            <FieldGlyph name="chevron" size={13} turn={270} />
            <span>{FLOW_WORDS.earlier(item.count)}</span>
          </button>
        );
      case "day":
        return (
          <div key={item.key} className="vf-chat-day" data-row="day">
            {item.words}
          </div>
        );
      case "honest":
        return (
          <p key={item.key} className="vf-chat-honest" data-row="honest" data-honest={item.which}>
            {item.words}
          </p>
        );
      case "hello":
        return (
          <div key={item.key} className="vf-chat-msg" data-row="hello">
            <SparkFace seed={item.face.seed} status={item.face.status} size={28} />
            <div className="vf-chat-msg-body">
              <p className="vf-chat-reply-text">{item.words}</p>
              <div className="vf-chat-starters" {...(sending ? { "aria-busy": true } : {})}>
                {item.starters.map((starter) => (
                  <ChatStarter
                    key={starter.glyph}
                    starter={starter}
                    held={startersHeld}
                    onPress={() => {
                      if (!sending) onStarter?.(starter.words);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      case "you":
        return (
          <div key={item.key} className="vf-chat-you" data-row="you">
            <p className="vf-chat-bubble">{bubbleOf(item.text, item.chips)}</p>
            {item.receipt === null ? null : (
              <span
                className="vf-chat-receipt"
                {...(item.receipt.tone === undefined ? {} : { "data-tone": item.receipt.tone })}
              >
                {item.receipt.words}
              </span>
            )}
          </div>
        );
      case "reply":
        return (
          <div key={item.key} className="vf-chat-msg" data-row="reply">
            {lead(item.lead)}
            <div className="vf-chat-reply-text">{blocksOf(markdownBlocksOf(item.text))}</div>
          </div>
        );
      case "tools": {
        const opened = open.has(item.key);
        return (
          <div key={item.key} className="vf-chat-msg" data-row="tools" data-quiet="">
            {lead(item.lead)}
            <div className="vf-chat-msg-body">
              <button
                type="button"
                className="vf-chat-quiet"
                aria-expanded={opened}
                onClick={() => toggle(item.key)}
              >
                <FieldGlyph name="code" size={13} />
                <span>{item.words}</span>
              </button>
              {opened ? (
                <ul className="vf-chat-tool-rows">
                  {item.rows.map((tool, index) => (
                    // a turn's tools in the order asked, never reordered; none has an id of its own here
                    <li key={index}>
                      <span>{tool.words}</span>
                      {tool.detail === undefined ? null : (
                        <code className="vf-chat-tool-detail">{tool.detail}</code>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        );
      }
      case "act": {
        const glyph = ACT_GLYPHS[item.what];
        const line = (
          <p className="vf-chat-quiet" data-act={item.what}>
            {glyph === undefined ? null : <FieldGlyph name={glyph} size={13} />}
            <span>{item.words}</span>
          </p>
        );
        // SP-1e2 — a crew's card hangs under its act line, by the crew's id; with none, the line stands alone
        const card = item.crew === undefined ? undefined : crews?.get(item.crew);
        if (card === undefined)
          return (
            <div key={item.key} className="vf-chat-msg" data-row="act" data-quiet="">
              {lead(item.lead)}
              {line}
            </div>
          );
        return (
          <div key={item.key} className="vf-chat-msg" data-row="act" data-crew="">
            {lead(item.lead)}
            <div className="vf-chat-msg-body">
              {line}
              <CrewCardView
                card={card}
                onRow={onCrewRow}
                onOpenGodview={onOpenGodview}
                revealing={revealing}
              />
            </div>
          </div>
        );
      }
      case "thinking":
        return (
          <div key={item.key} className="vf-chat-msg" data-row="thinking" data-quiet="">
            {lead(item.lead)}
            <p className="vf-chat-quiet vf-chat-thinking" role="status">
              <span className="vf-chat-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>{FLOW_WORDS.thinking}</span>
            </p>
          </div>
        );
    }
  };
  return (
    <div className="vf-chat-flow" data-flow-state="ready" ref={scroller} onScroll={onScroll}>
      <div className="vf-chat-flow-col">{items?.map(row)}</div>
    </div>
  );
}

/** Your words, their chips drawn as chips from the record's spans. */
function bubbleOf(text: string, chips: readonly ComposeSayChip[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const chip of chips) {
    if (chip.start > at) out.push(text.slice(at, chip.start));
    out.push(
      <span key={`chip:${chip.start}`} className="vf-chat-bubble-chip" data-chip={chip.kind}>
        {chipWordsOf(text, chip)}
      </span>,
    );
    at = chip.start + chip.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function blocksOf(blocks: readonly MarkdownBlock[]): ReactNode[] {
  return blocks.map((block, index) => blockOf(block, `${block.kind}:${index}`));
}

function blockOf(block: MarkdownBlock, key: string): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return (
        <p key={key}>
          {block.strong ? <strong>{linesOf(block.lines)}</strong> : linesOf(block.lines)}
        </p>
      );
    case "code":
      return (
        <pre key={key} className="vf-chat-code">
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      // a reply's list never reorders
      const items = block.items.map((item, at) => <li key={at}>{linesOf(item)}</li>);
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "quote":
      return <blockquote key={key}>{blocksOf(block.blocks)}</blockquote>;
  }
}

/** A block's lines, its line breaks kept. */
function linesOf(lines: readonly (readonly InlineRun[])[]): ReactNode[] {
  return lines.flatMap((line, index) => [
    ...(index === 0 ? [] : [<br key={`br:${index}`} />]),
    ...runsOf(line, `l${index}`),
  ]);
}

function runsOf(runs: readonly InlineRun[], key: string): ReactNode[] {
  return runs.map((run, index) => runOf(run, `${key}:${index}`));
}

function runOf(run: InlineRun, at: string): ReactNode {
  switch (run.kind) {
    case "text":
      return run.text;
    case "code":
      return <code key={at}>{run.text}</code>;
    case "bold":
      return <strong key={at}>{runsOf(run.runs, at)}</strong>;
    case "italic":
      return <em key={at}>{runsOf(run.runs, at)}</em>;
  }
}
