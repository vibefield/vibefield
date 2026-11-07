import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexArtifactPageResponse } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import type { ArtifactEntry, ArtifactPage } from "@vibefield/rosetta-protocol";
import { PROTOCOL_VERSION } from "@vibefield/rosetta-protocol/protocol-version";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { EnrollmentStore, type IndexArtifactsRead, IndexService } from "../src/agent-index";
import { RpcCallError } from "../src/native-link";
import type { RosettadSupervisor } from "../src/rosettad-supervisor";

// MA-3a (`draft/thinking-mini-apps.md` v0.2 §4.1; the build plan's 3a) —
// `IndexService.artifacts`, fieldd's ONE reader of rosetta's library (`GET
// /api/artifacts`). The apps table walks it and the `index.artifacts` door
// pages it (3e), so every row here is about what the reader may say: the ask
// in rosetta's own spelling and nothing the caller left out; rosetta's page
// PARSED, never cast; a 410 (the library moved under the cursor) and a 400 (a
// bad filter or cursor) each in their own words; a body fieldd cannot vouch
// for is `malformed`, never an empty library; and no log line carries the
// ask's words (EL7).
//
// The first block drives the reader through a fake `fetchFn` (the pattern of
// agent-index-sessions.test.ts). The second runs it against the scripted
// rosettad's library route (test/fixtures/fake-rosettad.mjs), which is also
// that route's own witness: newest first, the newest presentation of each
// app, one app's whole history, rosetta's clamp, its cursor, its 410 and 400.
//
// The compiler's witness (EL9 at a seam whose mirror is hand-written in
// contracts, R22): every fixture here is typed as rosetta's OWN generated
// `ArtifactEntry` / `ArtifactPage`, and `mirrorReadsRosetta` below only
// compiles while rosetta's page still fits what the contracts mirror reads.

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-rosettad.mjs");
const GOLDEN = join(HERE, "../../contracts/fixtures/index-artifacts-response.rosetta-30.json");
const ORIGIN = "http://127.0.0.1:65011";

/** rosetta's generated page is what the contracts' mirror reads, field for field. */
const mirrorReadsRosetta = (page: ArtifactPage): IndexArtifactPageResponse => page;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Said {
  level: string;
  event: string;
  attrs: LogFields | undefined;
}

const recorder = (): { said: Said[]; logger: Logger } => {
  const said: Said[] = [];
  const at =
    (level: string) =>
    (event: string, _message: string, attrs?: LogFields): void => {
      said.push({ level, event, attrs });
    };
  const logger: Logger = {
    child: () => logger,
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: (event, _message, _error, attrs) => {
      said.push({ level: "error", event, attrs });
    },
    fatal: (event, _message, _error, attrs) => {
      said.push({ level: "fatal", event, attrs });
    },
    isLevelEnabled: () => true,
  };
  return { said, logger };
};

/** 64 lowercase hex, as rosetta's identities are (blake3 there; any stable digest here). */
const hex = (seed: string): string => createHash("sha256").update(seed).digest("hex");

/** One presentation as rosetta answers it — typed as rosetta's OWN `ArtifactEntry`. */
const entry = (
  app: string,
  over: {
    publication?: Partial<ArtifactEntry["publication"]>;
    entry?: Partial<Omit<ArtifactEntry, "publication">>;
    version?: number;
  } = {},
): ArtifactEntry => {
  const version = over.version ?? 1;
  return {
    publication: {
      id: hex(`presentation:${app}:${version}`),
      artifact_id: hex(`app:${app}`),
      session_id: "s1",
      timeline_id: `tl-${app}-${version}`,
      title: `App ${app}`,
      filename: `${app}.html`,
      path: `/Users/someone/work/${app}.html`,
      url: null,
      native_id: null,
      version: null,
      published_at: 1_000 + version,
      source_offset: 4_096,
      description: null,
      dropped_files: null,
      ...over.publication,
    },
    availability: "captured",
    captured_at: 900,
    recovered_from: null,
    asset: {
      url: `/api/assets/${hex(`page:${app}:${version}`)}.html`,
      digest: hex(`page:${app}:${version}`),
      media_type: "text/html; charset=utf-8",
      byte_len: 120,
    },
    agent: "claude-code",
    session_title: `Session for ${app}`,
    project_id: "p1",
    project_name: "app",
    presentations: version,
    ...over.entry,
  };
};

