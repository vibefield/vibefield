import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import { SparkNight } from "@vibefield/design-kit/spark-face";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { hearLineCreateOver } from "../frame/line-door";
import { ariaKeys, createActOf } from "../frame/line-model";
import type { ViewKeys } from "../frame/views";
import { ChatStarter } from "./ChatStarter";
import { type NightAgents, nightOffNames, offWords } from "./night-agents";
import { STARTERS, type Starter } from "./thread-items";
import "./chat-empty.css";

// CHAT, EMPTY: THE NIGHT (track ES; ES-D1…D7 A, ruled by James on the ES page *The night that becomes the window*,
// 2026-11-08; DESIGN.md §8 "Chat's list", Empty: the night; §2.4 "On the night, the night's ink"; §5 night glass; §9
// Chat's words). With no spark, Chat's whole panel is the hatch's night (`SparkNight`, §2.10), edge to edge at its
// corners; on it, in the night's ink (`.vf-on-night`), one column: the headline, the sentence, New spark (the line's
// create, the same door, its key printed on it) and, under "Or give it a first job", the hello's three starters in
// night glass (`ChatStarter`, ES-D2 A). With no agent here that can be a spark (`night-agents.ts`) New spark is Off
// from the kit's own button, the sentence under it names the agents that can, Open Agents settings opens Settings →
// Agents, and no job is offered. Controller-free: the product (`ChatView`) hands it the agents read and its acts, the
// catalog fixtures. ES-2 carries a job into the sheet; ES-3 leans the night and closes it into the sheet's sky.
// ES-3a (§6, the lean): under the pointer or the keyboard's focus, New spark, a job or the line's ✦ (the frame's word,
// `hearLineCreateOver`, heard while Chat is the view) leans the night (`data-lean`), until none has held it for 90ms.

export interface ChatEmptyViewProps {
  /** what the night knows of this device's agents (`useNightAgents`); absent, they are being read, and it is live */
  agents?: NightAgents;
  /** the first jobs it offers: the hello's starters, filled from this Mac (ES-4, `starters.ts`) */
  jobs?: readonly Starter[];
  /** ES-4 — this Mac's agents and board are being read: the jobs hold their places in night glass, wordless */
  held?: boolean | undefined;
  /** the window's keys: New spark's printed key, ⌘N on a Mac and Ctrl+N elsewhere (the line's own spelling) */
  keys?: ViewKeys;
  /** Chat is the view showing: the night moves under §6's rest rule; hidden, it holds still */
  active?: boolean;
  /** New spark pressed: the New spark sheet, as the line's ✦ and ⌘N open it */
  onNewSpark?: (() => void) | undefined;
  /** a first job pressed: the sheet, carrying it (ES-2) */
  onJob?: ((job: Starter) => void) | undefined;
  /** Open Agents settings pressed, while Off: Settings → Agents */
  onAgents?: (() => void) | undefined;
}

const READING: NightAgents = { state: "reading" };

/** How long the lean stands once nothing holds it (DESIGN.md §6, the lean): a pointer passing between New spark and a
 * job never lets it go. */
const LEAN_LETS_GO_MS = 90;

/** The lean (ES-3a): who holds the night leaning — New spark, a job, the line's ✦, each by the pointer or the
 * keyboard's focus, held apart — and whether one does, or did within the last 90ms. */
function useLean(active: boolean): {
  readonly leaning: boolean;
  readonly hold: (who: string, held: boolean) => void;
  readonly drop: (prefix: string) => void;
} {
  const [leaning, setLeaning] = useState(false);
  const holders = useRef(new Set<string>());
  const letGo = useRef<number | undefined>(undefined);
  const settle = useCallback(() => {
    window.clearTimeout(letGo.current);
    letGo.current = undefined;
    if (holders.current.size > 0) {
      setLeaning(true);
      return;
    }
    letGo.current = window.setTimeout(() => {
      letGo.current = undefined;
      setLeaning(false);
    }, LEAN_LETS_GO_MS);
  }, []);
  const hold = useCallback(
    (who: string, held: boolean) => {
      if (held) holders.current.add(who);
      else if (!holders.current.delete(who)) return;
      settle();
    },
    [settle],
  );
  // a holder that leaves the page leaves no pointerleave or blur behind it: its holds go with it
  const drop = useCallback(
    (prefix: string) => {
      let dropped = false;
      for (const who of holders.current)
        if (who.startsWith(prefix)) dropped = holders.current.delete(who) || dropped;
      if (dropped) settle();
    },
    [settle],
  );
  // the line's ✦, while Chat is the view: the frame says, the night hears
  useEffect(() => {
    if (!active) return;
    const stop = hearLineCreateOver((over) => hold("line", over));
    return () => {
      stop();
      hold("line", false);
    };
  }, [active, hold]);
  useEffect(() => () => window.clearTimeout(letGo.current), []);
  return { leaning, hold, drop };
}

export function ChatEmptyView({
  agents = READING,
  jobs = STARTERS,
  held = false,
  keys = "mac",
  active = true,
  onNewSpark,
  onJob,
  onAgents,
}: ChatEmptyViewProps): ReactElement {
  const create = createActOf("assistant", keys);
  // Off (§7): the agents that can be a spark, none of them here; null, live
  const away = nightOffNames(agents);
  const { leaning, hold, drop } = useLean(active);
  // Off, the jobs leave, and New spark can be held by nothing: their holds go with them
  useEffect(() => {
    if (away === null) return;
    drop("job:");
    drop("new:");
  }, [away, drop]);
  return (
    <div className="vf-chat-empty vf-on-night" {...(leaning ? { "data-lean": "true" } : {})}>
      <SparkNight active={active} />
      <div className="vf-chat-empty-hush" aria-hidden="true" />
      <div className="vf-chat-empty-column">
        <h2 className="vf-chat-empty-title">Make your first spark</h2>
        <p className="vf-chat-empty-sentence">
          A spark is an agent VibeField starts to run your other agents.
        </p>
        <UiButton
          variant="primary"
          className="vf-chat-empty-new"
          disabled={away !== null}
          {...(create.key === null ? {} : { "aria-keyshortcuts": ariaKeys(create.key) })}
          onClick={() => onNewSpark?.()}
          onPointerEnter={() => hold("new:pointer", true)}
          onPointerLeave={() => hold("new:pointer", false)}
          onFocus={() => hold("new:focus", true)}
          onBlur={() => hold("new:focus", false)}
        >
          <FieldGlyph name={create.glyph} size={16} />
          <span>{create.name}</span>
          {create.key === null ? null : <kbd className="vf-chat-empty-key">{create.key}</kbd>}
        </UiButton>
        {away === null ? (
          <>
            <p className="vf-chat-empty-or">Or give it a first job</p>
            <div className="vf-chat-empty-jobs">
              {jobs.map((job, index) => (
                <ChatStarter
                  key={job.glyph}
                  starter={job}
                  held={held}
                  onPress={() => onJob?.(job)}
                  onHold={(by, held) => hold(`job:${index}:${by}`, held)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="vf-chat-empty-why">{offWords(away)}</p>
            <UiButton className="vf-chat-empty-agents" onClick={() => onAgents?.()}>
              Open Agents settings
            </UiButton>
          </>
        )}
      </div>
    </div>
  );
}
