import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexSessionRow } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import type { SessionRow } from "@vibefield/rosetta-protocol";
import { afterAll, describe, expect, it } from "vitest";
import { EnrollmentStore, IndexService } from "../src/agent-index";
import { RpcCallError } from "../src/native-link";
import type { RosettadSupervisor } from "../src/rosettad-supervisor";

// AR-4 review — `IndexService.sessionByNativeId`, the ONE rosetta read fieldd
// PARSES instead of casting. It is the evidence resume-when-idle decides on,
// and that decision TERMINATES a live PTY, so every row here is about what the
// reader refuses to believe: a body it cannot vouch for, a stamp that is not a
// finite number, bounds that contradict each other, a foreign row the server's
// comma-separated selector let through. The seam is driven through a fake
// `fetchFn` — the daemon's own wire is the supervisor suites' business.

const PROTOCOL = 20;
const ORIGIN = "http://127.0.0.1:65000";

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

/** The service over a scripted daemon. The answer is RAW TEXT on purpose: some
 * of these bodies are ones `JSON.stringify` cannot make (`1e999`, a tag soup). */
const service = (answer: string, phase = "ready") => {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-sessions-"));
  dirs.push(dir);
  const urls: string[] = [];
  const { said, logger } = recorder();
  const fetchFn: typeof fetch = async (input) => {
    urls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url,
    );
    return new Response(answer, {
      status: 200,
      headers: { "x-rosetta-protocol-version": String(PROTOCOL) },
    });
  };
  const health = { phase, detail: null, pid: 4242, protocolVersion: PROTOCOL };
  const supervisor = {
    health: () => health,
    state: () => ({ ...health, origin: phase === "ready" ? ORIGIN : null, announce: null }),
  } as unknown as RosettadSupervisor;
  const index = new IndexService({
    supervisor,
    store: new EnrollmentStore({ path: join(dir, "enrollment.json"), logger }),
    expectedProtocolVersion: PROTOCOL,
    fetchFn,
    logger,
  });
  return { index, urls, said };
};

/** A REAL rosetta row — typed as the sibling's OWN generated `SessionRow`, so
 * the compiler witnesses that fieldd's narrowed reader still fits the wire it
 * reads (EL9's spirit at a seam with no fixture file of its own). */
const row = (
  over: Partial<SessionRow> & Pick<SessionRow, "id" | "native_session_id">,
): SessionRow => ({
  runtime_id: "rt-scripted",
  project_id: null,
  cwd: null,
  parent_session_id: null,
  delegation: null,
  root_session_id: over.id,
  role: "main",
  title: null,
  summary: null,
  started_at: 1_700_000_000_000,
  updated_at: 1_700_000_100_000,
  activity: { first_at: 1_700_000_000_000, last_at: 1_700_000_100_000 },
  stream_state: "indexed",
  ...over,
});

const body = (...rows: SessionRow[]) => JSON.stringify({ sessions: rows });

const refusal = async (call: Promise<unknown>): Promise<RpcCallError> => {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, "the call resolved where it had to refuse").toBeInstanceOf(RpcCallError);
  return error as RpcCallError;
};

