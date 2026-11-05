import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FLOW_LIMITS,
  FLOW_RECORD_FORMAT,
  FlowApprovalRecord,
  RECORD_STORES,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { FlowLibrary } from "../src/flows/library";
import { FlowRecords, flowHashOf } from "../src/flows/records";
import type { RpcCallError } from "../src/native-link";
import { RecordSigner, UNREADABLE_WORDS } from "../src/signed-record";

// CP-4a1 (step0-cp4.md §5.1 commit 4; CP4-Q18 (a), CP4-Q5 (a)) — the person's library and fieldd's flow records. A
// version's bytes are kept by their SHA-256 and read back only while that is still their hash; a flow's approval and a
// spark's proposal are records signed by fieldd's one signer under LAYOUT.FLOWS_KEY_FILE, their own names inside, so an
// edit, a copy to another name or a record no signer made is set aside for a human and never served (EL7, against an
// edit). The library reads each `<slug>.flow.js` against its approval: approved, changed, new, or too big to read.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Seen = { event: string; attrs: LogFields | undefined };

function capture(events: Seen[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _m, attrs) => void events.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void events.push({ event, attrs }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

const VELA = "sp-vela00000000";
const AT = new Date("2026-11-05T04:00:00.000Z");
const RELEASE = Buffer.from(
  'export const meta = { name: "Release check" };\nexport default async function () {\n  await agent("Review the change.", { agent: "codex", label: "review" });\n}\n',
);
const EDITED = Buffer.from(
  `${RELEASE.toString("utf8")}// an agent's edit: skip the review\n`,
  "utf8",
);

function harness() {
  const root = mkdtempSync(join(tmpdir(), "vf-flows-"));
  dirs.push(root);
  const dir = join(root, "fieldd", "flows");
  const keyPath = join(root, "fieldd", "flows.key");
  const library = join(root, "flows");
  const events: Seen[] = [];
  const records = () => new FlowRecords({ dir, keyPath, logger: capture(events), now: () => AT });
  const lib = (over = records()) =>
    new FlowLibrary({ dir: library, records: over, logger: capture(events) });
  const approvalFile = (flow: string) => join(dir, "approvals", `${flow}.json`);
  const proposalFile = (id: string) => join(dir, "proposals", `${id}.json`);
  const bytesFile = (hash: string) => join(dir, "bytes", `${hash}.flow.js`);
  /** a library file, as the person (or anything running as them) wrote it */
  const put = (name: string, bytes: Uint8Array | string) => {
    mkdirSync(library, { recursive: true });
    writeFileSync(join(library, name), bytes);
  };
  /** an approval as a writer that holds the key would sign it */
  const signApproval = (body: Record<string, unknown>) => {
    const signature = new RecordSigner({ keyPath }).sign(body);
    mkdirSync(join(dir, "approvals"), { recursive: true, mode: 0o700 });
    writeFileSync(approvalFile(String(body.flow)), JSON.stringify({ ...body, signature }), {
      mode: 0o600,
    });
  };
  const setAside = (event: string) =>
    events.filter((e) => e.event === event).map((e) => [String(e.attrs?.file), e.attrs?.why]);
  return {
    root,
    dir,
    keyPath,
    library,
    events,
    records,
    lib,
    approvalFile,
    proposalFile,
    bytesFile,
    put,
    signApproval,
    setAside,
  };
}

describe("fieldd's flow records (CP4-Q18 (a))", () => {
  it("R1 · keeps a version's bytes by their SHA-256, 0600 in 0700, once, and reads them back after a restart", () => {
    const h = harness();
    const hash = h.records().keep(RELEASE);
    expect(hash).toBe(createHash("sha256").update(RELEASE).digest("hex"));
    expect(hash).toBe(flowHashOf(RELEASE));
    // each kept file is asserted before it is read, so a regression fails here, never by a thrown errno
    expect(existsSync(h.bytesFile(hash)), "the bytes are kept by their hash").toBe(true);
    expect(readFileSync(h.bytesFile(hash))).toEqual(RELEASE);
    expect(statSync(h.bytesFile(hash)).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.dir, "bytes")).mode & 0o777).toBe(0o700);
    expect(statSync(h.dir).mode & 0o777).toBe(0o700);
    // the same bytes again are the same version: one file
    expect(h.records().keep(Buffer.from(RELEASE))).toBe(hash);
    expect(readdirSync(join(h.dir, "bytes"))).toEqual([`${hash}.flow.js`]);
    // a second instance over the same folder (a restart) reads them
    expect(h.records().bytes(hash)).toEqual(RELEASE);
    expect(h.records().bytes(flowHashOf(EDITED))).toBeUndefined();
    expect(h.records().bytes("not-a-hash")).toBeUndefined();
  });

  it("R2 · bytes whose hash is not their name are set aside, never served; so are bytes past SCRIPT_MAX_BYTES", () => {
    const h = harness();
    const records = h.records();
    const hash = records.keep(RELEASE);
    expect(existsSync(h.bytesFile(hash)), "the bytes are kept by their hash").toBe(true);
    // an agent rewrites the approved version's bytes in place
    writeFileSync(h.bytesFile(hash), EDITED, { mode: 0o600 });
    expect(h.records().bytes(hash)).toBeUndefined();
    expect(existsSync(h.bytesFile(hash))).toBe(false);
    expect(
      readdirSync(join(h.dir, "bytes")).some((f) => f.startsWith(`${hash}.flow.js.forged-`)),
    ).toBe(true);
    // a file at a hash's name, too big to be a script fieldd kept
    const big = Buffer.alloc(FLOW_LIMITS.SCRIPT_MAX_BYTES + 1, 0x20);
    const bigHash = flowHashOf(big);
    writeFileSync(h.bytesFile(bigHash), big, { mode: 0o600 });
    expect(h.records().bytes(bigHash)).toBeUndefined();
    expect(h.setAside("fieldd.flows.set_aside")).toEqual([
      [`${hash}.flow.js`, "forged"],
      [`${bigHash}.flow.js`, "unreadable"],
    ]);
  });

  it("R3 · an approval is one signed record per flow, its name inside, read back after a restart; a new one replaces it and both versions stay kept", () => {
    const h = harness();
    const approved = h.records().approve("release-check", RELEASE, { proposal: "fp-9d4e2a7c1b" });
    expect(approved).toEqual({
      format: FLOW_RECORD_FORMAT,
      flow: "release-check",
      hash: flowHashOf(RELEASE),
      approvedAt: AT.toISOString(),
      by: "you",
      proposal: "fp-9d4e2a7c1b",
    });
    expect(existsSync(h.approvalFile("release-check")), "the approval is kept by its flow").toBe(
      true,
    );
    expect(existsSync(h.keyPath), "the records' key is kept").toBe(true);
    const onDisk = JSON.parse(readFileSync(h.approvalFile("release-check"), "utf8"));
    expect(onDisk.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(FlowApprovalRecord.parse(onDisk)).toMatchObject({ flow: "release-check" });
    expect(statSync(h.approvalFile("release-check")).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.dir, "approvals")).mode & 0o777).toBe(0o700);
    expect(statSync(h.keyPath).mode & 0o777).toBe(0o600);
    expect(h.records().approval("release-check")).toEqual(approved);
    expect(h.records().bytes(approved.hash)).toEqual(RELEASE);
    // the person approves the edited version: it stands, and the first version's bytes are still kept
    const next = h.records().approve("release-check", EDITED);
    expect(next).not.toHaveProperty("proposal");
    expect(h.records().approval("release-check")?.hash).toBe(flowHashOf(EDITED));
    expect(h.records().bytes(flowHashOf(RELEASE))).toEqual(RELEASE);
    expect(
      h
        .records()
        .approvals()
        .map((a) => a.flow),
    ).toEqual(["release-check"]);
    expect(h.records().approval("nightly-sweep")).toBeUndefined();
  });

  it("R4 · sets aside, and never serves, an approval that is unsigned, forged, exposed, unreadable or copied to another flow's name; keeps a newer VibeField's; the rest still list", () => {
    const h = harness();
    const records = h.records();
    for (const flow of ["good", "forged", "exposed", "copied-from"]) records.approve(flow, RELEASE);
    for (const flow of ["good", "forged", "exposed", "copied-from"]) {
      expect(existsSync(h.approvalFile(flow)), `${flow}'s approval is kept by its flow`).toBe(true);
    }
    // unsigned: a record no signer made
    mkdirSync(join(h.dir, "approvals"), { recursive: true });
    writeFileSync(
      h.approvalFile("unsigned"),
      JSON.stringify({
        format: 1,
        flow: "unsigned",
        hash: flowHashOf(EDITED),
        approvedAt: AT.toISOString(),
        by: "you",
      }),
      { mode: 0o600 },
    );
    // forged: an agent points the approval at its own bytes
    const edited = JSON.parse(readFileSync(h.approvalFile("forged"), "utf8"));
    edited.hash = flowHashOf(EDITED);
    writeFileSync(h.approvalFile("forged"), JSON.stringify(edited), { mode: 0o600 });
    chmodSync(h.approvalFile("exposed"), 0o644);
    writeFileSync(h.approvalFile("junk"), "{not json", { mode: 0o600 });
    // a good, signed approval copied to another flow's name
    copyFileSync(h.approvalFile("copied-from"), h.approvalFile("copied-to"));
    // a newer VibeField's approval, signed (item 172): kept where it is for it, never served and never set aside
    h.signApproval({
      format: 2,
      flow: "later",
      hash: flowHashOf(RELEASE),
      approvedAt: AT.toISOString(),
      by: "you",
    });
    // a file that is no approval's name is passed over
    writeFileSync(join(h.dir, "approvals", "README.txt"), "a human's note");

    expect(
      h
        .records()
        .approvals()
        .map((a) => a.flow),
    ).toEqual(["copied-from", "good"]);
    expect(Object.fromEntries(h.setAside("fieldd.flows.set_aside"))).toEqual({
      "unsigned.json": "unsigned",
      "forged.json": "forged",
      "exposed.json": "exposed",
      "junk.json": "unreadable",
      "copied-to.json": "forged",
    });
    for (const flow of ["unsigned", "forged", "exposed", "junk", "copied-to"]) {
      expect(existsSync(h.approvalFile(flow)), flow).toBe(false);
      expect(h.records().approval(flow), flow).toBeUndefined();
    }
    expect(existsSync(h.approvalFile("later")), "a newer VibeField's approval is kept").toBe(true);
    expect(h.records().approval("later")).toBeUndefined();
    // and a write over it is refused in fieldd's words, never answered by writing over it
    expect(() => h.records().approve("later", RELEASE)).toThrow(UNREADABLE_WORDS.flows);
    expect(readFileSync(join(h.dir, "approvals", "README.txt"), "utf8")).toBe("a human's note");
  });

  it("R5 · a spark's proposal keeps its bytes and one signed record by its id, oldest first; a copy or an edit is set aside; an answered one is dropped", () => {
    const h = harness();
    let tick = 0;
    const records = new FlowRecords({
      dir: h.dir,
      keyPath: h.keyPath,
      logger: capture(h.events),
      now: () => new Date(AT.getTime() + 1000 * tick++),
    });
    const first = records.propose({
      flow: "review-until-clean",
      bytes: RELEASE,
      spark: VELA,
      name: "Review until clean",
      item: "ny-2a9c4e6b8d0f1357",
    });
    const second = records.propose({ flow: "release-check", bytes: EDITED, spark: VELA });
    expect(first).toMatchObject({
      format: FLOW_RECORD_FORMAT,
      flow: "review-until-clean",
      name: "Review until clean",
      hash: flowHashOf(RELEASE),
      spark: VELA,
      item: "ny-2a9c4e6b8d0f1357",
    });
    expect(first.id).toMatch(/^fp-[0-9a-f]{16}$/);
    expect(first.id).not.toBe(second.id);
    expect(existsSync(h.proposalFile(first.id)), "the first proposal is kept by its id").toBe(true);
    expect(existsSync(h.proposalFile(second.id)), "the second proposal is kept by its id").toBe(
      true,
    );
    expect(statSync(h.proposalFile(first.id)).mode & 0o777).toBe(0o600);
    expect(h.records().bytes(first.hash)).toEqual(RELEASE);
    expect(h.records().proposal(first.id)).toEqual(first);
    expect(
      h
        .records()
        .proposals()
        .map((p) => p.id),
    ).toEqual([first.id, second.id]);

    // an edit (the spark names another spark) and a copy to another id's name are set aside
    const edited = JSON.parse(readFileSync(h.proposalFile(second.id), "utf8"));
    edited.spark = "sp-kiwi00000000";
    writeFileSync(h.proposalFile(second.id), JSON.stringify(edited), { mode: 0o600 });
    copyFileSync(h.proposalFile(first.id), h.proposalFile("fp-0000000000000000"));
    expect(
      h
        .records()
        .proposals()
        .map((p) => p.id),
    ).toEqual([first.id]);
    expect(Object.fromEntries(h.setAside("fieldd.flows.set_aside"))).toEqual({
      [`${second.id}.json`]: "forged",
      "fp-0000000000000000.json": "forged",
    });

    h.records().dropProposal(first.id);
    expect(existsSync(h.proposalFile(first.id))).toBe(false);
    expect(h.records().proposal(first.id)).toBeUndefined();
    // its bytes stay kept: an approval of it may still name them
    expect(h.records().bytes(first.hash)).toEqual(RELEASE);
  });

  it("R6 · refuses before it keeps anything: bytes past SCRIPT_MAX_BYTES, and a flow whose name is not a slug", () => {
    const h = harness();
    const big = Buffer.alloc(FLOW_LIMITS.SCRIPT_MAX_BYTES + 1, 0x20);
    expect(() => h.records().keep(big)).toThrow(/64 KiB/);
    expect(() => h.records().approve("release-check", big)).toThrow(/64 KiB/);
    expect(() => h.records().approve("Release check", RELEASE)).toThrow();
    expect(() => h.records().approve("../escape", RELEASE)).toThrow();
    expect(() => h.records().propose({ flow: "ok", bytes: big, spark: VELA })).toThrow(/64 KiB/);
    expect(existsSync(join(h.dir, "approvals"))).toBe(false);
    expect(existsSync(join(h.dir, "proposals"))).toBe(false);
    expect(existsSync(join(h.dir, "bytes")) ? readdirSync(join(h.dir, "bytes")) : []).toEqual([]);
    // exactly the bound is a script
    const edge = Buffer.alloc(FLOW_LIMITS.SCRIPT_MAX_BYTES, 0x20);
    expect(h.records().bytes(h.records().keep(edge))).toEqual(edge);
  });

  it("R7 · a write over a record the disk did not answer is refused in fieldd's words, and nothing is moved, set aside or written (item 172)", () => {
    const h = harness();
    h.records().approve("release-check", RELEASE);
    const proposal = h
      .records()
      .propose({ flow: "review-until-clean", bytes: RELEASE, spark: VELA });
    const approval = readFileSync(h.approvalFile("release-check"), "utf8");
    const proposed = readFileSync(h.proposalFile(proposal.id), "utf8");
    // the disk answers no record file (EMFILE, every try); the key and the bytes read as ever
    const records = new FlowRecords({
      dir: h.dir,
      keyPath: h.keyPath,
      readFile: (path) => {
        if (path.startsWith(join(h.dir, "approvals")) || path.startsWith(join(h.dir, "proposals")))
          throw Object.assign(new Error(`EMFILE: too many open files, open '${path}'`), {
            code: "EMFILE",
          });
        return readFileSync(path, "utf8");
      },
    });
    const refused = {
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: RECORD_STORES.SERVICE_FLOWS, state: RECORD_STORES.STATE_UNREADABLE },
      message: UNREADABLE_WORDS.flows,
    };
    expect(outcome(() => records.approve("release-check", EDITED))).toEqual(refused);
    expect(outcome(() => records.dropProposal(proposal.id))).toEqual(refused);
    expect(outcome(() => records.approval("release-check"))).toEqual(refused);
    expect(outcome(() => records.proposals())).toEqual(refused);
    expect(readFileSync(h.approvalFile("release-check"), "utf8")).toBe(approval);
    expect(readFileSync(h.proposalFile(proposal.id), "utf8")).toBe(proposed);
    expect(h.records().bytes(flowHashOf(EDITED)), "the refused version's bytes").toBeUndefined();
    expect(h.setAside("fieldd.flows.set_aside")).toEqual([]);
  });
});

