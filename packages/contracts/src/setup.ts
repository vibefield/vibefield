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

/** The ledger, on disk and on the wire alike. `steps` is keyed by step, and its
 * rows are read one at a time (`setupStepState`): a row from a newer build — a
 * step or a state this one has never heard of — is carried and never read, so
 * an older build never erases a newer one's answer. `hidden`: the person hid
 * Finish setting up; every step still lives on its page. */
export const SetupLedger = z
  .object({
    format: z.literal(SETUP_LEDGER_FORMAT),
    steps: z.record(z.string(), z.unknown()),
    hidden: z.boolean(),
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
