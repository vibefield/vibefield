import { z } from "zod";

// The Setup Assistant's ledger (design-03 §4.3's `setup.*`; track AO, AO-2 —
// draft/thinking-agent-onboarding.md §5). fieldd's truth for which of the
// assistant's steps a person answered and which they put off: a quit resumes at
// the first unanswered pane (W6), and Settings' "Finish setting up" lists what
// was put off (AO-D10) — never what was declined (AO-L6: skipped is not no).
//
// One file per user (`LAYOUT.SETUP_LEDGER_FILE`), written atomically by fieldd.
// The doors (`setup.get`/`.subscribe`/`.answer`/`.hide`) ride `settings.manage`
// and answer only a trusted desktop caller — the wizard and Settings. TS-only:
// field-native reads none of it (gen-jsonschema.ts's agent-plane rule).

/** The steps the assistant records. */
export const SETUP_STEPS = ["agents", "profiles", "history", "devices"] as const;
export const SetupStep = z.enum(SETUP_STEPS);
export type SetupStep = z.infer<typeof SetupStep>;

/** `answered` — the person decided, yes or no, and the step is never listed
 * again. `later` — put off ("Not now"): Finish setting up lists it until it is
 * answered, here or on its page. */
export const SETUP_STEP_STATES = ["answered", "later"] as const;
export const SetupStepState = z.enum(SETUP_STEP_STATES);
export type SetupStepState = z.infer<typeof SetupStepState>;

export const SetupStepRecord = z
  .object({
    state: SetupStepState,
    /** when it was recorded (ISO-8601) */
    at: z.string().min(1),
  })
  .passthrough();
export type SetupStepRecord = z.infer<typeof SetupStepRecord>;

export const SETUP_LEDGER_FORMAT = 1;

/** AO-6b (AO-D15, ruled (a) by James 2026-10-27) — a moment: a reminder tied to
 * a moment of need, shown once (the page's "One moment each"). `<name>`, or
 * `<name>:<key>` for one of many — one record per name and key; the name ends at
 * the first colon, and a key is printable ASCII without spaces, up to 256 (a
 * device id's bound, DEVICE_LIMITS.DEVICE_ID_CHARS). `limit` is the limit moment
 * (AO-D11); `agent-past:<agent>` is a new agent with a past, one per agent (the
 * catalog id); track TS's notices are `device-joined:<deviceId>` and
 * `renewal-notice:<YYYY-MM-DD>` (TS-D18, ruled (d) by James 2026-10-27), and its
 * asks to connect are `connect-ask:<place>` (TS-4, TS-D7). Open, so a newer
 * build's moment rides through. */
export const SetupMomentKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}(?::[\x21-\x7E]{1,256})?$/);
export type SetupMomentKey = z.infer<typeof SetupMomentKey>;

/** `retired` — the person said Not now (or acted on it): it never shows again.
 * `asked` (TS-4, TS-D7) — said, and it may be said again: its `at` is when it was
 * last said, and the reader keeps its own quiet from there (each place once per
 * 30 days, one a day across them). It never replaces `retired`. */
export const SETUP_MOMENT_STATES = ["retired", "asked"] as const;
export const SetupMomentState = z.enum(SETUP_MOMENT_STATES);
export type SetupMomentState = z.infer<typeof SetupMomentState>;

export const SetupMomentRecord = z
  .object({ state: SetupMomentState, at: z.string().min(1) })
  .passthrough();
export type SetupMomentRecord = z.infer<typeof SetupMomentRecord>;

/** The ledger, on disk and on the wire alike. `steps` is keyed by step, and its
 * rows are read one at a time (`setupStepState`): a row from a newer build — a
 * step or a state this one has never heard of — is carried and never read, so
 * an older build never erases a newer one's answer. `hidden`: the person hid
 * Finish setting up; every step still lives on its page. `moments` (AO-6b) is
 * keyed by moment and read the same way (`setupMomentState`); absent from a
 * ledger written before AO-6b. */