const page = (entries: ArtifactEntry[], over: Partial<ArtifactPage> = {}): ArtifactPage => ({
  entries,
  next_cursor: null,
  canonical_ready: true,
  ...over,
});

/** The service over a scripted daemon: each request is answered by `answer` (a body, a status with one, or the body
 * for the nth request, from 1). The body is RAW TEXT on purpose: some are ones `JSON.stringify` cannot make. */
const service = (
  answer: string | { status: number; body?: string } | ((n: number) => string),
  opts: { phase?: string; protocol?: number } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-artifacts-"));
  dirs.push(dir);
  const urls: string[] = [];
  const { said, logger } = recorder();
  const phase = opts.phase ?? "ready";
  const fetchFn: typeof fetch = async (input) => {
    urls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url,
    );
    const status = typeof answer === "object" ? answer.status : 200;
    const body =
      typeof answer === "function"
        ? answer(urls.length)
        : typeof answer === "string"
          ? answer
          : (answer.body ?? "");
    return new Response(body, {
      status,
      headers: {
        "x-rosetta-protocol-version": String(opts.protocol ?? PROTOCOL_VERSION),
        "content-type": "application/json",
      },
    });
  };
  const health = { phase, detail: null, pid: 4242, protocolVersion: PROTOCOL_VERSION };
  const supervisor = {
    health: () => health,
    state: () => ({ ...health, origin: phase === "ready" ? ORIGIN : null, announce: null }),
  } as unknown as RosettadSupervisor;
  const index = new IndexService({
    supervisor,
    store: new EnrollmentStore({ path: join(dir, "enrollment.json"), logger }),
    expectedProtocolVersion: PROTOCOL_VERSION,
    fetchFn,
    logger,
  });
  return { index, urls, said };
};

const refusal = async (call: Promise<unknown>): Promise<RpcCallError> => {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, "the call resolved where it had to refuse").toBeInstanceOf(RpcCallError);
  return error as RpcCallError;
};

const APP = hex("app:checkout");

