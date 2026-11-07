#!/usr/bin/env node
// Every golden the iOS test bundles carry must be the contracts' own bytes.
//
// EL9 says a seam is pinned by fixtures parsed on BOTH sides; the phone is the
// third side, and it holds COPIES because its bundle cannot reach across the
// workspace. A copy is only evidence while it is identical — and this lane
// shipped a "byte for byte" claim that was already false by one line of
// formatting, with nothing to notice. This is the thing that notices.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const contracts = join(root, "packages/contracts/fixtures");
const searchRoots = [
  join(root, "apps/ios/VibeFieldKit/Tests"),
  join(root, "apps/ios/VibeFieldKit/Sources"),
];

/** Every `*.json` under a tree, however deep. */
function jsonFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // An asset catalog's `Contents.json` files are Xcode's, never a golden.
    if (entry.isDirectory() && entry.name.endsWith(".xcassets")) continue;
    if (entry.isDirectory()) found.push(...jsonFiles(path));
    else if (entry.name.endsWith(".json")) found.push(path);
  }
  return found;
}

// The ONLY phone-side JSON files with no contracts origin: fixtures a kit lane
// authored for itself (recorded TRF1 frames, not a wire shape). Anything else
// with no origin is an ORPHAN — a golden that was deleted or renamed upstream
// while its copy stayed behind, unchecked. Before 2026-09-14 (TM review, T-H2)
// such a copy was silently skipped and `checked` merely dropped by one; a gate
// that stops gating without a red is the failure this script exists to catch,
// so the copy half now has the pin half's posture below.
// IOS-13a: `acknowledgements-l5.lane.json` is a trimmed copy of L5's generated acknowledgements (lane `a76cc7aba`, 8 of
// its parts and every text they name, one unknown field added), which FieldSettingsTests reads. Its origin is L5's
// output, not a contracts golden. L5 landed (02b47ba2a), so the row before the copies below holds its entries to the
// committed file.
const LANE_AUTHORED = new Set([
  "trf1-frames.lane.json",
  "spawn-bloom-geometry.lane.json",
  "acknowledgements-l5.lane.json",
]);

// PG-4s — the phone's Godview views (PG-5…8): the witness each view suite replays, the toolkit's golden, and one
// golden per view, which its lane names here (ONE line; both uses below derive from it). FieldHomeTests reads them.
const PHONE_GODVIEW = join(root, "packages/field-app/test/fixtures/phone-godview");
// biome-ignore format: one golden per line, so each view lane's line merges keep-both
const phoneViewGoldens = [
  "phone-list.golden.json",
  "phone-rain.golden.json",
  "phone-timeline.golden.json",
  "phone-spend.golden.json",
];
// IOS-12c (M-c1; the 12c plan's Q1 (a)) — the phone's Chat goldens, written by field-app's own fold
// (packages/field-app/test/chat-flow-goldens.test.ts, `VF_WRITE_GOLDENS=1`), which the kit's ChatFlow and
// ChatMarkdown are held to (FieldProductTests). Read from their folder, so a case the fold's test adds is a required
// mirror the moment it is committed. Each basename is its own: the walk below maps a copy to its origin by basename.
const CHAT_FLOW = join(root, "packages/field-app/test/fixtures/chat-flow");
let chatFlowGoldens = [];
try {
  chatFlowGoldens = readdirSync(CHAT_FLOW)
    .filter((name) => name.endsWith(".golden.json"))
    .sort();
} catch {
  // said with the problems, below
}
// IOS-12d (Q1 (a), VF-PM 2026-11-06 19:12Z) — the needs-you card's goldens, written by field-app's own card
// (packages/field-app/test/needs-card-goldens.test.ts, `VF_WRITE_GOLDENS=1`), which the kit's NeedsCards is held to
// (FieldProductTests). Read from their folder, as the flow's are.
const NEEDS_CARD = join(root, "packages/field-app/test/fixtures/needs-card");
let needsCardGoldens = [];
try {
  needsCardGoldens = readdirSync(NEEDS_CARD)
    .filter((name) => name.endsWith(".golden.json"))
    .sort();
} catch {
  // said with the problems, below
}
// IOS-12f (f1; VF-PM 2026-11-07 12:35:44Z) — the New spark sheet's goldens, written by field-app's own model
// (packages/field-app/test/new-spark-goldens.test.ts, `VF_WRITE_GOLDENS=1`), which the kit's NewSpark is held to
// (FieldHomeTests). Read from their folder, as the card's are.
const NEW_SPARK = join(root, "packages/field-app/test/fixtures/new-spark");
let newSparkGoldens = [];
try {
  newSparkGoldens = readdirSync(NEW_SPARK)
    .filter((name) => name.endsWith(".golden.json"))
    .sort();
} catch {
  // said with the problems, below
}
// Goldens whose origin is another package than the contracts — a design
// decision both apps compute, not a wire shape — compared byte for byte all
// the same. PJ-7: the project ink's table (DESIGN.md §2.9), which the design
// kit's own test reads too. PG-3a: the phone's parity goldens, the home's window over the witness
// remote goldens (field-app computes them, `phone:goldens`), which the kit's fold and body model are
// held to. PG-3c mirrors phone-fold (Tests/FieldMeshTests), and PG-3d again in
// Tests/FieldProductTests, where its parity suite runs; PG-3e mirrors phone-body in
// Tests/FieldMeshTests, where the mapping from a drawn row to its bubble runs. (Corrected
// 2026-11-02, PG-3e: this said phone-body would mirror "with its body model" in FieldAgentsTests,
// which reads no FieldProduct and so could never run the golden.)
const OTHER_ORIGINS = new Map([
  ["project-ink.golden.json", join(root, "packages/design-kit/fixtures/project-ink.golden.json")],
  // IOS-12a (PC-D6 A) — the spark face's DNA golden, generated from the vendored engine by
  // packages/design-kit/scripts/spark-dna-golden.mjs, which the phone's agentDNA (IOS-12b) is held to
  ["spark-dna.golden.json", join(root, "packages/design-kit/fixtures/spark-dna.golden.json")],
  // IOS-12b — the flat star's golden beside it (the same generator, from flat-star.ts), which SparkFlatStar is held to
  [
    "spark-flat-star.golden.json",
    join(root, "packages/design-kit/fixtures/spark-flat-star.golden.json"),
  ],
  // IOS-12e — the engine's rows (spark-rows-golden.mjs), which SparkBuddy is held to, and the stills' manifest
  // (spark-stills-golden.mjs), which names each PNG the Metal star is held to; the PNGs are held below
  ["spark-rows.golden.json", join(root, "packages/design-kit/fixtures/spark-rows.golden.json")],
  [
    "spark-stills.manifest.json",
    join(root, "packages/design-kit/fixtures/spark-stills.manifest.json"),
  ],
  [
    "phone-fold.golden.json",
    join(root, "packages/field-app/test/fixtures/phone-godview/phone-fold.golden.json"),
  ],
  [
    "phone-body.golden.json",
    join(root, "packages/field-app/test/fixtures/phone-godview/phone-body.golden.json"),
  ],
  // PG-4s — the toolkit's golden, and each view's from the one list above
  ["phone-toolkit.golden.json", join(PHONE_GODVIEW, "phone-toolkit.golden.json")],
  // PG-4t — the views' faces, which the Stories row draws
  ["phone-marks.golden.json", join(PHONE_GODVIEW, "phone-marks.golden.json")],
  // UM-1 (2026-11-06) — the meters' golden: field-app's meter model and Bands geometry (src/usage/golden.ts, written
  // by perf/usage-bands.generate.perf.ts), a VibeField golden outside the phone Godview's family. Its FieldHomeTests
  // copy is required below (the `usage` rows, UM-4 PH-2), where BandsParityTests holds the phone's meters to it.
  [
    "usage-bands.golden.json",
    join(root, "packages/field-app/test/fixtures/usage/usage-bands.golden.json"),
  ],
  ...phoneViewGoldens.map((name) => [name, join(PHONE_GODVIEW, name)]),
  ...chatFlowGoldens.map((name) => [name, join(CHAT_FLOW, name)]),
  ...needsCardGoldens.map((name) => [name, join(NEEDS_CARD, name)]),
  ...newSparkGoldens.map((name) => [name, join(NEW_SPARK, name)]),
]);
// Goldens VENDORED from a sibling project outside this workspace, so there is no origin here to
// compare with: each is pinned by its sha256 beside the files it tests, and the vendoring script's
// own `--check` holds them all to their pins below (needing no sibling checkout). The phone's
// splash (DESIGN.md §8 "The phone's splash"): runtime.js's goldens for the Swift runtime, vendored
// with the shaders and the runtime from vibefield-splash's Metal bake.
const VENDORED = new Map([["splash-clock.json", "apps/ios/scripts/vendor-splash.mjs"]]);
// Bundle assets a script EDITED in place, whose generator is not in this repo: each script's own
// `--check` holds the asset to the Swift table it serves and to its test's pin, below with the
// vendored ones, so a table edit the asset does not follow is red here and not only on the kit
// slot. LP-4 — the swarm's mark atlas (FieldSwarm/Resources/marks.png), every tile but Claude
// Code's and Codex's blanked, held to MarksAtlas.swift's `candidates` and `kept` and to
// FieldSwarmTests' `uploadedMarksMatchDesktopPixels`.
const EDITED_IN_PLACE = ["apps/ios/scripts/blank-unkept-marks.mjs"];

