import type { SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { ChatComposerView } from "../chat/ChatComposerView";
import { ChatPanelView, shownOf } from "../chat/ChatPanelView";
import { SparkPaneView } from "../chat/SparkPaneView";
import {
  CHAT_CHOSEN,
  CHAT_COMPOSER,
  CHAT_PANE,
  CHAT_STATE_LABEL,
  CHAT_STATES,
  type ChatState,
  chatReadingOf,
  FIXTURE_NOW,
} from "./chat-fixtures";

// Chat on fixtures (SP-1b, SP-1d; docs/UI_SYSTEM.md): the SHIPPING panel (`ChatPanelView`) over the product's own
// reading of fixture sparks and rows (`chat-fixtures.ts`). What it replaces is only what a host supplies — fieldd's
// answers, the clock, the acts (Wake and Send answer nothing here) and the thread's pane: a catalog holds no terminals,
// so the pane's place shows the shipping `SparkPaneView`'s words, never the live pane. The thread's composer is the
// shipping `ChatComposerView` on the plate's fixture draft and @ rows, never its controller. The markup and the CSS
// are the product's.

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
  const composer =
    shown === undefined ? undefined : (
      <ChatComposerView name={shown.spark.name} {...CHAT_COMPOSER[state]} />
    );
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={FIXTURE_NOW}
      onChoose={setChosen}
      {...(pane === undefined ? {} : { pane })}
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
