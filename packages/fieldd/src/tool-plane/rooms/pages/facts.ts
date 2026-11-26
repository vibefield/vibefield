import {
  PAGES_RUN_PANES_MAX,
  PAGES_SERVICE,
  PAGES_UNAVAILABLE_STATES,
  type PagesNeed,
  type ShellSurfacesControlRefusalFact,
} from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";

// EY-2 (2b, 2026-11-19) — what main and the engine answered, as the facts a model acts on (TOOL_FACTS; EYD's facts
// table). Pure. Each refusal says what to do next. The engine's own answer keeps its envelope (`{success, data}` or
// `{success: false, error, code?}`) inside main's `done`, so a failure of the engine is read here too, and main's own
// refusal is the first witness of any fact it can name.

const refuse = (
  fact: string,
  text: string,
  retryable = false,
  more: Record<string, unknown> = {},
) => new RpcCallError("PRECONDITION_FAILED", text, retryable, { fact, ...more });

/** What a needs-you asks of the person, said in words. */
const NEED_WORDS: Readonly<Record<PagesNeed, string>> = {
  "sign-in": "to sign in",
  permission: "to allow a permission",
  file: "to choose a file",
  download: "to allow a download",
  dialog: "to answer a dialog",
  password: "to type a password",
  confirm: "to confirm before it is sent",
};

/** A fact main refused a page's call with, or the engine said, as the model reads it. */
export function pageRefusal(fact: ShellSurfacesControlRefusalFact | "needs-you", need?: PagesNeed) {
  switch (fact) {
    case "held":
      // BU-9 A: the person's hand wins, on reads and stills as on acts; nothing was done, nothing is replayed
      return refuse(
        "held",
        "The user is holding this page, so nothing was done. Try again when they put it down.",
        true,
      );
    case "gone":
      // a rested page (2026-11-24): a page the desk put to rest and woke comes back as a new page, and its first call
      // answers gone; the room keeps it for one more try (verbs.ts settle)
      return refuse(
        "gone",
        "This page has closed, or the desk woke it from a rest as a new page. Try it once more; if it answers gone again, it has closed: list your pages, or open a new one.",
      );
    case "parked":
      // a rested page (2026-11-24): nothing an agent does wakes a page the desk put to rest out of view; the person's
      // look does
      return refuse(
        "parked",
        "The desk put this page to rest while it is out of view, to stay within its live pages. It wakes when the user looks at it: work another page meanwhile, or ask the user to bring it into view.",
        true,
      );
    case "stale-ref":
      return refuse(
        "stale-ref",
        "The page no longer has that part. Take a new snapshot and use its refs.",
      );
    case "loading":
      return refuse("loading", "The page has not settled yet. Read it again.", true);
    case "off-site":
      return refuse(
        "off-site",
        "That would take the page off its site, so nothing was done. Stay on the site you were handed.",
      );
    case "needs-you":
      return refuse(
        "needs-you",
        `The page needs the user ${need === undefined ? "to act" : NEED_WORDS[need]}. Ask them, then try again.`,
        false,
        need === undefined ? {} : { need },
      );
  }
}

/** A rested page (2026-11-24) — a gone the room has stopped trying: the page's first gone offered one more try, and
 * this is the second running. Its words offer none, and whatever followed the first words (a pop-up said beside it) is
 * kept. */
export function goneForGood(err: unknown): unknown {
  if (!(err instanceof RpcCallError)) return err;
  const first = pageRefusal("gone").message;
  const rest = err.message.startsWith(first) ? err.message.slice(first.length) : "";
  return new RpcCallError(
    err.kind,
    `This page has closed. List your pages, or open a new one.${rest}`,
    false,
    err.details,
  );
}

/** How much of the engine's own words a failure carries. */
const ENGINE_WORDS_CHARS = 300;

/** The engine's words for a ref the page no longer has (its element.rs): a ref it never gave, one gone stale, or a
 * selector that finds nothing. */
const STALE_REF = /^(Unknown ref|Element ref \S+ is stale|Element not found)/;

/** The engine's own failure inside main's `done`, as a fact; nothing for an answer that succeeded. `onPart` is a row
 * that names a part of the page, so a missing part is a stale ref and not a failure. */
export function engineFailure(output: unknown, onPart: boolean): RpcCallError | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const { success, error, code } = output as { success?: unknown; error?: unknown; code?: unknown };
  if (success !== false) return undefined;
  const words = typeof error === "string" ? error : "";
  if (code === "tab_gone") return pageRefusal("gone");
  if (code === "page_wedged") return pageRefusal("loading");
  if (onPart && STALE_REF.test(words)) return pageRefusal("stale-ref");
  const said = words.length > ENGINE_WORDS_CHARS ? `${words.slice(0, ENGINE_WORDS_CHARS)}…` : words;
  return refuse(
    "failed",
    said === ""
      ? "The browser could not do that."
      : `The browser could not do that. It said: ${said}`,
  );
}

/** the engine's bookkeeping (2026-11-24) — the engine's own bookkeeping, never a fact of the page: the pinned engine's
 * record of how it launched its browser (`lifecycle`: effectiveLaunch, launchHash, launched, relaunchedBrowser,
 * restartedBackground), seen in its real replies (2026-11-24), inside its data and beside its envelope. A dialog's
 * `warning` is the page's, and stays. */
const ENGINE_BOOKKEEPING: readonly string[] = ["lifecycle"];