const problems = [];
let checked = 0;

// FS-2: required mirrors are named as well as compared below. Deleting a
// workspace golden must not silently reduce the third-side coverage count.
const workspaceFixtures = [
  "workspace-roots.valid.json",
  "workspace-list.valid.json",
  "workspace-search.valid.json",
  "workspace-list-params.valid.json",
  "workspace-search-params.valid.json",
  "agent-catalog.valid.json",
];
// PJ-7: the phone's `project.*` reads (History) and its launch sheet's reads
// and asks, named the same way — a project set and a launch set.
const projectFixtures = [
  "place-ref.valid.json",
  "project-list.valid.json",
  "project-list.tailnet.json",
  "project-summary.valid.json",
  "project-summary.tailnet.json",
  "project-summary.home.json",
  "project-summary.recipe.json",
  "project-summary.hidden.json",
  "project-summary.recipe-place.json",
  "project-get.valid.json",
  "project-get.moved.json",
  "project-sessions.valid.json",
  "project-figures.valid.json",
  "project-figures-day.valid.json",
  "project-changes-open.snapshot.json",
  "project-changes-delta.regrouped.json",
  "project-refusal.path-in-request.json",
  "project-refusal.key-moved.json",
  "error-data.projects-grouping.json",
  "index-sessions.keyed.json",
  "project-list-params.valid.json",
  "project-get-params.key.json",
  "project-get-params.anchor.json",
  "project-sessions-params.valid.json",
  "project-figures-params.valid.json",
  "project-figures-day-params.valid.json",
  "project-subscribe-params.valid.json",
];
const launchFixtures = [
  "agent-models.valid.json",
  "agent-models.stale.json",
  "agent-models.auth-required.json",
  "agent-models-params.valid.json",
  "agent-spawn-params.model-selection.json",
  "agent-spawn-params.place.json",
  "agents-profile-sets.valid.json",
  "agent-field-snapshot.native-session.json",
  "agent-field-snapshot.stop.json",
  "agent-field-snapshot.turned.json",
];
// History's ledger reads them: the fixture door serves these, its tests read them.
const historyFixtures = [
  "project-list.valid.json",
  "project-get.valid.json",
  "project-sessions.valid.json",
  "project-figures.valid.json",
  "project-changes-open.snapshot.json",
];
// SE-2 (SE-D3/D4 A) — the phone's search reads `index.search`'s answers: the valid golden (Live now's ask, and the
// DEBUG fixture door's answer) and Everything's, whose hits carry their root's facts. Named so a copy deleted with its
// golden kept is red here, not unseen.
const searchFixtures = ["index-search-result.valid.json", "index-search-result.everything.json"];
// fix7 — the ledger reads its door's index beside it: ready, failed, rebuilding.
const indexFixtures = [
  "index-status.valid.json",
  "index-status.failed.json",
  "index-status.rebuilding.json",
];
// The launch sheet reads these (its tests, and the DEBUG fixture door the first two).
const sheetFixtures = [
  "agents-profile-sets.valid.json",
  "agent-models.valid.json",
  "agent-models.stale.json",
  "agent-models.auth-required.json",
  "project-summary.recipe-place.json",
];
// F1 — the freeway's frame bytes, which the kit's codec is held to.
const freewayFixtures = [
  "freeway-frames.vector.json",
  "freeway-opened.tickets.json",
  "freeway-opened.attach-grant.json",
  "freeway-opened.renew-refused.json",
];
// C5/C8 (the fixer's review of 2026-10-21, finding 9) — the cell's refusal and its ended
// lease, which the routed client's own reader tests parse.
const tpFixtures = [
  "tp-input-refused.lagging.json",
  "tp-cell-activation-status.exited.json",
  "tp-cell-activation-status.removed.json",
];
// PG-3c — the remote cut the phone will read (`AgentRemoteRow`, its mesh open and frames) and
// PG-3a's witness goldens, which the kit's fold (3d) and the home's window are both held to.
// PG-3e: 3b's routed report joins, beside the kit's encoder (FieldProductTests). Only `.routed`:
// `.forwarded` is fieldd to fieldd and is never the phone's. (Corrected 2026-11-02, PG-3e: this
// said "3b's agent-report-shown.* join at 3e".)
const remoteWitness = [
  "agent-remote-mesh-open.witness.json",
  "agent-remote-mesh-frames.witness.json",
  "agent-remote-mesh-open.resync.json",
];
const remoteFixtures = [
  "agent-remote-row.valid.json",
  "agent-remote-row.terminal.json",
  // IOS-12a — a spark's own run on the remote cut (`spark`, `origin`), which Chat on the phone reads
  "agent-remote-row.spark.json",
  "agent-remote-mesh-open.valid.json",
  "agent-remote-mesh-frames.valid.json",
  "monitor-agent-row.valid.json",
  "agent-report-shown.routed.json",
  // PG-9 (PG-L4.4) — the phone's mesh subscribe naming its cursors, and the open that answers each desktop by one
  "agent-subscribe-params.mesh-since.json",
  "agent-remote-mesh-open.resume.json",
  ...remoteWitness,
];
// IOS-12b — Chat on the phone: the home's lists of the sparks and of the needs-you queue (`scope: "mesh"`, IOS-12a),
// and an item of each kind, which the kit's `SparkSummary` / `NeedsItem` readers (FieldProductTests) parse.
const sparkFixtures = [
  "compose-sparks-list.valid.json",
  "compose-sparks-list.merged.json",
  "compose-sparks-list.turned.json",
  "needs-list.valid.json",
  "needs-list.merged.json",
  "needs-item.question.json",
  "needs-item.held-send.json",
  "needs-item.held-send-cut.json",
  "needs-item.held-spawn.json",
  "needs-item.agent-ask.json",
  "needs-item.unknown-kind.json",
  // IOS-12d — CP-4's six flow kinds, which Chat draws as the Mac's card does until CP-4b, and needs.answer's wire
  "needs-item.flow-proposal.json",
  "needs-item.flow-gate.json",
  "needs-item.flow-changed.json",
  "needs-item.flow-repair.json",
  "needs-item.flow-cap.json",
  "needs-item.flow-lost.json",
  "needs-answer-params.valid.json",
  "needs-answer-result.valid.json",
];
// SP-7a — the spark's transcript on the phone: every line kind, the worker's five frames, the window's one open, and
// the ticket's answer and ask, which the kit's own `SparkTranscriptWire` and `SparkTranscriptReader` read
// (FieldProductTests, the contracts' and the Mac reader's rows). M-b2 adds the phone's: the routed serve's answer and
// the ask that names the desktop.
const transcriptFixtures = [
  "spark-transcript-frame.caught-up.json",
  "spark-transcript-frame.line.json",
  "spark-transcript-frame.ready.json",
  "spark-transcript-frame.refused.json",
  "spark-transcript-frame.run.json",
  "spark-transcript-line.act-crew.json",
  "spark-transcript-line.act.json",
  "spark-transcript-line.forged.json",
  "spark-transcript-line.gap.json",
  "spark-transcript-line.outcome-uncertain.json",
  "spark-transcript-line.outcome.json",
  "spark-transcript-line.reply.json",
  "spark-transcript-line.run.json",
  "spark-transcript-line.tool-ours.json",
  "spark-transcript-line.tool.json",
  "spark-transcript-line.turn.json",
  "spark-transcript-line.unknown-kind.json",
  "spark-transcript-line.you-terminal.json",
  "spark-transcript-line.you.json",
  "spark-transcript-open.valid.json",
  "spark-transcript-ticket-params.device.json",
  "spark-transcript-ticket-params.valid.json",
  "spark-transcript-ticket.remote.json",
  "spark-transcript-ticket.valid.json",
];
// IOS-12c (M-c1) — the say door's params and its three receipts, which the kit's SparkSay encodes and reads
const sayFixtures = [
  "compose-sparks-say-params.valid.json",
  "compose-sparks-say-params.chips.json",
  "compose-sparks-say.queued.json",
  "compose-sparks-say.waking.json",
  "compose-sparks-say.delivered.json",
];
// UM-4 (UM-D8 A) — the phone's meters: the home's usage batch (one with readings, needs and a model's week; the empty
// one before the first refresh; one with a budget, a kept reading and a shared plan) and its profile sets with
// personas and plans, which the kit's `AgentAccountUsageBatch` / `AgentProfileSet` readers (FieldProductTests) parse.
const usageFixtures = [
  "agent-usage.valid.json",
  "agent-usage.empty.json",
  "agent-usage.budget.json",
  "agents-profile-sets.meters.json",
];
const requiredMirrors = [
  ["freeway", freewayFixtures, ["Tests/FieldFreewayTests"]],
  ["tp", tpFixtures, ["Tests/FieldRoutedTerminalTests"]],
  // the routed reader's own bundle reads the freeway ticket's endpoints
  ["freeway", ["freeway-opened.tickets.json"], ["Tests/FieldRoutedTerminalTests"]],
  ["workspace", workspaceFixtures, ["Tests/FieldWorkspaceTests", "Sources/FieldWorkspace"]],
  ["project", projectFixtures, ["Tests/FieldProductTests"]],
  ["project", historyFixtures, ["Tests/FieldHistoryTests", "Sources/FieldHistory"]],
  ["index", indexFixtures, ["Tests/FieldHistoryTests"]],
  // SE-2 — search's answers: both readers' suites, and the DEBUG fixture door's answer (`HistoryFixtureDoor`)
  ["search", searchFixtures, ["Tests/FieldHistoryTests", "Tests/FieldProductTests"]],
  ["search", searchFixtures.slice(0, 1), ["Sources/FieldHistory"]],
  // SE-2 — Live now's rows under `-vf-mock` (`MockAccount.searchRows`): the witness's open, in FieldHome's bundle
  ["search", ["agent-remote-mesh-open.witness.json"], ["Sources/FieldHome"]],
  ["launch", launchFixtures, ["Tests/FieldProductTests"]],
  ["launch", sheetFixtures, ["Tests/FieldWorkspaceTests"]],
  ["launch", sheetFixtures.slice(0, 2), ["Sources/FieldWorkspace"]],
  // TS-7b — the phone code's vector: the Swift parser reads the bytes the TypeScript one does
  ["phone-code", ["phone-code.vector.json"], ["Tests/FieldMeshTests"]],
  // IOS-8f — the face deal's vector: the phone deals from the desktop's own deck and hash
  ["face", ["face-deal.vector.json"], ["Tests/FieldDesignTests"]],
  // IOS-12a (PC-D6 A) — the spark face's DNA golden: the phone deals a spark's face from the desktop's own engine
  [
    "spark-face",
    [
      "spark-dna.golden.json",
      "spark-flat-star.golden.json",
      "spark-rows.golden.json",
      "spark-stills.manifest.json",
    ],
    ["Tests/FieldDesignTests"],
  ],
  // IOS-8f — `user.me`'s answers, read by the kit's own `UserMeResult`
  ["user-me", ["user-me.valid.json", "user-me.dealt.json"], ["Tests/FieldProductTests"]],
  // PG-3c — the remote cut's readers' goldens; PG-3d — the fold's parity golden beside them, which
  // the phone's copy of its home's board is held to step by step (PhoneFoldParityTests)
  ["remote", [...remoteFixtures, "phone-fold.golden.json"], ["Tests/FieldProductTests"]],
  // IOS-12b — the sparks' and the needs' lists, and each kind of item, read by Chat on the phone
  ["sparks", sparkFixtures, ["Tests/FieldProductTests"]],
  // IOS-12c (M-c1) — the phone's Chat: the Mac fold's goldens (in their own folder), and the say door's wire
  ["chat", chatFlowGoldens.map((name) => `chat-flow/${name}`), ["Tests/FieldProductTests"]],
  ["chat", sayFixtures, ["Tests/FieldProductTests"]],
  // and the two merged lists Chat's demo door answers under `-vf-mock` (ChatFixtureDoor, DEBUG)
  ["sparks", ["compose-sparks-list.merged.json", "needs-list.merged.json"], ["Sources/FieldHome"]],
  // IOS-12d — the needs-you card's goldens (in their own folder), and the items and the catalog Chat's demo door
  // answers its cards with under `-vf-mock` (ChatFixtureDoor's `-vf-needs-case=`)
  ["needs-card", needsCardGoldens.map((name) => `needs-card/${name}`), ["Tests/FieldProductTests"]],
  // IOS-12f (f1) — the New spark sheet's goldens (in their own folder), which the kit's NewSpark is held to
  ["new-spark", newSparkGoldens.map((name) => `new-spark/${name}`), ["Tests/FieldHomeTests"]],
  [
    "chat",
    ["needs-item.held-spawn.json", "needs-item.agent-ask.json", "agent-catalog.valid.json"],
    ["Sources/FieldHome"],
  ],
  // IOS-12c (M-c2) — the thread cases Chat's demo door draws under `-vf-mock` (ChatFixtureDoor)
  [
    "chat",
    ["at-rest", "earlier", "hello", "receipts"].map((c) => `chat-flow/chat-flow.${c}.golden.json`),
    ["Sources/FieldHome"],
  ],
  // SP-7a — the spark's transcript, read on the phone as the Mac reads it
  ["spark-transcript", transcriptFixtures, ["Tests/FieldProductTests"]],
  // UM-4 — the home's usage batch and its profile sets, read by the kit's readers
  ["usage", usageFixtures, ["Tests/FieldProductTests"]],
  // and what the meters' demo door answers under `-vf-mock` (MetersFixtureDoor, DEBUG): the batch with a budget, the
  // empty one (a first read), and the profile sets with plans
  [
    "usage",
    ["agent-usage.budget.json", "agent-usage.empty.json", "agents-profile-sets.meters.json"],
    ["Sources/FieldHome"],
  ],
  // UM-4 PH-2 — the usage bands golden and every input it was computed from (its `inputs`, and the catalog whose order
  // and names it carries), which BandsParityTests and MeterModelTests (FieldHomeTests) recompute it over
  [
    "usage",
    [
      "usage-bands.golden.json",
      "agents-profile-sets.valid.json",
      "agents-profile-sets.meters.json",
      "agent-usage.valid.json",
      "agent-usage.budget.json",
      "agent-catalog.valid.json",
    ],
    ["Tests/FieldHomeTests"],
  ],
  // the fold's parity golden and its inputs; the field cut's project-key collapse beside the remote cut's;
  // PG-3e — the body golden, which the drawn rows' bubbles are held to (PhoneBodyParityTests)
  [
    "remote",
    [
      ...remoteWitness,
      "agent-field-snapshot.project-keys.json",
      "phone-fold.golden.json",
      "phone-body.golden.json",
    ],
    ["Tests/FieldMeshTests"],
  ],
  // PG-3e — the demo door (`-vf-demo-field-slice`) serves the witness's open from the kit's own
  // bundle; the field golden it served until the switch left that folder in the same commit
  ["remote", ["agent-remote-mesh-open.witness.json"], ["Sources/FieldMesh"]],
  // PG-4s — the Godview views' bundle: the witness every view suite replays, the toolkit's golden and each view's.
  // Never empty: the witness stands in it from PG-4s on, so the row always asserts something.
  [
    "phone-view",
    [...remoteWitness, "phone-toolkit.golden.json", "phone-marks.golden.json", ...phoneViewGoldens],
    ["Tests/FieldHomeTests"],
  ],
];
if (chatFlowGoldens.length === 0) {
  problems.push(
    `the phone's Chat goldens are missing: ${relative(root, CHAT_FLOW)} holds no *.golden.json`,
  );
}
if (needsCardGoldens.length === 0) {
  problems.push(
    `the needs-you card's goldens are missing: ${relative(root, NEEDS_CARD)} holds no *.golden.json`,
  );
}
if (newSparkGoldens.length === 0) {
  problems.push(
    `the New spark sheet's goldens are missing: ${relative(root, NEW_SPARK)} holds no *.golden.json`,
  );
}
for (const [set, fixtures, folders] of requiredMirrors) {
  for (const folder of folders) {
    for (const fixture of fixtures) {
      const copy = join(root, "apps/ios/VibeFieldKit", folder, "Fixtures", fixture);
      try {
        statSync(copy);
      } catch {
        problems.push(`required ${set} mirror is missing: ${relative(root, copy)}`);
      }
    }
  }
}

