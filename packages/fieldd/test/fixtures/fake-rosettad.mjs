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
//   no-auth            ready, but the line says nothing about access (pre-RO-1)
//   old-binary         `rosettad: unknown flag --token-file`, exit 2 (pre-RO-1)
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
//
// AR-8b — ACCESS CONTROL, as the pin's daemon has it (rosetta docs/AUTH.md,
// `ee6724e`): `--token-file F` requires a credential on every route and every
// upgrade; `--grant-key-file K` (only beside a token) admits a grant on the
// session routes and the assets — never the lists, search, `/ws/meta` or the
// aggregates; `--allow-origin O` adds browser origins. RO-13 (2026-10-04,
// rosetta main `856bd80`): the session's recorded-file read
// (`/api/sessions/{id}/timeline/{t}/read/{n}`) admits a grant for its session
// that carries `files` beside `read` — a read grant there is `wrong-scope` —
// and, the scripted index recording no file, answers rosetta's honest 404. The
// files are read ONCE before binding and refused (stderr + exit 2) the way
// rosetta refuses them: a token outside 32..1,024 visible ASCII, a key under
// 32 bytes, a key without a token, any group/other permission bit. The ready
// line carries `auth: {bearer, grants, origins}`; with no flags the daemon is
// open, as before (the catalog's own rows spawn it that way). A refusal is a 401 with
// `x-rosetta-auth: <reason>` beside the protocol header, which is how a test
// tells "wrong credential" from "wrong daemon"; FAKE_ROSETTAD_AUTH_LOG names a
// file that gets one line per decision (`<METHOD> <path> <credential> <verdict>`,
// never the credential itself). Grants verify with `@rosetta/protocol/grants`.
// Modes: `no-auth` (a ready line with no `auth` — a daemon from before RO-1),
// `old-binary` (`rosettad: unknown flag --token-file` and exit 2, as an older
// binary answers the flag).
//
// AR-8b — the project aggregates `index.project` and `index.projectDay` fold:
// `/api/projects/{id}/heatmap|usage|contribution` and `…/usage/day?day=…`,
// scripted by FAKE_ROSETTAD_AGGREGATES (a JSON file re-read per request:
// `{heatmap, usage, contribution, day_usage}` bodies, each optional with a
// golden-shaped default, and `status` — e.g. 503 — to answer every aggregate
// with). And `/ws/sessions/{id}`: a session socket that opens (a `hello` frame,
// then a `snapshot`) once the upgrade passes the Origin rule and the credential.
//
// TL (protocol 27) — `/api/activity?since_ms&until_ms[&gap_ms][&sessions][&limit]`,
// bearer-only like the aggregates: the scripted ROOT sessions whose activity
// touches the window, newest first, each with the turns FAKE_ROSETTAD_ACTIVITY
// scripts for it (a JSON file re-read per request: `{turns: {<session id>:
// TurnSpan[]}, withheld?: string[], truncated?: boolean, status?: number}` —
// `status` answers every ask with it, e.g. 404 for a daemon without the
// route). A window that holds no time is the route's own 400.
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
import { verifyGrant } from "@rosetta/protocol/grants";
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

