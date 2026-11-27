/** Real product multi-pane stress run. Each pane runs the local GPU fixture. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, screen, webContents } from "electron";
import {
  layPane,
  type PaneRow,
  type PaneRowsDriver,
  paneHands,
  paneToMiddle,
} from "./smoke-browser-pane";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
interface Face {
  key: string;
  presented: number;
  arrivals: number;
  dropped: number;
  wire: unknown;
  demand: unknown;
  texture?: { width: number; height: number; bytes: number };
}
interface Snapshot {
  perf: { frames: number; ticks: number; frameMs: number };
  live: { faces: Face[]; stats: unknown };
  uploads: unknown;
  rest: unknown;
}
const facts = `({url:location.href,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState,viewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},timeOrigin:performance.timeOrigin,canvases:[...document.querySelectorAll('canvas')].map(c=>[c.width,c.height,c.clientWidth,c.clientHeight])})`;
const start = `(()=>{const p={start:performance.now(),count:0,last:0,intervals:[],stop:false};function tick(t){if(p.stop)return;p.count++;if(p.last)p.intervals.push(t-p.last);p.last=t;requestAnimationFrame(tick)}requestAnimationFrame(tick);globalThis.__vfMultiPerf=p;})()`;
const end = `(()=>{const p=globalThis.__vfMultiPerf;p.stop=true;delete globalThis.__vfMultiPerf;return {ms:performance.now()-p.start,count:p.count,intervals:p.intervals};})()`;
const percentile = (xs: number[], q: number) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? null;

export async function browserPerfMulti(
  d: PaneRowsDriver,
  count: number,
  pageUrl: string,
): Promise<string[]> {
  const out = process.env["VF_BROWSER_PERF_OUT"]!;
  const warm = Number(process.env["VF_BROWSER_PERF_WARM_MS"] ?? 20000);
  const watch = Number(process.env["VF_BROWSER_PERF_MS"] ?? 12000);
  mkdirSync(out, { recursive: true });
  const h = paneHands(d);
  const report: Record<string, unknown> = {
    mode: "multi",
    panes: count,
    createdAt: new Date().toISOString(),
    versions: process.versions,
    display: screen.getPrimaryDisplay(),
    variant: process.env["VF_BROWSER_PERF_VARIANT"],
    warmMs: warm,
    watchMs: watch,
    phases: [],
  };
  const cleanup: Array<() => void> = [];
  try {
    await h.js(`globalThis.__vfDesk.ambient('still')`);
    await h.theme("light");
    const at = await layPane(h, await h.census(), () => {});
    if (at.pane === undefined) throw Error("No first pane");
    await paneToMiddle(h, at.pane, at);
    const first = (await h.rows()).find((r) => r.entity === at.pane)!;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const area = await h.js<{ w: number; h: number }>(
      `(()=>{const r=document.querySelector('[data-desk]').getBoundingClientRect();return {w:r.width,h:r.height}})()`,
    );
    // Fixed screen grid, ordinary product zoom, unchanged page CSS viewport.
    for (let i = 0; i < 10; i++) {
      const c = await h.js<{ zoom: number }>(`globalThis.__vfDesk.camera()`);
      if (
        first.rect.w * c.zoom * cols + 80 * (cols + 1) < area.w &&
        first.rect.h * c.zoom * rows + 80 * (rows + 1) < area.h
      )
        break;
      await h.key("-", [process.platform === "darwin" ? "meta" : "control"]);
      await sleep(300);
    }
    const c = await h.js<{ zoom: number }>(`globalThis.__vfDesk.camera()`);
    const w = first.rect.w * c.zoom,
      height = first.rect.h * c.zoom;
    if (w * cols >= area.w || height * rows >= area.h) throw Error("Pane grid does not fit");
    const offset = await h.deskAt();
    const made: PaneRow[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        const known = (await h.rows()).map((r) => r.entity);
        await h.pressSelector('.vf-bar [data-act="duplicate"]');
        await h.until(
          "pane duplicated",
          8000,
          `globalThis.__vfDesk.objects('vibefield.browser-pane').some(r=>!${JSON.stringify(known)}.includes(r.entity))`,
        );
        await sleep(400);
        const fresh = (await h.rows()).find((r) => !known.includes(r.entity));
        if (!fresh) throw Error("Duplicate missing");
        made.push(fresh);
      } else made.push(first);
      const f = await h.frame();
      if (!f) throw Error("Duplicate not selected");
      const from = {
        x: offset.left + (f.x0 + f.x1) / 2,
        y: offset.top + f.y0 + Math.min(10, (f.y1 - f.y0) * 0.04),
      };
      const goal = {
        x: offset.left + (area.w * ((i % cols) + 0.5)) / cols,
        y:
          offset.top +
          (area.h * (Math.floor(i / cols) + 0.5)) / rows -
          height / 2 +
          Math.min(10, height * 0.04),
      };
      await h.drag(from, goal, 12, 250);
      await sleep(300);
    }
    const keys = made.map((r) => r.key);
    for (let i = 0; i < made.length; i++) {
      const url = `${pageUrl}#vf-perf-pane-${i}`;
      if (
        !(await h.js(
          `globalThis.__vfDesk.writeProps(${made[i]!.entity},{url:${JSON.stringify(url)}})`,
        ))
      )
        throw Error("Navigation refused");
    }
    await h.key("Escape");
    await h.until(
      "all GPU panes live",
      120000,
      `(()=>{const fs=globalThis.__vfDesk.live().faces;return ${JSON.stringify(keys)}.every(k=>fs.some(f=>f.key===k&&f.state.is==='live'&&f.presented>0&&f.info.loading===undefined));})()`,
    );
    if (process.env["VF_BROWSER_PERF_INTERACTIVE"] === "1") {
      // Hand the prepared desk to the person. No timed phases, synthetic input
      // or paint observers continue after this point; closing ends the session.
      report.mode = "interactive";
      report.readyAt = new Date().toISOString();
      d.win.setTitle("VibeField — Browser performance preview");
      d.win.setIgnoreMouseEvents(false);
      d.win.setFocusable(true);
      d.win.show();
      d.win.focus();
      app.focus({ steal: true });
      writeFileSync(join(out, "interactive.png"), (await d.win.capturePage()).toPNG());
      d.say(
        `BROWSER_PERF_INTERACTIVE_READY ${JSON.stringify({ panes: count, visible: d.win.isVisible(), focused: d.win.isFocused(), bounds: d.win.getBounds() })}`,
      );
      await new Promise<void>((resolve) => d.win.once("closed", () => resolve()));
      report.ok = true;
      return [];
    }
    const sources = made.map((r, i) => {
      const page = webContents
        .getAllWebContents()
        .find(
          (p) =>
            p.isOffscreen() && !p.isDestroyed() && p.getURL() === `${pageUrl}#vf-perf-pane-${i}`,
        );
      if (!page) throw Error(`Missing page ${i}`);
      let paints = 0,
        shared = 0,
        cpu = 0;
      let size: unknown;
      const onPaint = (
        e: Electron.Event<Electron.WebContentsPaintEventParams>,
        _r: Electron.Rectangle,
        img: Electron.NativeImage,
      ) => {
        paints++;
        if (e.texture) {
          shared++;
          size = e.texture.textureInfo.codedSize;
        } else {
          cpu++;
          size = img.getSize();
        }
      };
      page.on("paint", onPaint);
      cleanup.push(() => page.removeListener("paint", onPaint));
      return { key: r.key, page, counts: () => ({ paints, shared, cpu, size }) };
    });
    const snap = () =>
      h.js<Snapshot>(
        `({perf:globalThis.__vfDesk.perf(),live:globalThis.__vfDesk.live(),uploads:globalThis.__vfDesk.uploads(),rest:globalThis.__vfDesk.rest()})`,
      );
    d.say(`BROWSER_PERF_MULTI warmup ${count} panes ${warm}ms`);
    await sleep(warm);
    report.layout = {
      area,
      camera: await h.js("globalThis.__vfDesk.camera()"),
      panes: (await h.rows()).filter((r) => keys.includes(r.key)),
    };
    report.pages = await Promise.all(
      sources.map(async (s) => ({
        key: s.key,
        webContentsId: s.page.id,
        target: await s.page.debugger.sendCommand("Target.getTargetInfo"),
        facts: await s.page.executeJavaScript(facts),
      })),
    );
    async function measure(phase: string) {
      const before = await snap();
      const counters = sources.map((s) => s.counts());
      await Promise.all(sources.map((s) => s.page.executeJavaScript(start)));
      const metrics: Array<Array<{ pid: number; type: string; cpu: number; memory: unknown }>> = [];
      app.getAppMetrics();
      const timer = setInterval(
        () =>
          metrics.push(
            app.getAppMetrics().map((m) => ({
              pid: m.pid,
              type: m.type,
              cpu: m.cpu.percentCPUUsage,
              memory: m.memory,
            })),
          ),
        1000,
      );
      const t = performance.now();
      await sleep(watch);
      clearInterval(timer);
      const ms = performance.now() - t;
      const pages = await Promise.all(sources.map((s) => s.page.executeJavaScript(end)));
      const after = await snap();
      const panes = sources.map((s, i) => {
        const a = before.live.faces.find((f) => f.key === s.key)!,
          b = after.live.faces.find((f) => f.key === s.key)!;
        const pc = s.counts(),
          bc = counters[i]!,
          p = pages[i];
        return {
          key: s.key,
          sourceRafFps: (p.count / p.ms) * 1000,
          rafP95Ms: percentile(p.intervals, 0.95),
          sourcePaintFps: ((pc.paints - bc.paints) / ms) * 1000,
          sharedPaints: pc.shared - bc.shared,
          cpuPaints: pc.cpu - bc.cpu,
          size: pc.size,
          nativeFrameRate: s.page.getFrameRate(),
          paneFps: ((b.presented - a.presented) / ms) * 1000,
          arrivalFps: ((b.arrivals - a.arrivals) / ms) * 1000,
          dropped: b.dropped - a.dropped,
          wire: b.wire,
          demand: b.demand,
          texture: b.texture,
        };
      });
      const result = {
        phase,
        ms,
        deskFps: ((after.perf.frames - before.perf.frames) / ms) * 1000,
        deskTicks: ((after.perf.ticks - before.perf.ticks) / ms) * 1000,
        deskCpuMs: after.perf.frameMs - before.perf.frameMs,
        panes,
        before,
        after,
        processMetrics: metrics,
      };
      (report.phases as unknown[]).push(result);
      d.say(
        `BROWSER_PERF_MULTI ${JSON.stringify({ phase, deskFps: result.deskFps, panes: panes.map((p) => ({ fps: p.paneFps, paint: p.sourcePaintFps, size: p.size, texture: p.texture })) })}`,
      );
      writeFileSync(join(out, `${phase}.png`), (await d.win.webContents.capturePage()).toPNG());
    }
    await measure("all-visible");
    // Item 658 (2026-11-26): the benchmark drives no agent-browser. The pages engine runs only through main's broker.
    const active = (await h.rows()).find((r) => r.entity === first.entity)!;
    const cam = await h.js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    await h.press({
      x: offset.left + (active.rect.x + active.rect.w / 2 - cam.x) * cam.zoom,
      y: offset.top + (active.rect.y + active.rect.h / 2 - cam.y) * cam.zoom,
    });
    await h.until("pane selected", 8000, "globalThis.__vfDesk.anchor()?.count===1");
    await sleep(400);
    report.beforeHold = await h.js(
      "({anchor:globalThis.__vfDesk.anchor(),held:globalThis.__vfDesk.held()})",
    );
    await h.key("Return");
    await h.until(
      "first pane held",
      10000,
      `globalThis.__vfDesk.held()?.entity===${first.entity}&&globalThis.__vfDesk.held()?.frame?.settled===true`,
    );
    await sleep(3000);
    await measure("one-held");
    await h.key("Escape");
    await sleep(3000);
    await measure("all-visible-again");
    report.finalPages = await Promise.all(
      sources.map(async (s) => ({
        key: s.key,
        webContentsId: s.page.id,
        facts: await s.page.executeJavaScript(facts),
      })),
    );
    report.ok = true;
    return [];
  } catch (e) {
    report.ok = false;
    report.error = String(e);
    report.failureDesk = await h
      .js(
        "({anchor:globalThis.__vfDesk.anchor(),held:globalThis.__vfDesk.held(),camera:globalThis.__vfDesk.camera()})",
      )
      .catch(() => null);
    return [`BROWSER_PERF_MULTI: ${String(e)}`];
  } finally {
    for (const f of cleanup) f();
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    d.say(`BROWSER_PERF_REPORT ${join(out, "report.json")}`);
  }
}
