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
// `/api/sessions` request: a window in which the fold did NOT change is only
// evidence if the poller actually ASKED during it, and this is the counter a
// test reads to say so.
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

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const mode = process.env.FAKE_ROSETTAD_MODE ?? "ok";
const announceDir = args.includes("--announce") ? flag("--announce-dir") : undefined;
const db = flag("--db");
const enrollPath = flag("--enroll");
const protocol = Number(process.env.FAKE_ROSETTAD_PROTOCOL ?? "20");

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
    const entry = (message) =>
      `--enroll ${enrollPath}: runtime #${i + 1} (kind ${JSON.stringify(spec.kind)}, data_root ${JSON.stringify(spec.data_root)}): ${message}\n`;
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

if (mode === "silent") {
  setInterval(() => {}, 1_000);
} else {
  // a real loopback HTTP listener, so the origin is a port the OS actually
  // gave us and the status probe answers like the real server
  const startedAt = Date.now();
  const server = createServer((req, res) => {
    const rows = [...discoveredRows, ...enrolledRows];
    if (req.url === "/api/status") {
      json(res, {
        protocol_version: protocol,
        schema_version: 1,
        canonical_ready: true,
        search: "ready",
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
          ingest: { phase, runtimes: rows.map(backfill), projects: [] },
        },
      });
      return;
    }
    if (req.url === "/api/discoveries") {
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
    if (req.url !== undefined && req.url.startsWith("/api/sessions?")) {
      const log = process.env.FAKE_ROSETTAD_REQUEST_LOG;
      if (log !== undefined) {
        try {
          appendFileSync(log, `${Date.now()} ${req.url}\n`);
        } catch {
          // a counter that cannot be written is not worth failing a request over
        }
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const wanted = (url.searchParams.get("native_session_id") ?? "")
        .split(",")
        .filter((id) => id !== "");
      let sessions = [];
      const file = process.env.FAKE_ROSETTAD_SESSIONS;
      if (file !== undefined && existsSync(file)) {
        try {
          sessions = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          sessions = [];
        }
      }
      json(res, {
        sessions: sessions.filter(
          (row) => wanted.length === 0 || wanted.includes(row.native_session_id),
        ),
      });
      return;
    }
    res.statusCode = 404;
    res.end();
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
