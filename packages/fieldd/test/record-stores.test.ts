import { createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  AGENT_CATALOG,
  AGENT_SESSION_RECORD_FORMAT,
  type AgentSessionRecord,
  NEEDS_RECORD_FORMAT,
  type NeedsRecord,
  RECORD_STORES,
  SPARK_KEPT_FILE,
  type SparkRecord,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInputQueues } from "../src/agent-input-queue";
import { SessionRecordStore } from "../src/agent-sessions";
import { FlowRecords } from "../src/flows/records";
import { RpcCallError } from "../src/native-link";
import {
  newerFormat,
  RecordSigner,
  recordsUnreadable,
  UNREADABLE_WORDS,
} from "../src/signed-record";
import { NeedsQueue } from "../src/tool-plane/rooms/you/queue";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";
import { SparkKeptStore } from "../src/tool-plane/spark-kept";
import { SparkStore } from "../src/tool-plane/sparks";

// Item 172 (DESIGN.md §9 "What VibeField keeps, when it cannot read it"; co-plan's item-172 plan) — the one record
// signer and its four stores tell a record from a disk that did not answer. What must hold, for every store alike:
// - (a) a read the disk does not answer (EMFILE, EACCES) is tried RECORD_STORES.READ_TRIES times, then left where it is,
//   never set aside and never written over, and the store refuses UNAVAILABLE in fieldd's words;
// - (b) a record a newer VibeField wrote is kept where it is, never served, and a write to its key is refused;
// - (c) a boot read that fails (a same-uid file where the folder is, a folder it may not open) degrades the store,
//   never the daemon (EL7): the boot read never throws.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // a test that left a folder it may not open would keep its root from being removed
    for (const sub of walk(dir)) chmodSafe(sub, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

function walk(dir: string): string[] {
  try {
    chmodSafe(dir, 0o700);
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? [join(dir, e.name), ...walk(join(dir, e.name))] : [],
    );
  } catch {
    return [];
  }
}

function chmodSafe(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // gone already
  }
}

/** Mode bits mean nothing on win32, and root reads past them. */
const MODES_BITE = process.platform !== "win32" && process.getuid?.() !== 0;

type Events = { event: string; attrs: LogFields | undefined }[];

function capture(events: Events): Logger {
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

const tmp = () => {
  const root = mkdtempSync(join(tmpdir(), "vf-record-stores-"));
  dirs.push(root);
  return root;
};

const AGENT = AGENT_CATALOG[0]!.id;
const VELA = "sp-vela00000000";
const LYRA = "sp-lyra00000000";

const spark = (id: string, name: string): SparkRecord => ({
  format: 1,
  id,
  name,
  face: { seed: 7 },
  agent: AGENT,
  profiles: ["native"],
  thinksUnder: "native",
  folder: `/f/sparks/${name.toLowerCase()}`,
  createdAt: "2026-11-05T04:00:00.000Z",
  updatedAt: "2026-11-05T04:00:00.000Z",
});

const question = (id: string): NeedsRecord => ({
  format: NEEDS_RECORD_FORMAT,
  item: {
    id,
    kind: "question",
    state: "open",
    from: { name: "Vela", session: "run-vela", spark: VELA },
    spark: VELA,
    asked: "2026-11-05T04:00:00.000Z",
    words: "Push the fix?",
    choices: ["Push", "Hold"],
  },
});

/** What a call threw, as a door would answer it, or "ok". */
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

/** Re-sign a kept file with its store's key after `mutate`: what another VibeField with that key would have written. */
function resign(
  file: string,
  keyPath: string,
  mutate: (body: Record<string, unknown>) => Record<string, unknown>,
  keyEncoding?: "hex" | "base64",
) {
  const { signature: _s, ...body } = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  const next = mutate(body);
  writeFileSync(
    file,
    `${JSON.stringify({ ...next, signature: new RecordSigner({ keyPath, keyEncoding }).sign(next) })}\n`,
    {
      mode: 0o600,
    },
  );
}

/** A read seam that answers EMFILE, every time, for files under `under`; counts the tries per file. */
function emfile(under: string) {
  const tries = new Map<string, number>();
  const readFile = (path: string): string => {
    if (path.startsWith(under)) {
      tries.set(path, (tries.get(path) ?? 0) + 1);
      throw Object.assign(new Error(`EMFILE: too many open files, open '${path}'`), {
        code: "EMFILE",
      });
    }
    return readFileSync(path, "utf8");
  };
  return { readFile, tries };
}

/** Files set aside under `dir` (renamed `<file>.<why>-<ms>`), at any depth. */
function asides(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) =>
    /\.(exposed|unsigned|forged|unreadable)-\d+$/.test(name),
  );
}