// PG-4s (Q-S8) — a view's golden committed in field-app but named in no list here would never reach the phone: every
// `phone-*.golden.json` beside fold, body and the toolkit's must be in `phoneViewGoldens`.
{
  const named = new Set([
    "phone-fold.golden.json",
    "phone-body.golden.json",
    "phone-toolkit.golden.json",
    "phone-marks.golden.json",
    ...phoneViewGoldens,
  ]);
  let committed = [];
  try {
    committed = readdirSync(PHONE_GODVIEW).filter((name) => /^phone-.+\.golden\.json$/.test(name));
  } catch {
    problems.push(`the phone's goldens folder is unreadable: ${relative(root, PHONE_GODVIEW)}`);
  }
  for (const name of committed) {
    if (!named.has(name))
      problems.push(
        `${relative(root, join(PHONE_GODVIEW, name))} is committed but not mirrored: add it to phoneViewGoldens`,
      );
  }
}

// IOS-13a — the trimmed acknowledgements FieldSettingsTests reads (`acknowledgements-l5.lane.json`, LANE_AUTHORED
// above) are held to L5's committed file, apps/ios/App/Resources/acknowledgements.json, entry for entry: each part the
// copy keeps is the committed part of the same ecosystem and name, each text the committed text of the same id, and
// its schema, pins and tailscaleKit are the committed ones. Two differences are the lane's on purpose, and they are the
// only two: OpenSSL's `homepage`, the one field the reader does not know (AppReviewTests' `bundled` row holds that it
// is kept and named), and the copy's own TRIMMED line after the committed note. When L5 regenerates and an entry the
// copy keeps moves, this is red until the copy is refreshed.
{
  const L5_COMMITTED = join(root, "apps/ios/App/Resources/acknowledgements.json");
  const L5_TRIMMED = join(
    root,
    "apps/ios/VibeFieldKit/Tests/FieldSettingsTests/Fixtures/acknowledgements-l5.lane.json",
  );
  // The fields the lane added, by part name: the copy's part, less these, is the committed part.
  const ADDED_PART_FIELDS = new Map([["OpenSSL", ["homepage"]]]);
  const canon = (value) => {
    if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
  };
  const copy = relative(root, L5_TRIMMED);
  const fix = `  fix: refresh ${copy} from ${relative(root, L5_COMMITTED)}, the same parts and every text they name`;
  let committed = null;
  let trimmed = null;
  try {
    committed = JSON.parse(readFileSync(L5_COMMITTED, "utf8"));
    trimmed = JSON.parse(readFileSync(L5_TRIMMED, "utf8"));
  } catch (error) {
    problems.push(
      `the phone's acknowledgements copy cannot be held to L5's file: ${error.message}`,
    );
  }
  if (committed !== null && trimmed !== null) {
    checked += 1;
    const said = [];
    const tops = new Set([...Object.keys(committed), ...Object.keys(trimmed)]);
    for (const key of ["components", "texts", "note"]) tops.delete(key);
    for (const key of tops) {
      if (canon(trimmed[key]) !== canon(committed[key]))
        said.push(`its ${key} is not the committed file's`);
    }
    if (
      trimmed.note !== committed.note &&
      !String(trimmed.note).startsWith(`${committed.note} TRIMMED `)
    ) {
      said.push("its note is not the committed note followed by its own TRIMMED line");
    }
    const parts = new Map(
      (committed.components ?? []).map((part) => [`${part.ecosystem}/${part.name}`, part]),
    );
    const texts = new Map((committed.texts ?? []).map((text) => [text.id, text]));
    const kept = trimmed.components ?? [];
    const carried = trimmed.texts ?? [];
    if (kept.length === 0) said.push("it keeps no parts");
    for (const part of kept) {
      const id = `${part.ecosystem}/${part.name}`;
      const theirs = parts.get(id);
      const added = ADDED_PART_FIELDS.get(part.name) ?? [];
      const ours = Object.fromEntries(Object.entries(part).filter(([key]) => !added.includes(key)));
      if (theirs === undefined) said.push(`it keeps ${id}, which L5's file no longer lists`);
      else if (canon(ours) !== canon(theirs)) said.push(`its ${id} is not the committed part`);
    }
    for (const [name, fields] of ADDED_PART_FIELDS) {
      const part = kept.find((candidate) => candidate.name === name);
      for (const field of fields) {
        if (part?.[field] === undefined)
          said.push(`its ${name} lost the ${field} the lane added on purpose`);
      }
    }
    for (const text of carried) {
      const theirs = texts.get(text.id);
      if (theirs === undefined)
        said.push(`it carries text ${text.id}, which L5's file no longer has`);
      else if (canon(text) !== canon(theirs))
        said.push(`its text ${text.id} is not the committed text`);
    }
    const named = new Set(kept.flatMap((part) => part.texts ?? []));
    const ids = new Set(carried.map((text) => text.id));
    for (const id of named)
      if (!ids.has(id)) said.push(`a part it keeps names text ${id}, which it does not carry`);
    for (const id of ids)
      if (!named.has(id)) said.push(`it carries text ${id}, which no part it keeps names`);
    if (said.length > 0) {
      problems.push(
        `${copy} has moved from ${relative(root, L5_COMMITTED)}: ${said.join("; ")}\n${fix}`,
      );
    }
  }
}

