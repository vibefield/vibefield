// THE DOOR PROBE — TP-S3a's gate line: "document + worker `Origin` verified".
//
// vibefield-terminal-door-probe-only
//
// terminal-pipeline-v3 §8 (door hygiene) said the Origin a PACKAGED and a dev
// renderer actually send — from the DOCUMENT and from a WORKER execution
// context — must be VERIFIED at TP-S3a, not assumed: the app scheme is a custom
// scheme, and a custom scheme that were not registered `standard` + `secure`
// would send `Origin: null`, which the cell's allow-list (the same list fieldd's
// own door admits) refuses with a silent 1008. This runs the real shell in a
// smoke-like mode (the app-scheme renderer — the PACKAGED origin), boots the
// real daemon pair against an isolated root, births one session through
// fieldd's own door, takes the ticket's `endpoints` + transport grant, and dials
// the cell's control door from the renderer DOCUMENT and its frames door from a
// WORKER. `ConnectionAccepted` from both IS the proof: the cell saw an Origin it
// admits from both contexts (a non-admitted one cannot reach acceptance).
//
// The dev renderer (an http origin from Vite) is structurally ordinary — a
// standard scheme — and fieldd's product door already admits it from the
// document in every `pnpm dev` session; a worker inherits its document's
// origin. This probe therefore runs the arm that could actually surprise.
//
// It asserts nothing about performance and moves no production flag: the
// smoke-like CSP keeps the loopback wildcard on its own (security-policy.ts),
// so what is under test is the cell door and the renderer's Origin, nothing else.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_CELL_RECEIVER_CAPS,
  TerminalCreateOpenResponse,
  type TerminalCreateOpenResult,
  TP_PROTOCOL_VERSION,
  tagTpMessage,
} from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app, type BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";

/** One context's dial, as the renderer reports it back. */
export interface DoorDialResult {
  readonly context: "document" | "worker";
  readonly url: string;
  readonly accepted: boolean;
  readonly type: string | null;
  readonly refusal: string | null;
  readonly closeCode: number | null;
  readonly closeReason: string | null;
  readonly error: string | null;
  readonly origin?: string;
  readonly legGeneration?: number;
  readonly connectionSetId?: string;
}

export interface DoorProbeResult {
  readonly documentOrigin: string;
  readonly document: DoorDialResult;
  readonly worker: DoorDialResult;
}

/** The renderer-side script: self-contained (no imports — it runs as a string
 * under the app origin's CSP; the worker is a blob: worker, which the
 * smoke-like CSP admits on `worker-src`). Exported for the unit test that
 * pins its shape; `buildDoorProbeScript` is pure. */
