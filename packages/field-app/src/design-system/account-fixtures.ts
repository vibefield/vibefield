import { AGENT_CATALOG, type IndexStatus } from "@vibefield/contracts";
import type { AccountMe, AccountPerson } from "../account/use-account";
import type { HistoryAgentRow } from "../setup/history-consent";

// Deterministic account data for the catalog's faces, Me menu and Settings
// head (UA-D17/D19). Fixture DATA only — every view that draws it is the
// shipping one. Logins and tailnets are examples.

export const FIXTURE_ME: AccountMe = {
  userId: "01J8Z3K6W9QX2M4N7P5R8T1V3B",
  name: "James",
  face: { emoji: "🦊" },
  waiting: 0,
  detail: "james@example.com",
  detailIsLogin: true,
  detailTone: "plain",
  canLink: false,
};

export const FIXTURE_ME_OFFLINE: AccountMe = {
  ...FIXTURE_ME,
  detail: "This Mac only",
  detailIsLogin: false,
  canLink: true,
};

/** TS-2 — a sign-in 6 days from renewal: the line in the attention ink. */
export const FIXTURE_ME_RENEWING: AccountMe = {
  ...FIXTURE_ME,
  detail: "Sign-in renews in 6 days",
  detailIsLogin: false,
  detailTone: "attention",
};

export const FIXTURE_OTHERS: readonly AccountPerson[] = [
  {
    userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7",
    name: "James (work)",
    face: { emoji: "🐙", frame: "coin" },
    waiting: 0,
  },
  {
    userId: "01JA4T8N5RS1V4W7X9Y2Z5A8B3",
    name: "Sandbox",
    face: { emoji: "🧪" },
    waiting: 0,
  },
];

export const FIXTURE_OTHERS_WAITING: readonly AccountPerson[] = FIXTURE_OTHERS.map((person) =>
  person.name === "James (work)" ? { ...person, waiting: 2 } : person,
);

/** The ladder the catalog stages a face on — every threshold of DESIGN.md §2.8
 * lands between two rungs. */
export const FACE_LADDER = [112, 80, 56, 40, 28, 20, 16] as const;

/** AO-2/AO-3 — a ledger as fieldd keeps it for someone who said "Not now" to
 * History and to Connect: what Settings' "Finish setting up" lists, through the
 * shipping `finishSetupRows`. */
export const FIXTURE_SETUP_LEDGER = {
  format: 1 as const,
  steps: {
    history: { state: "later", at: "2026-10-27T05:41:30.000Z" },
    devices: { state: "later", at: "2026-10-27T05:41:34.000Z" },
  },
  hidden: false,
};

/** AO-3 — the History pane's census as a window reads it: the catalog's first
 * three agents whose history a desktop reads (AR-L1: a fixture reads the
 * catalog, never spells an id), each with a sample size and last use — one
 * used today, one yesterday, one not since the summer — nothing brought in. */
const HISTORY_SAMPLES = [
  { bytes: 6_200_000_000, newestModifiedMs: Date.parse("2026-10-27T09:12:00Z") },
  { bytes: 1_100_000_000, newestModifiedMs: Date.parse("2026-10-26T18:40:00Z") },
  { bytes: 240_000_000, newestModifiedMs: Date.parse("2026-08-14T10:00:00Z") },
] as const;

const HISTORY_AGENTS = AGENT_CATALOG.filter(
  (row) => row.offers.history && row.seams.rosetta !== null && row.layoutRoot !== null,
);

export const FIXTURE_HISTORY_CENSUS = {
  kind: "found" as const,
  rows: HISTORY_SAMPLES.flatMap((sample, i): HistoryAgentRow[] => {
    const row = HISTORY_AGENTS[i];
    if (row === undefined || row.seams.rosetta === null || row.layoutRoot === null) return [];
    return [
      {
        kind: row.seams.rosetta.kind,
        agent: row.id,
        label: row.label,
        root: row.layoutRoot,
        consented: false,
        ...sample,
      },
    ];
  }),
  consented: [],
};

/** The catalog's clock for History's rows, so they say "today", "yesterday"
 * and "in August" in every run. */
export const FIXTURE_HISTORY_NOW = Date.parse("2026-10-27T12:00:00Z");

/** AO-6b — a new agent with a past, as History's head offers it: the census's
 * agent not used since the summer, never asked about. */
export const FIXTURE_NEW_AGENT_PAST = FIXTURE_HISTORY_CENSUS.rows[2] ?? null;

/** AO-3 — what Settings → History's specimen says History reads now: the
 * census's first agent, brought in already. */
export const FIXTURE_HISTORY_CONSENTED: ReadonlySet<string> = new Set(
  FIXTURE_HISTORY_CENSUS.rows.slice(0, 1).map((row) => row.kind),
);

/** AO-4b — History's first reading as Setting up hears it pushed: the census's
 * first agent brought in, its skim at 1,215 of 5,912 files; then landed (rosetta
 * queues a skimmed agent again to stream it), 4,441 sessions in 74 projects. */
const firstReading = (
  backfill: { state: string; filesSkimmed: number; sessionsTotal: number },
  projects: number,
): IndexStatus => {
  const reading = FIXTURE_HISTORY_CENSUS.rows.slice(0, 1);
  return {
    phase: "backfilling",
    rosettad: { phase: "ready", detail: null, pid: 51207, protocolVersion: 20 },
    enrollment: {
      enabledKinds: reading.map((row) => row.kind),
      runtimes: [],
      retired: [],
      updatedAt: null,
    },
    runtimes: reading.map((row) => ({
      runtimeId: "rt_5f0c9a2e1b7d4c3a",
      kind: row.kind,
      provenance: "discovered" as const,
      dataRoot: row.root,
      watched: true,
      backfill: {
        filesTotal: 5912,
        bytesTotal: 12_200_000_000,
        bytesStreamed: 0,
        records: 0,
        ...backfill,
      },
    })),
    projects: Array.from({ length: projects }, (_, i) => ({
      key: `p1:fixture${i}`,
      sessionsTotal: 60,
      sessionsDone: 0,
      bytesTotal: 165_000_000,
      bytesStreamed: 0,
    })),
  };
};

export const FIXTURE_FIRST_READING_FINDING = firstReading(
  { state: "skimming", filesSkimmed: 1215, sessionsTotal: 0 },
  0,
);
export const FIXTURE_FIRST_READING_FOUND = firstReading(
  { state: "queued", filesSkimmed: 5912, sessionsTotal: 4441 },
  74,
);