for (const searchRoot of searchRoots) {
  for (const copy of jsonFiles(searchRoot)) {
    const name = copy.slice(copy.lastIndexOf("/") + 1);
    const origin = OTHER_ORIGINS.get(name) ?? join(contracts, name);
    try {
      statSync(origin);
    } catch {
      if (!LANE_AUTHORED.has(name) && !VENDORED.has(name)) {
        problems.push(
          `${relative(root, copy)} has no origin in packages/contracts/fixtures — a golden was ` +
            "deleted or renamed and this phone-side copy is now unchecked\n" +
            "  fix: delete the copy, or add its basename to LANE_AUTHORED in this script",
        );
      }
      continue;
    }
    checked += 1;
    const a = readFileSync(origin);
    const b = readFileSync(copy);
    if (!a.equals(b)) {
      problems.push(
        `${relative(root, copy)} differs from ${relative(root, origin)}\n` +
          `  fix: cp ${relative(root, origin)} ${relative(root, copy)}`,
      );
    }
  }
}

// IOS-12e — the stills golden's PNGs: packages/design-kit/fixtures/spark-stills/, drawn by spark-stills-golden.mjs and
// named with their sha256 in its manifest (mirrored above as JSON). The kit's copies in FieldDesignTests'
// Fixtures/spark-stills must be the same set of files, byte for byte, and the set the manifest names: a PNG copied
// by hand, one left behind by a redraw, or a case the copy lacks is red here before it is a kit slot's.
{
  const ORIGIN = join(root, "packages/design-kit/fixtures/spark-stills");
  const COPY = join(root, "apps/ios/VibeFieldKit/Tests/FieldDesignTests/Fixtures/spark-stills");
  const MANIFEST = join(root, "packages/design-kit/fixtures/spark-stills.manifest.json");
  const pngs = (dir) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    return names.filter((name) => name.endsWith(".png")).sort();
  };
  const origin = pngs(ORIGIN);
  const copy = pngs(COPY);
  let named = null;
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    named = manifest.cases.map(({ file }) => file.slice(file.lastIndexOf("/") + 1)).sort();
  } catch {
    problems.push(`the stills' manifest is unreadable: ${relative(root, MANIFEST)}`);
  }
  if (origin === null) problems.push(`the stills golden is missing: ${relative(root, ORIGIN)}`);
  if (copy === null)
    problems.push(`required spark-face mirror is missing: ${relative(root, COPY)}`);
  if (origin !== null && named !== null && origin.join("\n") !== named.join("\n"))
    problems.push(`${relative(root, ORIGIN)} is not the set its manifest names: redraw it`);
  if (origin !== null && copy !== null) {
    for (const name of new Set([...origin, ...copy])) {
      const from = join(ORIGIN, name);
      const to = join(COPY, name);
      const fix = `  fix: cp ${relative(root, from)} ${relative(root, to)}`;
      if (!origin.includes(name)) {
        problems.push(`${relative(root, to)} has no origin in ${relative(root, ORIGIN)}`);
      } else if (!copy.includes(name)) {
        problems.push(`${relative(root, to)} is missing\n${fix}`);
      } else if (!readFileSync(from).equals(readFileSync(to))) {
        problems.push(`${relative(root, to)} differs from ${relative(root, from)}\n${fix}`);
      } else {
        checked += 1;
      }
    }
  }
}

