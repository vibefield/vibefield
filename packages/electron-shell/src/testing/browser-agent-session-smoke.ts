/**
 * EY-1 (1d, 2026-11-19) — THE FIRST CASE, on a real Electron: is a client's own session on a desk page independent of the
 * page's owner? The window is the product's (ElectronBrowserSurfaceNative), at half its raster (capture scale 0.5). The
 * owner's holds are read by main alone — its own probes and its own debugger listener, never a client's traffic — BEFORE
 * and AFTER the client's commands:
 *   B1 guard: a fresh document has `window.close` replaced and `prompt()` answering null;
 *   B2 words: the page's scale word arrives after a reload, and a fresh cross-site frame says its words;
 *   B3 auto-attach: that frame attaches on the owner's session, runs its guard and loads; a dedicated worker runs;
 *   B4 viewport: innerWidth, innerHeight and devicePixelRatio are the pane's, and a paint comes at the reduced raster;
 *   B5 events: a console line of the page reaches main's listener on the page's own session.
 * The client's rows, R0 to R11 as this file names them below, are recorded; R8, R9 and R11 are measures only.
 * Legs (VF_AGENT_SESSION_LEG), one Electron process each:
 *   fix      the client's own session through the page's port. AS WANTED (exit 0): independent — every B row true before,
 *            and true after R1, R2, R3 and R10 — and the session alive (R0).
 *   base     a client's own session by a bare `Target.attachToTarget` (a tree without the port). AS WANTED: the owner
 *            detached it (R0 fails: the red, on Electron).
 *   control  the client's R1 to R3 sent on the OWNER's own session. AS WANTED: a B row is seen broken after them, so the
 *            case can see a break; otherwise BLIND (exit 2).
 * The report is report.json in a NEW folder VF_AGENT_SESSION_OUT, rewritten whole as each row ends (`reached`: the
 * last row that ended), so a leg whose Electron dies still leaves its last whole report; the profile lives inside the
 * folder. One listener, on 127.0.0.1 alone, closed at every end. Exits: 0 as wanted, 2 blind, 3 the time limit, 5 not
 * as wanted, 1 an error, 64 usage.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, join } from "node:path";
import { app, type WebContents } from "electron";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../main/live-surfaces/browser-electron-native";
import * as owner from "../main/live-surfaces/browser-electron-native";
import type { BrowserSurfaceNativeWindow } from "../main/live-surfaces/browser-producer";

type Leg = "fix" | "base" | "control";
const OUT = process.env["VF_AGENT_SESSION_OUT"] ?? "";
const LEG = process.env["VF_AGENT_SESSION_LEG"] as Leg;
const LIMIT_S = Number(process.env["VF_AGENT_SESSION_LIMIT_S"] ?? "300");
if (
  !isAbsolute(OUT) ||
  existsSync(OUT) ||
  !["fix", "base", "control"].includes(LEG) ||
  !Number.isFinite(LIMIT_S)
) {
  process.stderr.write(
    "VF_AGENT_SESSION_OUT must name a new absolute folder; VF_AGENT_SESSION_LEG fix, base or control\n",
  );
  process.exit(64);
}
mkdirSync(join(OUT, "profile"), { recursive: true });
app.setPath("userData", join(OUT, "profile"));
owner.configureBrowserEngineIdentity();

const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  leg: LEG,
  versions: process.versions,
};
let code = 1;
const t0 = Date.now();
const ms = (): number => Date.now() - t0;
const pause = (wait: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, wait));

// ── the fixtures: the page (a button for R7, room to scroll), a frame of another site, the worker smoke's workers ──
const PAGE = `<!doctype html><title>agent session case</title>
<style>body{margin:0;height:3000px}#target{position:fixed;left:600px;top:400px;width:100px;height:60px}</style>
<button id="target" onclick="window.__hits=(window.__hits||0)+1">t</button>
<script>addEventListener('message',e=>{if(e.data&&e.data.kind==='frame')(window.__frames=window.__frames||[]).push(e.data)})</script>`;
const FRAME = (n: string): string =>
  `<!doctype html><script>parent.postMessage({kind:'frame',n:${JSON.stringify(n)},closeReplaced:!String(window.close).includes('[native code]')},'*')</script>`;
const SCRIPTS: Record<string, string> = {
  "/worker.js": "postMessage({ua:navigator.userAgent})",
  "/nested-worker.js":
    "const child=new Worker('/worker.js');child.onmessage=e=>{postMessage(e.data);child.terminate()};child.onerror=e=>{throw Error(e.message)}",
  "/shared-worker.js": "onconnect=e=>e.ports[0].postMessage({ua:navigator.userAgent})",
  "/service-worker.js":
    "oninstall=()=>skipWaiting();onactivate=e=>e.waitUntil(clients.claim());onmessage=e=>e.ports[0].postMessage({ua:navigator.userAgent})",
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture");
  const script = SCRIPTS[url.pathname];
  if (script !== undefined) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(script);
  } else if (url.pathname === "/frame") {
    res.setHeader("Content-Type", "text/html");
    res.end(FRAME(url.searchParams.get("n") ?? ""));
  } else if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(PAGE);
  } else {
    res.statusCode = 404;
    res.end();
  }
});

// ── main's own ear on the page's debugger: every event, by the session it was said on ("" the owner's page session) ──
interface Heard {
  readonly method: string;
  readonly on: string;
  readonly t: number;
  readonly params: Record<string, unknown>;
}
const heard: Heard[] = [];
const since = (t: number, method: string): Heard[] =>
  heard.filter((h) => h.t >= t && h.method === method);
const waitFor = async (test: () => boolean | Promise<boolean>, wait: number): Promise<boolean> => {
  const end = Date.now() + wait;
  while (Date.now() < end) {
    if (await test()) return true;
    await pause(50);
  }
  return test();
};

// ── a client: its own session through the port (fix), a bare self-attach (base), or the owner's own session (control) ──
interface Client {
  readonly kind: string;
  send(method: string, params?: Record<string, unknown>, child?: string): Promise<unknown>;
  readonly events: { readonly method: string; readonly child?: string; readonly params: unknown }[];
  onEvent(listener: (event: BrowserAgentEvent) => void): void;
  close(): Promise<void>;
  readonly closed?: Promise<{ readonly reason: string }>;
}
function portClient(session: BrowserAgentSession): Client {
  const events: Client["events"][number][] = [];
  session.onEvent((event) => events.push(event));
  return {
    kind: "its own, through the port",
    send: (method, params = {}, child) => session.send(method, params, child),
    events,
    onEvent: (listener) => {
      session.onEvent(listener);
    },
    close: () => session.close(),
    closed: session.closed,
  };
}

let surface: BrowserSurfaceNativeWindow | undefined;
let closing = false;
/** The report as it stands, written whole: to a temporary name in its own folder, then renamed over report.json — so a
 * death mid-write leaves the last whole report, never a torn one. `reached` names the last row that ended. */