interface Booted {
  /** the boot's one read: how many it read, what it threw, or null for a store read at each ask */
  readonly read: number | { message: string } | null;
  /** the keys it serves now */
  served(): string[] | { message: string };
  /** the act a caller takes that refuses while the store cannot read */
  refuse(): ReturnType<typeof outcome>;
  /** a write to one key */
  write(key: string): ReturnType<typeof outcome>;
}

interface StoreCase {
  readonly name: string;
  /** the door's refusal: its service, whether it is retryable, and fieldd's words */
  readonly service: string;
  readonly retryable: boolean;
  readonly words: string;
  dir(root: string): string;
  keyPath(root: string): string;
  /** how its key is written (item 177: the sessions' is base64, AR-4b's); hex when unsaid */
  readonly keyEncoding?: "hex" | "base64";
  /** a valid record kept by the store itself; its file and its key */
  seed(root: string, which: 0 | 1): { file: string; key: string };
  /** the store as a fresh fieldd opens it, through its boot read */
  boot(root: string, events: Events, readFile?: (path: string) => string): Booted;
}

const readOf = (fn: () => number): number | { message: string } => {
  try {
    return fn();
  } catch (err) {
    return { message: (err as Error).message };
  }
};

const sparksCase: StoreCase = {
  name: "the sparks (SparkStore)",
  service: RECORD_STORES.SERVICE_COMPOSE,
  retryable: true,
  words: UNREADABLE_WORDS.sparks,
  dir: (root) => join(root, "fieldd", "sparks"),
  keyPath: (root) => join(root, "fieldd", "sparks.key"),
  seed(root, which) {
    const store = new SparkStore({ dir: this.dir(root), keyPath: this.keyPath(root) });
    const record = which === 0 ? spark(VELA, "Vela") : spark(LYRA, "Lyra");
    store.write(record);
    return { file: store.path(record.id), key: record.id };
  },
  boot(root, events, readFile) {
    const store = new SparkStore({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      logger: capture(events),
      readFile,
    });
    return {
      read: null,
      served: () => {
        try {
          return store.list().map((s) => s.id);
        } catch (err) {
          return { message: (err as Error).message };
        }
      },
      refuse: () => outcome(() => store.list()),
      write: (key) => outcome(() => store.write(spark(key, key === VELA ? "Vela" : "Lyra"))),
    };
  },
};

const sessionRecord = (runtimeRunId: string): AgentSessionRecord => ({
  format: AGENT_SESSION_RECORD_FORMAT,
  runtimeRunId,
  runtimeEpoch: 1,
  provider: AGENT,
  cwd: "/repo",
  continuation: { providerId: AGENT, nativeSessionId: `native-${runtimeRunId}` },
  createdAt: "2026-11-05T04:00:00.000Z",
  updatedAt: "2026-11-05T04:00:00.000Z",
});

const NOW = () => new Date("2026-11-05T05:00:00.000Z");

/** Item 177 — the sessions' records (SessionRecordStore), one of fieldd's signed stores: read at each ask, as the sparks are. */
const sessionsCase: StoreCase = {
  name: "the sessions' records (SessionRecordStore, read at each ask)",
  service: RECORD_STORES.SERVICE_AGENTS,
  retryable: true,
  words: UNREADABLE_WORDS.sessions,
  keyEncoding: "base64",
  dir: (root) => join(root, "agents", "sessions"),
  keyPath: (root) => join(root, "agents", "sessions.key"),
  seed(root, which) {
    const store = new SessionRecordStore({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      now: NOW,
    });
    const record = sessionRecord(which === 0 ? "run-ada" : "run-ben");
    store.write(record);
    return { file: store.path(record.runtimeRunId), key: record.runtimeRunId };
  },
  boot(root, events, readFile) {
    const store = new SessionRecordStore({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      now: NOW,
      logger: capture(events),
      readFile,
    });
    return {
      read: null,
      served: () => {
        try {
          return store.list().map((record) => record.runtimeRunId);
        } catch (err) {
          return { message: (err as Error).message };
        }
      },
      refuse: () => outcome(() => store.list()),
      write: (key) => outcome(() => store.write(sessionRecord(key))),
    };
  },
};