// The vendored files, each held to its pin by the script that vendored it (VENDORED, above), and
// the assets edited in place, each held by the script that edited it (EDITED_IN_PLACE, above).
for (const script of new Set([...VENDORED.values(), ...EDITED_IN_PLACE])) {
  try {
    execFileSync(process.execPath, [join(root, script), "--check"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    checked += 1;
  } catch (error) {
    problems.push(`${script} --check: ${String(error.stderr ?? error.message).trim()}`);
  }
}

// PJ-7 — the OS marks (Simple Icons, kept exact: DESIGN.md §13, PJ-D24) ship
// on the phone as template SVGs beside the glyphs. They are COPIES of the
// desktop's `os-marks.tsx` paths, held to them here the way a golden is.
const OS_MARKS_TSX = join(root, "packages/field-app/src/godview/os-marks.tsx");
const OS_MARKS_IOS = join(
  root,
  "apps/ios/VibeFieldKit/Sources/FieldDesign/Resources/OSMarks.xcassets",
);
{
  const source = readFileSync(OS_MARKS_TSX, "utf8");
  const start = source.indexOf("const MARKS");
  const block = source.slice(start, source.indexOf("};", start));
  const marks = [...block.matchAll(/(\w+): \{\s*d: "([^"]+)",(\s*evenOdd: true,)?/g)];
  if (marks.length === 0) problems.push(`no OS marks read from ${relative(root, OS_MARKS_TSX)}`);
  for (const [, os, d, evenOdd] of marks) {
    const copy = join(OS_MARKS_IOS, `os-${os}.imageset`, `os-${os}.svg`);
    let svg = "";
    try {
      svg = readFileSync(copy, "utf8");
    } catch {
      problems.push(`the phone's ${os} mark is missing: ${relative(root, copy)}`);
      continue;
    }
    checked += 1;
    const sameRule = svg.includes('fill-rule="evenodd"') === Boolean(evenOdd);
    if (!svg.includes(` d="${d}"`) || !sameRule) {
      problems.push(
        `${relative(root, copy)} is not ${relative(root, OS_MARKS_TSX)}'s ${os} mark\n` +
          "  fix: copy the path (and its fill rule) from the desktop's mark, exactly",
      );
    }
  }
}

// TS-7 — Tailscale's logomark and its ink on the phone's sign-in (DESIGN.md
// §13, TS-D4: kept exact, in its own ink). The phone draws the desktop's
// `tailscale-mark.tsx` from the same constants, so each constant is read from
// both files and compared; and the approval page's admin console is
// truffle-core's own literal, which field-native's tests pin and the Swift
// node does not expose.
{
  const MARK_TSX = "packages/field-app/src/account/tailscale-mark.tsx";
  const MARK_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldDesign/TailscaleMark.swift";
  const TOKENS = "packages/design-kit/src/tokens.css";
  const PALETTE_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldDesign/ChromePalette.swift";
  const ADMIN_ORIGIN = "packages/field-native/tests/mesh_unit.rs";
  const ADMIN_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldMesh/FieldTruffleRuntime.swift";
  const read = (file) => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  const tsx = read(MARK_TSX);
  const swift = read(MARK_SWIFT);
  const tokens = read(TOKENS);
  const palette = read(PALETTE_SWIFT);
  const field = (text, pattern) => pattern.exec(text)?.[1]?.trim().toLowerCase() ?? null;
  const compare = (label, origin, copy, originFile, copyFile) => {
    checked += 1;
    if (origin === null || copy === null || origin !== copy) {
      problems.push(
        `${copyFile}'s ${label} is ${copy ?? "unreadable"} but ${originFile}'s is ${origin ?? "unreadable"}\n` +
          "  fix: copy the desktop's value exactly (or move this script's pattern with the declaration)",
      );
    }
  };
  for (const [label, origin, copy] of [
    ["box", /viewBox="0 0 (\d+) \d+"/, /^ {2}static let box: CGFloat = (\d+)$/m],
    [
      "dot centres",
      /^const AT = \[([^\]]+)\] as const;$/m,
      /^ {2}static let at: \[CGFloat\] = \[([^\]]+)\]$/m,
    ],
    ["dot radius", /\br=\{(\d+)\}/, /^ {2}static let radius: CGFloat = (\d+)$/m],
    [
      "solid dots",
      /^const SOLID = new Set\(\[([^\]]+)\]\);$/m,
      /^ {2}static let solid: Set<String> = \[([^\]]+)\]$/m,
    ],
    [
      "faint opacity",
      /fillOpacity: ([0-9.]+)/,
      /^ {2}static let faintOpacity: Double = ([0-9.]+)$/m,
    ],
    [
      "floor",
      /^export const TAILSCALE_MARK_MIN = (\d+);$/m,
      /^ {2}public static let minimum: CGFloat = (\d+)$/m,
    ],
  ]) {
    compare(
      `Tailscale mark ${label}`,
      field(tsx, origin),
      field(swift, copy),
      MARK_TSX,
      MARK_SWIFT,
    );
  }
  const inkCopy =
    /public static let tailscaleInk = dynamic\(light: 0x([0-9A-Fa-f]{6}), dark: 0x([0-9A-Fa-f]{6})\)/.exec(
      palette,
    );
  compare(
    "Tailscale ink (light)",
    field(tokens, /--vf-tailscale-ink: #([0-9a-fA-F]{6});/),
    inkCopy?.[1]?.toLowerCase() ?? null,
    TOKENS,
    PALETTE_SWIFT,
  );
  compare(
    "Tailscale ink (dark)",
    field(
      tokens,
      /--vf-tailscale-ink: #[0-9a-fA-F]{6};[\s\S]*?--vf-tailscale-ink: #([0-9a-fA-F]{6});/,
    ),
    inkCopy?.[2]?.toLowerCase() ?? null,
    TOKENS,
    PALETTE_SWIFT,
  );
  // SE-2 (SE-D3 A; DESIGN.md §5 *Search scrim*, returned 2026-11-06) — the phone's search dims the page under its
  // sheet with the Peek's own scrim, its dim alone: `ChromePalette.searchScrim` is `--vf-search-scrim`'s two alphas,
  // black on both sides. (WI-1 retired this check with the copy on 2026-11-02, 13aef47ec; it returns with it.)
  const scrimCopy =
    /public static let searchScrim = dynamic\(\s*light: 0x000000, lightAlpha: ([0-9.]+), dark: 0x000000, darkAlpha: ([0-9.]+)\)/.exec(
      palette,
    );
  const alpha = (percent) => (percent === null ? null : (Number(percent) / 100).toFixed(2));
  compare(
    "search scrim (light)",
    alpha(field(tokens, /--vf-search-scrim: rgb\(0 0 0 \/ (\d+)%\);/)),
    scrimCopy?.[1] ?? null,
    TOKENS,
    PALETTE_SWIFT,
  );
  compare(
    "search scrim (dark)",
    alpha(
      field(
        tokens,
        /--vf-search-scrim: rgb\(0 0 0 \/ \d+%\);[\s\S]*?--vf-search-scrim: rgb\(0 0 0 \/ (\d+)%\);/,
      ),
    ),
    scrimCopy?.[2] ?? null,
    TOKENS,
    PALETTE_SWIFT,
  );
  compare(
    "machines admin URL",
    field(read(ADMIN_ORIGIN), /facts\.admin_url\.as_deref\(\),\s*Some\("([^"]+)"\)/),
    field(read(ADMIN_SWIFT), /^ {2}static let tailscaleMachinesAdminURL = "([^"]+)"$/m),
    ADMIN_ORIGIN,
    ADMIN_SWIFT,
  );
}