describe("IndexService.artifacts — the library reader (MA-3a)", () => {
  it("asks rosetta's route in rosetta's spelling, and sends no member the ask left out", async () => {
    const { index, urls } = service(JSON.stringify(page([])));
    await index.artifacts({
      q: "check out",
      agent: "claude-code",
      project: "p1",
      artifactId: APP,
      cursor: '{"at":1,"id":"x"}',
      limit: 20,
    });
    expect(urls, "one request reached the daemon").toHaveLength(1);
    const asked = new URL(urls[0] ?? "http://unasked.invalid/");
    expect(`${asked.origin}${asked.pathname}`, "rosetta's library route").toBe(
      `${ORIGIN}/api/artifacts`,
    );
    expect(Object.fromEntries(asked.searchParams), "rosetta's names, every member").toEqual({
      q: "check out",
      agent: "claude-code",
      project: "p1",
      artifact_id: APP,
      cursor: '{"at":1,"id":"x"}',
      limit: "20",
    });

    await index.artifacts({ limit: 100 });
    expect(urls, "a second request reached the daemon").toHaveLength(2);
    expect(
      Object.fromEntries(new URL(urls[1] ?? "http://unasked.invalid/").searchParams),
      "an ask with nothing but its page sends nothing else",
    ).toEqual({ limit: "100" });
  });

  it("parses rosetta's own page (the protocol-30 golden) and hands it back in rosetta's spelling", async () => {
    expect(existsSync(GOLDEN), "the contracts' rosetta-30 golden is present").toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as ArtifactPage & { "//"?: string };
    const { index } = service(JSON.stringify(golden));
    const answered = await index.artifacts({ limit: 100 });
    expect(answered.entries, "the golden's one entry").toHaveLength(1);
    expect(answered.canonical_ready, "the golden's library is ready").toBe(true);
    expect(answered.next_cursor, "the golden's cursor, as rosetta wrote it").toBe("opaque");
    const [first] = answered.entries;
    expect(first?.publication.id).toBe(golden.entries[0]?.publication.id);
    expect(first?.publication.artifact_id).toBe(golden.entries[0]?.publication.artifact_id);
    expect(first?.agent, "the agent arrives as rosetta's kind").toBe("claude-code");
    expect(first?.presentations).toBe(2);
    expect(first?.publication.description, "the publish request's own description (RO-33)").toBe(
      "Two checkout flows to compare",
    );
    expect(first?.publication.dropped_files, "the files it did not keep (RO-34a)").toBe(2);
    // the witness is a compile-time one; this keeps it referenced
    expect(mirrorReadsRosetta(page([entry("a")])).entries).toHaveLength(1);
  });

  it("a 410 (the library moved under the cursor) is PRECONDITION_FAILED cursor-expired, the caller's to read from the head", async () => {
    const { index } = service({
      status: 410,
      body: JSON.stringify({ error: { code: "cursor_expired", message: "moved" } }),
    });
    const error = await refusal(index.artifacts({ cursor: "c", limit: 100 }));
    expect(error.kind).toBe("PRECONDITION_FAILED");
    expect(error.retryable, "a retry of the same cursor meets the same 410").toBe(false);
    expect(error.details).toEqual({ service: "index", reason: "cursor-expired" });
  });

  it("a 400 (a filter past rosetta's bound, a cursor that is not one) is PRECONDITION_FAILED bad-filter", async () => {
    const { index } = service({
      status: 400,
      body: JSON.stringify({
        error: { code: "bad_request", message: "invalid artifact filter or cursor" },
      }),
    });
    const error = await refusal(index.artifacts({ cursor: "not a cursor", limit: 100 }));
    expect(error.kind).toBe("PRECONDITION_FAILED");
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ service: "index", reason: "bad-filter" });
  });

  it("any other refusal is the index's honest UNAVAILABLE error, retryable", async () => {
    const { index } = service({ status: 500, body: "{}" });
    const error = await refusal(index.artifacts({ limit: 100 }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "index", state: "error" });
  });

  it("a page fieldd cannot vouch for is malformed — never an empty library — and its log names no word of the ask", async () => {
    const bodies = [
      "<html>tag soup</html>",
      JSON.stringify({ entries: [] }),
      JSON.stringify({
        entries: [{ ...entry("a"), publication: { title: "no id" } }],
        canonical_ready: true,
      }),
      JSON.stringify({ entries: "nope", next_cursor: null, canonical_ready: true }),
    ];
    // ONE token that no encoding changes, so a line that carried the asked path (`?q=zqsecretzq…`) would be caught
    // here; the spaced form is checked raw and form-encoded as well
    const asks = [
      { q: "zqsecretzq", words: ["zqsecretzq"] },
      { q: "secret words", words: ["secret words", "secret+words", "secret%20words"] },
    ];
    for (const body of bodies) {
      for (const ask of asks) {
        const { index, said, urls } = service(body);
        const error = await refusal(index.artifacts({ q: ask.q, limit: 100 }));
        expect(urls[0], "the ask reached the daemon with its words").toContain("q=");
        expect(error.kind, `UNAVAILABLE for ${body.slice(0, 40)}`).toBe("UNAVAILABLE");
        expect(error.retryable).toBe(true);
        expect(error.details).toEqual({ service: "index", state: "malformed" });
        const warned = said.filter((line) => line.level === "warn");
        expect(warned.length, "the reader warned that it could not read the page").toBeGreaterThan(
          0,
        );
        for (const line of said) {
          const route = line.attrs?.route;
          if (route !== undefined) {
            expect(route, `${line.event} names the route, never the asked path`).toBe(
              "/api/artifacts",
            );
          }
        }
        const text = JSON.stringify(said);
        for (const word of ask.words) {
          expect(text, `no log line carries the ask's words (EL7): ${word}`).not.toContain(word);
        }
      }
    }
  });

  it("says a page it cannot read at warn once per member, and at debug after (the apps table reads on a timer)", async () => {
    const unreadable = (n: number): string =>
      JSON.stringify({
        entries: [
          ...Array.from({ length: n }, (_, at) => entry(`ok-${at}`)),
          { ...entry("bad"), publication: { title: "no id" } },
        ],
        next_cursor: null,
        canonical_ready: true,
      });
    // the same member at another entry's index on each read, then another member
    const other = JSON.stringify({ entries: "nope", next_cursor: null, canonical_ready: true });
    const bodies = [unreadable(0), unreadable(2), unreadable(0), other, other];
    const { index, said } = service((n) => bodies[Math.min(n, bodies.length) - 1] ?? "");
    for (let n = 0; n < 3; n += 1) {
      const error = await refusal(index.artifacts({ limit: 100 }));
      expect(error.details, `read ${n + 1} is malformed`).toEqual({
        service: "index",
        state: "malformed",
      });
    }
    const lines = said.filter((line) => line.event === "fieldd.index.artifacts_malformed");
    expect(
      lines.map((line) => line.level),
      "one warn for the member, then debug, whatever its index",
    ).toEqual(["warn", "debug", "debug"]);

    await refusal(index.artifacts({ limit: 100 }));
    await refusal(index.artifacts({ limit: 100 }));
    expect(
      said
        .filter((line) => line.event === "fieldd.index.artifacts_malformed")
        .map((line) => line.level),
      "another member is said at warn once of its own",
    ).toEqual(["warn", "debug", "debug", "warn", "debug"]);
  });

  it("refuses with the daemon's phase while it is not ready, and sends nothing", async () => {
    const { index, urls } = service(JSON.stringify(page([])), { phase: "starting" });
    const error = await refusal(index.artifacts({ limit: 100 }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "index", state: "starting" });
    expect(urls, "no request went out").toEqual([]);
  });

  it("a daemon that speaks another protocol is INCOMPATIBLE", async () => {
    const { index } = service(JSON.stringify(page([])), { protocol: PROTOCOL_VERSION + 1 });
    const error = await refusal(index.artifacts({ limit: 100 }));
    expect(error.kind).toBe("INCOMPATIBLE");
    expect(error.retryable).toBe(false);
  });

  it("is a tolerant reader: an envelope member this build does not read is said once, and a new availability word costs no page", async () => {
    const wider = {
      ...page([
        {
          ...entry("a"),
          availability: "captured_partially",
          future_member: { later: true },
        } as unknown as ArtifactEntry,
      ]),
      revision: 7,
      future: {},
    };
    const { index, said } = service(JSON.stringify(wider));
    const first = await index.artifacts({ limit: 100 });
    await index.artifacts({ limit: 100 });
    expect(first.entries, "the page's entry was read").toHaveLength(1);
    expect(first.entries[0]?.availability, "the word is carried for the projection to fold").toBe(
      "captured_partially",
    );
    const unknown = said.filter((line) => line.event === "fieldd.index.unknown_fields");
    expect(unknown, "said once, at debug, across two reads").toHaveLength(1);
    expect(unknown[0]?.level).toBe("debug");
    expect(unknown[0]?.attrs).toEqual({ shape: "artifacts", keys: ["revision", "future"] });
  });
});

