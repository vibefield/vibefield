import { SegmentedControl, UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { NewSparkSheet } from "../chat/NewSparkSheet";
import { NewSparkSheetView } from "../chat/NewSparkSheetView";
import { ChatPreview } from "./ChatPreview";
import {
  NEW_SPARK_STATE_LABEL,
  NEW_SPARK_STATES,
  type NewSparkState,
  newSparkFixturePort,
  newSparkPlateOf,
} from "./new-spark-fixtures";

// The New spark sheet on fixtures (SP-1c; docs/UI_SYSTEM.md): the SHIPPING sheet over a fixture port, drawn into its
// plate as the product draws it into the window, with Chat's list receding behind it by the product's own rule; and
// its still states as the shipping view over the product's own readings (`new-spark-fixtures.ts`). The markup and the
// CSS are the product's.

/** The live sheet: the product's controller, its doors answered by fixtures. Cancel and Create fold it, and New
 * spark opens it again; it binds no keys and leaves the page's focus alone. */
function NewSparkLivePlate(): ReactElement {
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [port] = useState(() => newSparkFixturePort());
  return (
    <div ref={setPlate} className="vf-ds-new-spark-plate" data-state="live">
      <div className="vf-ds-new-spark-view" data-peek-recede={open ? "true" : "false"}>
        <ChatPreview state="list" />
      </div>
      {open ? null : (
        <div className="vf-ds-new-spark-again">
          <UiButton variant="primary" onClick={() => setOpen(true)}>
            New spark
          </UiButton>
        </div>
      )}
      <NewSparkSheet
        open={open}
        port={port}
        onClose={() => setOpen(false)}
        container={plate}
        takeFocus={false}
        bindKeys={false}
      />
    </div>
  );
}

/** One of the sheet's still states, over Chat receded. */
export function NewSparkPreview({
  state,
}: {
  state: Exclude<NewSparkState, "live">;
}): ReactElement {
  return (
    <div className="vf-ds-new-spark-plate" data-state={state}>
      <div className="vf-ds-new-spark-view" data-peek-recede="true">
        <ChatPreview state="list" />
      </div>
      <NewSparkSheetView {...newSparkPlateOf(state)} />
    </div>
  );
}

/** The specimen: the live sheet and its still states on a control, one plate at the window's size. */
export function NewSparkSpecimen(): ReactElement {
  const [state, setState] = useState<NewSparkState>("live");
  return (
    <div className="vf-ds-new-spark-preview">
      <div className="vf-ds-frame-controls">
        <SegmentedControl
          options={NEW_SPARK_STATES.map((entry) => NEW_SPARK_STATE_LABEL[entry])}
          value={NEW_SPARK_STATE_LABEL[state]}
          onChange={(label) => {
            const next = NEW_SPARK_STATES.find((entry) => NEW_SPARK_STATE_LABEL[entry] === label);
            if (next !== undefined) setState(next);
          }}
          label="New spark state"
        />
      </div>
      {state === "live" ? (
        <NewSparkLivePlate key="live" />
      ) : (
        <NewSparkPreview key={state} state={state} />
      )}
    </div>
  );
}
