import type { SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { ChatComposerView } from "../chat/ChatComposerView";
import { ChatPanelView, shownOf } from "../chat/ChatPanelView";
import { draftBlank } from "../chat/composer-draft";
import { SparkPaneView } from "../chat/SparkPaneView";
import { threadItemsOf, threadQuiet } from "../chat/thread-items";
import { threadMarksOf } from "../chat/thread-marks";
import {
  CHAT_CHOSEN,
  CHAT_COMPOSER,
  CHAT_LATCHES,
  CHAT_PANE,
  CHAT_STATE_LABEL,
  CHAT_STATES,
  type ChatState,
  chatReadingOf,
  FIXTURE_NOW,
} from "./chat-fixtures";

// Chat on fixtures (SP-1b, SP-1d, CP-3; docs/UI_SYSTEM.md): the SHIPPING panel (`ChatPanelView`) over the product's
// own reading of fixture sparks, rows and, on the waiting plate, the needs-you queue's items (`chat-fixtures.ts`).
// What it replaces is only what a host supplies — fieldd's answers, the clock, the acts (Wake and Send answer nothing
// here) and the thread's pane: a catalog holds no terminals, so the pane's place shows the shipping `SparkPaneView`'s
// words, never the live pane. The thread's composer is the shipping `ChatComposerView` on the plate's fixture draft
// and @ rows, never its controller. What stands in the thread over its pane is the product's own reading
// (`threadItemsOf`) of the shown spark and the plate's draft: a new spark's hello, whose starters send nothing here.
// Each row's mark is the product's own reading (`threadMarksOf`) of what the plates' window saw off screen. The markup
// and the CSS are the product's.

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
  const drafted = CHAT_COMPOSER[state];
  const composer =
    shown === undefined ? undefined : <ChatComposerView name={shown.spark.name} {...drafted} />;
  // a catalog window has sent nothing, and its pane holds no keyboard: the hello leaves only for a draft
  const items =
    shown === undefined
      ? []
      : threadItemsOf(shown, threadQuiet(shown, draftBlank(drafted?.seed ?? []), false));
  const marks = threadMarksOf(reading.state === "ready" ? reading.entries : [], CHAT_LATCHES);
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={FIXTURE_NOW}
      marks={marks}
      onChoose={setChosen}
      {...(pane === undefined ? {} : { pane })}
      items={items}
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