// ── against the scripted rosettad's library route ──

interface FakeLibrary {
  entries: ArtifactEntry[];
  canonical_ready?: boolean;
  revision?: number;
  status?: number;
  content?: Record<string, string>;
}

async function startFake(library: FakeLibrary) {
  const dir = mkdtempSync(join(tmpdir(), "vf-artifacts-fake-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "artifacts.json");
  const requestLog = join(dir, "requests.log");
  const write = (next: FakeLibrary) => writeFileSync(file, JSON.stringify(next));
  write(library);
  const child: ChildProcess = spawn(process.execPath, [FAKE, "serve", "--json"], {
    env: {
      ...process.env,
      FAKE_ROSETTAD_MODE: "ok",
      FAKE_ROSETTAD_ARTIFACTS: file,
      FAKE_ROSETTAD_REQUEST_LOG: requestLog,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(() => {
    child.kill("SIGINT");
  });
  const origin = await new Promise<string>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("the fake never said ready")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      for (const line of buffered.split("\n")) {
        try {
          const parsed = JSON.parse(line) as { event?: string; origin?: string };
          if (parsed.event === "ready" && typeof parsed.origin === "string") {
            clearTimeout(timer);
            resolve(parsed.origin);
          }
        } catch {
          // not a whole line yet
        }
      }
    });
    child.once("exit", (code) => reject(new Error(`the fake exited ${code}`)));
  });
  const health = {
    phase: "ready",
    detail: null,
    pid: child.pid ?? 1,
    protocolVersion: PROTOCOL_VERSION,
  };
  const supervisor = {
    health: () => health,
    state: () => ({ ...health, origin, announce: null }),
  } as unknown as RosettadSupervisor;
  const { logger } = recorder();
  const index = new IndexService({
    supervisor,
    store: new EnrollmentStore({ path: join(dir, "enrollment.json"), logger }),
    expectedProtocolVersion: PROTOCOL_VERSION,
    logger,
  });
  const asked = (): string[] =>
    existsSync(requestLog)
      ? readFileSync(requestLog, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.slice(line.indexOf(" ") + 1))
      : [];
  return { origin, index, write, asked };
}

/** Read every page of one ask, following `next_cursor` (bounded: a reader that never ends fails here). */
async function readAll(
  index: IndexService,
  ask: Omit<IndexArtifactsRead, "cursor">,
): Promise<{ pages: number; entries: IndexArtifactPageResponse["entries"] }> {
  const entries: IndexArtifactPageResponse["entries"] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const answered = await index.artifacts({ ...ask, ...(cursor !== undefined ? { cursor } : {}) });
    entries.push(...answered.entries);
    cursor = answered.next_cursor ?? undefined;
    pages += 1;
  } while (cursor !== undefined && pages < 20);
  return { pages, entries };
}

