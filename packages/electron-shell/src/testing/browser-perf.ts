/** Opt-in real-desk browser benchmark; invoked only by --smoke-canvas --browser-perf. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, screen, type WebContents, webContents } from "electron";
import { browserPaneUi } from "./browser-pane-ui";
import { browserPerfMulti } from "./browser-perf-multi";
import { startLiveFixture } from "./live-fixture";
import {
  layPane,
  type PaneRowsDriver,
  pageRegion,
  paneHands,
  paneToMiddle,
} from "./smoke-browser-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";
import { keepFromPerson } from "./smoke-window";

interface DeskSnapshot {
  perf: { frames: number };
  live: { faces: Array<{ key: string; presented: number }>; stats: unknown } | null;
  submits: unknown;
  held: unknown;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const WATCH_MS = Number(process.env["VF_BROWSER_PERF_MS"] ?? 12000);
const WARM_MS = Number(process.env["VF_BROWSER_PERF_WARM_MS"] ?? 20000);
const MODE = process.env["VF_BROWSER_PERF_MODE"] ?? "canvas";
const OUT = process.env["VF_BROWSER_PERF_OUT"];
function summary(values: number[]) {
  const v = values.slice().sort((a, b) => a - b);
  return {
    count: v.length,
    p50: v[Math.floor(v.length * 0.5)] ?? null,
    p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] ?? null,
    max: v.at(-1) ?? null,
    over33ms: v.filter((n) => n > 33.4).length,
  };
}
const PAGE_FACTS = `({url:location.href,title:document.title,ready:document.readyState,
  width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState,
  viewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},
  canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight})),
  text:document.body.innerText.slice(0,400),timeOrigin:performance.timeOrigin})`;
// rAF is scheduling evidence, not proof of scanout. Pane presentations and OSR paints are counted separately.
const START_PAGE = `(() => {
  const p = {start:performance.now(),intervals:[],moves:[],wheels:[],last:0,stop:false};
  const tick = t => { if(p.stop)return; if(p.last)p.intervals.push(t-p.last); p.last=t; requestAnimationFrame(tick); };
  p.move = e => p.moves.push({at:Date.now(),x:e.clientX,y:e.clientY,trusted:e.isTrusted});
  p.wheel = e => p.wheels.push({at:Date.now(),dy:e.deltaY,trusted:e.isTrusted});
  addEventListener('pointermove',p.move,{passive:true}); addEventListener('wheel',p.wheel,{passive:true});
  requestAnimationFrame(tick); globalThis.__vfBrowserPerf = p;
})()`;
const STOP_PAGE = `(() => { const p=globalThis.__vfBrowserPerf; p.stop=true;
  removeEventListener('pointermove',p.move);removeEventListener('wheel',p.wheel);
  delete globalThis.__vfBrowserPerf;return {ms:performance.now()-p.start,intervals:p.intervals,moves:p.moves,wheels:p.wheels}; })()`;

export async function browserPerf(d: PaneRowsDriver): Promise<string[]> {
  const fixture = await startLiveFixture(resolve(app.getAppPath(), "../../fixtures/live-panes"));
  const pageUrl = fixture.origin + "/gpu.html";
  try {
    if (process.env["VF_BROWSER_PERF_UI"] === "1")
      return await browserPaneUi(d, pageUrl, fixture.origin + "/media.html");
    const panes = Number(process.env["VF_BROWSER_PERF_PANES"] ?? 1);
    if (panes > 1) return await browserPerfMulti(d, panes, pageUrl);
    return await browserPerfSingle(d, pageUrl);
  } finally {
    await fixture.close();
  }
}

async function browserPerfSingle(d: PaneRowsDriver, pageUrl: string): Promise<string[]> {
  if (!OUT) throw new Error("VF_BROWSER_PERF_OUT must name this benchmark run directory");
  mkdirSync(OUT, { recursive: true });
  const h = paneHands(d);
  const report: Record<string, unknown> = {
    url: pageUrl,
    mode: MODE,
    variant: process.env["VF_BROWSER_PERF_VARIANT"] ?? "baseline",
    createdAt: new Date().toISOString(),
    versions: process.versions,
    display: screen.getPrimaryDisplay(),
    warmMs: WARM_MS,
    watchMs: WATCH_MS,
    phases: [],
  };
  let native: BrowserWindow | undefined;
  let page: WebContents | undefined;
  let removePaint: (() => void) | undefined;
  try {
    await h.js(`globalThis.__vfDesk.ambient('still')`);
    await h.theme("light");
    let key: string | undefined;
    let entity: number | undefined;
    if (MODE === "native") {
      d.win.hide();
      native = new BrowserWindow({
        width: 1280,
        height: 800,
        useContentSize: true,
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      keepFromPerson(native);
      native.showInactive();
      page = native.webContents;
      await page.loadURL("about:blank");
      d.say("BROWSER_PERF native bootstrap ready");
      page.debugger.attach("1.3");
      await page.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        screenWidth: 1280,
        screenHeight: 800,
        deviceScaleFactor: 2,
        mobile: false,
      });
      await page.loadURL(pageUrl);
    } else {
      const at = await layPane(h, await h.census(), () => {});
      if (at.pane === undefined) throw new Error("No browser pane created");
      entity = at.pane;
      await paneToMiddle(h, entity, at);
      await sleep(500);
      const row = (await h.rows()).find((r) => r.entity === entity);
      if (!row?.key) throw new Error("Browser pane has no durable key");
      key = row.key;
      if (
        !(await h.js(`globalThis.__vfDesk.writeProps(${entity},{url:${JSON.stringify(pageUrl)}})`))
      )
        throw new Error("Could not navigate pane");
      await h.until(
        "GPU fixture live",
        90000,
        `globalThis.__vfDesk.live()?.faces.some(f=>f.key===${JSON.stringify(key)} && f.state.is==='live' && f.presented>0 && f.info.loading===undefined)`,
      );
      page = webContents
        .getAllWebContents()
        .find((p) => !p.isDestroyed() && p.isOffscreen() && p.getURL().startsWith(pageUrl));
      if (!page) throw new Error("No GPU fixture WebContents");
      report.atRest = await h.js(
        `({perf:globalThis.__vfDesk.perf(),live:globalThis.__vfDesk.live()})`,
      );
      const frame = await h.frame();
      if (!frame) throw new Error("No pane selection frame");
      const r = pageRegion(frame, row.rect);
      await h.press({
        x: at.deskOff.left + (r.x0 + r.x1) / 2,
        y: at.deskOff.top + (r.y0 + r.y1) / 2,
      });
      await h.key("Return");
      await h.until(
        "held browser settled",
        10000,
        `globalThis.__vfDesk.held()?.entity===${entity} && globalThis.__vfDesk.held()?.frame?.settled===true`,
      );
      await h.until(
        "held browser at requested frame rate",
        10000,
        `globalThis.__vfDesk.live()?.faces.some(f=>f.key===${JSON.stringify(key)} && f.wire?.targetFps===${Number(process.env["VF_BROWSER_PERF_FPS"] ?? 60)})`,
      );
    }
    const source = page;
    const sourceFps = Number(process.env["VF_BROWSER_PERF_SOURCE_FPS"]);
    if (source.isOffscreen() && Number.isFinite(sourceFps) && sourceFps > 0) {
      source.setFrameRate(sourceFps);
      report.sourceFpsOverride = sourceFps;
    }
    const errors: string[] = [];
    source.on("render-process-gone", (_e, details) => errors.push(`renderer: ${details.reason}`));
    source.on("did-fail-load", (_e, code, description, url, main) => {
      if (main) errors.push(`load: ${code} ${description} ${url}`);
    });
    let paints = 0,
      shared = 0,
      cpu = 0;
    let paintTimes: number[] = [];
    let lastTexture: unknown = null;
    const onPaint = (
      event: Electron.Event<Electron.WebContentsPaintEventParams>,
      _dirty: Electron.Rectangle,
      image: Electron.NativeImage,
    ) => {
      paints++;
      paintTimes.push(performance.now());
      if (event.texture) {
        shared++;
        const { handle: _handle, ...info } = event.texture.textureInfo;
        lastTexture = info;
      } else {
        cpu++;
        lastTexture = image?.getSize();
      }
    };
    if (source.isOffscreen()) {
      source.on("paint", onPaint);
      removePaint = () => source.removeListener("paint", onPaint);
    }
    report.webContentsId = source.id;
    report.nativeFrameRate = source.isOffscreen() ? source.getFrameRate() : null;
    report.commandLine = process.argv.filter(
      (a) => a.startsWith("--disable-frame-rate") || a.startsWith("--disable-gpu-vsync"),
    );
    report.target = await source.debugger.sendCommand("Target.getTargetInfo");
    d.say(`BROWSER_PERF warmup ${MODE} ${WARM_MS}ms`);
    await sleep(WARM_MS);
    if (!(await source.executeJavaScript('document.documentElement.dataset.gpu === "ready"')))
      throw Error("The GPU fixture did not draw a frame");
    report.page = await source.executeJavaScript(PAGE_FACTS);
    await screenshot("warm");
    async function screenshot(name: string) {
      const img = await (native ?? d.win).webContents.capturePage();
      writeFileSync(join(OUT!, `${name}.png`), img.toPNG());
    }
    const deskSnapshot = () =>
      h.js<DeskSnapshot>(
        `({perf:globalThis.__vfDesk.perf(),live:globalThis.__vfDesk.live(),submits:globalThis.__vfDesk.submits(),held:globalThis.__vfDesk.held()})`,
      );
    for (const phase of ["idle", "pointer", "wheel"]) {
      const facts = await source.executeJavaScript(PAGE_FACTS);
      const held =
        MODE === "canvas" ? await h.js<HeldFrameSeen>("globalThis.__vfDesk.held().frame") : null;
      const offset = MODE === "canvas" ? await h.deskAt() : null;
      const point = (x: number, y: number) =>
        held && offset ? pageOnWindow(held, [facts.width, facts.height], offset, x, y) : { x, y };
      const target = native?.webContents ?? d.win.webContents;
      const before = await deskSnapshot();
      const cdpInput: Array<Record<string, unknown>> = [];
      const originalCommand = source.debugger.sendCommand;
      source.debugger.sendCommand = async function (method, params, sessionId) {
        const record = method.startsWith("Input.")
          ? { method, params, at: Date.now(), doneAt: 0 }
          : undefined;
        if (record) cdpInput.push(record);
        try {
          return await originalCommand.call(this, method, params, sessionId);
        } finally {
          if (record) record.doneAt = Date.now();
        }
      };
      const paintBefore = { paints, shared, cpu };
      paintTimes = [];
      const sent: Array<{ at: number; x: number; y: number; dy?: number }> = [];
      const metrics: unknown[] = [];
      app.getAppMetrics();
      const cpuTimer = setInterval(
        () =>
          metrics.push(
            app
              .getAppMetrics()
              .map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.percentCPUUsage })),
          ),
        1000,
      );
      await source.executeJavaScript(START_PAGE);
      const t0 = performance.now();
      let tick = 0;
      const inputTimer =
        phase === "idle"
          ? undefined
          : setInterval(
              () => {
                const px =
                  phase === "pointer"
                    ? 100 + (tick % Math.max(1, facts.width - 200))
                    : facts.width * 0.5;
                const py =
                  phase === "pointer"
                    ? facts.height * 0.4 + Math.sin(tick / 30) * 80
                    : facts.height * 0.5;
                const p = point(px, py);
                const at = Date.now();
                if (phase === "pointer")
                  target.sendInputEvent({
                    type: "mouseMove",
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                  });
                else
                  target.sendInputEvent({
                    type: "mouseWheel",
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                    deltaY: -8 * (held ? (2 * held.hx) / facts.width : 1),
                    deltaX: 0,
                    canScroll: true,
                  });
                sent.push({ at, x: px, y: py, ...(phase === "wheel" ? { dy: -8 } : {}) });
                tick++;
              },
              phase === "pointer" ? 1000 / 60 : 1000 / 30,
            );
      try {
        await sleep(WATCH_MS);
      } finally {
        if (inputTimer) clearInterval(inputTimer);
        clearInterval(cpuTimer);
      }
      const measuredMs = performance.now() - t0;
      source.debugger.sendCommand = originalCommand;
      const counters = {
        paints: paints - paintBefore.paints,
        shared: shared - paintBefore.shared,
        cpu: cpu - paintBefore.cpu,
      };
      const measuredPaintTimes = paintTimes.slice();
      const measuredPage = await source.executeJavaScript(STOP_PAGE);
      const after = await deskSnapshot();
      const face = (s: DeskSnapshot) => s.live?.faces.find((f) => f.key === key);
      const fb = face(before),
        fa = face(after);
      const presents = fa && fb ? fa.presented - fb.presented : null;
      const result = {
        phase,
        nativeFrameRate: source.isOffscreen() ? source.getFrameRate() : null,
        measuredMs,
        pageFacts: facts,
        sourceRafFps: (measuredPage.intervals.length / measuredPage.ms) * 1000,
        sourceRafIntervals: summary(measuredPage.intervals),
        sourcePaintFps: (counters.paints / measuredMs) * 1000,
        paints: counters,
        paintIntervals: summary(
          measuredPaintTimes.slice(1).map((n, i) => n - measuredPaintTimes[i]!),
        ),
        paneFps: presents === null ? null : (presents / measuredMs) * 1000,
        presents,
        deskFps: ((after.perf.frames - before.perf.frames) / measuredMs) * 1000,
        before,
        after,
        lastTexture,
        sent,
        cdpInput,
        received: measuredPage,
        processMetrics: metrics,
      };
      (report.phases as unknown[]).push(result);
      d.say(
        `BROWSER_PERF ${JSON.stringify({ phase, mode: MODE, sourceRafFps: result.sourceRafFps, sourcePaintFps: result.sourcePaintFps, paneFps: result.paneFps, deskFps: result.deskFps, paints: counters, sent: sent.length, moves: measuredPage.moves.length, wheels: measuredPage.wheels.length })}`,
      );
      await screenshot(phase);
      await sleep(1500);
    }
    if (source.isOffscreen() && process.env["VF_BROWSER_PERF_SOURCE_ONLY"] === "1") {
      // Diagnostic isolation only: leave the page/target alive, remove the
      // product's paint delivery, and promptly release each OSR capture.
      const listeners = source
        .listeners("paint")
        .filter((listener) => listener !== onPaint) as Array<typeof onPaint>;
      for (const listener of listeners) source.removeListener("paint", listener);
      const release = (event: Electron.Event<Electron.WebContentsPaintEventParams>) =>
        event.texture?.release();
      source.on("paint", release);
      try {
        source.setFrameRate(Number.isFinite(sourceFps) ? sourceFps : 120);
        await sleep(2500);
        const before = paints;
        const t = performance.now();
        await source.executeJavaScript(START_PAGE);
        await sleep(WATCH_MS);
        const measured = await source.executeJavaScript(STOP_PAGE);
        report.sourceOnly = {
          ms: performance.now() - t,
          requestedFps: source.getFrameRate(),
          paintFps: ((paints - before) / (performance.now() - t)) * 1000,
          rafFps: (measured.intervals.length / measured.ms) * 1000,
        };
        d.say(`BROWSER_PERF_SOURCE_ONLY ${JSON.stringify(report.sourceOnly)}`);
      } finally {
        source.removeListener("paint", release);
        for (const listener of listeners) source.on("paint", listener);
        source.invalidate();
      }
    }
    // Item 658 (2026-11-26): the benchmark drives no agent-browser. The pages engine runs only through main's broker.
    report.finalNativeFrameRate = source.isOffscreen() ? source.getFrameRate() : null;
    report.finalPage = await source.executeJavaScript(PAGE_FACTS);
    report.finalTarget = await source.debugger.sendCommand("Target.getTargetInfo");
    report.errors = errors;
    if (errors.length) throw new Error(errors.join("; "));
    report.ok = true;
    return [];
  } catch (error) {
    report.ok = false;
    report.error = String(error);
    return [`BROWSER_PERF: ${error instanceof Error ? error.message : String(error)}`];
  } finally {
    removePaint?.();
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    native?.destroy();
    d.say(`BROWSER_PERF_REPORT ${join(OUT, "report.json")}`);
  }
}