export const SetupLedger = z
  .object({
    format: z.literal(SETUP_LEDGER_FORMAT),
    steps: z.record(z.string(), z.unknown()),
    hidden: z.boolean(),
    moments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type SetupLedger = z.infer<typeof SetupLedger>;

/** `setup.answer` — one step's answer. Declarative: the same answer twice is
 * written once. */
export const SetupAnswerParams = z.object({ step: SetupStep, state: SetupStepState }).passthrough();
export type SetupAnswerParams = z.infer<typeof SetupAnswerParams>;

/** `setup.hide` — hide Finish setting up, or show it again. */
export const SetupHideParams = z.object({ hidden: z.boolean() }).passthrough();
export type SetupHideParams = z.infer<typeof SetupHideParams>;

/** `setup.moment` (AO-D15) — one moment's answer, beside the steps: Not now
 * retires it for good. Declarative: the same answer twice is written once —
 * except `asked`, whose answer is its time, so each saying is written. */
export const SetupMomentParams = z
  .object({ moment: SetupMomentKey, state: SetupMomentState })
  .passthrough();
export type SetupMomentParams = z.infer<typeof SetupMomentParams>;

/** A ledger with no rows: a user the assistant has not asked yet, or one who
 * set up before it kept a ledger (AO-D12). */
export function emptySetupLedger(): SetupLedger {
  return { format: SETUP_LEDGER_FORMAT, steps: {}, hidden: false };
}

/** A step's recorded state; undefined while it has no row it can read. */
export function setupStepState(ledger: SetupLedger, step: SetupStep): SetupStepState | undefined {
  const row = SetupStepRecord.safeParse(ledger.steps[step]);
  return row.success ? row.data.state : undefined;
}

/** A moment's recorded state; undefined while it has no row it can read. */
export function setupMomentState(
  ledger: SetupLedger,
  moment: SetupMomentKey,
): SetupMomentState | undefined {
  return setupMomentRecord(ledger, moment)?.state;
}

/** A moment's record, with when it was answered (TS-4 keeps its quiet from an
 * `asked` row's `at`); undefined while it has no row it can read. */
export function setupMomentRecord(
  ledger: SetupLedger,
  moment: SetupMomentKey,
): SetupMomentRecord | undefined {
  const row = SetupMomentRecord.safeParse(ledger.moments?.[moment]);
  return row.success ? row.data : undefined;
}

/** TS-4 (TS-D7, TS-L6; DESIGN.md §8 "Asking again") — the places that ask to
 * connect again after Not now, each a moment `connect-ask:<place>` written
 * `asked` each time it is said: the notice when the window closes with agents
 * running, and the line after a wait that outlasted ten minutes. The rows that
 * offer it (the face menu's, the status item's, the filters' ghost rows) are not
 * moments: they are there while this Mac is not connected. */
export const CONNECT_ASK_PLACES = ["away", "approval-wait"] as const;
export type ConnectAskPlace = (typeof CONNECT_ASK_PLACES)[number];

export const CONNECT_ASK = {
  /** each place is said at most once in this long */
  PLACE_QUIET_MS: 30 * 86_400_000,
  /** and at most one place is said in this long, across them */
  DAY_MS: 86_400_000,
} as const;

export function connectAskMoment(place: ConnectAskPlace): SetupMomentKey {
  return `connect-ask:${place}`;
}

/** Whether the ledger lets a place ask now: the person put Devices off (Not
 * now — never someone the assistant has not asked, and never a no), the place
 * was not said in the last 30 days, and no place was said in the last day. A
 * place retired is quiet for good (AO-D15), and only an `asked` time is a saying,
 * so another place's retired row spends no day. The link and the switch
 * (`mesh.connectAsks`) are the caller's to read. A row whose time cannot be read
 * keeps the quiet: asking less is the safe mistake. */
export function connectAskOpen(ledger: SetupLedger, place: ConnectAskPlace, now: number): boolean {
  if (setupStepState(ledger, "devices") !== "later") return false;
  for (const moment of Object.keys(ledger.moments ?? {})) {
    if (!moment.startsWith("connect-ask:")) continue;
    const row = setupMomentRecord(ledger, moment);
    if (row === undefined) continue;
    const own = moment === connectAskMoment(place);
    if (row.state === "retired") {
      if (own) return false;
      continue;
    }
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) return false;
    if (now - at < (own ? CONNECT_ASK.PLACE_QUIET_MS : CONNECT_ASK.DAY_MS)) return false;
  }
  return true;
}