// AR-8b — the access flags, read once before binding (AUTH.md §4)
const tokenPath = flag("--token-file");
const grantKeyPath = flag("--grant-key-file");
const allowOrigins = args.flatMap((arg, at) =>
  arg === "--allow-origin" && args[at + 1] !== undefined ? [args[at + 1].toLowerCase()] : [],
);
if (mode === "old-binary" && tokenPath !== undefined) {
  // an older daemon's own words for a flag it does not know (main.rs)
  process.stderr.write("rosettad: unknown flag --token-file\n");
  process.exit(2);
}
/** rosetta's file rule: a regular file, at most 4 KiB, owner-only on Unix */
const readSecretFile = (path, what) => {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    process.stderr.write(`rosettad: reading ${what} ${path}: ${error.message}\n`);
    process.exit(2);
  }
  if (!stat.isFile() || stat.size > 4096) {
    process.stderr.write(`rosettad: ${what} ${path} is not a regular file of at most 4 KiB\n`);
    process.exit(2);
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    process.stderr.write(
      `rosettad: ${what} ${path} is readable by others (mode ${(stat.mode & 0o777).toString(8)}); chmod 600 it\n`,
    );
    process.exit(2);
  }
  return readFileSync(path);
};
let bearer = null;
let grantKey = null;
if (tokenPath !== undefined) {
  const token = readSecretFile(tokenPath, "--token-file").toString("latin1").trim();
  if (!/^[\x21-\x7e]{32,1024}$/.test(token)) {
    process.stderr.write("rosettad: --token-file must hold 32 to 1024 visible ASCII characters\n");
    process.exit(2);
  }
  bearer = token;
}
if (grantKeyPath !== undefined) {
  if (bearer === null) {
    process.stderr.write("rosettad: a grant key needs a bearer token\n");
    process.exit(2);
  }
  const key = readSecretFile(grantKeyPath, "--grant-key-file");
  if (key.length < 32) {
    process.stderr.write(
      `rosettad: the grant key is ${key.length} bytes; at least 32 are required\n`,
    );
    process.exit(2);
  }
  grantKey = new Uint8Array(key);
}
/** AUTH.md §5.4 — what a grant opens, by route: the session's own routes (the
 * id the grant's `sid`) and the assets; everything else needs the bearer.
 * RO-13: the recorded-file read is its session's route that also needs
 * `files` (it reads the disk NOW, which is more than the transcript). */
const FILE_READ = /^\/api\/sessions\/[^/?]+\/timeline\/[^/?]+\/read\/[^/?]+$/;
const grantRoute = (method, path) => {
  if (method !== "GET" && method !== "HEAD") return null;
  const session = /^\/(?:ws\/sessions|ws\/collaboration|api\/sessions)\/([^/?]+)(?:\/[^?]*)?$/.exec(
    path,
  );
  if (session !== null) return { sid: decodeURIComponent(session[1]), files: FILE_READ.test(path) };
  if (/^\/api\/assets\/[^/?]+$/.test(path)) return { sid: null, files: false };
  return null;
};
const authLog = (line) => {
  const log = process.env.FAKE_ROSETTAD_AUTH_LOG;
  if (log === undefined) return;
  try {
    appendFileSync(log, `${line}\n`);
  } catch {
    // a decision log that cannot be written is not worth a refusal
  }
};
/** One request's credential decision: null = admitted, else the 401 reason.
 * `carrier` is the Authorization header, else the WebSocket subprotocol pair. */
