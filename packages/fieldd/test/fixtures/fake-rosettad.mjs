// A scripted rosettad for the supervisor rows: speaks the daemon's REAL
// readiness contract (`serve … --json --announce --announce-dir DIR` → one JSON
// line `{event:"ready", origin, protocol_version, announce}`), writes the
// announce file the way rosetta's announce.rs does (`<dir>/<pid>.json`, removed
// on a clean SIGINT exit), answers `GET /api/status` with the
// `x-rosetta-protocol-version` header the way the real server does (the
// supervisor's orphan pass identifies a daemon by it), and misbehaves on
// request through FAKE_ROSETTAD_MODE:
//   ok                 ready, then serve forever
//   wrong-protocol     ready with protocol_version 1
//   bad-origin         ready with a non-loopback origin
//   silent             never says ready
//   crash-after-ready  ready, then a line on stderr and exit 3 shortly after
//   crash-on-start     a line on stderr and exit 2 before saying anything
// The supervisor never sees this file's name — it spawns whatever `bin` it was
// given, so the test passes `process.execPath` with this script as `bin` via
// the spawnProcess seam.
//
// AR-1: it also reads `--enroll FILE` the way rosetta's enroll.rs does — once,
// before binding; a missing file, the wrong format, or a runtime whose
// data_root is not an existing directory is a refusal (stderr + exit 2) — and
// serves the three routes the index doors read: `/api/discoveries` (a roll
// call of two kinds, claude-code installed and codex not), `/api/runtimes`
// (the consented discovered runtime plus one row per enrolled root, labelled,
// `provenance: "enrolled"`), and a `/api/status` whose `daemon.ingest.phase`
// is `awaiting_consent` while nothing is consented and `live` otherwise.
//
// AR-4: `/api/sessions?native_session_id=a,b` — the rows fieldd's
// resume-when-idle reads (`SessionRow[]`, filtered by native id), scripted by
// FAKE_ROSETTAD_SESSIONS: a JSON file re-read on every request, so a test can
// move a session's `activity.last_at` while the daemon polls. When
// FAKE_ROSETTAD_REQUEST_LOG names a file, one line is appended there per
// READ request: a window in which the fold did NOT change is only evidence if
// the poller actually ASKED during it, and this is the counter a test reads to
// say so — and for AR-5e it is also how a test asserts the exact query string
// fieldd sent (the scope, `prefix`, `kind`, `limit`).
//
// QL (the native resume's provenance check): FAKE_ROSETTAD_RUNTIMES, a JSON
// file of extra `/api/runtimes` rows re-read per request, so a test can say
// which kind a scripted session's `runtime_id` names.
//
// QL: `/api/projects` (every `project_id` the scripted session rows name, as
// a project rooted at the first such row's cwd — rosetta's own grouping in
// miniature) and `/api/sessions?project=…` (the rows of one project, as the
// real server filters them) — `index.recent`'s reads.
//
// AR-5e: `/api/search` and `/api/sessions/<id>` — the find sheet's seam,
// scripted by FAKE_ROSETTAD_SEARCH, a JSON file re-read per request like the
// sessions one:
//
//   {
//     "readiness": "ready",            // rosetta SearchReadiness; default ready
//     "canonical_ready": true,          // the /api/status flag; default true
//     "progress": { "documents_done": 1, "documents_total": 2 },   // optional
//     "hits": [ { "timeline_id", "session_id", "kind", "at", "snippet" } ]
//   }
//
// The route answers the way the real server does: `sessions=` scopes (a hit
// whose session is not named is not answered), `q` matches case-insensitively
// inside the snippet, `kind` and `after_ts` filter, `limit` truncates (which
// is how a test makes fieldd's `clipped` true), and a readiness that is not
// `ready`/`catching-up` WITHHOLDS every hit — rosetta returns the state
// explicitly rather than serving an empty success, and fieldd must answer
// `answered: false` over it. A hit is passed through as written, so a
// deliberately malformed one reaches fieldd's parser.
//
// DS-6: `/ws/meta` — rosetta's topology stream as it is at the pin (d3cf325,
// crates/server/src/ws.rs run_meta_stream): `{frame:"hello"}`, ONE
// `{frame:"meta_snapshot", runtimes, projects, sessions}` of the whole mirror
// (children included), then unstamped `{frame:"mutation", mutation:{type, …row}}`
// frames carrying FULL rows of type session | project | runtime. The scripted
// files are polled while a meta socket is open and every row that CHANGED is
// sent as a mutation; a row that DISAPPEARS is sent as nothing at all — the
// real surface "has no removal event" (store/src/hot.rs refresh_meta), and
// the follower must find the removal by diffing a fresh snapshot.
// FAKE_ROSETTAD_PROJECTS scripts `/api/projects` and the stream's project rows
// (`git_repo` included); unset, projects are derived from the session rows as
// before (git_repo null). FAKE_ROSETTAD_META_CONTROL is a JSON file polled the
// same way: `{"resync": n}` sends `{frame:"resync"}` + a fresh snapshot each
// time n changes (the barrier a subscriber 1,024 items behind gets), and
// `{"drop": n}` closes every meta socket each time n changes (a daemon that
// dropped the stream). The upgrade answers with the protocol header, and a
// browser Origin that is not loopback is refused 403, as the real guard does.
// Bare `/api/sessions` answers the ROOTS (no parent) newest first, 100 by
// default, and every list clamps its limit to rosetta's 1..1,000.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@rosetta/protocol/protocol-version";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const mode = process.env.FAKE_ROSETTAD_MODE ?? "ok";
const announceDir = args.includes("--announce") ? flag("--announce-dir") : undefined;
const db = flag("--db");
const enrollPath = flag("--enroll");
const protocol = Number(process.env.FAKE_ROSETTAD_PROTOCOL ?? PROTOCOL_VERSION);
// the real daemon prints `ready` BEFORE it walks the roots: its census (the
// roll call) is empty and its ingest phase `discovering` until the walk ends.
// This knob reproduces that window for as many milliseconds as it says.
const censusDelayMs = Number(process.env.FAKE_ROSETTAD_CENSUS_DELAY_MS ?? "0");