export function buildDoorProbeScript(input: {
  controlUrl: string;
  framesUrl: string;
  controlHello: Record<string, unknown>;
  framesHello: Record<string, unknown>;
  timeoutMs: number;
}): string {
  // `dial` is serialized INTO the worker source with Function.prototype.toString,
  // so it must stay free of closures over this scope.
  const dial = `
    function dial(url, hello, context, timeoutMs) {
      return new Promise((resolve) => {
        const out = { context, url, accepted: false, type: null, refusal: null, closeCode: null, closeReason: null, error: null };
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(out); } };
        let ws;
        try { ws = new WebSocket(url); } catch (e) { out.error = String(e); done(); return; }
        const timer = setTimeout(() => { out.error = out.error || "timeout"; try { ws.close(); } catch {} done(); }, timeoutMs);
        ws.onopen = () => { ws.send(JSON.stringify(hello)); };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(String(ev.data));
            out.type = typeof m.type === "string" ? m.type : null;
            out.accepted = m.type === "ConnectionAccepted";
            out.refusal = typeof m.code === "string" ? m.code : null;
            if (typeof m.legGeneration === "number") out.legGeneration = m.legGeneration;
            if (typeof m.connectionSetId === "string") out.connectionSetId = m.connectionSetId;
          } catch (e) { out.error = "non-json reply"; }
          clearTimeout(timer);
          try { ws.close(1000); } catch {}
          done();
        };
        ws.onclose = (ev) => { out.closeCode = ev.code; out.closeReason = ev.reason; clearTimeout(timer); done(); };
        ws.onerror = () => { out.error = out.error || "socket error"; };
      });
    }`;
  return `(async () => {
    ${dial}
    const controlUrl = ${JSON.stringify(input.controlUrl)};
    const framesUrl = ${JSON.stringify(input.framesUrl)};
    const controlHello = ${JSON.stringify(input.controlHello)};
    const framesHello = ${JSON.stringify(input.framesHello)};
    const timeoutMs = ${input.timeoutMs};
    const document_ = await dial(controlUrl, controlHello, "document", timeoutMs);
    const workerSource = ${JSON.stringify(dial)} + "\\nself.onmessage = async (e) => { const r = await dial(e.data.url, e.data.hello, 'worker', e.data.timeoutMs); r.origin = self.origin; postMessage(r); };";
    const worker = await new Promise((resolve) => {
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }))); }
      catch (e) { resolve({ context: "worker", url: framesUrl, accepted: false, type: null, refusal: null, closeCode: null, closeReason: null, error: "worker construct: " + String(e) }); return; }
      const t = setTimeout(() => resolve({ context: "worker", url: framesUrl, accepted: false, type: null, refusal: null, closeCode: null, closeReason: null, error: "worker timeout" }), timeoutMs + 2000);
      w.onmessage = (e) => { clearTimeout(t); resolve(e.data); w.terminate(); };
      w.onerror = (e) => { clearTimeout(t); resolve({ context: "worker", url: framesUrl, accepted: false, type: null, refusal: null, closeCode: null, closeReason: null, error: "worker error: " + String(e && e.message ? e.message : e) }); };
      w.postMessage({ url: framesUrl, hello: framesHello, timeoutMs });
    });
    return { documentOrigin: location.origin, document: document_, worker };
  })()`;
}

/** The two hellos this probe sends — the contracts' tagged ConnectionHello,
 * one per channel, with the worker advertising receive capacity on frames. */
export function doorProbeHellos(transportGrant: unknown): {
  controlHello: Record<string, unknown>;
  framesHello: Record<string, unknown>;
} {
  const base = {
    protocolMajor: TP_PROTOCOL_VERSION.major,
    protocolMinor: TP_PROTOCOL_VERSION.minor,
    capabilities: [] as string[],
  };
  return {
    controlHello: tagTpMessage("ConnectionHello", {
      ...base,
      channel: "control",
      transportGrant: transportGrant as never,
    }),
    framesHello: tagTpMessage("ConnectionHello", {
      ...base,
      channel: "frames",
      transportGrant: transportGrant as never,
      receiverCapacities: DEFAULT_CELL_RECEIVER_CAPS,
    }),
  };
}

/** The verdict is the conjunction: both contexts reached acceptance. */
export function doorProbeVerdict(result: DoorProbeResult): { ok: boolean; why: string[] } {
  const why: string[] = [];
  for (const r of [result.document, result.worker]) {
    if (!r.accepted) {
      why.push(
        `${r.context}: ${r.type ?? "no reply"}${r.refusal ? ` ${r.refusal}` : ""}` +
          `${r.closeCode !== null ? ` close ${r.closeCode}${r.closeReason ? ` ${r.closeReason}` : ""}` : ""}` +
          `${r.error ? ` (${r.error})` : ""}`,
      );
    }
  }
  return { ok: why.length === 0, why };
}

function armExitWatchdog(afterMs: number, reason: string): () => void {
  const timer = setTimeout(() => {
    process.stderr.write(
      `terminal-door-probe: ${reason} — forcing exit after ${afterMs}ms so this process ` +
        "cannot outlive its probe and hold its floor\n",
    );
    process.exit(3);
  }, afterMs);
  timer.unref();
  return () => clearTimeout(timer);
}

/** `app.exit`, with `process.exit` behind it on a short fuse (TP-S0c's lesson:
 * the exit is unconditional and sits in `finally`). */
function leave(code: number): void {
  const fuse = setTimeout(() => process.exit(code), 5_000);
  fuse.unref();
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
}

const PROBE_SHELL =
  process.platform === "win32"
    ? (process.env["COMSPEC"] ?? "C:\\Windows\\System32\\cmd.exe")
    : "/bin/sh";

