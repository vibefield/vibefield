import { type MouseEvent, type ReactElement, useEffect, useState } from "react";
import type { DealFrom } from "./cards-store";
import { COPY_BUTTON_WORDS } from "./cards-words";
import { dealFromElement } from "./copy-door";

/** How long a copy's button says how the copy went (DESIGN.md §8 "Copy"). */
const SAID_MS = 2_000;

/** HN-5 — a copy's button on a sheet over the frame: Settings' (a sign-in link, a device's name, a
 * diagnostics record) and the Setup Assistant's (DESIGN.md §8 "Copy", LC-22). What it copies is
 * dealt into the hand from the button's own box, under the sheet, and the button says how it went
 * for two seconds in its own words: "Copied", the copy's sign while the sheet stands, or "Couldn't
 * copy". Why a copy was refused is the log's (`renderer.cards.copy_refused`), never the button's.
 * Each sheet dresses it as its own buttons. */
export function CopyButton({
  label,
  copy,
  className,
  inSummary = false,
}: {
  readonly label: string;
  /** the copy, dealt from `from`; true once the clipboard took it */
  readonly copy: (from: DealFrom | null) => Promise<boolean>;
  readonly className: string;
  /** it sits in a `<summary>` (a Diagnostics record's row): its press is its own, and never
   * opens or closes the row */
  readonly inSummary?: boolean;
}): ReactElement {
  const [done, setDone] = useState<null | boolean>(null);
  useEffect(() => {
    if (done === null) return;
    const timer = setTimeout(() => setDone(null), SAID_MS);
    return () => clearTimeout(timer);
  }, [done]);
  const press = (event: MouseEvent<HTMLButtonElement>): void => {
    if (inSummary) {
      event.preventDefault();
      event.stopPropagation();
    }
    void copy(dealFromElement(event.currentTarget)).then(setDone);
  };
  const said = done === null ? label : done ? COPY_BUTTON_WORDS.copied : COPY_BUTTON_WORDS.refused;
  return <button type="button" className={className} onClick={press}>{said}</button>;
}