const needsCase: StoreCase = {
  name: "the needs-you queue (NeedsStore, read once at boot)",
  service: RECORD_STORES.SERVICE_NEEDS,
  retryable: false,
  words: UNREADABLE_WORDS.needs,
  dir: (root) => join(root, "fieldd", "needs"),
  keyPath: (root) => join(root, "fieldd", "needs.key"),
  seed(root, which) {
    const id = which === 0 ? "ny-0000000000c0ffee" : "ny-0000000000b0b0b0";
    new NeedsStore({ dir: this.dir(root), keyPath: this.keyPath(root) }).write(question(id));
    return { file: join(this.dir(root), `${id}.json`), key: id };
  },
  boot(root, events, readFile) {
    const store = new NeedsStore({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      logger: capture(events),
      readFile,
    });
    const queue = new NeedsQueue({
      store,
      inputs: { wake: () => true, enqueue: () => ({ id: "in-1", position: 1 }) },
      run: () => undefined,
      personaSets: () => null,
      sparkSession: () => undefined,
      spark: () => undefined,
      open: async () => {
        throw new Error("no spark wakes here");
      },
      spawn: async () => {
        throw new Error("nothing starts here");
      },
      agentLabel: () => undefined,
      logger: capture(events),
    });
    return {
      read: readOf(() => queue.restore()),
      served: () => queue.list().map((item) => item.id),
      refuse: () => outcome(() => queue.readable()),
      write: (key) => outcome(() => store.write(question(key))),
    };
  },
};

const inputsCase: StoreCase = {
  name: "the sessions' input queues (AgentInputQueues, read once at boot)",
  service: RECORD_STORES.SERVICE_COMPOSE,
  retryable: false,
  words: UNREADABLE_WORDS.inputs,
  dir: (root) => join(root, "fieldd", "inputs"),
  keyPath: (root) => join(root, "fieldd", "inputs.key"),
  seed(root, which) {
    const run = which === 0 ? "run-ada" : "run-ben";
    new AgentInputQueues({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      deliver: async () => ({ status: "confirmed" }),
      isIdle: () => false,
    }).enqueue(run, "words", { kind: "spark", spark: VELA, name: "Vela" });
    return { file: join(this.dir(root), `${run}.json`), key: run };
  },
  boot(root, events, readFile) {
    const queues = new AgentInputQueues({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      deliver: async () => ({ status: "confirmed" }),
      isIdle: () => false,
      logger: capture(events),
      readFile,
    });
    return {
      read: readOf(() => queues.restore()),
      served: () => ["run-ada", "run-ben"].filter((run) => queues.pending(run).length > 0),
      refuse: () =>
        outcome(() => {
          // fieldd's own wake is not queued where nothing can keep it (its fact stays owed)
          if (queues.wake("run-new", "a fact")) throw new Error("woke where no queue can keep it");
          return queues.enqueue("run-new", "hello", { kind: "you" });
        }),
      write: (key) => outcome(() => queues.enqueue(key, "more words", { kind: "you" })),
    };
  },
};