/** What an act answers: "ok", or what it threw, read as an RpcCallError (never thrown on). */
function outcome(
  fn: () => unknown,
): { kind?: string; retryable?: boolean; details?: unknown; message: string } | "ok" {
  try {
    fn();
    return "ok";
  } catch (err) {
    const e = err as RpcCallError;
    return { kind: e.kind, retryable: e.retryable, details: e.details, message: e.message };
  }
}

describe("the person's library (CP4-Q5 (a))", () => {
  it("L1 · lists each <slug>.flow.js against its approval: approved, changed, new, too big; by slug", () => {
    const h = harness();
    const records = h.records();
    h.put("release-check.flow.js", RELEASE);
    records.approve("release-check", RELEASE);
    h.put("nightly-sweep.flow.js", EDITED);
    records.approve("nightly-sweep", RELEASE);
    h.put("scratch.flow.js", 'export const meta = { name: "Scratch" };\n');
    h.put("giant.flow.js", Buffer.alloc(FLOW_LIMITS.SCRIPT_MAX_BYTES + 1, 0x20));
    records.approve("giant", RELEASE);
    expect(h.lib().list()).toEqual([
      { flow: "giant", approved: flowHashOf(RELEASE), state: "too-big", bytes: 65_537 },
      {
        flow: "nightly-sweep",
        hash: flowHashOf(EDITED),
        approved: flowHashOf(RELEASE),
        state: "changed",
        bytes: EDITED.length,
      },
      {
        flow: "release-check",
        hash: flowHashOf(RELEASE),
        approved: flowHashOf(RELEASE),
        state: "approved",
        bytes: RELEASE.length,
      },
      {
        flow: "scratch",
        hash: flowHashOf(Buffer.from('export const meta = { name: "Scratch" };\n')),
        state: "new",
        bytes: 41,
      },
    ]);
  });

  it("L2 · passes over what is not a flow: another suffix, a folder, a name that is no slug (logged once), a link that leads nowhere; an absent library is empty", () => {
    const h = harness();
    expect(h.lib().list()).toEqual([]);
    h.put("notes.md", "not a flow");
    h.put("release-check.flow.js.bak", RELEASE);
    h.put("Release Check.flow.js", RELEASE);
    mkdirSync(join(h.library, "folder.flow.js"));
    symlinkSync(join(h.root, "nowhere.flow.js"), join(h.library, "dangling.flow.js"));
    h.put("ok.flow.js", RELEASE);
    const lib = h.lib();
    expect(lib.list().map((e) => e.flow)).toEqual(["ok"]);
    expect(lib.list().map((e) => e.flow)).toEqual(["ok"]);
    expect(
      h.events
        .filter((e) => e.event === "fieldd.flows.passed_over")
        .map((e) => [e.attrs?.file, e.attrs?.why]),
    ).toEqual([["Release Check.flow.js", "name"]]);
  });

  it("L3 · reads one flow's bytes and hash, or says it is too big to read; nothing for a name that is no flow", () => {
    const h = harness();
    h.put("release-check.flow.js", RELEASE);
    h.put("giant.flow.js", Buffer.alloc(FLOW_LIMITS.SCRIPT_MAX_BYTES + 1, 0x20));
    const lib = h.lib();
    expect(lib.read("release-check")).toEqual({
      flow: "release-check",
      size: RELEASE.length,
      bytes: RELEASE,
      hash: flowHashOf(RELEASE),
    });
    expect(lib.read("giant")).toEqual({ flow: "giant", size: 65_537, tooBig: true });
    expect(lib.read("absent")).toBeUndefined();
    expect(lib.read("../fieldd/flows.key")).toBeUndefined();
    expect(lib.read("Release Check")).toBeUndefined();
  });

  it("L4 · an approval an agent wrote never makes its file read approved: the forged record is set aside and the file reads new", () => {
    const h = harness();
    h.put("release-check.flow.js", EDITED);
    // an agent that cannot sign writes an approval naming its own edit
    mkdirSync(join(h.dir, "approvals"), { recursive: true });
    writeFileSync(
      h.approvalFile("release-check"),
      JSON.stringify({
        format: 1,
        flow: "release-check",
        hash: flowHashOf(EDITED),
        approvedAt: AT.toISOString(),
        by: "you",
        signature: "0".repeat(64),
      }),
      { mode: 0o600 },
    );
    expect(h.lib().list()).toEqual([
      { flow: "release-check", hash: flowHashOf(EDITED), state: "new", bytes: EDITED.length },
    ]);
    expect(h.setAside("fieldd.flows.set_aside")).toEqual([["release-check.json", "forged"]]);
  });
});
