import type { SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { ChatComposerView } from "../chat/ChatComposerView";
import { ChatPanelView, shownOf } from "../chat/ChatPanelView";
import { draftBlank } from "../chat/composer-draft";
import { waitingCardOf } from "../chat/needs-card";
import { SparkPaneView } from "../chat/SparkPaneView";
import { ThreadFlowView } from "../chat/ThreadFlowView";
import { threadItemsOf, threadQuiet } from "../chat/thread-items";
import { transcriptItemsOf } from "../chat/transcript-items";
import {
  CHAT_ACT,
  CHAT_CHOSEN,
  CHAT_COMPOSER,
  CHAT_FLOW,
  CHAT_PANE,
  CHAT_SENDING,
  CHAT_STATE_LABEL,
  CHAT_STATES,
  type ChatState,
  chatHandlesOf,
  chatMarksOf,
  chatReadingOf,
  FIXTURE_NOW,
} from "./chat-fixtures";

// Chat on fixtures (SP-1b, SP-1d, CP-3; docs/UI_SYSTEM.md): the SHIPPING panel (`ChatPanelView`) over the product's
// own reading of fixture sparks, rows and, on the waiting plate, the needs-you queue's items (`chat-fixtures.ts`).
// What it replaces is only what a host supplies — fieldd's answers, the clock, the acts (Wake and Send answer nothing
// here; a plate's act under way or refused, `CHAT_ACT`, is handed to the panel as Chat's controller hands it) and the
// thread's pane: a catalog holds no terminals, so the pane's place shows the shipping `SparkPaneView`'s words, never
// the live pane. The thread's composer is the shipping `ChatComposerView` on the plate's fixture draft and @ rows,
// never its controller. What stands in the thread over its pane is the product's own reading (`threadItemsOf`) of the
// shown spark and the plate's draft: a new spark's hello, whose starters send nothing here, or on the waiting plate
// the needs-you card (`waitingCardOf`), its sessions named as the thread's @ names them (`chatHandlesOf`, the
// product's `sessionHandlesOf` on the fixture board), whose acts answer nothing here. A plate whose thread an act holds
// (`CHAT_SENDING`) hands that one fact to both, as Chat's controller does: Wake and the starters wait and send is
// busy. Each row's mark is the product's own ledger and reading (`chatMarksOf`: `ThreadLedger`, `threadMarksOf`) over
// what the plates' window read, the shown thread on screen. TH-1: the thread's plates (`CHAT_FLOW`) hand the panel the
// shipping `ThreadFlowView` over the product's own projection (`transcriptItemsOf`) of fixture record lines, read as
// the reader reads them (`transcriptReadingOf`), in the pane's place. The markup and the CSS are the product's.

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
  const place = CHAT_PANE[state];
  const shown = reading.state === "ready" ? shownOf(reading.entries, chosen) : undefined;
  const pane =
    place === undefined || shown === undefined ? undefined : (
      <SparkPaneView name={shown.spark.name} {...place} />
    );
  // TH-1 — a plate whose thread is drawn: the shipping flow over the product's own projection of its fixture lines,
  // standing in the pane's place
  const drawn = CHAT_FLOW[state];
  const flow =
    drawn === undefined || shown === undefined ? undefined : (
      <ThreadFlowView
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
        opened={drawn.opened}
      />
    );
  const drafted = CHAT_COMPOSER[state];
  const sending = CHAT_SENDING.has(state);
  const composer =
    shown === undefined ? undefined : (
      <ChatComposerView name={shown.spark.name} {...drafted} busy={sending} />
    );
  // a catalog window has sent nothing, and its pane holds no keyboard: the hello leaves only for a draft; it answers
  // nothing, so a thread with something waiting on you stands that card (the waiting plate's)
  const items =
    shown === undefined || flow !== undefined
      ? []
      : threadItemsOf(
          shown,
          threadQuiet(shown, draftBlank(drafted?.seed ?? []), false),
          waitingCardOf(shown, { handles: chatHandlesOf(shown.spark) }),
        );
  const marks = chatMarksOf(
    reading.state === "ready" ? reading.entries : [],
    shown?.spark.id ?? null,
  );
  const act = CHAT_ACT[state];
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={FIXTURE_NOW}
      marks={marks}
      onChoose={setChosen}
      {...(act === undefined ? {} : { act })}
      {...(pane === undefined ? {} : { pane })}
      {...(flow === undefined ? {} : { flow })}
      items={items}
      sending={sending}
      {...(composer === undefined ? {} : { composer })}
      {...(locale === undefined ? {} : { locale })}
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