const keptCase: StoreCase = {
  name: "each spark's kept record (SparkKeptStore, read once at boot)",
  service: RECORD_STORES.SERVICE_COMPOSE,
  retryable: false,
  words: UNREADABLE_WORDS.sparks,
  dir: (root) => join(root, "fieldd", "spark-files"),
  keyPath: (root) => join(root, "fieldd", "spark-files.key"),
  seed(root, which) {
    const id = which === 0 ? VELA : LYRA;
    new SparkKeptStore({ dir: this.dir(root), keyPath: this.keyPath(root) }).update(id, (k) => k);
    return { file: join(this.dir(root), id, SPARK_KEPT_FILE), key: id };
  },
  boot(root, events, readFile) {
    const store = new SparkKeptStore({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      logger: capture(events),
      readFile,
    });
    return {
      read: readOf(() => store.restore()),
      served: () => {
        try {
          return store.list().map((record) => record.spark);
        } catch (err) {
          return { message: (err as Error).message };
        }
      },
      refuse: () => outcome(() => store.update("sp-kiwi00000000", (k) => k)),
      write: (key) => outcome(() => store.update(key, (k) => k)),
    };
  },
};

/** CP-4a1 — the flow records, item 172's fifth store: read at each ask, as the sparks are. */
const FLOW_BYTES = new TextEncoder().encode(
  'export const meta = { name: "Kept" };\nexport default async function () {}\n',
);

const flowsCase: StoreCase = {
  name: "the flow records (FlowRecords)",
  service: RECORD_STORES.SERVICE_FLOWS,
  retryable: true,
  words: UNREADABLE_WORDS.flows,
  dir: (root) => join(root, "fieldd", "flows"),
  keyPath: (root) => join(root, "fieldd", "flows.key"),
  seed(root, which) {
    const flow = which === 0 ? "release-check" : "nightly-sweep";
    new FlowRecords({ dir: this.dir(root), keyPath: this.keyPath(root) }).approve(flow, FLOW_BYTES);
    return { file: join(this.dir(root), "approvals", `${flow}.json`), key: flow };
  },
  boot(root, events, readFile) {
    const records = new FlowRecords({
      dir: this.dir(root),
      keyPath: this.keyPath(root),
      logger: capture(events),
      readFile,
    });
    return {
      read: null,
      served: () => {
        try {
          return records.approvals().map((record) => record.flow);
        } catch (err) {
          return { message: (err as Error).message };
        }
      },
      refuse: () => outcome(() => records.approvals()),
      write: (key) => outcome(() => records.approve(key, FLOW_BYTES)),
    };
  },
};

const CASES = [sparksCase, needsCase, inputsCase, keptCase, flowsCase, sessionsCase];

const refusalOf = (c: StoreCase) => ({
  kind: "UNAVAILABLE",
  retryable: c.retryable,
  details: { service: c.service, state: RECORD_STORES.STATE_UNREADABLE },
  message: c.words,
});

describe("item 172 — the signer tells a record from a disk that did not answer", () => {
  const record = { format: 1, id: "rec-1", words: "kept" };

  function signed() {
    const root = tmp();
    const keyPath = join(root, "fieldd", "rec.key");
    const path = join(root, "fieldd", "rec.json");
    const signer = new RecordSigner({ keyPath });
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ ...record, signature: signer.sign(record) }), {
      mode: 0o600,
    });
    return { root, keyPath, path, signer };
  }

  it.skipIf(!MODES_BITE)(
    "R1 · a file it may not read (mode 000) is unavailable by its errno, and stays where it is",
    () => {
      const { path, signer } = signed();
      chmodSync(path, 0o000);
      expect(signer.read(path)).toEqual({ unavailable: "EACCES" });
      chmodSync(path, 0o600);
      expect(signer.read(path)).toEqual({ body: record });
    },
  );

  it("R2 · a read the disk refuses (EMFILE) is tried READ_TRIES times: answered when a try is, unavailable past the last", () => {
    const { keyPath, path } = signed();
    let fails = RECORD_STORES.READ_TRIES - 1;
    const flaky = new RecordSigner({
      keyPath,
      readFile: (p) => {
        if (fails-- > 0) throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
        return readFileSync(p, "utf8");
      },
    });
    expect(flaky.read(path)).toEqual({ body: record });
    const { readFile, tries } = emfile(dirname(path));
    expect(new RecordSigner({ keyPath, readFile }).read(path)).toEqual({ unavailable: "EMFILE" });
    expect(tries.get(path)).toBe(RECORD_STORES.READ_TRIES);
    expect(readFileSync(path, "utf8")).toContain('"rec-1"');
  });

  it("R3 · nothing there is absent, and a folder at the path is not a record", () => {
    const { root, signer } = signed();
    expect(signer.read(join(root, "fieldd", "absent.json"))).toEqual({ absent: true });
    const folder = join(root, "fieldd", "folder.json");
    mkdirSync(folder, { mode: 0o700 });
    expect(signer.read(folder)).toEqual({ why: "unreadable" });
  });

  it.skipIf(!MODES_BITE)(
    "R4 · a key it may not read leaves the record unavailable, never refused as unreadable",
    () => {
      const { keyPath, path } = signed();
      chmodSync(keyPath, 0o000);
      try {
        expect(new RecordSigner({ keyPath }).read(path)).toEqual({ unavailable: "EACCES" });
      } finally {
        chmodSync(keyPath, 0o600);
      }
    },
  );

  it("R5 · names the format a newer VibeField wrote, and nothing else", () => {
    expect(newerFormat({ format: 2 }, 1)).toBe(2);
    expect(newerFormat({ format: 1 }, 1)).toBeUndefined();
    expect(newerFormat({ format: "2" }, 1)).toBeUndefined();
    expect(newerFormat({}, 1)).toBeUndefined();
  });

  it("R6 · the refusal is UNAVAILABLE {service, records-unreadable} in DESIGN.md §9's words", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const words of Object.values(UNREADABLE_WORDS))
      expect(design, words).toContain(`"${words}"`);
    const refusal = recordsUnreadable(RECORD_STORES.SERVICE_NEEDS, UNREADABLE_WORDS.needs, false);
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(refusal).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      message: UNREADABLE_WORDS.needs,
      details: { service: "needs", state: "records-unreadable" },
    });
  });
});

