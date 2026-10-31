import { type ReactElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConnectPane } from "../boot/onboarding/panes/ConnectPane";
import type { ConnectMe } from "../boot/onboarding/views/connect";
import { WizardShell } from "../boot/onboarding/wizard-ui";
import { HistoryWizardPane } from "./HistoryWizardPane";
import type { FinishStep } from "./ledger";
import "./setup-sheet.css";

// Finish setting up's sheet (track AO, AO-D10; DESIGN.md §8 "Finish setting
// up"): the Setup Assistant's own panes — the same controllers, views and
// glass — over the app, one put-off step after another. Not now leaves a step
// as it was (still listed); answering it, here or anywhere, takes it off the
// list, and the sheet closes when nothing is left.

export function SetupSheet({
  me,
  steps,
  onClose,
}: {
  /** who is finishing setup: the face the Connect pane is drawn around (TS-2) */
  me: ConnectMe;
  /** The steps still put off, in the assistant's order. */
  steps: readonly FinishStep[];
  onClose: () => void;
}): ReactElement | null {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === undefined) onClose();
  }, [step, onClose]);
  // A modal sheet keeps the keys (Settings stands down while it is open):
  // Escape closes it, Tab cycles inside it, and focus starts in it.
  useEffect(() => {
    const sheet = sheetRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || sheet === null) return;
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  if (step === undefined) return null;
  const next = (): void => setIndex((n) => n + 1);
  return createPortal(
    <div
      ref={sheetRef}
      className="vf-setup-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Finish setting up"
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <WizardShell size="sheet">
        <SheetPane me={me} step={step} onDone={next} />
      </WizardShell>
    </div>,
    document.body,
  );
}

function SheetPane({
  me,
  step,
  onDone,
}: {
  me: ConnectMe;
  step: FinishStep;
  onDone: () => void;
}): ReactElement {
  switch (step) {
    case "history":
      return <HistoryWizardPane onDone={onDone} />;
    case "devices":
      return <DevicesStep me={me} onDone={onDone} />;
  }
}

// TS-2 — the pane owns the link through the shared door; the sheet keeps
// Escape for itself (it closes), so the pane's Esc-as-Not-now stays off here.
function DevicesStep({ me, onDone }: { me: ConnectMe; onDone: () => void }): ReactElement {
  return <ConnectPane me={me} onBack={undefined} onContinue={onDone} onSkip={onDone} />;
}