// IOS-12b — Chat's tab glyph (DESIGN.md §8 "The phone's Chat": §13's
// `message` cut as `tab-chat`, as the Mac's cell wears it): a template SVG
// beside `tab-field`, held to design-kit's glyph data — its one stroke, at
// §13's weight of 2.
{
  const GLYPHS = "packages/design-kit/src/glyphs/data.ts";
  const COPY =
    "apps/ios/VibeFieldKit/Sources/FieldHome/Resources/Glyphs.xcassets/tab-chat.imageset/chat.svg";
  const read = (file) => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  const d =
    /^ {2}message: \{"kind":"instrument","strokes":\[\["path",\{"d":"([^"]+)"\}\]\],"fills":\[\]\},$/m.exec(
      read(GLYPHS),
    )?.[1];
  const svg = read(COPY);
  checked += 1;
  if (d === undefined || !svg.includes(` d="${d}"`) || !svg.includes('stroke-width="2"')) {
    problems.push(
      `${COPY} is not ${GLYPHS}'s \`message\` (${d === undefined ? "its stroke is unreadable" : "path or weight differ"})\n` +
        "  fix: copy the glyph's path exactly, stroked at 2 in its 24 box (or move this script's pattern with the data)",
    );
  }
}

// IOS-12b — §2.5's hues on the phone's chrome (DESIGN.md §2.5; the bar's cyan
// dot, §8 "The phone's Chat", PC-D5 A): each state colour `ChromePalette`
// names is tokens.css's own, read from both files and compared. IOS-12f adds
// the one other solid the phone copies, New spark's sky (`--vf-spark-night`).
{
  const TOKENS = "packages/design-kit/src/tokens.css";
  const PALETTE_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldDesign/ChromePalette.swift";
  const read = (file) => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  const tokens = read(TOKENS);
  const palette = read(PALETTE_SWIFT);
  for (const [name, token] of [
    ["attention", "orange"],
    ["green", "green"],
    ["red", "red"],
    ["info", "cyan"],
    ["sparkNight", "spark-night"],
  ]) {
    checked += 1;
    const hex = (pattern, text) => pattern.exec(text)?.[1]?.toLowerCase() ?? null;
    const origin = hex(new RegExp(`^\\s*--vf-${token}: #([0-9a-fA-F]{6});$`, "m"), tokens);
    const copy = hex(
      new RegExp(`^ {2}public static let ${name} = solid\\(0x([0-9A-Fa-f]{6})\\)$`, "m"),
      palette,
    );
    if (origin === null || copy === null || origin !== copy) {
      problems.push(
        `${PALETTE_SWIFT}'s ${name} is ${copy ?? "unreadable"} but ${TOKENS}'s --vf-${token} is ${origin ?? "unreadable"}\n` +
          "  fix: copy the token's value exactly (or move this script's pattern with the declaration)",
      );
    }
  }
}

// PG-4t — the phone's monitor skin (DESIGN.md §2.7; §8 "The monitor view owns
// its drawing"): the nine colours of puppeteer-view-sdk's MONITOR_SKIN, which
// `GodviewSkin.swift` carries one line each as `(.key, 0xLIGHT, 0xDARK)`. Each
// value is held to tokens.css's `--vf-godview-{light,dark}-<key>`, all 18, and
// a red names the key. (field-app's phone-parity row holds the key names to
// the SDK's own list; this script reads no package.)
{
  const SKIN_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldHome/Godview/GodviewSkin.swift";
  const TOKENS = "packages/design-kit/src/tokens.css";
  const read = (file) => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  const swift = read(SKIN_SWIFT);
  const tokens = read(TOKENS);
  const cases = new Map(
    [...swift.matchAll(/^ {4}case (\w+) = "([a-z-]+)"$/gm)].map(([, name, raw]) => [name, raw]),
  );
  const lines = [...swift.matchAll(/^ {4}\(\.(\w+), 0x([0-9A-Fa-f]{6}), 0x([0-9A-Fa-f]{6})\),$/gm)];
  const named = lines.map(([, name]) => name);
  if (cases.size === 0 || lines.length !== cases.size) {
    problems.push(
      `${SKIN_SWIFT} has ${cases.size} skin keys and ${lines.length} table lines\n` +
        "  fix: one `(.key, 0xLIGHT, 0xDARK),` line per Key case (or move this script's pattern with the declaration)",
    );
  }
  for (const name of cases.keys()) {
    if (named.filter((line) => line === name).length !== 1) {
      problems.push(`${SKIN_SWIFT}'s skin key ${name} needs exactly one table line`);
    }
  }
  for (const [, name, light, dark] of lines) {
    const raw = cases.get(name);
    for (const [look, copy] of [
      ["light", light],
      ["dark", dark],
    ]) {
      checked += 1;
      const pattern = new RegExp(`^\\s*--vf-godview-${look}-${raw}: #([0-9a-fA-F]{6});$`, "m");
      const origin = raw === undefined ? null : (pattern.exec(tokens)?.[1]?.toLowerCase() ?? null);
      if (origin !== copy.toLowerCase()) {
        problems.push(
          `${SKIN_SWIFT}'s ${look} ${name} is #${copy.toLowerCase()} but ${TOKENS}'s ` +
            `--vf-godview-${look}-${raw ?? name} is ${origin === null ? "unreadable" : `#${origin}`}\n` +
            "  fix: copy the token's value exactly (DESIGN.md §2.7 first, if the token moved)",
        );
      }
    }
  }
}

// The same argument one level up: the REGISTRY VALUES the phone speaks.
//
// `registries.ts` says ports, scopes, stores and the app id exist there and
// nowhere else, but the kit is outside `pnpm verify` and has no generator
// pointed at it, so every registry value it needs is a hand-written string
// that can drift. One did, silently: the phone started its truffle node in
// ghosttea's `ghosttea-terminal` namespace while every desktop floor joined
// `vibefield`, and since a node admits a peer only by the `truffle-{appId}-`
// hostname prefix, a signed-in phone read `0 peers in reach` beside a serving
// desktop. Nothing in the tree could have noticed. This is the thing that
// notices.
const REGISTRIES = "packages/contracts/src/registries.ts";
const ROUTED_CONTRACT = "apps/ios/VibeFieldKit/Sources/FieldRoutedTerminal/RoutedContract.swift";

/**
 * TM-4 — a TPv3 number the phone's routed T1 client BRANCHES on.
 *
 * The captured text is compared verbatim, which is why the Swift literals carry
 * the same `_` grouping the TypeScript does. Numbers the client does not branch
 * on are never copied: they arrive on the wire in `ConnectionAccepted`.
 *
 * `indent` is the Swift declaration's indentation — 2 for a top-level member of
 * `RoutedTerminalContract`, 4 for one nested in its `CloseCode`.
 */
function tpPin(key, swiftName, indent = 2) {
  return {
    name: key,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^ {2}${key}: ([0-9_]+),$`, "m"),
      label: `TERMINAL_PIPELINE.${key}`,
    },
    copy: {
      file: ROUTED_CONTRACT,
      pattern: new RegExp(`^ {${indent}}public static let ${swiftName} = ([0-9_]+)$`, "m"),
      label: `RoutedTerminalContract.${swiftName}`,
    },
  };
}

/**
 * UA-P-1a — the product serve's tailnet port.
 *
 * **ARMED since 2026-09-15 (UA-P-0e).** When this pin was written the registry
 * carried no product-serve row and could not: `productServeSpec` declared no
 * `listenPort`, so the floor fell the listener back to the TARGET port, which
 * since UA-5 is fieldd's EPHEMERAL control port — a per-boot random number no
 * phone can dial. UA-P-0e fixed that at the source: the tailnet listener is now
 * `PORTS.FIELDD_PRODUCT_SERVE` while the loopback control plane stays ephemeral
 * (`packages/fieldd/src/daemon.ts`, `productServeSpec`), because a peer DERIVES
 * the coordinate and a derivation needs the same number on every device.
 *
 * **ERRATUM (2026-09-15):** this pin was first written against a bare
 * `PRODUCT_SERVE`, which is the name the row did NOT get — the lane followed the
 * `FIELDD_*` prefix of the neighbouring rows. A pin whose pattern misses reads
 * exactly like a row that does not exist, which is why the miss printed a
 * reassuring NOTICE instead of a red.
 *
 * The self-arming shape STAYS, and not as a leftover: it joins `pins` whenever
 * the registry row is readable and prints a NOTICE when it is not, so if the
 * row is ever renamed or removed the run says so instead of going quiet. A gate
 * that stops gating without a red is the exact failure this script exists to
 * catch, and an unarmed pin nobody is told about is one.
 */
/**
 * SP-2 (g) — the phone's connection budget (`PHONE_BUDGET`; SP-D12 is OPEN).
 * The kit ENFORCES these — a dial beyond the budget waits for a slot — so a
 * number that moved on one side only is a phone holding more sockets, or
 * fewer, than the registry says it may. Pinned like every other value here:
 * verbatim, `_` grouping included.
 */
const PHONE_BUDGET_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldProduct/PhoneBudget.swift";
function phoneBudgetPin(key, swiftName) {
  return {
    name: key,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^ {2}${key}: ([0-9_]+),$`, "m"),
      label: `PHONE_BUDGET.${key}`,
    },
    copy: {
      file: PHONE_BUDGET_SWIFT,
      pattern: new RegExp(`^ {2}public static let ${swiftName} = ([0-9_]+)$`, "m"),
      label: `PhoneBudget.${swiftName}`,
    },
  };
}

/**
 * SP-2 (b) — the door's tick interval, which the phone's receive deadline is
 * measured in until the door's first `system.tick` names its own (2.5 × it).
 *
 * SELF-ARMING, like `productServePin` below, and for a stated reason: the row
 * is SP-1's (`PRODUCT_API_LIMITS.TICK_INTERVAL_MS`, built by a sibling lane in
 * DS wave 2), and the kit's literal landed first. Until the row is readable
 * this prints a NOTICE instead of a red; the day it is, the pin arms itself and
 * a disagreement is a red like every other.
 */
const doorTickPin = {
  name: "TICK_INTERVAL_MS",
  origin: {
    file: REGISTRIES,
    pattern: /^ {2}TICK_INTERVAL_MS: ([0-9_]+),$/m,
    label: "PRODUCT_API_LIMITS.TICK_INTERVAL_MS",
  },
  copy: {
    file: "apps/ios/VibeFieldKit/Sources/FieldProduct/ProductTransport.swift",
    pattern: /^ {2}public static let doorTickIntervalMs: Int64 = ([0-9_]+)$/m,
    label: "FieldProductContract.doorTickIntervalMs",
  },
};

const productServePin = {
  name: "FIELDD_PRODUCT_SERVE",
  origin: {
    file: REGISTRIES,
    pattern: /^ {2}FIELDD_PRODUCT_SERVE: ([0-9_]+),$/m,
    label: "PORTS.FIELDD_PRODUCT_SERVE",
  },
  copy: {
    file: "apps/ios/VibeFieldKit/Sources/FieldMesh/FieldMeshContract.swift",
    pattern: /^ {2}public static let productServePort = ([0-9_]+)$/m,
    label: "FieldMeshContract.productServePort",
  },
};

