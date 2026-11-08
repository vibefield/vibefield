import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import { SparkNight } from "@vibefield/design-kit/spark-face";
import type { ReactElement } from "react";
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

export interface ChatEmptyViewProps {
  /** what the night knows of this device's agents (`useNightAgents`); absent, they are being read, and it is live */
  agents?: NightAgents;
  /** the first jobs it offers: the hello's starters (ES-4 fills their words from this Mac) */
  jobs?: readonly Starter[];
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

export function ChatEmptyView({
  agents = READING,
  jobs = STARTERS,
  keys = "mac",
  active = true,
  onNewSpark,
  onJob,
  onAgents,
}: ChatEmptyViewProps): ReactElement {
  const create = createActOf("assistant", keys);
  // Off (§7): the agents that can be a spark, none of them here; null, live
  const away = nightOffNames(agents);
  return (
    <div className="vf-chat-empty vf-on-night">
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
        >
          <FieldGlyph name={create.glyph} size={16} />
          <span>{create.name}</span>
          {create.key === null ? null : <kbd className="vf-chat-empty-key">{create.key}</kbd>}
        </UiButton>
        {away === null ? (
          <>
            <p className="vf-chat-empty-or">Or give it a first job</p>
            <div className="vf-chat-empty-jobs">
              {jobs.map((job) => (
                <ChatStarter key={job.glyph} starter={job} onPress={() => onJob?.(job)} />
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
