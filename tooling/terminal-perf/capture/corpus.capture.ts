// THE CORPUS CAPTURE — writes `fixtures/terminal-perf/trf1/*.trf1` + manifest.
//
//   pnpm --filter @vibefield/terminal-perf capture
//
// Deliberately NOT part of `pnpm test` or `pnpm verify`: it spawns the real
// daemon pair, births one real pty session per entry, and rewrites checked-in
// fixtures. It is vitest-hosted only because `@vibefield/fieldd` exports raw
// TypeScript, so a plain Node script cannot import `bootstrap`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { bootstrap } from "@vibefield/fieldd";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { base1Corpus } from "../src/byte-traces";
import { captureSession, startNativeFloor } from "../src/capture-harness";
import {
  CORPUS_COLS,
  CORPUS_ROWS,
  type CorpusEntry,
  driveEntry,
  REPLAY_ENTRIES,
  recordEntries,
} from "../src/corpus-plan";
import { type CorpusManifest, describeCapture, type ManifestEntry } from "../src/manifest";
import { capCapture, type Trf1CaptureHeader, writeCaptureFile } from "../src/trf1-container";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const FIXTURES = join(ROOT, "fixtures", "terminal-perf", "trf1");
const SCRATCH = join(ROOT, "fixtures", "terminal-perf", ".sources");
const REPLAY_PROGRAM = join(HERE, "replay-program.mjs");

const GHOSTTEA_VERSION = "0.10.1";
const REPLAY_HOLD_MS = 400;

/** The corpus's size discipline. 300 frames is a comfortable histogram (p99 is
 * the 297th sample, an observation rather than an extrapolation) and 6 MiB
 * bounds the heaviest entry. Both are per entry, before gzip. */
const MAX_FRAMES_PER_ENTRY = 300;
const MAX_BYTES_PER_ENTRY = 6 * 1024 * 1024;

/** `git rev-parse HEAD`, probed at run time — the spike's manifest discipline. */
function sourceCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function hostFacts(): Trf1CaptureHeader["host"] {
  return {
    platform: process.platform,
    arch: process.arch,
    // The loaded-host rule wants this number ON the artifact: this Mac is never
    // quiet, and a corpus captured at load 20 has a different cadence from the
    // same corpus captured at load 3.
    loadAvg1: Math.round((loadavg()[0] as number) * 100) / 100,
  };
}

interface Rpc {
  call(method: string, params: unknown): Promise<Record<string, unknown>>;
  close(): void;
}

