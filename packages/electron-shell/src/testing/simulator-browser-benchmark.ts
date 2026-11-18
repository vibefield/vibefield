import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screen, type WebContents, webContents } from "electron";
import type { PaneHands } from "./smoke-browser-pane";
import type { PhoneRowsDriver } from "./smoke-phone";

const sampleMs = 6_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Face {
  surface: string | null;
  mode: string | null;
  targetFps: number | null;
  raster: { width: number; height: number } | null;
  texture: { width: number; height: number } | null;
  degraded: boolean;
  state: string;
  arrivals: number;
  presented: number;
  dropped: number;
}

interface FrameTiming {
  source: number | null;
  host: number;
  arrived: number | null;
  presented: number;
}

function percentiles(values: number[]) {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return {
    p50: values[Math.ceil(values.length * 0.5) - 1]!,
    p95: values[Math.ceil(values.length * 0.95) - 1]!,
    max: values[values.length - 1]!,
  };
}

/** How far apart the two independently produced frames reached the renderer. */
function peerArrivalOffset(phone: FrameTiming[], browser: FrameTiming[]) {
  const peer = browser.flatMap((frame) => (frame.arrived === null ? [] : [frame.arrived]));
  if (peer.length < 2) return null;
  let index = 0;
  const offsets: number[] = [];
  for (const { arrived } of phone) {
    if (arrived === null || arrived < peer[0]! || arrived > peer[peer.length - 1]!) continue;
    while (index + 1 < peer.length && peer[index + 1]! <= arrived) index++;
    offsets.push(Math.min(arrived - peer[index]!, (peer[index + 1] ?? arrived) - arrived));
  }
  return percentiles(offsets);
}

function timingSummary(frames: FrameTiming[]) {
  // Epochs differ across processes. Only subtract timestamps from the same clock.
  const gaps = (field: keyof FrameTiming) => {
    const values: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]![field],
        b = frames[i]![field];
      if (a !== null && b !== null) values.push(b - a);
    }
    return percentiles(values);
  };
  return {
    count: frames.length,
    sourceGap: gaps("source"),
    hostGap: gaps("host"),
    arrivalGap: gaps("arrived"),
    presentGap: gaps("presented"),
    arrivalToPresent: percentiles(
      frames.flatMap((f) => (f.arrived === null ? [] : [f.presented - f.arrived])),
    ),
  };
}

interface Snapshot {
  timings: Record<string, FrameTiming[]>;
  at: number;
  deskFrames: number;
  deskFrameMs: number;
  camera: { x: number; y: number; zoom: number };
  alive: number;
  cap: number;
  faces: Record<string, Face>;
}

function faceDelta(a: Face, b: Face, ms: number) {
  if (
    a.surface !== b.surface ||
    a.mode !== b.mode ||
    a.targetFps !== b.targetFps ||
    JSON.stringify(a.raster) !== JSON.stringify(b.raster)
  ) {
    throw new Error("The surface or its demand changed inside the measurement window");
  }
  const presented = b.presented - a.presented;
  const arrived = b.arrivals - a.arrivals;
  const dropped = b.dropped - a.dropped;
  if (Math.min(presented, arrived, dropped) < 0) throw new Error("A face counter reset");
  return {
    mode: b.mode,
    targetFps: b.targetFps,
    raster: b.raster,
    texture: b.texture,
    state: b.state,
    degraded: b.degraded,
    presented,
    arrived,
    dropped,
    presentFps: (presented * 1000) / ms,
    arrivalFps: (arrived * 1000) / ms,
  };
}