function save(reached: string): void {
  report.reached = reached;
  const whole = join(OUT, ".report.json.writing");
  writeFileSync(whole, JSON.stringify(report, null, 2));
  renameSync(whole, join(OUT, "report.json"));
}

function close(): void {
  if (closing) return;
  closing = true;
  clearTimeout(limit);
  report.ended = new Date().toISOString();
  save(typeof report.reached === "string" ? report.reached : "nothing");
  try {
    if (surface !== undefined && !surface.isDestroyed()) surface.destroy();
  } catch {
    // (the window may already be gone)
  }
  server.close();
  setTimeout(() => app.exit(code), 300);
}
const limit = setTimeout(() => {
  report.verdict = `the time limit (${LIMIT_S} s)`;
  code = 3;
  close();
}, LIMIT_S * 1000);
const finish = (exit: number, verdict: string): void => {
  code = exit;
  report.verdict = verdict;
  report.exit = exit;
};

app.on("window-all-closed", () => undefined);
app
  .whenReady()
  .then(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const frameOrigin = `http://localhost:${port}`;
    const native = new owner.ElectronBrowserSurfaceNative();
    const agent = native.engineAgent();
    surface = native.createWindow({
      partition: `memory:agent-session-${LEG}`,
      persistent: false,
      logicalViewport: { width: 800, height: 600 },
      initialBackingRaster: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
      requestSharedTexture: true,
    });
    const s = surface;
    const portOf = (owner as { browserAgentPortOf?: (c: object) => BrowserAgentPort | null })
      .browserAgentPortOf;
    /** the page's port: the fix leg's tree has one */
    const agentPortOf = (): BrowserAgentPort => {
      const found = portOf?.(s.controlContents) ?? null;
      if (found === null) throw Error("the page has no port (the fix leg runs on the port's tree)");
      return found;
    };
    let lastPaint: { width: number; height: number } | undefined;
    s.onPaint((paint) => {
      if (paint.bootstrap !== true) lastPaint = paint.image.getSize();
      paint.texture?.release();
    });
    let scaleWords = 0;
    s.onScale(() => {
      scaleWords += 1;
    });
    const page = s.controlContents as unknown as WebContents;
    const cdp = page.debugger;
    cdp.on("message", (_event, method, params, sessionId) =>
      heard.push({ method, on: sessionId ?? "", t: ms(), params: params ?? {} }),
    );
    await s.setEmulation({ ...agent, touchPoints: 0, colorScheme: "light" });
    // the reduced raster: half the base, so the capture scale in force is 0.5
    const raster = await s.setBackingRaster(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      2,
    );
    report.raster = raster;
    save("the window");
    await s.loadURL(`${origin}/`);
    const js = <T>(source: string): Promise<T> =>
      page.executeJavaScript(source, true) as Promise<T>;
    let frameNumber = 0;
    const addFrame = async (): Promise<string> => {
      frameNumber += 1;
      const n = `f${frameNumber}`;
      await js(
        `(()=>{const f=document.createElement('iframe');f.src=${JSON.stringify(`${frameOrigin}/frame?n=`)}+${JSON.stringify(n)};document.body.append(f);return true})()`,
      );
      return n;
    };
    const frameSaid = (n: string): Promise<{ closeReplaced?: boolean } | null> =>
      js(`(window.__frames||[]).find(x=>x.n===${JSON.stringify(n)})||null`);

    // ── the owner's holds, read by main alone ──
    const holds = async (label: string): Promise<Record<string, boolean>> => {
      const b1 =
        await js<boolean>(`new Promise(r=>{const f=document.createElement('iframe');f.srcdoc='<p>b1</p>';
        f.onload=()=>{const w=f.contentWindow;let ok=false;try{ok=!String(w.close).includes('[native code]')&&w.prompt('b1')===null}catch(e){ok=false}f.remove();r(ok)};
        document.body.append(f)})`);
      const words = scaleWords;
      s.navigate("reload");
      const reloaded = await waitFor(() => scaleWords > words, 8000);
      await waitFor(() => js<boolean>("document.readyState==='complete'"), 8000);
      const mark = ms();
      const n = await addFrame();
      const loaded = await waitFor(async () => (await frameSaid(n)) !== null, 8000);
      const said = await frameSaid(n);
      const ownerFrames = since(mark, "Target.attachedToTarget").filter(
        (h) =>
          h.on === "" &&
          (h.params["targetInfo"] as { type?: string } | undefined)?.type === "iframe",
      );
      const frameSessions = new Set(ownerFrames.map((h) => String(h.params["sessionId"])));
      const frameWords = await waitFor(
        () =>
          since(mark, "Runtime.bindingCalled").some(
            (h) => frameSessions.has(h.on) && h.params["name"] === owner.FRAME_WORDS_BINDING,
          ),
        4000,
      );
      const worker = await js<unknown>(
        "new Promise(r=>{const w=new Worker('/worker.js');w.onmessage=()=>{r('up');w.terminate()};w.onerror=()=>r('error');setTimeout(()=>r('timeout'),5000)})",
      );
      const viewport = await js<{ w: number; h: number; dpr: number }>(
        "({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})",
      );
      const line = `b5-${label}-${ms()}`;
      const lineAt = ms();
      // The PAGE's console, not this process's: console.dir, which R11's diagnostic pattern does not name. b5 needs
      // only that the page says something on its console; the owner hears it as Runtime.consoleAPICalled (EY-1 1d,
      // 2026-11-19).
      await js(`console.dir(${JSON.stringify(line)});true`);
      const b5 = await waitFor(
        () =>
          since(lineAt, "Runtime.consoleAPICalled").some(
            (h) => h.on === "" && JSON.stringify(h.params["args"] ?? []).includes(line),
          ),
        3000,
      );
      const result = {
        b1,
        b2: reloaded && frameWords,
        b3: ownerFrames.length > 0 && loaded && said?.closeReplaced === true && worker === "up",
        b4:
          viewport.w === 800 &&
          viewport.h === 600 &&
          viewport.dpr === 2 &&
          lastPaint !== undefined &&
          Math.abs(lastPaint.width - raster.width) <= 2 &&
          Math.abs(lastPaint.height - raster.height) <= 2,
        b5,
      };
      (report.holds as Record<string, unknown>)[label] = {
        ...result,
        detail: {
          reloaded,
          frameWords,
          ownerFrames: ownerFrames.length,
          loaded,
          said,
          worker,
          viewport,
          lastPaint,
        },
      };
      save(`B ${label}`);
      return result;
    };
    report.holds = {};
    const allHeld = (h: Record<string, boolean>): boolean => Object.values(h).every((v) => v);
    const before = await holds("before");
    if (!allHeld(before)) {
      finish(5, "a B row is false BEFORE the client: the case proves nothing (NOT AS WANTED)");
      close();
      return;
    }

    // ── the client ──
    let client: Client;
    let clientId: string | undefined;
    if (LEG === "fix") {
      const session = await agentPortOf().openClientSession();
      clientId = session.id;
      client = portClient(session);
    } else if (LEG === "base") {
      const info = (await cdp.sendCommand("Target.getTargetInfo")) as {
        targetInfo?: { targetId?: string };
      };
      const answer = (await cdp.sendCommand("Target.attachToTarget", {
        targetId: info.targetInfo?.targetId,
        flatten: true,
      })) as { sessionId?: string };
      clientId = answer.sessionId;
      client = {
        kind: "its own, by a bare self-attach",
        send: (method, params = {}, child) => cdp.sendCommand(method, params, child ?? clientId),
        events: [],
        onEvent: () => undefined,
        close: async () => undefined,
      };
    } else {
      client = {
        kind: "the owner's own session",
        send: (method, params = {}, child) => cdp.sendCommand(method, params, child),
        events: [],
        onEvent: () => undefined,
        close: async () => undefined,
      };
    }
    report.client = { kind: client.kind };
    save("the client opened");
    const tryOn = async (method: string, params: Record<string, unknown> = {}, child?: string) => {
      try {
        return { ok: true, value: await client.send(method, params, child) };
      } catch (error) {
        return { ok: false, error: String(error).slice(0, 200) };
      }
    };

    // R0: alive, and still attached 3 s later
    const r0a = await tryOn("Runtime.evaluate", { expression: "1+1", returnByValue: true });
    await pause(3000);
    const r0b = await tryOn("Runtime.evaluate", { expression: "1+1", returnByValue: true });
    const alive = (r: { ok: boolean; value?: unknown }) =>
      r.ok && (r.value as { result?: { value?: unknown } } | undefined)?.result?.value === 2;
    const detachedByOwner =
      clientId !== undefined &&
      since(0, "Target.detachedFromTarget").some((h) => h.params["sessionId"] === clientId);
    report.R0 = { first: alive(r0a), later: alive(r0b), detachedByOwner };
    save("R0");
    if (LEG === "base") {
      if (!alive(r0b) || detachedByOwner)
        finish(0, "the owner detached the client's own session (the red, on Electron)");
      else finish(5, "the owner left the client's own session on the base tree (NOT AS WANTED)");
      close();
      return;
    }
    if (LEG === "fix" && !(alive(r0a) && alive(r0b))) {
      finish(5, "R0: the client's own session did not live (NOT AS WANTED)");
      close();
      return;
    }

    // R1: the client's own auto-attach, no filter, each attach waiting (agent-browser's). The client resumes what waits on
    // it at once, as the engine does — but for variant (b), which never resumes.
    const waiting: { child: string; t: number }[] = [];
    let resume = true;
    client.onEvent((event) => {
      if (event.method !== "Target.attachedToTarget" || event.child !== undefined) return;
      const child = String(event.params["sessionId"]);
      waiting.push({ child, t: ms() });
      if (resume) void tryOn("Runtime.runIfWaitingForDebugger", {}, child);
    });
    report.R1 = {
      setAutoAttach: await tryOn("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      }),
    };
    save("R1");
    const afterR1 = await holds("after R1");
    if (LEG === "fix") {
      // (a) a fresh frame of another site waits on the client too; the client resumes it at once: does it run before
      // the owner's guards? (its first script reads window.close)
      const mark = waiting.length;
      const na = await addFrame();
      const aLoaded = await waitFor(async () => (await frameSaid(na)) !== null, 8000);
      const a = {
        waitedOnClient: waiting.length > mark,
        loaded: aLoaded,
        said: await frameSaid(na),
      };
      // (b) the client never resumes: does the frame load?
      resume = false;
      const nb = await addFrame();
      const b = { loaded: await waitFor(async () => (await frameSaid(nb)) !== null, 8000) };
      resume = true;
      // (c) a third client waits its frames and never resumes, then goes while one waits: does it load?
      const third = await agentPortOf().openClientSession();
      await third.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      const nc = await addFrame();
      await pause(1000);
      const cBefore = (await frameSaid(nc)) !== null;
      await third.close();
      const c = {
        loadedBeforeItWent: cBefore,
        loaded: await waitFor(async () => (await frameSaid(nc)) !== null, 8000),
      };
      (report.R1 as Record<string, unknown>).variants = {
        resumedAtOnce: a,
        neverResumed: b,
        clientWentWhileWaiting: c,
      };
      save("R1 variants");
    }
    report.R2 = {};
    for (const domain of ["Page", "Runtime", "Network", "Fetch", "DOM"])
      (report.R2 as Record<string, unknown>)[domain] = await tryOn(`${domain}.disable`);
    save("R2");
    const afterR2 = await holds("after R2");
    report.R3 = {
      scripts: await Promise.all(
        ["1", "2", "3", "4", "5", "6"].map((identifier) =>
          tryOn("Page.removeScriptToEvaluateOnNewDocument", { identifier }),
        ),
      ),
      bindings: await Promise.all(
        [owner.PAGE_SCALE_BINDING, owner.FRAME_WORDS_BINDING].map((name) =>
          tryOn("Runtime.removeBinding", { name }),
        ),
      ),
    };
    save("R3");
    const afterR3 = await holds("after R3");
    const broken = [afterR1, afterR2, afterR3].some((h) => !allHeld(h));
    if (LEG === "control") {
      if (broken)
        finish(
          0,
          "the owner's own session, used by the client, broke a hold: the case can see a break",
        );
      else
        finish(
          2,
          "BLIND: the client's R1 to R3 on the owner's own session broke no hold the case reads",
        );
      close();
      return;
    }

    // R4: the client's Runtime.enable gets the page's live contexts itself (no replay); which worlds it sees
    const r4Mark = client.events.length;
    report.R4 = { enable: await tryOn("Runtime.enable") };
    await pause(1000);
    const contexts = client.events
      .slice(r4Mark)
      .filter((e) => e.method === "Runtime.executionContextCreated" && e.child === undefined)
      .map((e) => (e.params as { context?: { name?: string } }).context?.name ?? "");
    Object.assign(report.R4 as object, {
      contexts: contexts.length,
      worlds: [...new Set(contexts)],
      sawOwnersWords: contexts.includes(owner.WORDS_WORLD),
    });
    save("R4");
    // R5: a world one client makes — can a second client see it?
    const tree = (await tryOn("Page.getFrameTree")) as {
      value?: { frameTree?: { frame?: { id?: string } } };
    };
    const mainFrame = tree.value?.frameTree?.frame?.id;
    const made = await tryOn("Page.createIsolatedWorld", {
      frameId: mainFrame,
      worldName: "vf-probe-a",
    });
    const second = portClient(await agentPortOf().openClientSession());
    await second.send("Runtime.enable");
    await pause(1000);
    report.R5 = {
      made,
      secondSees: second.events.some(
        (e) =>
          e.method === "Runtime.executionContextCreated" &&
          (e.params as { context?: { name?: string } }).context?.name === "vf-probe-a",
      ),
    };
    save("R5");
    // R6: the client's own auto-attach with iframe and worker: do workers reach it, and stay?
    const r6Mark = client.events.length;
    report.R6 = {
      setAutoAttach: await tryOn("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [{ type: "iframe" }, { type: "worker" }],
      }),
    };
    const kinds = await js<unknown>(`(async()=>{
      const run=async(kind,start)=>{let cleanup=()=>{},timer;try{const value=await Promise.race([new Promise((resolve,reject)=>{cleanup=start(resolve,reject)||cleanup}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),4000)})]);return {kind,ok:true}}catch(e){return {kind,ok:false,error:String(e)}}finally{clearTimeout(timer);cleanup()}};
      const dedicated=path=>(resolve,reject)=>{const w=new Worker(path);w.onmessage=e=>resolve(e.data);w.onerror=e=>reject(Error(e.message));return ()=>w.terminate()};
      return Promise.all([run('dedicated',dedicated('/worker.js')),run('nested',dedicated('/nested-worker.js')),
        run('shared',(resolve,reject)=>{const w=new SharedWorker('/shared-worker.js');w.port.onmessage=e=>resolve(e.data);w.onerror=e=>reject(Error(e.message));return ()=>w.port.close()}),
        run('service',(resolve,reject)=>{const ch=new MessageChannel();ch.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.register('/service-worker.js').then(()=>navigator.serviceWorker.ready).then(r=>r.active.postMessage('probe',[ch.port2])).catch(reject);return ()=>ch.port1.close()})]);
    })()`);
    await pause(2000);
    const attaches = client.events
      .slice(r6Mark)
      .filter((e) => e.method === "Target.attachedToTarget")
      .map((e) => {
        const p = e.params as {
          sessionId?: string;
          targetInfo?: { type?: string; openerId?: string };
        };
        return {
          type: p.targetInfo?.type,
          openerId: p.targetInfo?.openerId ?? null,
          session: p.sessionId,
        };
      });
    const detached = new Set(
      client.events
        .slice(r6Mark)
        .filter((e) => e.method === "Target.detachedFromTarget")
        .map((e) => String((e.params as { sessionId?: string }).sessionId)),
    );
    report.R6 = {
      ...(report.R6 as object),
      kinds,
      attaches: attaches.map((a) => ({ ...a, stayed: !detached.has(String(a.session)) })),
    };
    save("R6");
    // R7: points at capture scale 0.5 — the button's CSS centre × 0.5 lands, the unscaled point misses; the box's space
    const box = await tryOn("DOM.getBoxModel", {
      objectId: (
        (await tryOn("Runtime.evaluate", { expression: "document.getElementById('target')" })) as {
          value?: { result?: { objectId?: string } };
        }
      ).value?.result?.objectId,
    });
    const press = async (x: number, y: number): Promise<number> => {
      const hitsBefore = await js<number>("window.__hits||0");
      for (const type of ["mousePressed", "mouseReleased"])
        await tryOn("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      await pause(200);
      return (await js<number>("window.__hits||0")) - hitsBefore;
    };
    const scrolled = await js<number>("scrollY");
    await tryOn("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 100,
      deltaX: 0,
      deltaY: 200,
    });
    await pause(500);
    report.R7 = {
      box,
      scaledHits: await press(650 * 0.5, 430 * 0.5),
      unscaledHits: await press(650, 430),
      wheelScrolled: (await js<number>("scrollY")) - scrolled,
    };
    save("R7");
    await js("scrollTo(0,0);true");
    // R8 (a measure): the client's own metrics override against the owner's next re-send
    const r8set = await tryOn("Emulation.setDeviceMetricsOverride", {
      width: 500,
      height: 400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const r8after = await js<number>("innerWidth");
    await s.setBackingRaster({ width: 800, height: 600 }, { width: 800, height: 600 }, 2);
    const r8resent = await js<number>("innerWidth");
    await tryOn("Emulation.clearDeviceMetricsOverride");
    await s.setBackingRaster({ width: 800, height: 600 }, { width: 800, height: 600 }, 2);
    report.R8 = {
      set: r8set,
      innerWidthAfterClient: r8after,
      innerWidthAfterOwnerResend: r8resent,
    };
    save("R8");
    // R9 (a measure): the client pauses the page — does the owner's own command still answer?
    await tryOn("Debugger.enable");
    const r9pause = await tryOn("Debugger.pause");
    await pause(300);
    const answered = await Promise.race([
      cdp.sendCommand("Runtime.evaluate", { expression: "1" }).then(
        () => "answered",
        (error) => `refused: ${String(error).slice(0, 80)}`,
      ),
      pause(3000).then(() => "stalled"),
    ]);
    await tryOn("Debugger.resume");
    await tryOn("Debugger.disable");
    report.R9 = { pause: r9pause, ownersCommand: answered };
    save("R9");
    // R11 (a measure): what the trusted client's Target.getTargets lists
    const targets = (await tryOn("Target.getTargets")) as {
      value?: { targetInfos?: { type?: string }[] };
    };
    report.R11 = {
      count: targets.value?.targetInfos?.length ?? null,
      types: (targets.value?.targetInfos ?? []).map((t) => t.type),
    };
    save("R11");
    // R10: the client closed — the holds after; then the window destroyed with a second client live
    await client.close();
    const closedReason =
      client.closed === undefined
        ? null
        : await Promise.race([client.closed, pause(2000).then(() => null)]);
    const afterR10 = await holds("after R10");
    s.destroy();
    const secondEnded =
      second.closed === undefined
        ? null
        : await Promise.race([second.closed, pause(2000).then(() => null)]);
    report.R10 = { closed: closedReason, secondEndedByDestroy: secondEnded };
    save("R10");
    const independent = allHeld(before) && [afterR1, afterR2, afterR3, afterR10].every(allHeld);
    report.independent = independent;
    if (independent)
      finish(
        0,
        "independent: every B row held before, and after R1, R2, R3 and R10; the session lived",
      );
    else
      finish(
        5,
        "NOT independent: a B row broke after the client's own session's commands (the bridge falls back to the owner's shared session)",
      );
    close();
  })
  .catch((error) => {
    finish(1, `the case's error: ${String(error).slice(0, 300)}`);
    close();
  });