describe("IndexService.sessionByNativeId — the evidence a terminate rides on (AR-4)", () => {
  it("prefers the canonical row when the native id answers children too, and ignores a row that is not this session's", async () => {
    const { index } = service(
      body(
        row({
          id: "child-1",
          native_session_id: "nat-1",
          root_session_id: "root-1",
          role: "subagent",
        }),
        row({ id: "root-1", native_session_id: "nat-1" }),
        row({ id: "other-1", native_session_id: "nat-other" }),
      ),
    );
    const facts = await index.sessionByNativeId("nat-1");
    expect(facts?.id).toBe("root-1");
    expect(facts?.nativeSessionId).toBe("nat-1");
    expect(facts?.streamState).toBe("indexed");
    expect(facts?.activity).toEqual({ firstAt: 1_700_000_000_000, lastAt: 1_700_000_100_000 });
  });

  it("a native id the index has never read is undefined — the absence of evidence, never evidence", async () => {
    const { index } = service(body());
    expect(await index.sessionByNativeId("nat-unknown")).toBeUndefined();
  });

  it("a row rosetta has no timestamped evidence for carries no activity", async () => {
    const { index } = service(body(row({ id: "s1", native_session_id: "nat-1", activity: null })));
    expect((await index.sessionByNativeId("nat-1"))?.activity).toBeNull();
  });

  it("an absent activity field reads the same way — no evidence, never unreadable", async () => {
    const { index } = service(
      '{"sessions":[{"id":"s1","native_session_id":"nat-1","root_session_id":"s1","stream_state":"indexed"}]}',
    );
    const facts = await index.sessionByNativeId("nat-1");
    expect(facts?.id).toBe("s1");
    expect(facts?.activity).toBeNull();
  });

  it("bounds that contradict each other are not evidence: activity is null and the fold is said once", async () => {
    const { index, said } = service(
      body(
        row({
          id: "s1",
          native_session_id: "nat-1",
          activity: { first_at: 1_700_000_100_000, last_at: 1_700_000_000_000 },
        }),
      ),
    );
    const facts = await index.sessionByNativeId("nat-1");
    expect(facts?.id).toBe("s1");
    expect(facts?.activity).toBeNull();
    expect(said.filter((s) => s.event === "fieldd.index.activity_nonsense")).toHaveLength(1);
  });

  it("a stamp in the FUTURE is carried honestly, never folded here — the caller is the one that must not read it as idle", async () => {
    const ahead = Date.now() + 600_000;
    const { index } = service(
      body(
        row({
          id: "s1",
          native_session_id: "nat-1",
          activity: { first_at: ahead - 1_000, last_at: ahead },
        }),
      ),
    );
    // a provider's own records can carry a skewed clock; hiding that here
    // would leave `now - lastAt` NEGATIVE — younger than any threshold — with
    // nothing left for the caller to see (`IndexSessionFacts.activity`)
    expect((await index.sessionByNativeId("nat-1"))?.activity?.lastAt).toBe(ahead);
  });

  it("a body the reader cannot vouch for is UNAVAILABLE {malformed} — never a silent undefined", async () => {
    const { index } = service(JSON.stringify({ sessions: [{ id: "s1" }] }));
    const error = await refusal(index.sessionByNativeId("nat-1"));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ service: "index", state: "malformed" });
  });

  it("a last_at that is not a finite number is refused, not believed (JSON spells Infinity 1e999)", async () => {
    const text =
      '{"sessions":[{"id":"s1","native_session_id":"nat-1","root_session_id":"s1",' +
      '"activity":{"first_at":1700000000000,"last_at":1e999},"stream_state":"indexed"}]}';
    const proof = JSON.parse(text) as { sessions: { activity: { last_at: number } }[] };
    expect(proof.sessions[0]?.activity.last_at).toBe(Number.POSITIVE_INFINITY);
    const { index } = service(text);
    const error = await refusal(index.sessionByNativeId("nat-1"));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "malformed" });
  });

  it("a body that is not JSON at all degrades the same honest way", async () => {
    const { index } = service("<html>the index is not itself</html>");
    const error = await refusal(index.sessionByNativeId("nat-1"));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "malformed" });
  });

  it("the native id rides as ONE encoded query value, and a comma in it cannot widen the answer", async () => {
    const native = "run 7 & co,nat-other";
    // what the server's comma-separated selector would hand back: BOTH the
    // sessions the split named
    const { index, urls } = service(
      body(
        row({ id: "s1", native_session_id: native }),
        row({ id: "s2", native_session_id: "nat-other" }),
      ),
    );
    const facts = await index.sessionByNativeId(native);
    expect(urls).toEqual([
      `${ORIGIN}/api/sessions?native_session_id=run%207%20%26%20co%2Cnat-other&limit=50`,
    ]);
    expect(facts?.id).toBe("s1");
  });

  it("unknown envelope fields are logged ONCE, at debug, and the rows still read", async () => {
    const { index, said } = service(
      JSON.stringify({
        sessions: [row({ id: "s1", native_session_id: "nat-1" })],
        cursor: "next-page",
        warnings: [],
      }),
    );
    expect((await index.sessionByNativeId("nat-1"))?.id).toBe("s1");
    expect((await index.sessionByNativeId("nat-1"))?.id).toBe("s1");
    const news = said.filter((s) => s.event === "fieldd.index.unknown_fields");
    expect(news).toHaveLength(1);
    expect(news[0]?.level).toBe("debug");
    expect(news[0]?.attrs).toEqual({ shape: "sessions", keys: ["cursor", "warnings"] });
  });

  it("an index that is not ready is never asked — the honest phase, before the wire", async () => {
    const { index, urls } = service(body(), "starting");
    const error = await refusal(index.sessionByNativeId("nat-1"));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({ service: "index", state: "starting" });
    expect(urls).toEqual([]);
  });

  it("rosetta's own generated row still satisfies fieldd's narrowed reader", () => {
    const parsed = IndexSessionRow.parse(row({ id: "s1", native_session_id: "nat-1" }));
    expect(parsed.root_session_id).toBe("s1");
    // the columns fieldd does not read ride along untouched (tolerant reader)
    expect(parsed).toMatchObject({ runtime_id: "rt-scripted", role: "main" });
  });
});
