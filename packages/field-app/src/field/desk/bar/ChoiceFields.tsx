import type { ActChoiceField } from "@vibecook/ice";
import {
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

// A CHOICE'S FIELDS (track OM, 2026-11-25; DESIGN.md §8 "The bar grown" — "A choice that asks for values"; ICE I62).
// Controller-free, as the bar's view is: the values a choice asks for before it acts (the browser pane's Custom: a
// width, a height, a user agent), opened under its row in the grown bar. Each field shows its label over it and its
// value now; numbers side by side, a × between two; a text the list's width, its placeholder said. A value outside its
// field's bounds or off its step, or a text too long, rings its field in the danger ink and says why under the fields,
// and Use waits until every value fits — core holds the taken values to the same fields again (`takenChoice`). Return
// in a field takes them; Esc in a field puts its value back (`escape()`), the bar's own Esc then folding the list.

export interface ChoiceFieldsHandle {
  /** Esc in a field: its value put back, true — or false when it had not changed (the bar folds the list then). */
  escape(): boolean;
}

export interface ChoiceFieldsProps {
  readonly fields: readonly ActChoiceField[];
  /** Use, or Return in a field, with every value fitting its field: the values by field id. */
  readonly onUse: (values: Readonly<Record<string, number | string>>) => void;
  readonly handleRef?: Ref<ChoiceFieldsHandle>;
  /** Opened by the person: the first field takes the focus (a plate's fields, open as it mounts, take none). */
  readonly autoFocus?: boolean;
}

/** Why a field's text does not fit it, in the voice's words ("Width is 320 to 8192"), or null when it fits. */
export function fieldProblem(field: ActChoiceField, text: string): string | null {
  if (field.kind === "text") {
    const max = field.maxLength ?? 2048;
    return text.length > max ? `${field.label} is at most ${max} characters` : null;
  }
  const n = text.trim() === "" ? Number.NaN : Number(text);
  const { min, max, step } = field;
  const bounds =
    min !== undefined && max !== undefined
      ? `${field.label} is ${min} to ${max}`
      : min !== undefined
        ? `${field.label} is at least ${min}`
        : max !== undefined
          ? `${field.label} is at most ${max}`
          : `${field.label} is a number`;
  if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max))
    return bounds;
  if (step !== undefined) {
    const q = (n - (min ?? 0)) / step;
    if (Math.abs(q - Math.round(q)) > 1e-9 * Math.max(1, Math.abs(q)))
      return step === 1
        ? `${field.label} is a whole number`
        : `${field.label} goes in steps of ${step}`;
  }
  return null;
}

/** The fields' values as a choice is taken with them: numbers as numbers, texts as typed. */
export function fieldValues(
  fields: readonly ActChoiceField[],
  texts: Readonly<Record<string, string>>,
): Record<string, number | string> {
  const values: Record<string, number | string> = {};
  for (const f of fields) {
    const text = texts[f.id] ?? String(f.value);
    values[f.id] = f.kind === "number" ? Number(text) : text;
  }
  return values;
}

const textsOf = (fields: readonly ActChoiceField[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f.id, String(f.value)]));

export function ChoiceFields({
  fields,
  onUse,
  handleRef,
  autoFocus = true,
}: ChoiceFieldsProps): ReactElement {
  const [texts, setTexts] = useState<Record<string, string>>(() => textsOf(fields));
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const firstRef = useRef<HTMLInputElement>(null);
  const why = useId();
  const problems = fields.map((f) => fieldProblem(f, texts[f.id] ?? ""));
  const problem = problems.find((p) => p !== null) ?? null;
  const fits = problem === null;

  // opened from its row: the first field takes the focus, its value selected (once, as it opens)
  const focusOnce = useRef(autoFocus);
  useEffect(() => {
    if (!focusOnce.current) return;
    focusOnce.current = false;
    const first = firstRef.current;
    first?.focus({ preventScroll: true });
    first?.setSelectionRange(0, first.value.length);
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      escape() {
        const el = document.activeElement as HTMLInputElement | null;
        const field = fields.find((f) => f.id === el?.name);
        if (field === undefined || textsRef.current[field.id] === String(field.value)) return false;
        setTexts((now) => ({ ...now, [field.id]: String(field.value) }));
        return true;
      },
    }),
    [fields],
  );

  const use = (): void => {
    if (fits) onUse(fieldValues(fields, textsRef.current));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    use();
  };

  const nodes: ReactElement[] = [];
  let numbers: ReactElement[] = [];
  const flushNumbers = (): void => {
    if (numbers.length === 0) return;
    nodes.push(
      <div key={`numbers-${nodes.length}`} className="vf-bar-field-row">
        {numbers}
      </div>,
    );
    numbers = [];
  };
  fields.forEach((f, i) => {
    const bad = problems[i] !== null;
    const input = (
      <label key={f.id} className="vf-bar-field" data-field={f.id} data-kind={f.kind}>
        <span className="vf-bar-field-label">{f.label}</span>
        <input
          ref={i === 0 ? firstRef : undefined}
          className="vf-bar-input"
          name={f.id}
          type="text"
          inputMode={f.kind === "number" ? "numeric" : "text"}
          autoComplete="off"
          spellCheck={false}
          value={texts[f.id] ?? ""}
          placeholder={f.placeholder}
          {...(f.kind === "text" && f.maxLength !== undefined ? { maxLength: f.maxLength } : {})}
          {...(bad ? { "aria-invalid": true, "aria-describedby": why } : {})}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setTexts((now) => ({ ...now, [f.id]: value }));
          }}
          onKeyDown={onKeyDown}
        />
      </label>
    );
    if (f.kind === "number") {
      if (numbers.length > 0)
        numbers.push(
          <span key={`times-${f.id}`} className="vf-bar-times" aria-hidden="true">
            ×
          </span>,
        );
      numbers.push(input);
      return;
    }
    flushNumbers();
    nodes.push(input);
  });
  flushNumbers();

  return (
    <div className="vf-bar-fields" data-choice-fields="">
      {nodes}
      <div className="vf-bar-fields-foot">
        <span id={why} className="vf-bar-field-why" role="status">
          {problem ?? ""}
        </span>
        <button
          type="button"
          className="vf-bar-done vf-bar-use"
          data-act="use"
          {...(fits ? {} : { "aria-disabled": true, "data-waits": "" })}
          onClick={use}
        >
          Use
        </button>
      </div>
    </div>
  );
}