if (mode === "crash-on-start") {
  process.stderr.write("fake rosettad: refusing to start (scripted)\n");
  process.exit(2);
}

// --enroll: rosetta's refusals, mirrored (a refused file never binds)
const INSTALLED = new Set(["claude-code"]);
const KNOWN = new Set(["claude-code", "codex", "copilot", "pi", "opencode", "kimi-code", "grok"]);
let enrollment = { format: 1, enabled_kinds: [], runtimes: [] };
if (enrollPath !== undefined) {
  let text;
  try {
    text = readFileSync(enrollPath, "utf8");
  } catch (error) {
    process.stderr.write(`reading --enroll ${enrollPath}: ${error.message}\n`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    process.stderr.write(`--enroll ${enrollPath}: not a valid enrollment file: ${error.message}\n`);
    process.exit(2);
  }
  if (parsed.format !== 1) {
    process.stderr.write(
      `--enroll ${enrollPath}: unsupported enrollment format ${parsed.format}\n`,
    );
    process.exit(2);
  }
  const runtimes = Array.isArray(parsed.runtimes) ? parsed.runtimes : [];
  runtimes.forEach((spec, i) => {
    // the real daemon's shape: main.rs prints every top-level error as
    // `rosettad: <message>`, and the message begins `--enroll <file>: …`
    const entry = (message) =>
      `rosettad: --enroll ${enrollPath}: runtime #${i + 1} (kind ${JSON.stringify(spec.kind)}, data_root ${JSON.stringify(spec.data_root)}): ${message}\n`;
    if (!KNOWN.has(spec.kind)) {
      process.stderr.write(entry("unknown agent kind"));
      process.exit(2);
    }
    if (typeof spec.data_root !== "string" || !spec.data_root.startsWith("/")) {
      process.stderr.write(entry("data_root must be an absolute path (`~` forms are refused)"));
      process.exit(2);
    }
    if (!existsSync(spec.data_root) || !statSync(spec.data_root).isDirectory()) {
      process.stderr.write(entry("data_root is not a directory"));
      process.exit(2);
    }
  });
  enrollment = {
    format: 1,
    enabled_kinds: Array.isArray(parsed.enabled_kinds) ? parsed.enabled_kinds : [],
    runtimes,
  };
}
const consentedKinds = enrollment.enabled_kinds.filter((k) => INSTALLED.has(k));
const enrolledRows = enrollment.runtimes.map((spec, i) => ({
  id: `rt-${spec.kind}-enrolled-${i + 1}`,
  kind: spec.kind,
  data_root: spec.data_root,
  enabled: true,
  account: null,
  config: null,
  skills: null,
  versions_seen: null,
  discovered_at: 1,
  ...(spec.label !== undefined ? { label: spec.label } : {}),
  provenance: "enrolled",
}));
const discoveredRows = consentedKinds.map((kind) => ({
  id: `rt-${kind}-native`,
  kind,
  data_root: `~/.${kind === "claude-code" ? "claude" : kind}`,
  enabled: true,
  account: null,
  config: null,
  skills: null,
  versions_seen: null,
  discovered_at: 1,
}));
const phase = consentedKinds.length + enrolledRows.length === 0 ? "awaiting_consent" : "live";
const backfill = (row) => ({
  kind: row.kind,
  runtime_id: row.id,
  label: row.label ?? null,
  state: "done",
  files_total: 3,
  bytes_total: 300,
  files_skimmed: 3,
  bytes_streamed: 300,
  sessions_total: 1,
  records: 7,
});
const live = (row) => ({
  kind: row.kind,
  runtime_id: row.id,
  label: row.label ?? null,
  ticks: 1,
  events: 2,
  polls: 3,
  rescans: 0,
  admissions: 0,
  live_rows: 4,
  last_activity_ms: 1_700_000_000_000,
});
const json = (res, body) => {
  res.setHeader("x-rosetta-protocol-version", String(protocol));
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** a JSON file re-read per request (undefined when unset or unreadable) */
const scripted = (name, fallback) => {
  const file = process.env[name];
  if (file === undefined || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const sessionRows = () => {
  const rows = scripted("FAKE_ROSETTAD_SESSIONS", []);
  return Array.isArray(rows) ? rows : [];
};
/** AR-5e — the scripted search answer, with the real server's defaults */
const searchScript = () => {
  const script = scripted("FAKE_ROSETTAD_SEARCH", {});
  const source = script !== null && typeof script === "object" ? script : {};
  return {
    readiness: typeof source.readiness === "string" ? source.readiness : "ready",
    canonicalReady: source.canonical_ready !== false,
    progress: source.progress ?? null,
    hits: Array.isArray(source.hits) ? source.hits : [],
  };
};
const logRequest = (url) => {
  const log = process.env.FAKE_ROSETTAD_REQUEST_LOG;
  if (log === undefined) return;
  try {
    appendFileSync(log, `${Date.now()} ${url}\n`);
  } catch {
    // a counter that cannot be written is not worth failing a request over
  }
};

/** DS-6 — the project rows: scripted (with `git_repo`), or derived from the
 * session rows the way the first QL fake did (a project rooted at its first
 * session's cwd, no remote) */
const projectRows = () => {
  const scriptedProjects = scripted("FAKE_ROSETTAD_PROJECTS", undefined);
  if (Array.isArray(scriptedProjects)) return scriptedProjects;
  const projects = new Map();
  for (const row of sessionRows()) {
    if (typeof row.project_id !== "string" || projects.has(row.project_id)) continue;
    const root = typeof row.cwd === "string" ? row.cwd : `/${row.project_id}`;
    projects.set(row.project_id, {
      id: row.project_id,
      name: root.split("/").filter(Boolean).at(-1) ?? row.project_id,
      root_paths: [root],
      git_repo: null,
    });
  }
  return [...projects.values()];
};
/** rosetta's `clamp_limit`: absent → the default, else 1..MAX_LIMIT */
const clampLimit = (raw, fallback) => {
  const value = raw === null ? fallback : Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 1_000) : fallback;
};
/** `SessionRow::compare_recent`: activity.last_at descending (none last), id */
const rootsNewestFirst = (rows) =>
  rows
    .filter((row) => (row.parent_session_id ?? null) === null)
    .sort((a, b) => {
      const at = (row) => (row.activity ? row.activity.last_at : Number.NEGATIVE_INFINITY);
      return at(b) - at(a) || String(a.id).localeCompare(String(b.id));
    });

if (mode === "silent") {
  setInterval(() => {}, 1_000);
} else {
  // a real loopback HTTP listener, so the origin is a port the OS actually
  // gave us and the status probe answers like the real server
  const startedAt = Date.now();
  const censusPublished = () => Date.now() - startedAt >= censusDelayMs;
  const runtimeRows = () => {
    const extraRuntimes = scripted("FAKE_ROSETTAD_RUNTIMES", []);
    return [
      ...discoveredRows,
      ...enrolledRows,
      ...(Array.isArray(extraRuntimes) ? extraRuntimes : []),
    ];
  };
  const server = createServer((req, res) => {
    const rows = runtimeRows();
    if (req.url === "/api/status") {
      const search = searchScript();
      json(res, {
        protocol_version: protocol,
        schema_version: 1,
        canonical_ready: search.canonicalReady,
        // AR-5e — the REAL `SearchState` shape (it used to be the string
        // "ready" here, which no client's reader could fold)
        search: {
          readiness: search.readiness,
          progress: search.progress,
          projection_epoch: "epoch-1",
          revision: 42,
        },
        daemon: {
          started_at: startedAt,
          uptime_ms: Date.now() - startedAt,
          runtimes: rows.map(live),
          hub: {
            subscribers: 0,
            rings: 0,
            session_mutations: 0,
            meta_events: 0,
            resyncs: 0,
            rings_evicted: 0,
            overflow_rewarms: 0,
          },
          ingest: {
            phase: censusPublished() ? phase : "discovering",
            runtimes: rows.map(backfill),
            projects: [],
          },
        },
      });
      return;
    }
    if (req.url === "/api/discoveries") {
      if (!censusPublished()) {
        json(res, { discoveries: [] });
        return;
      }
      json(res, {
        discoveries: [
          {
            kind: "claude-code",
            data_root: "~/.claude",
            installed: true,
            files: 3,
            bytes: 300,
            newest_modified_ms: 1_700_000_000_000,
            enabled: consentedKinds.includes("claude-code"),
          },
          {
            kind: "codex",
            data_root: "~/.codex",
            installed: false,
            files: 0,
            bytes: 0,
            newest_modified_ms: 0,
            enabled: false,
          },
        ],
      });
      return;
    }
    if (req.url === "/api/runtimes") {
      json(res, { runtimes: rows });
      return;
    }
    if (req.url === "/api/projects") {
      logRequest(req.url);
      json(res, { projects: projectRows() });
      return;
    }
    // DS-6 — rosetta's bare list: the ROOTS, newest activity first
    if (req.url === "/api/sessions") {
      logRequest(req.url);
      json(res, { sessions: rootsNewestFirst(sessionRows()).slice(0, 100) });
      return;
    }
    if (req.url !== undefined && req.url.startsWith("/api/sessions?")) {
      logRequest(req.url);
      const url = new URL(req.url, "http://127.0.0.1");
      const wanted = (url.searchParams.get("native_session_id") ?? "")
        .split(",")
        .filter((id) => id !== "");
      const project = url.searchParams.get("project");
      const limit = clampLimit(url.searchParams.get("limit"), 100);
      const sessions = sessionRows().filter(
        (row) =>
          (wanted.length === 0 || wanted.includes(row.native_session_id)) &&
          (project === null || row.project_id === project),
      );
      json(res, { sessions: Number.isFinite(limit) ? sessions.slice(0, limit) : sessions });
      return;
    }
    // AR-5e — one session by canonical id: how a hit inside a delegated child
    // is walked up to the root a reader navigates to. An id the index does not
    // hold is a 404, exactly as the real server answers it.
    if (req.url !== undefined && req.url.startsWith("/api/sessions/")) {
      logRequest(req.url);
      const id = decodeURIComponent(req.url.slice("/api/sessions/".length).split("?")[0]);
      const row = sessionRows().find((candidate) => candidate.id === id);
      if (row === undefined) {
        res.statusCode = 404;
        res.setHeader("x-rosetta-protocol-version", String(protocol));
        res.end(JSON.stringify({ error: { message: `no session ${id}` } }));
        return;
      }
      json(res, { session: row });
      return;
    }
    // AR-5e — the find sheet's question
    if (req.url !== undefined && req.url.startsWith("/api/search")) {
      logRequest(req.url);
      const url = new URL(req.url, "http://127.0.0.1");
      const script = searchScript();
      const answers = script.readiness === "ready" || script.readiness === "catching-up";
      const state = {
        readiness: script.readiness,
        progress: script.progress,
        projection_epoch: "epoch-1",
        revision: 42,
      };
      if (!answers) {
        // rosetta reports the state explicitly; it never serves an empty success
        json(res, { state, hits: [] });
        return;
      }
      // `sessions=` names ROOTS; the real server widens each to every session
      // that rolls up to it before the backend sees the scope, so a hit inside
      // a delegated child answers for the root the reader named
      const named = (url.searchParams.get("sessions") ?? "").split(",").filter((id) => id !== "");
      const scope =
        named.length === 0
          ? named
          : [
              ...new Set([
                ...named,
                ...sessionRows()
                  .filter((row) => named.includes(row.root_session_id))
                  .map((row) => row.id),
              ]),
            ];
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const kind = url.searchParams.get("kind");
      const afterTs = url.searchParams.get("after_ts");
      const limit = clampLimit(url.searchParams.get("limit"), 300);
      const hits = script.hits.filter((hit) => {
        if (scope.length > 0 && !scope.includes(hit.session_id)) return false;
        if (
          q !== "" &&
          !String(hit.snippet ?? "")
            .toLowerCase()
            .includes(q)
        )
          return false;
        if (kind !== null && hit.kind !== kind) return false;
        if (afterTs !== null && Number(hit.at ?? 0) < Number(afterTs)) return false;
        return true;
      });
      // truncation is how a test makes fieldd's `clipped` true
      json(res, { state, hits: Number.isFinite(limit) ? hits.slice(0, limit) : hits });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  // DS-6 — `/ws/meta`, the topology stream (see the header)
  const metaSockets = new Set();
  // the WebSocket server loads on the FIRST upgrade: a test that never opens
  // the stream (the supervisor's kill matrix) starts the fake as fast as ever
  let wss = null;
  const metaServer = async () => {
    if (wss === null) {
      const { WebSocketServer } = await import("ws");
      wss = new WebSocketServer({ noServer: true });
      wss.on("headers", (headers) => headers.push(`x-rosetta-protocol-version: ${protocol}`));
    }
    return wss;
  };
  const mirror = () => ({
    runtimes: runtimeRows(),
    projects: projectRows(),
    sessions: sessionRows(),
  });
  const metaSnapshot = () => ({ frame: "meta_snapshot", ...mirror() });
  /** `type:id` → the row's JSON as last broadcast */
  let lastMirror = new Map();
  const keyed = (state) => {
    const out = new Map();
    for (const [type, list] of [
      ["runtime", state.runtimes],
      ["project", state.projects],
      ["session", state.sessions],
    ]) {
      for (const row of list) {
        if (row !== null && typeof row === "object" && typeof row.id === "string") {
          out.set(`${type}:${row.id}`, { type, row, json: JSON.stringify(row) });
        }
      }
    }
    return out;
  };
  let control = { resync: undefined, drop: undefined };
  const readControl = () => {
    const next = scripted("FAKE_ROSETTAD_META_CONTROL", {});
    return next !== null && typeof next === "object" ? next : {};
  };
  control = { ...readControl() };
  setInterval(() => {
    if (metaSockets.size === 0) return;
    const now = keyed(mirror());
    for (const [key, entry] of now) {
      if (lastMirror.get(key)?.json === entry.json) continue;
      // a CHANGED or NEW row: its full self, unstamped (rosetta's meta stream)
      const frame = JSON.stringify({
        frame: "mutation",
        stamp: null,
        mutation: { type: entry.type, ...entry.row },
      });
      for (const ws of metaSockets) ws.send(frame);
    }
    // a row that disappeared is sent as NOTHING — there is no removal event
    lastMirror = now;
    const next = readControl();
    if (next.resync !== undefined && next.resync !== control.resync) {
      for (const ws of metaSockets) {
        ws.send(JSON.stringify({ frame: "resync" }));
        ws.send(JSON.stringify(metaSnapshot()));
      }
    }
    if (next.drop !== undefined && next.drop !== control.drop) {
      for (const ws of metaSockets) ws.close(1011, "scripted drop");
    }
    control = { ...next };
  }, 40).unref();
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/meta") {
      socket.destroy();
      return;
    }
    // rosetta's `require_local_origin`: a native client sends no Origin; a
    // browser's must be loopback
    const origin = req.headers.origin;
    if (
      origin !== undefined &&
      !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    // the stream is a socket, not a READ: it never enters the request log
    // (a test that counts the reads a door made must not count the follower)
    void metaServer().then((meta) =>
      meta.handleUpgrade(req, socket, head, (ws) => {
        const state = mirror();
        ws.send(JSON.stringify({ frame: "hello", protocol_version: protocol, stamp: null }));
        ws.send(JSON.stringify({ frame: "meta_snapshot", ...state }));
        if (metaSockets.size === 0) lastMirror = keyed(state);
        metaSockets.add(ws);
        ws.on("close", () => metaSockets.delete(ws));
        ws.on("error", () => metaSockets.delete(ws));
      }),
    );
  });

  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    let announce = null;
    if (announceDir !== undefined) {
      mkdirSync(announceDir, { recursive: true });
      announce = join(announceDir, `${process.pid}.json`);
      writeFileSync(
        announce,
        `${JSON.stringify({
          schema: "rosetta-daemon/1",
          origin: `http://127.0.0.1:${port}`,
          pid: process.pid,
          protocol_version: protocol,
          db,
          started_at: Date.now(),
        })}\n`,
      );
    }
    const origin =
      mode === "bad-origin" ? `http://example.com:${port}` : `http://127.0.0.1:${port}`;
    const ready = {
      event: "ready",
      origin,
      protocol_version: mode === "wrong-protocol" ? 1 : protocol,
      ...(announce !== null ? { announce } : {}),
    };
    process.stdout.write(`${JSON.stringify(ready)}\n`);
    if (phase === "awaiting_consent") {
      process.stdout.write("no enrolled agents — choose in the app (or pass --all-agents)\n");
    }
    const cleanup = () => {
      if (announce !== null) rmSync(announce, { force: true });
    };
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    if (mode === "crash-after-ready") {
      setTimeout(() => {
        // a crash keeps its announce file behind, exactly like a real SIGKILL
        process.stderr.write("fake rosettad: simulated crash after ready\n");
        process.exit(3);
      }, 60);
    }
  });
}
