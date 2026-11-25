// A CHOICE ON THE SHEET (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts", §8 "A choice's list"): the pill
// shows the value taken — its accessible name the choice and its value, "iOS version: iOS 26.1" — and pressed, its list
// opens under it in the sheet, made of the bar's rows: a `check` 14 column, the current one checked (`menuitemradio`,
// `aria-checked`), a row that cannot be taken faint and passed over. ↑ ↓ walk it (Home and End to its ends; from a faint
// row, ↓ to the first that can be taken and ↑ to the last), Return or a press takes a row, Tab leaves it folded; Esc folds
// it first (the sheet's own keys ask `fold`), and a press elsewhere in the sheet folds it. Filled again while it stands
// open (the sheet's poll), it stays open, the focus kept in it. Taking another value tells the sheet, as a select's change
// did.
import { SHEET_GLYPHS } from "./setup-view";

/** One row of a choice's list. A `disabled` row is shown and never taken (a saved iOS version this Mac no longer has). */
export interface SheetOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SheetChoice {
  /** The value taken ("" where none is: an unavailable saved value shown, or nothing to choose). */
  readonly value: string;
  /** The rows it offers. */
  readonly options: readonly SheetOption[];
  /** A pill that cannot be pressed (and its list folded). */
  disabled: boolean;
  /** Its rows and the value taken — a value it does not offer takes none. */
  fill(options: readonly SheetOption[], value: string): void;
  /** Its list open, the row taken (else the first that can be) focused. False where it cannot open. */
  open(): boolean;
  /** Its list folded, the focus back on its pill when `refocus`. True when it was open. */
  fold(refocus?: boolean): boolean;
  readonly isOpen: boolean;
}

/** The choice named `name` in `root` (setup-view.ts's markup), telling `changed` when a row taken moves its value. */
export function sheetChoice(root: HTMLElement, name: string, changed: () => void): SheetChoice {
  const doc = root.ownerDocument;
  const wrap = root.querySelector<HTMLElement>(`[data-choice="${name}"]`)!;
  const pill = wrap.querySelector<HTMLButtonElement>(`[data-pill="${name}"]`)!;
  const shown = pill.querySelector<HTMLElement>("[data-shown]")!;
  const list = wrap.querySelector<HTMLElement>(`[data-list="${name}"]`)!;
  const label = wrap.querySelector<HTMLElement>(".vf-sim-label")?.textContent ?? name;
  let options: readonly SheetOption[] = [];
  let value = "";
  /** While the rows are made again: a focused row going with the old ones is no one leaving the list. */
  let rebuilding = false;

  const rows = () => Array.from(list.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const takeable = () => rows().filter((r) => r.getAttribute("aria-disabled") !== "true");
  /** One row of the list, as the bar's: its check column, then its label. */
  const rowOf = (o: SheetOption): HTMLButtonElement => {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = "vf-sim-row";
    row.setAttribute("role", "menuitemradio");
    row.tabIndex = -1;
    row.dataset.value = o.value;
    row.setAttribute("aria-checked", String(o.value === value));
    if (o.disabled === true) row.setAttribute("aria-disabled", "true");
    const check = doc.createElement("span");
    check.className = "vf-sim-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = SHEET_GLYPHS.check;
    const text = doc.createElement("span");
    text.className = "vf-sim-row-label";
    text.textContent = o.label;
    row.append(check, text);
    return row;
  };
  const render = () => {
    const at = options.find((o) => o.value === value);
    shown.textContent = at?.label ?? "";
    pill.dataset.value = value;
    pill.toggleAttribute("data-placeholder", at === undefined || at.disabled === true);
    pill.setAttribute("aria-label", at === undefined ? label : `${label}: ${at.label}`);
    rebuilding = true;
    try {
      list.replaceChildren(...options.map(rowOf));
    } finally {
      rebuilding = false;
    }
  };
  const fold = (refocus = false): boolean => {
    if (list.hidden) return false;
    list.hidden = true;
    pill.setAttribute("aria-expanded", "false");
    if (refocus) pill.focus({ preventScroll: true });
    return true;
  };
  const open = (): boolean => {
    if (pill.disabled || options.length === 0) return false;
    list.hidden = false;
    pill.setAttribute("aria-expanded", "true");
    const ready = takeable();
    const at = ready.find((r) => r.dataset.value === value && value !== "") ?? ready[0];
    at?.focus({ preventScroll: true });
    at?.scrollIntoView?.({ block: "nearest" });
    return true;
  };
  const take = (row: HTMLButtonElement) => {
    if (row.getAttribute("aria-disabled") === "true") return;
    const next = row.dataset.value ?? "";
    fold(true);
    if (next === value) return;
    value = next;
    render();
    changed();
  };

  pill.addEventListener("click", () => {
    if (!fold(true)) open();
  });
  pill.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open();
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "[role=menuitemradio]",
    );
    if (row && list.contains(row)) take(row);
  });
  list.addEventListener("keydown", (event) => {
    const row = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "[role=menuitemradio]",
    );
    if ((event.key === "Enter" || event.key === " ") && row && list.contains(row)) {
      // taken here, its own activation held back so it is taken once
      event.preventDefault();
      take(row);
      return;
    }
    const ready = takeable();
    if (ready.length === 0) return;
    // from a row that cannot be taken (a press on the unavailable one gives it the focus, and it is no row to walk from),
    // ↓ goes to the first row that can be and ↑ to the last
    const at = ready.indexOf(doc.activeElement as HTMLButtonElement);
    const to =
      event.key === "ArrowDown"
        ? ready[at < 0 ? 0 : (at + 1) % ready.length]
        : event.key === "ArrowUp"
          ? ready[at < 0 ? ready.length - 1 : (at - 1 + ready.length) % ready.length]
          : event.key === "Home"
            ? ready[0]
            : event.key === "End"
              ? ready[ready.length - 1]
              : undefined;
    if (event.key === "Tab") fold();
    if (to === undefined) return;
    event.preventDefault();
    to.focus({ preventScroll: true });
    to.scrollIntoView?.({ block: "nearest" });
  });
  // the focus gone from the choice (Tab past it, a press elsewhere) folds its list — never a row made again under it
  wrap.addEventListener("focusout", (event) => {
    if (rebuilding) return;
    const next = event.relatedTarget as Node | null;
    if (next === null || !wrap.contains(next)) fold();
  });

  return {
    get value() {
      return value;
    },
    get options() {
      return options;
    },
    get disabled() {
      return pill.disabled;
    },
    set disabled(off: boolean) {
      pill.disabled = off;
      if (off) fold();
    },
    fill(next, taken) {
      // filled while its list stands open (a check of the Mac read again — the sheet's poll): the list stays open on its new
      // rows, and a focus that was in it stays in it, on the row it was on, else the row taken, else the first that can be
      const open = !list.hidden;
      const active = doc.activeElement;
      const inList = open && active !== null && list.contains(active);
      const was = inList ? (active as HTMLElement).dataset.value : undefined;
      options = next;
      value = next.some((o) => o.value === taken) ? taken : "";
      render();
      if (!open) return;
      const ready = takeable();
      if (ready.length === 0) {
        fold(inList);
        return;
      }
      if (inList)
        (
          ready.find((r) => r.dataset.value === was) ??
          ready.find((r) => r.dataset.value === value) ??
          ready[0]
        )?.focus({ preventScroll: true });
    },
    open,
    fold,
    get isOpen() {
      return !list.hidden;
    },
  };
}
