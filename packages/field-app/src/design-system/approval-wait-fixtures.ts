import { AGENT_CATALOG } from "@vibefield/contracts";
import {
  type ApprovalWaitFact,
  type ApprovalWaitRow,
  ApprovalWaits,
} from "../account/approval-wait";

// TS-4b — the approval line as the claims strip says it in the catalog: the
// SHIPPING watch (`account/approval-wait.ts`) over two reads of one agent of
// this Mac's (the catalog's first agent), an approval it waited on from 16:00
// and answered at 16:14.

const AGENT = AGENT_CATALOG[0];
const START = Date.UTC(2026, 9, 29, 16, 0, 0);
const ANSWERED = START + 14 * 60_000;

const agent: ApprovalWaitRow = {
  id: "fixture-approval",
  kind: "agent",
  status: "blocked",
  statusSince: START,
  alive: true,
  wait: { kind: "permission", since: START },
  device: { self: true },
  project: { name: "vibe-field" },
  provider: { id: AGENT.id, label: AGENT.label },
};

const waits = new ApprovalWaits();
waits.observe([agent]);

const answered: ApprovalWaitRow = {
  ...agent,
  status: "working",
  statusSince: ANSWERED,
  wait: undefined,
};

export const FIXTURE_APPROVAL_WAIT: ApprovalWaitFact | null = waits.observe([answered])[0] ?? null;