function rpcOver(ws: WebSocket): Rpc {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as Record<string, unknown>;
    const id = message["id"];
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    if (message["error"]) entry.reject(new Error(JSON.stringify(message["error"])));
    else entry.resolve((message["result"] ?? {}) as Record<string, unknown>);
  });
  return {
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

/** `connectTicket` refuses immediately while the floor is absent — deliberately,
 * it does not await the cell's hello the way `create` does
 * (`packages/fieldd/src/terminal-service.ts:693`). So the caller waits. */
async function ticketWhenReady(rpc: Rpc, timeoutMs: number): Promise<TicketShape> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const result = await rpc.call("terminal.connectTicket", {});
      return result["ticket"] as TicketShape;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

interface TicketShape {
  controlSocket: string;
  frameSocket: string;
  token: string;
}

it("records the TRF1 corpus through a real cell", async () => {
  mkdirSync(FIXTURES, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });

  const capturedAt = new Date().toISOString();
  const commit = sourceCommit();
  const host = hostFacts();

  // The replayed half's source bytes are written once, then fed to the pty by
  // the fixture program. Kept on disk (gitignored) so a failed capture can be
  // re-run without regenerating, and so the exact bytes a frame came from are
  // inspectable after the fact.
  const byteTraces = new Map(base1Corpus(1n, 1).map((trace) => [trace.name, trace]));
  for (const [name, trace] of byteTraces) {
    writeFileSync(join(SCRATCH, `${name}.bytes`), trace.bytes);
  }

  const floor = await startNativeFloor(ROOT);
  const daemon = await bootstrap({ dataDir: floor.dataDir, controlPort: 0, dataPort: 0 });
  const entries: ManifestEntry[] = [];

  try {
    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-perf-capture");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = rpcOver(ws);
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "renderer",
      credential: grant.token,
    });
    const ticket = await ticketWhenReady(rpc, 30_000);

    const plan: CorpusEntry[] = [...REPLAY_ENTRIES, ...recordEntries(ROOT)];
    for (const entry of plan) {
      const started = Date.now();
      const isReplay = entry.kind === "replay";
      const trace = isReplay ? byteTraces.get(entry.name) : undefined;
      if (isReplay && trace === undefined) throw new Error(`no byte trace named ${entry.name}`);

      const drive =
        entry.kind === "record" && entry.drive !== undefined
          ? (client: GhostteaAutomationClient, sessionId: string): Promise<void> =>
              driveEntry(entry, client, sessionId)
          : undefined;

      const result = await captureSession({
        ticket,
        session: isReplay
          ? {
              executable: process.execPath,
              args: [
                REPLAY_PROGRAM,
                join(SCRATCH, `${entry.name}.bytes`),
                String(entry.bytesPerSecond),
                String(entry.targetMs),
                String(REPLAY_HOLD_MS),
              ],
              cols: CORPUS_COLS,
              rows: CORPUS_ROWS,
            }
          : {
              executable: entry.executable,
              args: entry.args,
              cols: CORPUS_COLS,
              rows: CORPUS_ROWS,
              ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
            },
        ...(drive === undefined ? {} : { drive }),
        settleMs: entry.settleMs ?? 1_200,
        timeoutMs: (entry.kind === "record" ? entry.timeoutMs : undefined) ?? 120_000,
      });

      const header: Trf1CaptureHeader = {
        name: entry.name,
        source: isReplay
          ? {
              kind: "base1-port",
              detail: `byte-traces.ts ${entry.name} (seed 1, scale 1) via replay-program.mjs`,
              byteLength: (trace as { bytes: Uint8Array }).bytes.byteLength,
            }
          : {
              kind: "recorded",
              detail: [entry.executable, ...entry.args].join(" "),
              byteLength: 0,
            },
        cols: CORPUS_COLS,
        rows: CORPUS_ROWS,
        cadence: isReplay
          ? {
              mode: entry.bytesPerSecond === 0 ? "asFastAsPossible" : "accelerated",
              bytesPerSecond: entry.bytesPerSecond,
              targetMs: entry.targetMs,
            }
          : { mode: "recorded", bytesPerSecond: 0, targetMs: 0 },
        capturedAt,
        ghostteaVersion: GHOSTTEA_VERSION,
        sourceCommit: commit,
        host,
        notes: [
          entry.covers,
          ...(result.exited
            ? []
            : ["the program did not exit within its budget; it was terminated"]),
        ],
      };

      // Capped before it is written. The uncapped corpus came to 93 MiB of
      // TRF1 — good data, not a thing to put in a git history — and the cap is
      // by BOTH frames and bytes because the two limits bind different entries:
      // `yes-flood` hits the frame cap at 40KiB a frame, `softwrap` hits the
      // byte cap at 70KiB a frame. A contiguous prefix in both cases (see
      // `capCapture`): the trace ends earlier, it does not develop holes.
      const capture = capCapture(
        { header, frames: result.frames },
        MAX_FRAMES_PER_ENTRY,
        MAX_BYTES_PER_ENTRY,
      );
      const file = `${entry.name}.trf1`;
      writeCaptureFile(join(FIXTURES, file), capture);
      const described = describeCapture(
        file,
        capture,
        result.messages.map((message) => String(message["type"])),
      );
      entries.push(described);
      console.log(
        `[capture] ${entry.name.padEnd(24)} frames=${String(described.frames).padStart(5)} ` +
          `bytes=${String(described.bytes).padStart(9)} ${described.durationMs}ms ` +
          `full=${described.fullSnapshots} (${Date.now() - started}ms)`,
      );
    }
    rpc.close();
  } finally {
    await daemon.stop();
    floor.stop();
  }

  const manifest: CorpusManifest = {
    version: 1,
    capturedAt,
    ghostteaVersion: GHOSTTEA_VERSION,
    sourceCommit: commit,
    host,
    limits: [
      "The eleven `base1-port` entries are a TypeScript PORT of the TC spike's Rust generators " +
        "(`draft/terminal-custody-spike/probes/base1/src/traces.rs`), replayed into a real cell. " +
        "The spike's corpus is 11 generators exercised as 22 cases (11 traces x 2 viewport " +
        "positions, `LEDGER.md:1162`), not the 22 byte traces spec §19.2 line 1622 describes, " +
        "and nothing in it was ever recorded from a real program.",
      "The `recorded` entries are live recordings and are NOT byte-reproducible; the manifest " +
        "carries the exact argv so a re-run is a run, not a guess.",
      "nvim, htop and an agent TUI are not installed on the capture host. Their CLASSES are " +
        "covered by vim, top and alt-animation; the programs themselves are not in this corpus.",
      "Cadence is the CELL's, not a display's: the cell coalesces damage, so `framesPerSecond` " +
        "is the fixture's own emission rate.",
      "Frames are stored verbatim. TRF1's reader is exact-version " +
        "(`ghosttea-frame/dist/index.js:41`), so this corpus is readable only by ghosttea " +
        `${GHOSTTEA_VERSION}'s frame protocol version.`,
    ],
    entries,
    totals: {
      entries: entries.length,
      frames: entries.reduce((total, entry) => total + entry.frames, 0),
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    },
  };
  writeFileSync(join(FIXTURES, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `[capture] ${manifest.totals.entries} entries, ${manifest.totals.frames} frames, ` +
      `${(manifest.totals.bytes / 1024 / 1024).toFixed(2)} MiB`,
  );

  // Every entry must have produced frames: a zero-frame entry is a capture bug
  // (the `attach-session` lesson), not an empty trace.
  for (const entry of entries)
    expect(entry.frames, `${entry.name} produced no frames`).toBeGreaterThan(0);
  expect(readFileSync(join(FIXTURES, "manifest.json"), "utf8").length).toBeGreaterThan(0);
}, 900_000);