export async function runTerminalDoorProbe(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const outPath = process.env["VF_DOOR_PROBE_OUT"];
  const expectOrigin = process.env["VF_DOOR_PROBE_EXPECT_ORIGIN"] ?? "vibefield-app://shell";
  const disarmWatchdog = armExitWatchdog(120_000, "the probe exceeded its total budget");
  const records: Record<string, unknown>[] = [];
  const emit = (record: Record<string, unknown>): void => {
    records.push(record);
    process.stdout.write(`TERMINAL_DOOR_PROBE ${JSON.stringify(record)}\n`);
  };
  let code = 1;
  let sessionId: string | undefined;
  emit({
    kind: "run",
    at: Date.now(),
    electron: process.versions["electron"],
    chrome: process.versions["chrome"],
    platform: process.platform,
    expectOrigin,
  });
  try {
    // One session through fieldd's own door: its ticket carries the route, the
    // cell's T1 endpoints (iff the cell serves doors) and a transport grant
    // MAC'd with that cell's key (TP-S1b/TP-S3a).
    const created = TerminalCreateOpenResponse.parse(
      await opts.handle.client.request("terminal.create", { shell: PROBE_SHELL }),
    );
    sessionId = created.sessionId;
    const routed = "route" in created ? (created as TerminalCreateOpenResult) : undefined;
    if (routed === undefined) {
      emit({ kind: "no-grants", why: "the floor minted no grants (keyless floor)" });
      return;
    }
    if (routed.endpoints === undefined) {
      emit({
        kind: "no-endpoints",
        cellBootId: routed.route.cellBootId,
        why: "the cell serves no T1 doors (no `doors` on its route row)",
      });
      return;
    }
    emit({
      kind: "ticket",
      cellBootId: routed.route.cellBootId,
      controlUrl: routed.endpoints.controlUrl,
      framesUrl: routed.endpoints.framesUrl,
      connectionSetId: routed.transportGrant.claims.connectionSetId,
      transportGrantGeneration: routed.transportGrant.claims.transportGrantGeneration,
    });

    const win = createMainWindow({
      mode: "terminal-door-probe",
      preloadPath: opts.preloadPath,
      show: false,
    });
    opts.registry.adopt(win);
    opts.onWindow?.(win);
    if (process.env["VF_DOOR_PROBE_DEBUG"] === "1") {
      win.webContents.on("console-message", (...args: unknown[]) => {
        process.stdout.write(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);
      });
    }
    await loadRenderer(win, "terminal-door-probe", opts.viteUrl);
    const { controlHello, framesHello } = doorProbeHellos(routed.transportGrant);
    const script = buildDoorProbeScript({
      controlUrl: routed.endpoints.controlUrl,
      framesUrl: routed.endpoints.framesUrl,
      controlHello,
      framesHello,
      timeoutMs: 8_000,
    });
    const result = (await win.webContents.executeJavaScript(script, true)) as DoorProbeResult;
    const verdict = doorProbeVerdict(result);
    const originOk = result.documentOrigin === expectOrigin;
    emit({
      kind: "probe",
      documentOrigin: result.documentOrigin,
      workerOrigin: result.worker.origin ?? null,
      document: result.document,
      worker: result.worker,
      originOk,
      ok: verdict.ok && originOk,
      why: [
        ...verdict.why,
        ...(originOk ? [] : [`document origin ${result.documentOrigin} ≠ ${expectOrigin}`]),
      ],
    });
    code = verdict.ok && originOk ? 0 : 1;
  } catch (error) {
    emit({ kind: "error", error: error instanceof Error ? error.message : String(error) });
    code = 1;
  } finally {
    disarmWatchdog();
    armExitWatchdog(30_000, "the teardown did not finish");
    if (outPath !== undefined) {
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
      } catch {
        /* the stdout lines are the record of last resort */
      }
    }
    if (sessionId !== undefined) {
      await opts.handle.client.request("terminal.terminate", { sessionId }).catch(() => undefined);
    }
    await opts.supervisor.dispose().catch(() => undefined);
    await opts.beforeExit().catch(() => undefined);
    leave(code);
  }
}