const pins = [
  {
    name: "appID",
    origin: {
      file: REGISTRIES,
      pattern: /^export const APP_ID = "([^"]*)"/m,
      label: "APP_ID",
    },
    copy: {
      file: "apps/ios/VibeFieldKit/Sources/FieldMesh/FieldMeshContract.swift",
      pattern: /^ {2}public static let appID = "([^"]*)"/m,
      label: "FieldMeshContract.appID",
    },
  },
  // TS-7b — the phone code's prefix: the Mac writes it, the phone reads it and registers the scheme.
  ...["SCHEME", "HOST"].map((part) => ({
    name: `phoneCode${part}`,
    origin: {
      file: "packages/contracts/src/phone-code.ts",
      pattern: new RegExp(`^export const PHONE_CODE_${part} = "([^"]*)"`, "m"),
      label: `PHONE_CODE_${part}`,
    },
    copy: {
      file: "apps/ios/VibeFieldKit/Sources/FieldMesh/PhoneCode.swift",
      pattern: new RegExp(`^ {2}public static let ${part.toLowerCase()} = "([^"]*)"`, "m"),
      label: `PhoneCode.${part.toLowerCase()}`,
    },
  })),
  {
    name: "phoneCodeAppScheme",
    origin: {
      file: "packages/contracts/src/phone-code.ts",
      pattern: /^export const PHONE_CODE_SCHEME = "([^"]*)"/m,
      label: "PHONE_CODE_SCHEME",
    },
    copy: {
      file: "apps/ios/App/Info.plist",
      pattern: /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>([^<]*)<\/string>/,
      label: "the app's CFBundleURLSchemes",
    },
  },
  // The handshake the phone offers and the liveness it keeps.
  tpPin("PROTOCOL_MAJOR", "protocolMajor"),
  tpPin("PROTOCOL_MINOR", "protocolMinor"),
  tpPin("HEARTBEAT_INTERVAL_MS", "heartbeatIntervalMs"),
  tpPin("HEARTBEAT_TTL_MS", "heartbeatTtlMs"),
  // The two limits the client applies to a grant BEFORE it spends a socket on
  // one — the cell applies the same pair, and a silent 1008 is what disagreeing
  // about them looks like from the phone.
  tpPin("MAX_CLOCK_SKEW_MS", "maxClockSkewMs"),
  tpPin("MAX_GRANT_LIFETIME_MS", "maxGrantLifetimeMs"),
  // Input closes this far before an attach grant expires without a renewal.
  tpPin("ATTACH_RENEWAL_MARGIN_MS", "attachRenewalMarginMs"),
  // Every close code the client branches on. `1008` is the silent
  // pre-authentication class and the rest are always named by the cell.
  tpPin("POLICY_PRE_AUTH", "policyPreAuth", 4),
  tpPin("SERVER_ERROR", "serverError", 4),
  tpPin("STALE_ROUTE", "staleRoute", 4),
  tpPin("FENCED", "fenced", 4),
  tpPin("SUPERSEDED", "superseded", 4),
  tpPin("PROTOCOL", "protocolError", 4),
  tpPin("LEG_TIMEOUT", "legTimeout", 4),
  // The phone's connection budget, which the kit enforces (SP-2).
  phoneBudgetPin("DOORS_PER_DESKTOP", "doorsPerDesktop"),
  phoneBudgetPin("TERMINAL_LEGS", "terminalLegs"),
  phoneBudgetPin("WEB_VIEWS", "webViews"),
];

/**
 * C5/C8 (the fixer's review of 2026-10-21, finding 8) — a lease or exit WORD the
 * phone's routed client branches on. It is named once in a nested enum of
 * `RoutedTerminalContract`, and read here from the contracts list that owns it.
 *
 * The origin pattern finds the word inside that list's brackets and nowhere
 * else, so a word the list drops reads as unreadable — red — never as
 * agreement. The copy's pattern stays inside its own nested enum, because
 * `exited` is a word of two of them.
 */
const TERMINAL_PIPELINE = "packages/contracts/src/terminal-pipeline.ts";
const TERMINAL = "packages/contracts/src/terminal.ts";
function routedWordPin(file, list, word, swiftEnum, swiftName) {
  return {
    name: `${list}.${word}`,
    origin: {
      file,
      pattern: new RegExp(`export const ${list} = (?:z\\.enum\\()?\\[[^\\]]*?"(${word})"`),
      label: `${list} "${word}"`,
    },
    copy: {
      file: ROUTED_CONTRACT,
      pattern: new RegExp(
        `public enum ${swiftEnum} \\{(?:(?!\\n {2}\\})[\\s\\S])*?\\n {4}public static let ${swiftName} = "([^"]*)"\\n`,
      ),
      label: `RoutedTerminalContract.${swiftEnum}.${swiftName}`,
    },
  };
}
pins.push(
  // The lease says the run EXITED in both of its dimensions (C8).
  routedWordPin(
    TERMINAL_PIPELINE,
    "PRESENTATION_STOPPED_REASONS",
    "exited",
    "LeaseReason",
    "exited",
  ),
  routedWordPin(TERMINAL_PIPELINE, "ACTIVATION_REVOKED_REASONS", "exited", "LeaseReason", "exited"),
  // The card's note for a refused input: one sentence per word (C5).
  ...[
    ["lagging", "lagging"],
    ["overload", "overload"],
    ["right-expired", "rightExpired"],
    ["pending", "pending"],
    ["not-granted", "notGranted"],
    ["right-revoked", "rightRevoked"],
    ["exited", "exited"],
    ["stale-lease-epoch", "staleLeaseEpoch"],
    ["no-view", "noView"],
  ].map(([word, swift]) =>
    routedWordPin(TERMINAL_PIPELINE, "INPUT_REFUSED_REASONS", word, "InputRefusedReason", swift),
  ),
  // Who ended a run the cell named as requested (C8).
  ...[
    ["user-terminated", "userTerminated"],
    ["application-terminated", "applicationTerminated"],
    ["service-terminated", "serviceTerminated"],
  ].map(([word, swift]) =>
    routedWordPin(TERMINAL, "TerminalExitOutcome", word, "ExitOutcome", swift),
  ),
);

/**
 * F1 — a freeway value the phone's link BRANCHES on, read from ITS OWN block of registries.ts.
 * The block matters: `FREEWAY_CODES.PROTOCOL` is 4400 and `TERMINAL_PIPELINE_CLOSE_CODES.PROTOCOL`
 * is 4003, and a whole-file pattern would read the first. The match may not leave the block.
 * Captured text is compared verbatim (`_` grouping, `30 * 60_000`, `0x00`).
 */
const FREEWAY_CONTRACT = "apps/ios/VibeFieldKit/Sources/FieldFreeway/FreewayContract.swift";
const NUMBER = "[0-9_]+(?: \\* [0-9_]+)*";
const HEX = "0x[0-9A-Fa-f]+";
function freewayPin(block, key, swiftName, { indent = 2, value = NUMBER, type = "" } = {}) {
  return {
    name: `${block}.${key}`,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(
        `export const ${block} = \\{(?:(?!\\n\\} as const;)[\\s\\S])*?\\n {2}${key}: (${value}),\\n`,
      ),
      label: `${block}.${key}`,
    },
    copy: {
      file: FREEWAY_CONTRACT,
      pattern: new RegExp(`^ {${indent}}public static let ${swiftName}${type} = (${value})$`, "m"),
      label: `FreewayContract.${swiftName}`,
    },
  };
}
pins.push(
  freewayPin("PORTS", "FREEWAY_SERVE", "servePort"),
  freewayPin("FREEWAY", "PROTOCOL_MAJOR", "protocolMajor"),
  freewayPin("FREEWAY", "MISSED_PINGS", "missedPings"),
  freewayPin("FREEWAY", "ACK_EVERY_BYTES", "ackEveryBytes"),
  freewayPin("FREEWAY", "APPROVAL_TTL_MS", "approvalTtlMs"),
  freewayPin("FREEWAY", "APPROVAL_RENEW_MS", "approvalRenewMs"),
  freewayPin("FREEWAY", "MAX_TICKETS_PER_ASK", "maxTicketsPerAsk"),
  ...[
    ["LINK", "link"],
    ["OPEN", "open"],
    ["OPENED", "opened"],
    ["TEXT", "text"],
    ["BINARY", "binary"],
    ["CLOSE", "close"],
    ["WINDOW", "window"],
    ["OPEN_REFUSED", "openRefused"],
  ].map(([key, swift]) =>
    freewayPin("FREEWAY_FRAME", key, swift, { indent: 4, value: HEX, type: ": UInt8" }),
  ),
  {
    name: "FREEWAY_FRAGMENT_BIT",
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(`^export const FREEWAY_FRAGMENT_BIT = (${HEX});$`, "m"),
      label: "FREEWAY_FRAGMENT_BIT",
    },
    copy: {
      file: FREEWAY_CONTRACT,
      pattern: new RegExp(`^ {2}public static let fragmentBit: UInt8 = (${HEX})$`, "m"),
      label: "FreewayContract.fragmentBit",
    },
  },
  ...[
    ["PROTOCOL", "protocolError"],
    ["APPROVAL", "approval"],
    ["NOT_ADMITTED", "notAdmitted"],
    ["KIND_NOT_SERVED", "kindNotServed"],
    ["SUPERSEDED", "superseded"],
    ["PEER_GONE", "peerGone"],
    ["TWIN", "twin"],
    ["PROTOCOL_VERSION", "protocolVersion"],
    ["RESTARTING", "restarting"],
    ["DOOR_DOWN", "doorDown"],
  ].map(([key, swift]) => freewayPin("FREEWAY_CODES", key, swift, { indent: 4 })),
  // F1b — `freeway.approve`'s refusals the phone says in words (`FreewayApproval.said`): the
  // service and the three states, each read from FREEWAY_APPROVAL's own block.
  ...[
    ["SERVICE", "service"],
    ["STATE_UNREAD", "stateUnread"],
    ["STATE_DOWN", "stateDown"],
    ["STATE_UNCORRELATED", "stateUncorrelated"],
  ].map(([key, swift]) =>
    freewayPin("FREEWAY_APPROVAL", key, swift, { indent: 4, value: '"[a-z-]+"' }),
  ),
);

