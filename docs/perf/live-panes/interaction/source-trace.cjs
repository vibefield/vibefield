const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const run = promisify(execFile);
const duration = 8000;
const wheelHz = 6;
const epoch = () => performance.timeOrigin + performance.now();
const gaps = (values) => values.slice(1).map((x, i) => x - values[i]);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const p95 = (values) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;

// Install only in the two fixture webContents. In the control, count and skip WebGL draws
// while the same document, animation loop and trusted input remain active.
function installPageProbe() {
  const p = { ticks: [], wheels: [], scrolls: [], long: [], bypass: false, omitted: 0 };
  window.__vfSourceTrace = p;
  function tick(t) {
    p.ticks.push(performance.timeOrigin + t);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  addEventListener(
    "wheel",
    (e) => {
      if (e.isTrusted)
        p.wheels.push([performance.timeOrigin + performance.now(), e.deltaY, e.clientX, e.clientY]);
    },
    { passive: true, capture: true },
  );
  addEventListener(
    "scroll",
    () => p.scrolls.push([performance.timeOrigin + performance.now(), scrollY]),
    { passive: true },
  );
  if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
    new PerformanceObserver((list) => {
      for (const t of list.getEntries())
        p.long.push([performance.timeOrigin + t.startTime, t.duration]);
    }).observe({ type: "longtask" });
  const draws = [];
  for (const iface of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!iface) continue;
    for (const key of [
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
      "drawRangeElements",
    ]) {
      const d = Object.getOwnPropertyDescriptor(iface.prototype, key);
      if (!d?.value) continue;
      draws.push([iface.prototype, key, d]);
    }
  }
  p.setBypass = (enabled) => {
    if (enabled === p.bypass) return;
    for (const [proto, key, d] of draws)
      Object.defineProperty(
        proto,
        key,
        enabled
          ? {
              ...d,
              value: () => {
                p.omitted++;
              },
            }
          : d,
      );
    p.bypass = enabled;
  };
  return true;
}
function pageWindow(start, end) {
  const p = window.__vfSourceTrace;
  const inside = (t) => t >= start && t < end;
  return {
    ticks: p.ticks.filter(inside),
    wheels: p.wheels.filter(([t]) => inside(t)),
    scroll: p.scrolls.filter(([t]) => inside(t)).map(([, y]) => y),
    long: p.long.filter(([t]) => inside(t)),
    omitted: p.omitted,
    y: scrollY,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    canvases: [...document.querySelectorAll("canvas")].map((c) => [c.width, c.height]),
  };
}
function visibleEffects() {
  const found = [];
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.filter === "none" && style.backdropFilter === "none") continue;
    const r = el.getBoundingClientRect();
    const width = Math.min(innerWidth, r.right) - Math.max(0, r.left),
      height = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
    if (width > 0 && height > 0)
      found.push({
        tag: el.tagName,
        id: el.id.slice(0, 80),
        cls: String(el.className).slice(0, 100),
        filter: style.filter.slice(0, 140),
        backdrop: style.backdropFilter.slice(0, 140),
        area: Math.round(width * height),
      });
  }
  return found.sort((a, b) => b.area - a.area).slice(0, 8);
}
// Scoped to these local benchmark pages. Reset before each normal measurement.
function setFixtureEffects(mode) {
  document.getElementById("__vfEffectsProbe")?.remove();
  for (const el of document.querySelectorAll("[data-vf-trace-blur]"))
    el.removeAttribute("data-vf-trace-blur");
  if (mode === "normal") return 0;
  const style = document.createElement("style");
  style.id = "__vfEffectsProbe";
  let selector = "*,*::before,*::after";
  let marked = 0;
  if (mode === "resting-zero-blurs-off") {
    selector = "[data-vf-trace-blur]";
    // Isolate the elements whose computed blur is zero at the top of the test page.
    for (const el of document.querySelectorAll("*")) {
      if (getComputedStyle(el).filter !== "blur(0px)") continue;
      el.setAttribute("data-vf-trace-blur", "");
      marked++;
    }
  }
  const rule = mode === "no-backdrop" ? "backdrop-filter:none" : "filter:none";
  style.textContent = `${selector}{${rule}!important}`;
  document.head.append(style);
  return marked;
}
// Attribute imports synchronously to the native paint that offered them. The production
// callback owns each texture. These counters retain numbers and never retain a handle.
function observeTransfers(pages) {
  const { sharedTexture } = require("electron");
  const nativeImport = sharedTexture.importSharedTexture;
  const records = pages.map(() => []);
  const pending = pages.map(() => 0);
  let current;
  const endPaint = () => {
    current = undefined;
  };
  sharedTexture.importSharedTexture = function (options) {
    if (!current) return nativeImport.call(this, options);
    const row = current;
    row.imported = epoch();
    pending[row.page]++;
    try {
      return nativeImport.call(this, {
        ...options,
        allReferencesReleased(...args) {
          row.released = epoch();
          pending[row.page]--;
          return options.allReferencesReleased(...args);
        },
      });
    } catch (e) {
      pending[row.page]--;
      throw e;
    }
  };
  return {
    begin(i, t) {
      current = { page: i, at: epoch(), outstanding: pending[i], frame: t?.widgetType === "frame" };
      records[i].push(current);
    },
    endPaint,
    summary(i, start, end) {
      const batch = records[i].filter((r) => r.frame && r.at >= start && r.at < end);
      const held = batch.filter((r) => r.released).map((r) => r.released - r.imported);
      return {
        paints: batch.length,
        imports: batch.filter((r) => r.imported).length,
        missedAtCap: batch.filter((r) => !r.imported && r.outstanding >= 2).length,
        otherMisses: batch.filter((r) => !r.imported && r.outstanding < 2).length,
        released: held.length,
        leaseMsMean: mean(held),
        leaseMs95: p95(held),
      };
    },
    close() {
      sharedTexture.importSharedTexture = nativeImport;
    },
  };
}
async function gpuSample() {
  const { stdout } = await run("/usr/sbin/ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"], {
    maxBuffer: 4 << 20,
  });
  const values = {};
  for (const key of ["Device Utilization %", "Renderer Utilization %", "Tiler Utilization %"]) {
    const match = stdout.match(new RegExp(`"${key}"=(\\d+)`));
    if (match) values[key] = Number(match[1]);
  }
  return values;
}
// A page can have one wheel awaiting CDP at a time. Neither page blocks the camera or the other page.
async function drive({ win, js, wait, pages, nScrolling, pan, inputScales }) {
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const start = epoch(),
    end = start + duration;
  const sampleGpu = [],
    camera = [],
    ack = pages.map(() => []),
    skipped = pages.map(() => 0),
    busy = pages.map(() => null),
    errors = [];
  let sensor = null,
    mouse = 0,
    nextWheel = 0,
    nextSensor = 0,
    cameraInputs = 0;
  while (epoch() < end) {
    const elapsed = epoch() - start;
    const cameraSlot = Math.min((duration * 60) / 1000 - 1, Math.floor((elapsed * 60) / 1000));
    if (mouse <= cameraSlot) {
      if (pan) {
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: 1160,
          y: 710,
          deltaX: Math.floor(cameraSlot / 60) % 2 ? -4 : 4,
          deltaY: 0,
          canScroll: true,
        });
        cameraInputs++;
      }
      mouse = cameraSlot + 1;
    }
    const wheelSlot = Math.min(
      (duration * wheelHz) / 1000 - 1,
      Math.floor((elapsed * wheelHz) / 1000),
    );
    if (nextWheel <= wheelSlot) {
      const dy = (Math.floor(wheelSlot / wheelHz) % 2 ? -1 : 1) * 64;
      for (let i = 0; i < nScrolling; i++) {
        skipped[i] += wheelSlot - nextWheel;
        if (busy[i]) {
          skipped[i]++;
          continue;
        }
        const sent = epoch();
        busy[i] = pages[i].debugger
          .sendCommand("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: 640 * inputScales[i],
            y: 400 * inputScales[i],
            deltaX: 0,
            deltaY: dy * inputScales[i],
          })
          .then(
            () => ack[i].push(epoch() - sent),
            (e) => errors.push(String(e)),
          )
          .finally(() => {
            busy[i] = null;
          });
      }
      nextWheel = wheelSlot + 1;
    }
    if (elapsed >= nextSensor && !sensor) {
      nextSensor += 1000;
      sensor = Promise.all([gpuSample(), js("__vfDesk.camera().x")])
        .then(([g, x]) => {
          sampleGpu.push(g);
          camera.push(x);
        })
        .catch((e) => errors.push(String(e)))
        .finally(() => {
          sensor = null;
        });
    }
    await wait(Math.max(1, Math.min(16, start + (mouse * 1000) / 60 - epoch())));
  }
  lag.disable();
  return { start, end, sampleGpu, camera, ack, skipped, errors, busy, sensor, cameraInputs, lag };
}
module.exports = async ({
  app,
  win,
  pages,
  phones,
  browsers,
  js,
  wait,
  frame,
  snapshot,
  trace,
  log,
  save,
  out,
  info,
  guestLog,
}) => {
  const active = [...phones, ...browsers];
  const paints = pages.map(() => []);
  const transfers = observeTransfers(pages);
  const onPaint = pages.map((_page, i) => (_e) => {
    const t = _e.texture?.textureInfo;
    transfers.begin(i, t);
    paints[i].push([epoch(), t?.timestamp, t?.metadata?.frameCount]);
  });
  const phases = [];
  const metrics = async (page) =>
    Object.fromEntries(
      (await page.debugger.sendCommand("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  async function attach(i, page) {
    // Observe metadata before the regular consumer releases the shared handle.
    page.prependListener("paint", onPaint[i]);
    page.on("paint", transfers.endPaint);
    await page.debugger.sendCommand("Performance.enable");
    await page.executeJavaScript(`(${installPageProbe.toString()})()`);
  }
  await Promise.all(pages.map((page, i) => attach(i, page)));
  const report = {
    display: { hz: info.displayFrequency, dpr: info.scaleFactor },
    gpu: app.getGPUFeatureStatus(),
    phases,
  };
  const rendererOrigin = await js("performance.timeOrigin");
  async function sample(
    name,
    { nScrolling = 2, pan = true, bypass = false, effects = "normal" } = {},
  ) {
    log("phase", { name });
    await frame(active.map((p) => p.id));
    await Promise.all(
      pages.map((p) =>
        p.executeJavaScript(
          "window.scrollTo({top:0,behavior:'instant'});__vfSourceTrace.setBypass(" +
            bypass +
            ");true",
        ),
      ),
    );
    const marked = await Promise.all(
      pages.map((p) =>
        p.executeJavaScript(`(${setFixtureEffects.toString()})(${JSON.stringify(effects)})`),
      ),
    );
    await wait(1800);
    const coords = await Promise.all(
      pages.map((p) =>
        p.executeJavaScript(
          "({y:scrollY,url:location.href,dpr:devicePixelRatio,width:innerWidth,effects:(" +
            visibleEffects.toString() +
            ")()})",
        ),
      ),
    );
    const base = await Promise.all(pages.map(metrics));
    await trace();
    const a = await snapshot();
    const inputScales = pages.map((_, i) => {
      const actual = a.faces[browsers[i].key].texture.w;
      return Math.min(1, actual / (coords[i].width * coords[i].dpr));
    });
    for (const row of paints) row.length = 0;
    await Promise.all(pages.map((p) => p.executeJavaScript("__vfSourceTrace.omitted=0;true")));
    const guests = phones.map((_, i) => guestLog(i));
    const { start, end, sampleGpu, camera, ack, skipped, errors, busy, sensor, cameraInputs, lag } =
      await drive({ win, js, wait, pages, nScrolling, pan, inputScales });
    const b = await snapshot();
    const finalGuests = phones.map((_, i) => guestLog(i));
    await Promise.all([...busy, sensor]);
    if (errors.length) throw Error(errors.join(", "));
    const last = await Promise.all(pages.map(metrics));
    const dt = b.at - a.at;
    const faceRows = Object.fromEntries(
      active.map((p) => {
        const before = a.faces[p.key],
          after = b.faces[p.key],
          c = b.clocks[p.key] || [];
        return [
          p.label,
          {
            fps: ((after.p - before.p) * 1000) / dt,
            arrivals: after.a - before.a,
            submitted: after.p - before.p,
            drops: after.d - before.d,
            hostGap95: p95(gaps(c.map((t) => t.host))),
            submitGap95: p95(gaps(c.map((t) => t.presented))),
            queue95: p95(c.filter((t) => t.arrived !== null).map((t) => t.presented - t.arrived)),
            raster: after.texture,
          },
        ];
      }),
    );
    const pageRows = [];
    for (const [i, p] of pages.entries()) {
      const obs = await p.executeJavaScript(`(${pageWindow.toString()})(${start},${end})`);
      const osr = paints[i].filter(([t]) => t >= start && t < end);
      const byCapture = new Map(osr.map((r) => [Math.floor(r[1]), r[0]]));
      const ages = (b.clocks[browsers[i].key] || []).flatMap((r) => {
        const seen = r.source === null ? undefined : byCapture.get(Math.round(r.source * 1000));
        return seen === undefined ? [] : [rendererOrigin + r.presented - seen];
      });
      const m = Object.fromEntries(
        ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"].map((k) => [
          k,
          ((last[i][k] - base[i][k]) * 1e6) / duration,
        ]),
      );
      pageRows.push({
        pid: p.getOSProcessId(),
        transfers: transfers.summary(i, start, end),
        paintToSubmit: { matched: ages.length, mean: mean(ages), p95: p95(ages) },
        captureTarget: p.getFrameRate(),
        rafFps: (obs.ticks.length * 1000) / duration,
        rafGap95: p95(gaps(obs.ticks)),
        paintFps: (osr.length * 1000) / duration,
        paintGap95: p95(gaps(osr.map((v) => v[0]))),
        captureGap95: p95(gaps(osr.filter((v) => Number.isFinite(v[1])).map((v) => v[1] / 1000))),
        captureSequenceGaps: gaps(osr.filter((v) => Number.isFinite(v[2])).map((v) => v[2]))
          .filter((n) => n > 1)
          .reduce((sum, n) => sum + n - 1, 0),
        wheels: obs.wheels.length,
        deltaY: obs.wheels.reduce((s, w) => s + w[1], 0),
        absDeltaY: obs.wheels.reduce((s, w) => s + Math.abs(w[1]), 0),
        point: obs.wheels[0]?.slice(2),
        acknowledged: ack[i].length,
        ack95: p95(ack[i]),
        skipped: skipped[i],
        longTasks: obs.long.length,
        omittedDraws: obs.omitted,
        mainMsPerS: m,
        from: coords[i],
        toY: obs.y,
        maxScrollY: Math.max(coords[i].y, obs.y, ...obs.scroll),
        dpr: obs.dpr,
        viewport: obs.viewport,
        canvases: obs.canvases,
      });
    }
    const moved = Math.max(...camera) - Math.min(...camera);
    if (
      b.visibility !== "visible" ||
      (pan && moved < 5) ||
      pageRows.slice(0, nScrolling).some((p) => p.wheels < 30)
    )
      throw Error(`Invalid workload ${name} ${JSON.stringify({ moved, pageRows })}`);
    for (const page of pageRows) {
      if (
        page.dpr !== Number(process.env.VF_PANE_TRACE_DPR || 2) ||
        page.viewport[0] !== 1280 ||
        page.viewport[1] !== 800
      )
        throw Error(`Unexpected browser emulation in ${name}`);
      if (
        page.wheels &&
        (Math.abs(page.point[0] - 640) > 1 ||
          Math.abs(page.point[1] - 400) > 1 ||
          Math.abs(page.absDeltaY - page.wheels * 64) > 1)
      )
        throw Error(`Unexpected logical wheel input in ${name}`);
      if (
        page.transfers.paints === 0 ||
        page.transfers.imports === 0 ||
        !page.paintToSubmit.matched ||
        (bypass && !page.omittedDraws)
      )
        throw Error(`Missing source observations in ${name}`);
    }
    const row = {
      name,
      pan,
      nScrolling,
      bypass,
      effects,
      marked,
      wheelHz,
      durationMs: duration,
      cameraInputs,
      cameraRange: moved,
      guestFps: guests.map(
        (g, i) => ((finalGuests[i].frames - g.frames) * 1000) / (finalGuests[i].at - g.at),
      ),
      gpu: sampleGpu,
      gpuAverage: mean(sampleGpu.map((g) => g["Device Utilization %"]).filter(Number.isFinite)),
      deskFps: ((b.desk - a.desk) * 1000) / dt,
      drawCpuMsPerS: ((b.cpu - a.cpu) * 1000) / dt,
      loopDelay95Ms: lag.percentile(95) / 1e6,
      faces: faceRows,
      pages: pageRows,
    };
    phases.push(row);
    save("source-trace-partial.json", report);
    log("sample", {
      name,
      gpu: row.gpuAverage,
      desk: row.deskFps,
      raf: pageRows.map((p) => p.rafFps),
      paint: pageRows.map((p) => p.paintFps),
    });
  }
  try {
    await sample("pan-only", { nScrolling: 0 });
    await sample("both-scroll");
    await sample("backdrop-off", { effects: "no-backdrop" });
    await sample("resting-zero-blurs-off", { effects: "resting-zero-blurs-off" });
    await sample("ordinary-filters-off", { effects: "no-filter-only" });
    await sample("filters-restored");
    await sample("webgl-draws-off", { bypass: true });
    await sample("camera-still", { pan: false });
    await sample("both-scroll-repeat");
    fs.writeFileSync(
      path.join(out, "source-trace-grid.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    return report;
  } finally {
    for (const [i, p] of pages.entries())
      if (!p.isDestroyed()) {
        p.off("paint", onPaint[i]);
        p.off("paint", transfers.endPaint);
      }
    transfers.close();
    await js("delete globalThis.__vfSurfaceClocks;true");
  }
};
