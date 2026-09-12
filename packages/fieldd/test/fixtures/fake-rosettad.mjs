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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const protocol = Number(process.env.FAKE_ROSETTAD_PROTOCOL ?? "20");

if (mode === "crash-on-start") {
  process.stderr.write("fake rosettad: refusing to start (scripted)\n");
  process.exit(2);
}
if (mode === "silent") {
  setInterval(() => {}, 1_000);
} else {
  // a real loopback HTTP listener, so the origin is a port the OS actually
  // gave us and the status probe answers like the real server
  const server = createServer((req, res) => {
    if (req.url === "/api/status") {
      res.setHeader("x-rosetta-protocol-version", String(protocol));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          protocol_version: protocol,
          schema_version: 1,
          canonical_ready: true,
          search: "ready",
          daemon: null,
        }),
      );
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