// SP-7a — the transcript reader's numbers (`SparkTranscriptLimits`, SparkTranscriptWire.swift), each read from
// SPARK_TRANSCRIPT's own block of registries.ts (never SPARK_TRANSCRIPT_SERVICE's), and the line format from
// spark-transcript.ts. The phone's backoff, its open timeout and the format it reads a body of are the window's.
const SPARK_TRANSCRIPT_SWIFT =
  "apps/ios/VibeFieldKit/Sources/FieldProduct/SparkTranscriptWire.swift";
function sparkTranscriptPin(key, swiftName, type = ": Int64") {
  return {
    name: `SPARK_TRANSCRIPT.${key}`,
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(
        `export const SPARK_TRANSCRIPT = \\{(?:(?!\\n\\} as const;)[\\s\\S])*?\\n {2}${key}: (${NUMBER}),\\n`,
      ),
      label: `SPARK_TRANSCRIPT.${key}`,
    },
    copy: {
      file: SPARK_TRANSCRIPT_SWIFT,
      pattern: new RegExp(`^ {2}public static let ${swiftName}${type} = (${NUMBER})$`, "m"),
      label: `SparkTranscriptLimits.${swiftName}`,
    },
  };
}
pins.push(
  sparkTranscriptPin("TICKET_TTL_MS", "ticketTTLMs"),
  sparkTranscriptPin("RUNS_MAX", "runsMax", ""),
  sparkTranscriptPin("OPEN_TIMEOUT_MS", "openTimeoutMs"),
  sparkTranscriptPin("RETRY_MIN_MS", "retryMinMs"),
  sparkTranscriptPin("RETRY_MAX_MS", "retryMaxMs"),
  {
    name: "SPARK_TRANSCRIPT_FORMAT",
    origin: {
      file: "packages/contracts/src/spark-transcript.ts",
      pattern: new RegExp(`^export const SPARK_TRANSCRIPT_FORMAT = (${NUMBER});$`, "m"),
      label: "SPARK_TRANSCRIPT_FORMAT",
    },
    copy: {
      file: SPARK_TRANSCRIPT_SWIFT,
      pattern: new RegExp(`^ {2}public static let format: Int64 = (${NUMBER})$`, "m"),
      label: "SparkTranscriptLimits.format",
    },
  },
  // M-b2 — the port a phone's ticket names: the worker's routed serve (SP-7a D1, D5)
  {
    name: "PORTS.SPARK_TRANSCRIPT_SERVE",
    origin: {
      file: REGISTRIES,
      pattern: new RegExp(
        `export const PORTS = \\{(?:(?!\\n\\} as const;)[\\s\\S])*?\\n {2}SPARK_TRANSCRIPT_SERVE: (${NUMBER}),\\n`,
      ),
      label: "PORTS.SPARK_TRANSCRIPT_SERVE",
    },
    copy: {
      file: SPARK_TRANSCRIPT_SWIFT,
      pattern: new RegExp(`^ {2}public static let servePort = (${NUMBER})$`, "m"),
      label: "SparkTranscriptLimits.servePort",
    },
  },
);

// IOS-12b — a spark's words (DESIGN.md §2.10): Chat's list on the phone says design-kit's own. The ids are read
// from `statuses.ts`, so a status added there with no word on the phone is a pin nobody can read: red.
const SPARK_STATUSES_TS = "packages/design-kit/src/spark-face/statuses.ts";
const SPARK_ENTRIES_SWIFT = "apps/ios/VibeFieldKit/Sources/FieldProduct/SparkEntries.swift";
{
  let ids = [];
  try {
    const table = readFileSync(join(root, SPARK_STATUSES_TS), "utf8");
    ids = [...table.matchAll(/\{ id: "([a-z]+)", word: "[^"]+" \}/g)].map((match) => match[1]);
  } catch {
    ids = [];
  }
  if (ids.length === 0) problems.push(`no spark statuses read from ${SPARK_STATUSES_TS}`);
  pins.push(
    ...ids.map((id) => ({
      name: `SPARK_STATUSES.${id}`,
      origin: {
        file: SPARK_STATUSES_TS,
        pattern: new RegExp(`\\{ id: "${id}", word: "([^"]+)" \\}`),
        label: `SPARK_STATUSES ${id}`,
      },
      copy: {
        file: SPARK_ENTRIES_SWIFT,
        pattern: new RegExp(`^ {4}case \\.${id}: "([^"]+)"$`, "m"),
        label: `SparkStatus.${id}.word`,
      },
    })),
  );
}

const pinProblems = [];
const notices = [];

/** The one captured group, or `null` when the pin lost its witness. */
function pinned({ file, pattern }) {
  try {
    return pattern.exec(readFileSync(join(root, file), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

// The self-arming pin, armed or announced. See `productServePin` above.
if (pinned(productServePin.origin) !== null) {
  pins.push(productServePin);
} else {
  notices.push(
    `${productServePin.origin.label} is unreadable, so ` +
      `${productServePin.copy.label} is UNPINNED (UA-P-1a)\n` +
      "  the row landed at UA-P-0e, so this means it was renamed or removed — the phone\n" +
      "  is dialing a number nothing agrees with. Fix the row, or move this pattern to it.",
  );
}

// The tick's pin, armed or announced. See `doorTickPin` above.
if (pinned(doorTickPin.origin) !== null) {
  pins.push(doorTickPin);
} else {
  notices.push(
    `${doorTickPin.origin.label} is unreadable, so ${doorTickPin.copy.label} is UNPINNED ` +
      "(SP-2)\n" +
      "  the row is SP-1's and lands with that lane; until then the phone's default tick\n" +
      "  interval is a literal nothing agrees with. When it lands, this pin arms itself.",
  );
}

for (const pin of pins) {
  const origin = pinned(pin.origin);
  const copy = pinned(pin.copy);
  // A pattern that stopped matching fails too. A pin nobody can read is not a
  // pin that agrees — it is a gate that quietly stopped being one.
  if (origin === null) {
    pinProblems.push(
      `${pin.origin.label} is unreadable in ${pin.origin.file}\n` +
        `  fix: restore the declaration, or move this script's pattern with it`,
    );
  } else if (copy === null) {
    pinProblems.push(
      `${pin.copy.label} is unreadable in ${pin.copy.file}\n` +
        `  fix: restore the declaration, or move this script's pattern with it`,
    );
  } else if (origin !== copy) {
    pinProblems.push(
      `${pin.copy.label} is "${copy}" but ${pin.origin.label} is "${origin}"\n` +
        `  fix: set ${pin.copy.label} to "${origin}" in ${pin.copy.file} — or move BOTH,` +
        ` deliberately, because it is the namespace every plane must share`,
    );
  }
}

if (problems.length > 0 || pinProblems.length > 0) {
  if (problems.length > 0) {
    console.error(`ios fixtures: ${problems.length} of ${checked} copies are stale\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
  }
  if (pinProblems.length > 0) {
    console.error(`ios pins: ${pinProblems.length} of ${pins.length} contract values drifted\n`);
    for (const problem of pinProblems) console.error(`  ${problem}\n`);
  }
  process.exit(1);
}

const values = pins.length === 1 ? "contract value" : "contract values";
console.log(`ios fixtures: ${checked} copies identical to packages/contracts/fixtures`);
console.log(
  `ios pins: ${pins.length} ${values} identical to packages/contracts/src (registries.ts, the terminal word lists and the phone code)`,
);
for (const notice of notices) console.log(`ios pins: NOTICE — ${notice}`);
