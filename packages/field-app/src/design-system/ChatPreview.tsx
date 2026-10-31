import type { SparkId } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { ChatPanelView } from "../chat/ChatPanelView";
import {
  CHAT_CHOSEN,
  CHAT_STATE_LABEL,
  CHAT_STATES,
  type ChatState,
  chatReadingOf,
  FIXTURE_NOW,
} from "./chat-fixtures";

// Chat on fixtures (SP-1b; docs/UI_SYSTEM.md): the SHIPPING panel (`ChatPanelView`) over the product's own reading of
// fixture sparks and rows (`chat-fixtures.ts`). What it replaces is only what a host supplies — fieldd's answers, the
// clock, and the acts (Show and Wake answer nothing here). The markup and the CSS are the product's.

/** One of Chat's states, in the cover's place, on the frame's ground. */
export function ChatPreview({
  state = "list",
  locale,
}: {
  state?: ChatState;
  locale?: string;
}): ReactElement {
  const [chosen, setChosen] = useState<SparkId | null>(CHAT_CHOSEN[state]);
  return (
    <ChatPanelView
      reading={chatReadingOf(state)}
      chosen={chosen}
      now={FIXTURE_NOW}
      onChoose={setChosen}
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