/** Counters come from the shipping desk and SCK adapter. Screenshot readback is outside timed windows. */
export function simulatorBenchmark(
  d: PhoneRowsDriver,
  h: PaneHands,
  phone: string,
  device: string,
  runtime: string,
  helperFrames: () => number,
) {
  if (!d.shotDir) throw new Error("The simulator benchmark needs the stage's output directory");
  const out = d.shotDir;
  const pageUrl = d.fixture.origin + "/gpu.html#vf-simulator-perf";
  const previewBatching =
    new URL(d.win.webContents.getURL()).searchParams.get("simulatorPreviewBatch") === "1";
  const requestedBatching =
    d.env["VF_SIMULATOR_PREVIEW_BATCHING"] === "1" ||
    d.env["VF_PHONE_COMPARE_PREVIEW_PACING"] === "1";
  if (previewBatching !== requestedBatching)
    throw new Error("Unexpected preview scheduling mode on the benchmark canvas");
  const report = {
    previewBatching,
    createdAt: new Date().toISOString(),
    completedAt: null as string | null,
    device,
    runtime,
    captureBackend:
      d.env["VF_SIMULATOR_FRAMEBUFFER"] !== "0" ? "simulator-framebuffer" : "ScreenCaptureKit",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    os: process.getSystemVersion(),
    displayHz: screen.getDisplayMatching(d.win.getBounds()).displayFrequency,
    browserUrl: pageUrl,
    browserPage: null as unknown,
    sampleMs,
    finalStillCoverage: null as number | null,
    mixedStillCoverage: null as number | null,
    phases: [] as unknown[],
  };
  const reportPath = join(out, "simulator-browser.json");
  const save = () => {
    const pending = `${reportPath}.tmp`;
    writeFileSync(pending, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(pending, reportPath);
  };
  let page: WebContents | undefined;
  let paints = 0;
  let sharedPaints = 0;
  const paint = (event: Electron.Event<Electron.WebContentsPaintEventParams>) => {
    paints++;
    if (event.texture) sharedPaints++;
  };
  const snapshot = (): Promise<Snapshot> =>
    h.js(`(() => {
    const d = globalThis.__vfDesk, live = d.live(), perf = d.perf();
    const faces = Object.fromEntries(live.faces.map(f => [f.key, {
      surface: f.surface, mode: f.wire?.mode ?? null, targetFps: f.wire?.targetFps ?? null,
      raster: f.wire?.targetRasterSize ?? null, state: f.state.is, degraded: f.simulator?.degraded === true,
      texture: f.texture ? {width:f.texture.width,height:f.texture.height} : null,
      arrivals: f.arrivals, presented: f.presented, dropped: f.dropped
    }]));
    const timings = Object.fromEntries(Object.entries(globalThis.__vfSurfaceClocks ?? {}).map(([key, clock]) => [key, clock.frames.splice(0)]));
    return {at: performance.now(), timings, deskFrames: perf.frames, deskFrameMs: perf.frameMs, camera: d.camera(),
      cap: live.stats.cap, alive: live.stats.alive, faces};
  })()`);
  return {
    pageUrl,
    async attachBrowser(key: string) {
      await h.until(
        "The GPU fixture on the canvas",
        90_000,
        `globalThis.__vfDesk.live().faces.some(f => f.key===${JSON.stringify(key)} &&
          f.current && f.presented > 0 && f.info.loading === undefined && f.info.address === ${JSON.stringify(pageUrl)})`,
      );
      page = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.isOffscreen() && w.getURL() === pageUrl);
      if (!page) throw new Error("The GPU fixture's offscreen WebContents was not found");
      const until = performance.now() + 30_000;
      for (;;) {
        const facts =
          await page.executeJavaScript(`({ title: document.title, ready: document.documentElement.dataset.gpu,
          url: location.href, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          canvases: [...document.querySelectorAll("canvas")].filter(c => c.width && c.height).length })`);
        if (facts.canvases > 0 && facts.ready === "ready") {
          report.browserPage = facts;
          break;
        }
        if (performance.now() >= until)
          throw new Error("The GPU fixture never supplied a loaded canvas");
        await sleep(300);
      }
      page.on("paint", paint);
      await sleep(10_000);
    },
    async waitForBrowserClose() {
      const until = performance.now() + 20_000;
      while (page && !page.isDestroyed()) {
        if (performance.now() >= until)
          throw new Error("The GPU fixture remained active after removing its pane");
        await sleep(200);
      }
    },
    recordStillCoverage(coverage: number, mixed: boolean) {
      if (mixed) report.mixedStillCoverage = coverage;
      else report.finalStillCoverage = coverage;
    },
    complete() {
      report.completedAt = new Date().toISOString();
      save();
    },
    detachBrowser() {
      if (page && !page.isDestroyed()) page.removeListener("paint", paint);
      page = undefined;
    },
    async measure(
      phase: string,
      browser: string | null,
      focus: "phone" | "browser" | null,
      activePhone = true,
    ) {
      await sleep(2500);
      const windows = [];
      const keys = [activePhone ? phone : null, browser].filter(
        (key): key is string => key !== null,
      );
      await h.js(
        `globalThis.__vfSurfaceClocks = Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, {arrived:null, frames:[]}])); true`,
      );
      let a = await snapshot();
      const camera = a.camera;
      for (let i = 0; i < 2; i++) {
        const beforeHelper = helperFrames(),
          beforePaints = paints,
          beforeShared = sharedPaints;
        const beganAt = Date.now();
        await sleep(sampleMs);
        const b = await snapshot();
        const ms = b.at - a.at;
        const p0 = a.faces[phone],
          p1 = b.faces[phone];
        const b0 = browser === null ? undefined : a.faces[browser];
        const b1 = browser === null ? undefined : b.faces[browser];
        if ((activePhone && (!p0 || !p1)) || (browser !== null && (!b0 || !b1)))
          throw new Error("A measured face disappeared");
        if (!activePhone && (p0 || p1))
          throw new Error("An unbound phone acquired a face during the control");
        const sim = p0 && p1 ? faceDelta(p0, p1, ms) : null;
        const web = b0 && b1 ? faceDelta(b0, b1, ms) : null;
        if (sim && focus !== "browser" && (sim.mode !== "live" || sim.presented === 0)) {
          throw new Error(`The phone did not present live frames during ${phase}`);
        }
        if (web && focus !== "phone" && (web.mode !== "live" || web.presented === 0)) {
          throw new Error(`The browser did not present live frames during ${phase}`);
        }
        if (
          (focus === "phone" && sim?.targetFps !== 60) ||
          (focus === "browser" && web?.targetFps !== 60)
        ) {
          throw new Error(`The held object did not reach its 60 FPS demand during ${phase}`);
        }
        const phoneTiming = timingSummary(b.timings[phone] ?? []);
        const browserTiming = browser === null ? null : timingSummary(b.timings[browser] ?? []);
        if (
          (sim && sim.presented !== phoneTiming.count) ||
          (web && web.presented !== browserTiming?.count)
        )
          throw new Error("The frame pacing samples disagree with the canvas presentations");
        windows.push({
          phonePresentGapP95Ms: phoneTiming.presentGap?.p95 ?? null,
          phoneTiming,
          browserTiming,
          peerArrivalOffsetMs:
            browser === null
              ? null
              : peerArrivalOffset(b.timings[phone] ?? [], b.timings[browser] ?? []),
          beganAt,
          endedAt: Date.now(),
          ms,
          deskFrames: b.deskFrames - a.deskFrames,
          deskFrameMs: b.deskFrameMs - a.deskFrameMs,
          deskFps: ((b.deskFrames - a.deskFrames) * 1000) / ms,
          helperFrames: helperFrames() - beforeHelper,
          phone: sim,
          browser: web,
          osrPaints: paints - beforePaints,
          osrSharedPaints: sharedPaints - beforeShared,
          alive: b.alive,
          cap: b.cap,
        });
        a = b;
      }
      await h.js("delete globalThis.__vfSurfaceClocks");
      report.phases.push({ phase, camera, windows });
      save();
      d.say(`PHONE_BENCH ${phase} ${JSON.stringify(windows)}`);
      writeFileSync(join(out, `${phase}.png`), (await d.win.capturePage()).toPNG());
    },
  };
}