/** A record without the engine's bookkeeping; anything that is not a record, as it came. */
const withoutBookkeeping = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  if (!ENGINE_BOOKKEEPING.some((key) => key in value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !ENGINE_BOOKKEEPING.includes(key)),
  );
};

/** What the engine answered, without its envelope or its bookkeeping: `data` of a success, else the answer as it
 * came. */
export function engineData(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return output;
  const { success, data } = output as { success?: unknown; data?: unknown };
  return withoutBookkeeping(success === true && "data" in output ? data : output);
}

/** Each pages state in the room's words, and whether another try may help. `no-answer` is an act's answer that never
 * came (as the desk room says it): the act may have happened. `bad-answer` is an answer of main's that fits no arm of
 * the control result. */
const UNAVAILABLE_WORDS: ReadonlyMap<string, readonly [string, boolean]> = new Map<
  string,
  readonly [string, boolean]
>([
  [
    "no-window",
    ["No VibeField window is open, so no page can answer. Ask the user to open one.", true],
  ],
  ["engine-starting", ["The browser is still starting. Try again in a moment.", true]],
  ["engine-stopped", ["The browser has stopped. Try again in a moment.", true]],
  [
    "engine-refused",
    ["VibeField refused a browser it could not verify, so no page can answer.", false],
  ],
  // the provider-state pair (2026-11-24): main says this state, and the model must hear that no engine is here
  [
    "not-installed",
    [
      "The browser engine is not installed in this VibeField, so no page can answer. Trying again will not help: tell the user.",
      false,
    ],
  ],
  [
    "no-answer",
    [
      "The page did not answer in time, so VibeField cannot tell whether this happened. Look before you try again.",
      true,
    ],
  ],
  ["bad-answer", ["The browser's answer could not be read.", true]],
]);

const unavailable = (state: string): RpcCallError => {
  const [words, retryable] = UNAVAILABLE_WORDS.get(state) ?? [
    "The browser is unavailable. Try again in a moment.",
    true,
  ];
  return new RpcCallError("UNAVAILABLE", words, retryable, { service: PAGES_SERVICE, state });
};

/** An act's answer that never came. */
export const noAnswer = (): RpcCallError => unavailable("no-answer");

/** An answer of main's that fits no arm of the control result: main's fault, said as such. */
export const badAnswer = (): RpcCallError => unavailable("bad-answer");

/** EY-1 1f's words (2026-11-19): the run holds the most pages it may. */
export const runFull = (): RpcCallError =>
  refuse(
    "limit",
    `This run already holds ${PAGES_RUN_PANES_MAX} pages, the most it may. Close one of them to open another.`,
  );

/** EY-1 1f's words: the desk has no room for another live page. */
export const deskFull = (): RpcCallError =>
  refuse(
    "limit",
    "The desk has no room for another live page right now. Close a page you no longer need, or carry on in this one.",
  );

/** main's no-room refusal (2026-11-24) — an answer past what one call carries (PAGES_OUTPUT_EXHAUSTED_MESSAGE's case):
 * nothing of it came back, and asking for less is the way through. */
const tooLarge = (): RpcCallError =>
  refuse(
    "limit",
    "The page's answer was larger than one call may carry, so it did not come back. Ask for less of it: a part of the page, a filter, or a smaller still.",
  );

/** main's no-room refusal (2026-11-24) — a new page main had no room for, when main does not say whose room: the desk's
 * or the run's. */
const noRoom = (): RpcCallError =>
  refuse(
    "limit",
    "VibeField has no room for another page right now. Close a page you no longer need, then try again.",
  );

/** What a failed control call becomes. A pages UNAVAILABLE keeps its state, in the room's words: main's provider says
 * it in the error's details `{service: "pages", state}` (the provider-state pair, 2026-11-24), and fieldd's shell
 * provider hands them on. A bare UNAVAILABLE (a provider that says no state, or no broker yet) is the engine stopped. A
 * timeout on a read is a page still loading; on an act it is no answer, never a failure, because the act may have
 * happened. Main's no-room refusal (2026-11-24): a RESOURCE_EXHAUSTED is the desk's room, the run's count or an answer
 * too large, by the broker's state when main's provider says one, else by the call (`making`: a call that makes a page
 * met a room; any other, an answer too large), never the words main's provider gives every such error today. Anything
 * else passes as it came. */
export function controlFailure(err: unknown, window: "read" | "act", making = false): unknown {
  if (!(err instanceof RpcCallError)) return err;
  if (err.kind === "TIMEOUT") return window === "act" ? noAnswer() : pageRefusal("loading");
  if (err.kind === "RESOURCE_EXHAUSTED") {
    const { service, state } = (err.details ?? {}) as { service?: unknown; state?: unknown };
    const said = service === PAGES_SERVICE ? state : undefined;
    if (said === "desk-full") return deskFull();
    if (said === "run-full") return runFull();
    if (said === "output-too-large") return tooLarge();
    return making ? noRoom() : tooLarge();
  }
  if (err.kind !== "UNAVAILABLE") return err;
  const { service, state } = (err.details ?? {}) as { service?: unknown; state?: unknown };
  if (service === PAGES_SERVICE && typeof state === "string")
    return UNAVAILABLE_WORDS.has(state) ||
      (PAGES_UNAVAILABLE_STATES as readonly string[]).includes(state)
      ? unavailable(state)
      : err;
  if (service === undefined) return unavailable("engine-stopped");
  return err;
}