describe("the scripted rosettad's library, read through the reader (MA-3a)", () => {
  it("pages the newest presentation of each app, newest first, to the end by next_cursor", async () => {
    const apps = Array.from({ length: 120 }, (_, n) =>
      entry(`app-${String(n).padStart(3, "0")}`, { publication: { published_at: 10_000 + n } }),
    );
    // an older presentation of the newest app: never listed beside its newest
    const older = entry("app-119", { version: 0, publication: { published_at: 5 } });
    const { index, asked } = await startFake({ entries: [older, ...apps] });

    const first = await index.artifacts({ limit: 100 });
    expect(first.entries, "the first page is full").toHaveLength(100);
    expect(first.entries[0]?.publication.artifact_id, "newest first").toBe(hex("app:app-119"));
    expect(first.next_cursor, "a cursor to the rest").toEqual(expect.any(String));
    expect(asked(), "the walk's ask, in rosetta's spelling").toContain("/api/artifacts?limit=100");

    const all = await readAll(index, { limit: 100 });
    expect(all.pages, "two pages of 100").toBe(2);
    const ids = all.entries.map((row) => row.publication.artifact_id);
    expect(new Set(ids).size, "every app once").toBe(120);
    expect(ids).toHaveLength(120);
    const at = all.entries.map((row) => row.publication.published_at ?? 0);
    expect(at, "newest first across the page boundary").toEqual([...at].sort((a, b) => b - a));
    expect(
      all.entries.some((row) => row.publication.id === older.publication.id),
      "an older presentation is not listed beside its newest",
    ).toBe(false);
  });

  it("clamps a page to rosetta's 100", async () => {
    const apps = Array.from({ length: 130 }, (_, n) => entry(`c-${n}`));
    const { index } = await startFake({ entries: apps });
    const answered = await index.artifacts({ limit: 500 });
    expect(answered.entries, "rosetta answers at most 100").toHaveLength(100);
  });

  it("answers one app's every presentation, newest first, for artifactId (Versions)", async () => {
    const history = [1, 2, 3].map((version) =>
      entry("versions", { version, publication: { published_at: 2_000 + version } }),
    );
    const { index } = await startFake({ entries: [...history, entry("other")] });
    const answered = await index.artifacts({ artifactId: hex("app:versions"), limit: 100 });
    expect(
      answered.entries.map((row) => row.publication.id),
      "the app's three presentations, newest first",
    ).toEqual([3, 2, 1].map((version) => hex(`presentation:versions:${version}`)));
  });

  it("a library that moved under the cursor is cursor-expired; a cursor minted for another ask, or none, is bad-filter", async () => {
    const apps = Array.from({ length: 30 }, (_, n) => entry(`m-${n}`));
    const { index, write } = await startFake({ entries: apps, revision: 1 });
    const first = await index.artifacts({ limit: 10 });
    expect(first.next_cursor, "a cursor to the next page").toEqual(expect.any(String));
    const cursor = first.next_cursor ?? "";

    const asked = await index.artifacts({ q: "App", limit: 10 });
    expect(asked.entries, "a filtered page").toHaveLength(10);
    const foreign = await refusal(index.artifacts({ cursor: asked.next_cursor ?? "", limit: 10 }));
    expect(foreign.details, "a cursor minted for another ask").toEqual({
      service: "index",
      reason: "bad-filter",
    });
    const junk = await refusal(index.artifacts({ cursor: "not a cursor", limit: 10 }));
    expect(junk.details, "a cursor that is not one").toEqual({
      service: "index",
      reason: "bad-filter",
    });

    write({ entries: apps, revision: 2 });
    const moved = await refusal(index.artifacts({ cursor, limit: 10 }));
    expect(moved.kind).toBe("PRECONDITION_FAILED");
    expect(moved.details, "the library's revision moved").toEqual({
      service: "index",
      reason: "cursor-expired",
    });
  });

  it("says canonical_ready: false while the library is still reading its history", async () => {
    const { index } = await startFake({ entries: [entry("early")], canonical_ready: false });
    const answered = await index.artifacts({ limit: 100 });
    expect(answered.entries, "what it holds so far").toHaveLength(1);
    expect(answered.canonical_ready, "still reading").toBe(false);
  });

  it("PIN — the fixture's content route answers inert bytes ahead of the session prefix", async () => {
    const shown = entry("bytes", { publication: { session_id: "s-bytes" } });
    const { origin } = await startFake({
      entries: [shown],
      content: { [shown.publication.id]: "<!doctype html><p>made</p>" },
    });
    const response = await fetch(
      `${origin}/api/sessions/s-bytes/artifacts/${shown.publication.id}/content`,
    );
    expect(response.status, "the scripted bytes").toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(await response.text()).toBe("<!doctype html><p>made</p>");
    const elsewhere = await fetch(
      `${origin}/api/sessions/s-other/artifacts/${shown.publication.id}/content`,
    );
    expect(elsewhere.status, "another session's publication is not found").toBe(404);
    const body = (await elsewhere.json()) as { error?: { code?: string } };
    expect(body.error?.code, "rosetta's not_found, not the session route's").toBe("not_found");
  });
});