describe("item 172 — the read seam is the tests' alone", () => {
  it("R7 · no production code hands a store or the signer a read of its own: each store only passes its option on", () => {
    const src = join(import.meta.dirname, "../src");
    const passes = (readdirSync(src, { recursive: true, encoding: "utf8" }) as string[])
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        readFileSync(join(src, file), "utf8")
          .split("\n")
          .filter((line) => /\breadFile\s*:/.test(line) && !line.trim().startsWith("readonly"))
          .map((line) => `${file.split("\\").join("/")}: ${line.trim()}`),
      )
      .sort();
    expect(passes).toEqual([
      "agent-input-queue.ts: readFile: opts.readFile,",
      "agent-sessions.ts: readFile: opts.readFile,",
      "flows/records.ts: readFile: opts.readFile,",
      "tool-plane/rooms/you/store.ts: readFile: opts.readFile,",
      "tool-plane/spark-kept.ts: readFile: opts.readFile,",
      "tool-plane/sparks.ts: readFile: opts.readFile,",
    ]);
  });
});

describe.each(CASES)("item 172 — $name, when the disk does not answer", (c) => {
  it("U1 · a same-uid file where its folder is: the boot read goes on, and the store refuses in fieldd's words (EL7)", () => {
    const root = tmp();
    mkdirSync(dirname(c.dir(root)), { recursive: true, mode: 0o700 });
    writeFileSync(c.dir(root), "not a folder", { mode: 0o600 });
    const events: Events = [];
    const booted = c.boot(root, events);
    if (booted.read !== null) expect(booted.read).toBe(0);
    expect(booted.refuse()).toEqual(refusalOf(c));
    expect(events.map((e) => e.event)).toContain("fieldd.records.store_unavailable");
    expect(readFileSync(c.dir(root), "utf8")).toBe("not a folder");
  });

  it.skipIf(!MODES_BITE)(
    "U2 · a folder it may not open (mode 000): the boot read goes on, the store refuses, and the folder and its record are left as they were",
    () => {
      const root = tmp();
      const { file } = c.seed(root, 0);
      const bytes = readFileSync(file, "utf8");
      chmodSync(c.dir(root), 0o000);
      const events: Events = [];
      const booted = c.boot(root, events);
      try {
        if (booted.read !== null) expect(booted.read).toBe(0);
        expect(booted.refuse()).toEqual(refusalOf(c));
        expect(events.map((e) => e.event)).toContain("fieldd.records.store_unavailable");
      } finally {
        chmodSync(c.dir(root), 0o700);
      }
      expect(readFileSync(file, "utf8")).toBe(bytes);
      expect(asides(c.dir(root))).toEqual([]);
    },
  );

  it("U3 · a record the disk does not answer (EMFILE, every try) is left in place, never set aside, and the store refuses", () => {
    const root = tmp();
    const { file } = c.seed(root, 0);
    const bytes = readFileSync(file, "utf8");
    const { readFile, tries } = emfile(c.dir(root));
    const events: Events = [];
    const booted = c.boot(root, events, readFile);
    if (booted.read !== null) expect(booted.read).toBe(0);
    expect(booted.refuse()).toEqual(refusalOf(c));
    expect(tries.get(file)).toBe(RECORD_STORES.READ_TRIES);
    expect(events.find((e) => e.event === "fieldd.records.unavailable")?.attrs).toMatchObject({
      code: "EMFILE",
    });
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(asides(c.dir(root))).toEqual([]);
  });

  it("U4 · a record a newer VibeField wrote is kept where it is, never served, and a write to its key is refused; the rest are served", () => {
    const root = tmp();
    const newer = c.seed(root, 0);
    const other = c.seed(root, 1);
    resign(newer.file, c.keyPath(root), (body) => ({ ...body, format: 2 }), c.keyEncoding);
    const bytes = readFileSync(newer.file, "utf8");
    const events: Events = [];
    const booted = c.boot(root, events);
    if (booted.read !== null) expect(booted.read).toBe(1);
    expect(booted.served()).toEqual([other.key]);
    expect(booted.write(newer.key)).not.toBe("ok");
    expect(readFileSync(newer.file, "utf8")).toBe(bytes);
    expect(asides(c.dir(root))).toEqual([]);
    expect(events.find((e) => e.event === "fieldd.records.newer")?.attrs).toMatchObject({
      format: 2,
    });
    expect(booted.write(other.key)).toBe("ok");
  });
});

