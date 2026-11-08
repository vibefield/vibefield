import type { SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { ChatComposerView } from "../chat/ChatComposerView";
import { ChatEmptyView } from "../chat/ChatEmptyView";
import { ChatPanelView, shownOf } from "../chat/ChatPanelView";
import { waitingCardOf } from "../chat/needs-card";
import { ThreadFlowView } from "../chat/ThreadFlowView";
import { footItemsOf } from "../chat/thread-items";
import { transcriptItemsOf } from "../chat/transcript-items";
import {
  CHAT_ACT,
  CHAT_CHOSEN,
  CHAT_COMPOSER,
  CHAT_JUMPING,
  CHAT_NIGHT,
  CHAT_PAUSE,
  CHAT_SENDING,
  CHAT_STATE_LABEL,
  CHAT_STATES,
  type ChatState,
  chatFlowOf,
  chatHandlesOf,
  chatMarksOf,
  chatReadingOf,
  FIXTURE_NOW,
} from "./chat-fixtures";

// Chat on fixtures (SP-1b, SP-1d, CP-3, TH-1; docs/UI_SYSTEM.md): the SHIPPING panel (`ChatPanelView`) over the
// product's own reading of fixture sparks, rows and, on the waiting plate, the needs-you queue's items
// (`chat-fixtures.ts`). What it replaces is only what a host supplies — fieldd's answers, the clock and the acts (Wake
// and Send answer nothing here; a plate's act under way or refused, `CHAT_ACT`, is handed to the panel as Chat's
// controller hands it). Every shown thread is drawn (TH-1): the shipping `ThreadFlowView` over the product's own
// projection (`transcriptItemsOf`) of fixture record lines, read as the reader reads them (`transcriptReadingOf`): the
// plate's own conversation (`CHAT_FLOW`), else the shown spark's (`chatFlowOf`), a new spark's hello its first row,
// whose starters send nothing here. The thread's composer is the shipping `ChatComposerView` on the plate's fixture
// draft and @ rows, never its controller. The thread's foot holds, on the waiting plates, the needs-you card
// (`waitingCardOf`), its sessions named as the thread's @ names them (`chatHandlesOf`, the product's
// `sessionHandlesOf` on the fixture board), whose acts answer nothing here. A plate whose thread an act holds
// (`CHAT_SENDING`) hands that one fact to the head, the flow and the composer, as Chat's controller does: Wake and the
// starters wait and send is busy. Each row's mark is the product's own ledger and reading (`chatMarksOf`:
// `ThreadLedger`, `threadMarksOf`) over what the plates' window read, the shown thread on screen. TH-2: the head's act
// is the shipping head's on the plate's reading — Jump to, Wake, and Pause current turn while Juno works — answering
// nothing here, as Wake and Send answer nothing; a plate's Jump to under way (`CHAT_JUMPING`) and its own Pause
// (`CHAT_PAUSE`) are handed to the panel as Chat's controller hands them. The markup and the CSS are the product's.
// Track ES: the empty plates are the shipping night (`ChatEmptyView`) on the plate's agents (`CHAT_NIGHT`) — live, Off,
// and a short panel, where the jobs step aside — whose acts open nothing here.
// *Amended 2026-11-05 (TH-1, the pane leaves Chat):* the pane's place showed the shipping `SparkPaneView`'s words on
// the plates with no conversation (`CHAT_PANE`: finding, off the floor, no answer, no terminals), and the hello stood
// over it (`threadItemsOf`). They are in git.

/** One of Chat's states, in the cover's place, on the frame's ground. */
export function ChatPreview({
  state = "list",
  locale,
}: {
  state?: ChatState;
  locale?: string;
}): ReactElement {
  const [chosen, setChosen] = useState<SparkId | null>(CHAT_CHOSEN[state]);
  const reading = chatReadingOf(state);
  const shown = reading.state === "ready" ? shownOf(reading.entries, chosen) : undefined;
  const sending = CHAT_SENDING.has(state);
  // TH-1 — every shown thread drawn: the shipping flow over the product's own projection of its fixture lines
  const drawn = shown === undefined ? undefined : chatFlowOf(state, shown.spark.id);
  const flow =
    drawn === undefined || shown === undefined ? undefined : (
      <ThreadFlowView
        key={shown.spark.id}
        flow={transcriptItemsOf({
          entry: shown,
          reading: drawn.reading,
          pending: drawn.pending,
          earlier: drawn.earlier,
          now: FIXTURE_NOW,
          locale,
        })}
        name={shown.spark.name}
        face={{ seed: shown.spark.face.seed, status: shown.status }}
        sending={sending}
        opened={drawn.opened}
      />
    );
  const drafted = CHAT_COMPOSER[state];
  const composer =
    shown === undefined ? undefined : (
      <ChatComposerView name={shown.spark.name} {...drafted} busy={sending} />
    );
  // a catalog window answers nothing, so a thread with something waiting on you stands that card (the waiting plates')
  const card =
    shown === undefined ? null : waitingCardOf(shown, { handles: chatHandlesOf(shown.spark) });
  const items = footItemsOf(card);
  const marks = chatMarksOf(
    reading.state === "ready" ? reading.entries : [],
    shown?.spark.id ?? null,
  );
  const act = CHAT_ACT[state];
  const pause = CHAT_PAUSE[state];
  const night = CHAT_NIGHT[state];
  const empty = <ChatEmptyView {...(night === undefined ? {} : { agents: night })} />;
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={FIXTURE_NOW}
      marks={marks}
      onChoose={setChosen}
      {...(act === undefined ? {} : { act })}
      jumping={CHAT_JUMPING.has(state)}
      {...(pause === undefined ? {} : { pause })}
      {...(flow === undefined ? {} : { flow })}
      items={items}
      sending={sending}
      {...(composer === undefined ? {} : { composer })}
      {...(locale === undefined ? {} : { locale })}
      empty={empty}
    />
  );
}

/** The specimen: every state on a control, one plate at the window's size. */
export function ChatSpecimen(): ReactElement {
  const [state, setState] = useState<ChatState>("list");
  return (
    <div className="vf-ds-chat-preview">
      <div className="vf-ds-frame-controls">
        <SegmentedControl
          options={CHAT_STATES.map((entry) => CHAT_STATE_LABEL[entry])}
          value={CHAT_STATE_LABEL[state]}
          onChange={(label) => {
            const next = CHAT_STATES.find((entry) => CHAT_STATE_LABEL[entry] === label);
            if (next !== undefined) setState(next);
          }}
          label="Chat state"
        />
      </div>
      <div className="vf-ds-chat-plate" data-state={state}>
        <ChatPreview key={state} state={state} />
      </div>
    </div>
  );
}