const credentialRefusal = (method, rawUrl, headers) => {
  const path = (rawUrl ?? "/").split("?")[0];
  if (bearer === null) return null;
  let scheme = null;
  let value = null;
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.trim() !== "") {
    const match = /^(\S+)\s+(\S+)$/.exec(authorization.trim());
    if (match === null) return "malformed";
    scheme = match[1].toLowerCase();
    value = match[2];
  } else if (typeof headers["sec-websocket-protocol"] === "string") {
    const offered = headers["sec-websocket-protocol"].split(",").map((p) => p.trim());
    const entries = offered.filter((p) => p.startsWith("rosetta."));
    if (entries.length > 1) return "malformed";
    if (entries.length === 1) {
      if (entries[0].startsWith("rosetta.bearer.")) {
        scheme = "bearer";
        value = Buffer.from(entries[0].slice("rosetta.bearer.".length), "base64url").toString();
      } else if (entries[0].startsWith("rosetta.grant.")) {
        scheme = "rosetta-grant";
        value = entries[0].slice("rosetta.grant.".length);
      } else return "malformed";
    }
  }
  const decide = (credential, verdict) => {
    authLog(`${method} ${path} ${credential} ${verdict}`);
    return verdict === "ok" ? null : verdict;
  };
  if (scheme === null) return decide("none", "missing");
  if (scheme === "bearer") return decide("bearer", value === bearer ? "ok" : "bad-token");
  if (scheme !== "rosetta-grant") return decide("unknown", "malformed");
  if (grantKey === null) return decide("grant", "grants-disabled");
  const route = grantRoute(method, path);
  if (route === null) return decide("grant", "wrong-route");
  const verdict = verifyGrant(grantKey, value, Date.now());
  if (!verdict.ok) return decide("grant", verdict.reason);
  if (route.sid !== null && verdict.claims.sid !== route.sid)
    return decide("grant", "wrong-session");
  if (
    !verdict.claims.scope.includes("read") ||
    (route.files && !verdict.claims.scope.includes("files"))
  )
    return decide("grant", "wrong-scope");
  return decide("grant", "ok");
};
/** the 401 rosetta answers (AUTH.md §6) */
const refuse = (res, reason) => {
  res.statusCode = 401;
  res.setHeader("x-rosetta-protocol-version", String(protocol));
  res.setHeader("x-rosetta-auth", reason);
  res.setHeader(
    "www-authenticate",
    grantKey !== null
      ? 'Bearer realm="rosetta", Rosetta-Grant realm="rosetta"'
      : 'Bearer realm="rosetta"',
  );
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "text/plain");
  res.end(`rosetta: unauthorized (${reason})`);
};
/** the Origin rule (AUTH.md §2): loopback any port, the app shells, the extras */
const originAllowed = (origin) =>
  origin === undefined ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ||
  origin === "tauri://localhost" ||
  origin === "rosetta://app" ||
  allowOrigins.includes(origin.toLowerCase());

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
// SP-6 — the timeline: rosetta `TimelineEntry` rows for any session, scripted
// by FAKE_ROSETTAD_TIMELINE (a JSON array re-read per request and per poll),
// filtered by `session_id` and ordered by `ordinal`. FAKE_ROSETTAD_TIMELINE_CONTROL
// scripts the projection's generation: `{watermark}` (every page and the
// socket's snapshot carry it; a cursor minted under another one is 410
// `cursor_expired`, as the real server answers a rewrite), `{resync: n}` (a
// change sends `resync` then a fresh `timeline_snapshot` on every open session
// socket — rosetta's barrier), `{drop: n}` (a change closes every session
// socket, 1011 — a daemon that went away mid-stream).
const timelineRows = (sessionId) => {
  const rows = scripted("FAKE_ROSETTAD_TIMELINE", []);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row !== null && typeof row === "object" && row.session_id === sessionId)
    .sort(
      (a, b) => a.ordinal - b.ordinal || String(a.timeline_id).localeCompare(String(b.timeline_id)),
    );
};
const timelineControl = () => {
  const control = scripted("FAKE_ROSETTAD_TIMELINE_CONTROL", {});
  return control !== null && typeof control === "object" ? control : {};
};
const timelineWatermark = () => {
  const control = timelineControl();
  return typeof control.watermark === "string" ? control.watermark : "w-1";
};
/** rosetta's `read_timeline_page`: the newest `limit` rows before `before`,
 * oldest first within the page; a cursor to the next older page when the page
 * filled; the cursor's spelling is the server's own JSON */