describe("item 172 — the sparks set aside as the other stores do", () => {
  it("U5 · a spark's record that is not one is renamed beside itself, said once, and never read again", () => {
    const root = tmp();
    const { file } = sparksCase.seed(root, 0);
    const { signature: _s, ...unsigned } = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(file, JSON.stringify(unsigned), { mode: 0o600 });
    const events: Events = [];
    const booted = sparksCase.boot(root, events);
    expect(booted.served()).toEqual([]);
    expect(booted.served()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(asides(sparksCase.dir(root))).toEqual([
      expect.stringMatching(/^sp-vela00000000\.json\.unsigned-\d+$/),
    ]);
    expect(events.filter((e) => e.event === "fieldd.compose.spark_set_aside")).toHaveLength(1);
  });
});

/** What SessionRecordStore wrote before item 177 (AR-4b): its own HMAC-SHA256 over its record's JSON with the keys
 * sorted at every level, its key 32 random bytes in base64, the record pretty-printed with its signature inside. */
function writtenBefore177(root: string, record: AgentSessionRecord) {
  const keyPath = sessionsCase.keyPath(root);
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const keyText = `${randomBytes(32).toString("base64")}\n`;
  writeFileSync(keyPath, keyText, { mode: 0o600, flag: "wx" });
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value === null || typeof value !== "object") return value;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, inner]) => [key, sorted(inner)]));
  };
  const signature = createHmac("sha256", Buffer.from(keyText.trim(), "base64"))
    .update(JSON.stringify(sorted(record)))
    .digest("hex");
  const dir = sessionsCase.dir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${encodeURIComponent(record.runtimeRunId)}.json`);
  writeFileSync(file, `${JSON.stringify({ ...record, signature }, null, 2)}\n`, { mode: 0o600 });
  return { file, keyPath, keyText };
}

describe("item 177 — the sessions' records move onto the one signer, their key read as it is written", () => {
  it("S1 · a record signed before item 177 verifies through the one signer, and its base64 key is never set aside", () => {
    const root = tmp();
    const record = sessionRecord("run-ada");
    const { file, keyPath, keyText } = writtenBefore177(root, record);
    expect(new RecordSigner({ keyPath, keyEncoding: "base64" }).read(file)).toEqual({
      body: record,
    });
    expect(readFileSync(keyPath, "utf8")).toBe(keyText);
    expect(asides(dirname(keyPath))).toEqual([]);
    // a fresh fieldd's store serves it, and keeps the key as it was
    expect(sessionsCase.boot(root, []).served()).toEqual(["run-ada"]);
    expect(readFileSync(keyPath, "utf8")).toBe(keyText);
  });

  it("S4 · a session record a newer VibeField wrote is held as it is, never set aside or written over, and stampExit refuses it", () => {
    const root = tmp();
    const { file, key } = sessionsCase.seed(root, 0);
    resign(file, sessionsCase.keyPath(root), (body) => ({ ...body, format: 2 }), "base64");
    const bytes = readFileSync(file, "utf8");
    const events: Events = [];
    const store = new SessionRecordStore({
      dir: sessionsCase.dir(root),
      keyPath: sessionsCase.keyPath(root),
      now: NOW,
      logger: capture(events),
    });
    const stamped = store.stampExit(key, {
      at: NOW().toISOString(),
      exitCode: 0,
      signal: null,
      reason: "exited",
    });
    expect(readdirSync(sessionsCase.dir(root)), "the newer record is held where it is").toEqual([
      basename(file),
    ]);
    expect(stamped, "stampExit refuses a record a newer VibeField wrote").toBe(false);
    expect(readFileSync(file, "utf8"), "and never writes over it").toBe(bytes);
    expect(store.list().map((record) => record.runtimeRunId)).toEqual([]);
    expect(readdirSync(sessionsCase.dir(root)), "a list holds it too").toEqual([basename(file)]);
    expect(events.find((e) => e.event === "fieldd.records.newer")?.attrs).toMatchObject({
      store: "sessions",
      format: 2,
    });
  });
});

/** Records SessionRecordStore signed before item 177 (AR-4b), written by the store itself on 2026-11-05 and kept
 * byte for byte: a plain one, a nested one (its workspace, continuation and exit; quotes, a backslash, non-ASCII and
 * an emoji in its strings), and one rewritten with its keys in reverse order. Their key is the base64 one. */
const PRE177 = join(import.meta.dirname, "fixtures", "sessions-pre177");

describe("item 177 — the canonical form the sessions' records were signed in", () => {
  it("S5 · the one signer verifies what agent-sessions.ts' own copy signed before item 177 (red-2's PIN; that copy is gone): every pre-177 fixture reads as its record, and the store serves all three", () => {
    const keyFile = join(PRE177, "sessions.key");
    expect(existsSync(keyFile), "the pre-177 fixtures' key is kept").toBe(true);
    const names = readdirSync(join(PRE177, "sessions")).sort();
    expect(names).toEqual(["run-nested.json", "run-ordered.json", "run-plain.json"]);
    // read from a copy, so a set-aside could never touch the committed fixtures
    const root = tmp();
    mkdirSync(sessionsCase.dir(root), { recursive: true, mode: 0o700 });
    writeFileSync(sessionsCase.keyPath(root), readFileSync(keyFile), { mode: 0o600 });
    for (const name of names)
      writeFileSync(
        join(sessionsCase.dir(root), name),
        readFileSync(join(PRE177, "sessions", name)),
        { mode: 0o600 },
      );
    const signer = new RecordSigner({ keyPath: sessionsCase.keyPath(root), keyEncoding: "base64" });
    for (const name of names) {
      const { signature: _signature, ...unsigned } = JSON.parse(
        readFileSync(join(PRE177, "sessions", name), "utf8"),
      ) as Record<string, unknown>;
      expect(
        signer.read(join(sessionsCase.dir(root), name)),
        `${name}: its signature verifies over the signer's canonical bytes`,
      ).toEqual({ body: unsigned });
    }
    const served = sessionsCase.boot(root, []).served();
    expect(Array.isArray(served) ? [...served].sort() : served).toEqual([
      "run-nested",
      "run-ordered",
      "run-plain",
    ]);
    expect(asides(sessionsCase.dir(root))).toEqual([]);
    expect(readFileSync(sessionsCase.keyPath(root)), "the key is kept as it was").toEqual(
      readFileSync(keyFile),
    );
  });
});