const timelinePage = (sessionId, limit, before) => {
  const watermark = timelineWatermark();
  const rows = timelineRows(sessionId).filter((row) => before === null || row.ordinal < before);
  const entries = rows.slice(Math.max(0, rows.length - limit));
  const cursor =
    entries.length === limit && entries.length > 0
      ? JSON.stringify({ session_id: sessionId, before: entries[0].ordinal, watermark })
      : null;
  return { entries, cursor, watermark };
};
const SNAPSHOT_LIMIT = 200;
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
    // AR-8b — the credential first, on every route (CORS preflights aside,
    // which no native client sends): a 401 still carries the protocol header
    const refused = credentialRefusal(req.method ?? "GET", req.url, req.headers);
    if (refused !== null) {
      refuse(res, refused);
      return;
    }
    const rows = runtimeRows();
    // AR-8b — the project aggregates (bearer-only upstream)
    const aggregate =
      req.url === undefined
        ? null
        : /^\/api\/projects\/([^/?]+)\/(heatmap|usage|contribution|usage\/day)(?:\?.*)?$/.exec(
            req.url,
          );
    if (aggregate !== null) {
      logRequest(req.url);
      const script = scripted("FAKE_ROSETTAD_AGGREGATES", {});
      const source = script !== null && typeof script === "object" ? script : {};
      if (typeof source.status === "number" && source.status !== 200) {
        res.statusCode = source.status;
        res.setHeader("x-rosetta-protocol-version", String(protocol));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: "not_ready", message: "scripted" }));
        return;
      }
      const figures = {
        tokens: 123,
        cost_micro_usd: 4210,
        billed_micro_usd: null,
        unpriced_tokens: 23,
        unrecorded_output: 0,
        reported_cost_adjustment_micro_usd: 0,
      };
      const url = new URL(req.url, "http://127.0.0.1");
      const route = aggregate[2];
      if (route === "heatmap") {
        json(res, source.heatmap ?? { days: [{ day: "2026-08-26", ...figures }] });
      } else if (route === "usage") {
        json(
          res,
          source.usage ?? {
            models: [{ day: "2026-08-26", model: "claude-opus-5", ...figures }],
            hours: [{ hour: 15, ...figures }],
          },
        );
      } else if (route === "contribution") {
        json(
          res,
          source.contribution ?? {
            rows: [
              {
                session_id: "s1",
                project_id: decodeURIComponent(aggregate[1]),
                commits: 1,
                edits: 2,
                loc: 30,
                messages: 41,
                ...figures,
              },
            ],
          },
        );
      } else {
        const day = url.searchParams.get("day") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          res.statusCode = 400;
          res.setHeader("x-rosetta-protocol-version", String(protocol));
          res.end(JSON.stringify({ code: "bad_request", message: "Expected a YYYY-MM-DD date" }));
          return;
        }
        json(
          res,
          source.day_usage ?? {
            day,
            models: [{ hour: 16, model: "claude-opus-5-5", tokens: 123 }],
          },
        );
      }
      return;
    }
    // TL (protocol 27) — the activity route (see the header)
    if (req.url !== undefined && /^\/api\/activity(?:\?.*)?$/.test(req.url)) {
      logRequest(req.url);
      const script = scripted("FAKE_ROSETTAD_ACTIVITY", {});
      const source = script !== null && typeof script === "object" ? script : {};
      if (typeof source.status === "number" && source.status !== 200) {
        res.statusCode = source.status;
        res.setHeader("x-rosetta-protocol-version", String(protocol));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { code: "not_found", message: "scripted" } }));
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const since = Number(url.searchParams.get("since_ms"));
      const until = Number(url.searchParams.get("until_ms") ?? Date.now());
      const gap = Number(url.searchParams.get("gap_ms") ?? 900_000);
      if (!Number.isFinite(since) || !(until > since)) {
        res.statusCode = 400;
        res.setHeader("x-rosetta-protocol-version", String(protocol));
        res.end(JSON.stringify({ error: { code: "bad_request", message: "bad window" } }));
        return;
      }
      const named = url.searchParams.get("sessions")?.split(",");
      const turns = source.turns !== null && typeof source.turns === "object" ? source.turns : {};
      const withheld = Array.isArray(source.withheld) ? source.withheld : [];
      const sessions = sessionRows()
        .filter((row) => row.parent_session_id === null || row.parent_session_id === undefined)
        .filter((row) => named === undefined || named.includes(row.id))
        .filter(
          (row) => row.activity && row.activity.last_at >= since && row.activity.first_at <= until,
        )
        .sort((a, b) => b.activity.last_at - a.activity.last_at)
        .map((row) => ({
          session: row,
          turns: withheld.includes(row.id) ? [] : (turns[row.id] ?? []),
          turns_withheld: withheld.includes(row.id),
        }));
      json(res, {
        since_ms: since,
        until_ms: until,
        gap_ms: gap,
        sessions,
        truncated: source.truncated === true,
      });
      return;
    }
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
    // RO-13 — the recorded-file read, past the credential: the scripted index
    // records no file, so every target is rosetta's own 404 for a row with no
    // openable file (crates/server/src/http.rs `read_file_target`)
    if (req.url !== undefined && FILE_READ.test(req.url.split("?")[0])) {
      logRequest(req.url);
      res.statusCode = 404;
      res.setHeader("x-rosetta-protocol-version", String(protocol));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: { code: "not_found", message: "no file at that recorded target" },
        }),
      );
      return;
    }
    // SP-6 — one backward page of a session's timeline, as the real server
    // pages it: `limit` clamped 1..1000 (default 100), `cursor` the previous
    // page's own (its session and watermark must match, else 410
    // `cursor_expired`), a 404 for a session the index does not hold
    const timelineRoute =
      req.url === undefined
        ? null
        : /^\/api\/sessions\/([^/?]+)\/timeline(?:\?(.*))?$/.exec(req.url);
    if (timelineRoute !== null) {
      logRequest(req.url);
      const id = decodeURIComponent(timelineRoute[1]);
      if (sessionRows().find((candidate) => candidate.id === id) === undefined) {
        res.statusCode = 404;
        res.setHeader("x-rosetta-protocol-version", String(protocol));
        res.end(JSON.stringify({ error: { code: "not_found", message: `no session ${id}` } }));
        return;
      }
      const query = new URLSearchParams(timelineRoute[2] ?? "");
      const limit = clampLimit(query.get("limit"), 100);
      let before = null;
      const cursor = query.get("cursor");
      if (cursor !== null) {
        let decoded = null;
        try {
          decoded = JSON.parse(cursor);
        } catch {
          decoded = null;
        }
        if (
          decoded === null ||
          decoded.session_id !== id ||
          decoded.watermark !== timelineWatermark() ||
          typeof decoded.before !== "number"
        ) {
          res.statusCode = 410;
          res.setHeader("x-rosetta-protocol-version", String(protocol));
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                code: "cursor_expired",
                message: "the timeline was rewritten; refetch from the head",
              },
            }),
          );
          return;
        }
        before = decoded.before;
      }
      json(res, timelinePage(id, limit, before));
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
  // SP-6 — the session sockets' ring identity; a scripted resync moves it
  let sessionEpoch = 1;
  // SP-6 — while the timeline control is scripted, each session socket's own
  // events (opened, with the control it read; resync fired; drop fired; a send
  // that failed; closed) are request-log lines under a `ws ` prefix: what the
  // fake SENT, so a frame a test never saw is placed on one side of the socket
  // or the other. The prefix keeps them apart from the reads a test counts.
  let sessionSockets = 0;
  const logSocket = (event) => {
    if (process.env.FAKE_ROSETTAD_TIMELINE_CONTROL !== undefined) logRequest(`ws ${event}`);
  };
  // the WebSocket server loads on the FIRST upgrade: a test that never opens
  // the stream (the supervisor's kill matrix) starts the fake as fast as ever
  let wss = null;
  const metaServer = async () => {
    if (wss === null) {
      const { WebSocketServer } = await import("ws");
      wss = new WebSocketServer({
        noServer: true,
        // AR-8b — a credentialed browser upgrade offers `rosetta` beside its
        // credential entry; the daemon selects `rosetta`, never the credential
        handleProtocols: (protocols) => (protocols.has("rosetta") ? "rosetta" : false),
      });
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
    const sessionSocket = /^\/ws\/sessions\/([^/?]+)(?:\?.*)?$/.exec(req.url ?? "");
    if (req.url !== "/ws/meta" && sessionSocket === null) {
      socket.destroy();
      return;
    }
    // rosetta's `require_local_origin`: a native client sends no Origin; a
    // browser's must be loopback — or, since RO-1, one `--allow-origin` named
    const origin = req.headers.origin;
    if (!originAllowed(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    // AR-8b — the credential, checked at the upgrade (an open socket is not
    // re-checked: AUTH.md §3)
    const refusedUpgrade = credentialRefusal("GET", req.url, req.headers);
    if (refusedUpgrade !== null) {
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\nx-rosetta-protocol-version: ${protocol}\r\nx-rosetta-auth: ${refusedUpgrade}\r\ncontent-length: 0\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    if (sessionSocket !== null) {
      // SP-6 — the session stream in rosetta's own shape (ws.rs): a hello
      // stamped at the ring's position, a `timeline_snapshot` of the newest
      // SNAPSHOT_LIMIT rows (oldest first, a cursor to the older page, the
      // watermark), then one `message` mutation per row the scripted file
      // adds or changes, at-least-once and keyed by `timeline_id`; a scripted
      // `resync` is the barrier (`resync`, then a replacement snapshot under a
      // new epoch), a scripted `drop` closes the socket. A session the index
      // does not hold greets and then errors, exactly as the real server does
      // (`snapshot read failed`, then the socket ends).
      const id = decodeURIComponent(sessionSocket[1]);
      void metaServer().then((sessions) =>
        sessions.handleUpgrade(req, socket, head, (ws) => {
          let epoch = sessionEpoch;
          let seq = 0;
          const stamp = () => ({ epoch, seq });
          ws.send(JSON.stringify({ frame: "hello", protocol_version: protocol, stamp: stamp() }));
          if (sessionRows().find((row) => row.id === id) === undefined) {
            ws.send(
              JSON.stringify({
                frame: "error",
                error: { code: "internal", message: "snapshot read failed" },
              }),
            );
            ws.close(1000);
            return;
          }
          const socketId = `${id}#${++sessionSockets}`;
          const sent = (what) => (error) => {
            if (error) logSocket(`${socketId} send ${what} failed: ${error.message}`);
          };
          const snapshot = () => {
            const page = timelinePage(id, SNAPSHOT_LIMIT, null);
            ws.send(
              JSON.stringify({
                frame: "timeline_snapshot",
                stamp: stamp(),
                entries: page.entries,
                timeline_meta: { tasks: [], workflows: [], plans: [], artifacts: [] },
                cursor: page.cursor,
                watermark: page.watermark,
              }),
              sent("timeline_snapshot"),
            );
            return page.entries.length;
          };
          snapshot();
          let last = new Map(timelineRows(id).map((row) => [row.timeline_id, JSON.stringify(row)]));
          let control = { ...timelineControl() };
          logSocket(`${socketId} opened epoch=${epoch} control=${JSON.stringify(control)}`);
          const poll = setInterval(() => {
            if (ws.readyState !== 1) return;
            const next = timelineControl();
            if (next.drop !== undefined && next.drop !== control.drop) {
              control = { ...next };
              logSocket(`${socketId} drop fired`);
              ws.close(1011, "scripted drop");
              return;
            }
            if (next.resync !== undefined && next.resync !== control.resync) {
              control = { ...next };
              sessionEpoch += 1;
              epoch = sessionEpoch;
              seq = 0;
              ws.send(JSON.stringify({ frame: "resync" }), sent("resync"));
              const rows = snapshot();
              logSocket(`${socketId} resync fired epoch=${epoch} rows=${rows}`);
              last = new Map(timelineRows(id).map((row) => [row.timeline_id, JSON.stringify(row)]));
              return;
            }
            control = { ...next };
            const now = new Map();
            for (const row of timelineRows(id)) {
              const encoded = JSON.stringify(row);
              now.set(row.timeline_id, encoded);
              if (last.get(row.timeline_id) === encoded) continue;
              seq += 1;
              ws.send(
                JSON.stringify({
                  frame: "mutation",
                  stamp: stamp(),
                  mutation: { type: "message", ...row },
                }),
              );
            }
            last = now;
          }, 40);
          poll.unref();
          ws.on("close", (code) => {
            clearInterval(poll);
            logSocket(`${socketId} closed ${code}`);
          });
          ws.on("error", (error) => {
            clearInterval(poll);
            logSocket(`${socketId} error ${error.message}`);
          });
        }),
      );
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
    // The guard is armed BEFORE the ready line: a parent that reads the line
    // may stop the daemon at once, and a SIGINT that lands while no listener
    // is installed takes Node's default — the process dies without cleanup,
    // its announce file outliving it (two gate reds, ~0.3 s rows, 2026-10-12).
    const cleanup = () => {
      if (announce !== null) rmSync(announce, { force: true });
    };
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    const origin =
      mode === "bad-origin" ? `http://example.com:${port}` : `http://127.0.0.1:${port}`;
    const ready = {
      event: "ready",
      origin,
      protocol_version: mode === "wrong-protocol" ? 1 : protocol,
      // AR-8b — which modes are on, never the secrets; a daemon from before
      // RO-1 (`no-auth`) says nothing about access at all
      ...(mode === "no-auth"
        ? {}
        : { auth: { bearer: bearer !== null, grants: grantKey !== null, origins: allowOrigins } }),
      ...(announce !== null ? { announce } : {}),
    };
    process.stdout.write(`${JSON.stringify(ready)}\n`);
    if (phase === "awaiting_consent") {
      process.stdout.write("no enrolled agents — choose in the app (or pass --all-agents)\n");
    }
    if (mode === "crash-after-ready") {
      setTimeout(() => {
        // a crash keeps its announce file behind, exactly like a real SIGKILL
        process.stderr.write("fake rosettad: simulated crash after ready\n");
        process.exit(3);
      }, 60);
    }
  });
}
