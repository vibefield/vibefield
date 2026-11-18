const fs = require("node:fs"),
  path = require("node:path"),
  { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const exec = promisify(execFile);
const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1] : null);
const stats = (a) => ({
  n: a.length,
  p50: q(a, 0.5),
  p95: q(a, 0.95),
  max: a.length ? Math.max(...a) : null,
});
const bundle = "dev.vibefield.bench.interaction",
  os = process.env.VF_PANE_RUNTIME,
  model = "com.apple.CoreSimulator.SimDeviceType.iPhone-11";
const urlPrefix = process.env.VF_PANE_FIXTURE_URL + "#vf-interaction-";
const sim = async (...a) =>
  (
    await exec("/usr/bin/xcrun", ["simctl", ...a], { timeout: 260000, maxBuffer: 4 << 20 })
  ).stdout.trim();
module.exports = async function run({
  app,
  win,
  webContents,
  js,
  wait,
  until,
  frame,
  hold,
  spawn,
  objs,
  phones,
  browserType,
  variant,
  out,
  log,
  save,
  info,
  read,
}) {
  const guests = read("guests.json"),
    active = [...phones],
    browsers = [],
    pages = [],
    phases = [],
    latencies = [];
  const states = async () =>
    JSON.parse(await sim("list", "devices", "available", "-j")).devices[os];
  const allowed = await states();
  for (const [i, g] of guests.entries())
    if (
      g.key !== phones[i].key ||
      !allowed.some((d) => d.name === phones[i].name && d.udid === g.udid)
    )
      throw Error("Benchmark device identity changed");
  const progress = () => save(variant + "-partial.json", { variant, phases, latencies });
  const live = () =>
    js(
      "__vfDesk.live().faces.map(f=>({key:f.key,mode:f.wire?.mode,fps:f.wire?.targetFps,raster:f.wire?.targetRasterSize,condition:f.simulator?.condition,p:f.presented,state:f.state?.is,loading:f.info.loading,address:f.info.address,input:f.info.extra?.input}))",
    );
  const bind = async (p, on) => {
    const current = (await objs("vibefield.simulator")).find((r) => r.key === p.key)?.props
      ?.binding;
    const value = typeof current === "string" && current ? JSON.parse(current) : current;
    if (!!value?.dedicated === on) return;
    const ok = await js(
      "__vfDesk.writeProps(" +
        p.id +
        "," +
        JSON.stringify({
          binding: on
            ? { deviceType: model, runtime: os, dedicated: true }
            : { deviceType: "", runtime: "" },
        }) +
        ")",
    );
    if (!ok) throw Error("Cannot update test phone");
  };
  const guestLog = (i) => JSON.parse(fs.readFileSync(guests[i].guestLog));
  const guestAlive = async (i) => {
    await sim("bootstatus", guests[i].udid, "-b");
    const previous = guestLog(i).at;
    if (Date.now() - previous > 3000) await sim("launch", guests[i].udid, bundle);
    await until("animating guest " + (i + 1), () => guestLog(i).at > previous, 30000);
  };
  const settle = async (key) => {
    await until(
      "live " + key,
      async () => (await live()).some((f) => f.key === key && f.mode === "live" && f.p > 1),
      50000,
    );
    await wait(1400);
  };
  const use = async (p) => {
    await hold(p.id);
    await until("settled hold", () => js("__vfDesk.held()?.frame?.settled===true"));
    await settle(p.key);
  };
  const point = async () => {
    const h = await js(
      '(()=>{const f=__vfDesk.held()?.frame,b=document.querySelector("canvas")?.getBoundingClientRect();return f&&{x:f.cx,y:f.cy,w:2*f.hx,h:2*f.hy,canvas:b&&[b.x,b.y]}})()',
    );
    if (!h) throw Error("No held input surface");
    return {
      x: Math.round(h.x + (h.canvas?.[0] || 0)),
      y: Math.round(h.y + (h.canvas?.[1] || 0)),
      w: h.w,
      h: h.h,
    };
  };
  const event = (v) => win.webContents.sendInputEvent(v);
  const click = (p, type) => event({ type, x: p.x, y: p.y, button: "left", clickCount: 1 });
  const snapshot = () =>
    js(`(() => {
    const { frames, frameMs } = __vfDesk.perf();
    const faces = __vfDesk.live().faces.map(face => [face.key, {
      p: face.presented, a: face.arrivals, d: face.dropped,
      mode: face.wire?.mode, target: face.wire?.targetFps, raster: face.wire?.targetRasterSize,
      texture: face.texture ? { w: face.texture.width, h: face.texture.height } : null
    }]);
    const clocks = Object.entries(globalThis.__vfSurfaceClocks || {})
      .map(([key, clock]) => [key, clock.frames.splice(0)]);
    return {
      at: performance.now(), visibility: document.visibilityState, focused: document.hasFocus(),
      desk: frames, cpu: frameMs, camera: __vfDesk.camera(),
      faces: Object.fromEntries(faces), clocks: Object.fromEntries(clocks)
    };
  })()`);
  const trace = async () => {
    await js(
      "globalThis.__vfSurfaceClocks=Object.fromEntries(" +
        JSON.stringify(active.map((x) => x.key)) +
        ".map(k=>[k,{arrived:null,frames:[]}]));true",
    );
  };
  const scrollEvent = (p, dx, dy) =>
    event({ type: "mouseWheel", x: p.x, y: p.y, deltaX: dx, deltaY: dy, canScroll: true });
  const drive = async (mode, ms, center) => {
    if (mode === "idle") {
      await wait(ms);
      return 0;
    }
    const start = performance.now();
    let i = 0;
    event({ type: "mouseMove", x: center.x, y: center.y });
    if (mode.startsWith("drag")) click(center, "mouseDown");
    while (performance.now() < start + ms) {
      const phase = (performance.now() - start) / 1000;
      if (mode.startsWith("drag"))
        event({
          type: "mouseMove",
          x: Math.round(center.x + Math.sin(phase * 4) * center.w * 0.18),
          y: Math.round(center.y + Math.sin(phase * 5) * 28),
          modifiers: ["leftButtonDown"],
          button: "left",
        });
      if (mode === "scroll") scrollEvent(center, 0, (Math.floor(phase) % 2 === 0 ? 1 : -1) * 6);
      if (mode === "pan" || mode === "pan-and-scroll")
        scrollEvent(center, (Math.floor(phase) % 2 === 0 ? 1 : -1) * 4, 0);
      if (mode === "pan-and-scroll" && i % 2 === 0)
        await Promise.all(
          pages.map((p) =>
            p.debugger.sendCommand("Input.dispatchMouseEvent", {
              type: "mouseWheel",
              x: 220,
              y: 180,
              deltaX: 0,
              deltaY: (Math.floor(phase) % 2 === 0 ? 1 : -1) * 8,
            }),
          ),
        );
      i++;
      await wait(
        Math.max(0, start + (i * 1000) / (mode === "drag120" ? 120 : 60) - performance.now()),
      );
    }
    if (mode.startsWith("drag")) click(center, "mouseUp");
    return i;
  };
  const sample = async (name, mode = "idle") => {
    log("phase", { name, mode });
    await wait(1700);
    await trace();
    const center = mode.startsWith("pan")
      ? { x: 1160, y: 710 }
      : mode === "idle"
        ? {}
        : await point();
    const guestStart = guests.map((_, i) => guestLog(i));
    let a = await snapshot();
    const windows = [];
    for (let j = 0; j < 2; j++) {
      const inputs = await drive(mode, 4500, center),
        b = await snapshot(),
        dt = b.at - a.at,
        faces = {};
      for (const p of active) {
        const prev = a.faces[p.key],
          now = b.faces[p.key],
          c = b.clocks[p.key] || [];
        if (!prev || !now) {
          faces[p.label] = null;
          continue;
        }
        const count = now.p - prev.p;
        if (c.length !== count && count > 1)
          throw Error("Pacing counter mismatch " + p.label + " " + count + " " + c.length);
        const gaps = c.slice(1).map((x, i) => x.presented - c[i].presented);
        faces[p.label] = {
          fps: (count * 1000) / dt,
          count,
          arrivals: now.a - prev.a,
          drops: now.d - prev.d,
          target: now.target,
          mode: now.mode,
          raster: now.raster,
          texture: now.texture,
          gap: stats(gaps),
          hostGap: stats(c.slice(1).map((x, i) => x.host - c[i].host)),
          arrivalToSubmit: stats(
            c.filter((x) => x.arrived !== null).map((x) => x.presented - x.arrived),
          ),
        };
      }
      if (b.visibility !== "visible") throw Error("The benchmark window was hidden during " + name);
      if (mode.startsWith("pan") && Math.abs(b.camera.x - a.camera.x) < 1)
        throw Error("The canvas did not pan during " + name);
      windows.push({
        dt,
        inputs,
        visibility: b.visibility,
        focused: b.focused,
        cameraFrom: a.camera,
        cameraTo: b.camera,
        deskFps: ((b.desk - a.desk) * 1000) / dt,
        drawCpuMsPerS: ((b.cpu - a.cpu) * 1000) / dt,
        faces,
      });
      a = b;
    }
    await js("delete globalThis.__vfSurfaceClocks;true");
    const guestEnd = guests.map((_, i) => guestLog(i));
    const motion = guestEnd.map((e, i) => ({
      moves: e.moves - guestStart[i].moves,
      guestFps:
        e.at > guestStart[i].at
          ? (1000 * (e.frames - guestStart[i].frames)) / (e.at - guestStart[i].at)
          : null,
    }));
    phases.push({ name, mode, windows, motion });
    progress();
  };
  const comparePreviews = async (prefix) => {
    if (!(await js("new URL(location.href).searchParams.get('simulatorPreviewBatch')==='auto'")))
      throw Error("Grouping flag missing");
    await wait(9000); // Let camera and website scrolling settle before comparing idle redraws.
    for (const [i, immediate] of [true, false, false, true].entries()) {
      await js("globalThis.__vfImmediatePreviews=" + immediate + ";true");
      await sample(prefix + "-" + (immediate ? "immediate" : "grouped") + "-" + i);
    }
    await js("delete globalThis.__vfImmediatePreviews;true");
  };
  const marker = async (p) => {
    const img = await win.webContents.capturePage({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 });
    const buf = img.toBitmap(),
      n = buf.length / 4;
    let r = 0,
      g = 0;
    for (let i = 0; i < buf.length; i += 4) {
      g += buf[i + 1];
      r += buf[i + 2];
    }
    return r / n - g / n > 65 ? "red" : g / n - r / n > 65 ? "green" : "unknown";
  };
  const latency = async (name, pane, guestIndex, page, count = 18) => {
    const tracing = variant === "tap-trace";
    const timeOrigin = tracing ? await js("performance.timeOrigin") : 0;
    if (tracing) await trace();
    log("latency", { name });
    const p = await point();
    if (page)
      await page.executeJavaScript(
        `(() => {
          const marker = document.createElement('i');
          marker.id = 'vf-latency-witness';
          marker.style.cssText = 'position:fixed;left:15%;top:30%;width:70%;height:40%;z-index:2147483647;pointer-events:none;background:rgb(244,13,20)';
          document.documentElement.append(marker);
          globalThis.__vfBenchTaps = [];
          globalThis.__vfBenchTouchListener = new AbortController();
          addEventListener('pointerdown', event => {
            if (!event.isTrusted) return;
            __vfBenchTaps.push(Date.now());
            marker.style.background = __vfBenchTaps.length % 2 ? 'rgb(8,230,35)' : 'rgb(244,13,20)';
          }, { capture: true, signal: __vfBenchTouchListener.signal });
          return true;
        })()`,
      );
    let prev = await until(
      "visible initial marker " + name,
      async () => {
        const c = await marker(p);
        return c === "unknown" ? null : c;
      },
      9000,
    );
    const taps = [];
    for (let i = 0; i < count; i++) {
      await wait(420 + ((i * 37) % 131));
      const expect = prev === "red" ? "green" : "red",
        epoch = Date.now(),
        start = performance.now();
      const target = { ...p, x: p.x + (i % 2 ? 23 : -23) };
      click(target, "mouseDown");
      const lifted = wait(48).then(() => click(target, "mouseUp"));
      const readbacks = [];
      let color,
        lastEnd = start,
        checks = 0;
      do {
        const before = performance.now();
        color = await marker(p);
        if (tracing) readbacks.push([before - start, performance.now() - start, color]);
        checks++;
        if (color === expect) break;
        lastEnd = before;
        await wait(3);
      } while (performance.now() - start < 1800);
      const upper = performance.now() - start;
      await lifted;
      let frames;
      if (tracing) {
        // Compare intervals on each clock. Only renderer times share performance.timeOrigin.
        await wait(40);
        const captured = (await snapshot()).clocks[pane.key] || [];
        frames = captured.slice(1).flatMap((frame, index) => {
          const previous = captured[index];
          const offset = timeOrigin + frame.presented - epoch;
          if (offset < -100 || offset > upper + 80) return [];
          return [
            {
              offset,
              submitGap: frame.presented - previous.presented,
              hostGap: frame.host - previous.host,
              sourceGap:
                frame.source !== null && previous.source !== null
                  ? frame.source - previous.source
                  : null,
              rendererWait: frame.arrived !== null ? frame.presented - frame.arrived : null,
            },
          ];
        });
      }
      taps.push({
        epoch,
        ...(tracing ? { frames, readbacks } : {}),
        seen: color === expect,
        upper,
        lower: Math.max(0, lastEnd - start),
        checks,
      });
      if (color !== expect) {
        const held = await js("__vfDesk.held()?.entity??null");
        log("tap-miss", { name, i, p, prev, color, held });
        if (held !== pane.id) await use(pane);
        prev = await marker(p);
      } else prev = color;
    }
    if (tracing) await js("delete globalThis.__vfSurfaceClocks;true");
    if (!page) await wait(2300);
    const guestEvents = page ? [] : guestLog(guestIndex).events;
    const received = page
      ? await page.executeJavaScript("__vfBenchTaps")
      : guestEvents.map((x) => x.at);
    const deltas = taps.map((v, i) => {
      const next = taps[i + 1]?.epoch || v.epoch + 1800;
      const t = received.find((stamp) => stamp >= v.epoch - 1 && stamp < next);
      return t === undefined ? null : t - v.epoch;
    });
    const valid = taps.filter((x) => x.seen);
    latencies.push({
      name,
      target: pane.label,
      p,
      count: taps.length,
      matched: valid.length,
      received: deltas.filter((x) => x !== null).length,
      handlerMs: stats(deltas.filter((x) => x !== null)),
      visibleUpperMs: stats(valid.map((x) => x.upper)),
      visibleLowerMs: stats(valid.map((x) => x.lower)),
      polls: stats(valid.map((x) => x.checks)),
      samples: taps.map((x, i) => ({
        seen: x.seen,
        upper: x.upper,
        lower: x.lower,
        handler: deltas[i],
        ...(tracing
          ? {
              frames: x.frames,
              readbacks: x.readbacks,
              nextGuestDisplayMs: (() => {
                const touch = guestEvents.find((event) => event.at === x.epoch + deltas[i]);
                return touch?.displayAt === undefined ? null : touch.displayAt - x.epoch;
              })(),
            }
          : {}),
      })),
    });
    progress();
    if (valid.length < 12) log("insufficient-latency-samples", { name, matched: valid.length });
    if (page)
      await page.executeJavaScript(
        'globalThis.__vfBenchTouchListener.abort(); document.querySelector("#vf-latency-witness").remove();true',
      );
  };
  // Each launch uses the same board. Remove only browser fixtures created by this benchmark.
  for (const r of await objs(browserType))
    if (typeof r.props?.url === "string" && r.props.url.startsWith(urlPrefix))
      await js("__vfFieldSmoke.removeWidget(" + JSON.stringify(String(r.entity)) + ")");
  const prepareBrowsers = async (pixelRatio) => {
    for (const [i, x] of [24420, 25160].entries()) {
      const id = await spawn(browserType, x, 25290, 698.16, 461.94, {
        url: urlPrefix + (i + 1),
        ...(pixelRatio === undefined ? {} : { deviceScaleFactor: pixelRatio }),
      });
      const key = await until(
        "browser key",
        async () => (await objs(browserType)).find((r) => r.entity === id)?.key,
      );
      browsers.push({ id, key, label: "browser" + (i + 1) });
      active.push(browsers.at(-1));
    }
    await frame(active.map((x) => x.id));
    for (const [i, b] of browsers.entries()) {
      const page = await until(
        "GPU fixture " + b.label,
        async () => {
          const page = webContents
            .getAllWebContents()
            .find((w) => !w.isDestroyed() && w.isOffscreen() && w.getURL() === urlPrefix + (i + 1));
          if (!page) return null;
          const v = await page.executeJavaScript(
            'document.documentElement.dataset.gpu === "ready"',
          );
          return v ? page : null;
        },
        90000,
      );
      await settle(b.key);
      pages.push(page);
    }
    await wait(9000);
  };
  if (variant === "source-trace") {
    await Promise.all([guestAlive(0), guestAlive(1)]);
    await prepareBrowsers(Number(process.env.VF_PANE_TRACE_DPR || 2));
    return require("./source-trace.cjs")({
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
    });
  }
  if (variant === "tap-trace") {
    await frame(phones.map((phone) => phone.id));
    await Promise.all([guestAlive(0), guestAlive(1)]);
    await settle(phones[1].key);
    await sample("two-phones");
    await use(phones[1]);
    await sample("second-phone-drag", "drag");
    await latency("second-phone-tap-repeat", phones[1], 1, undefined, 72);
    return {
      variant,
      display: { hz: info.displayFrequency, dpr: info.scaleFactor },
      pageFacts: [],
      phases,
      latencies,
    };
  }
  await guestAlive(0);
  await frame([phones[0].id]);
  await use(phones[0]);
  await bind(phones[1], false);
  await wait(1200);
  const peer = (await states()).find((x) => x.udid === guests[1].udid);
  if (peer.state !== "Shutdown") {
    await sim("bootstatus", peer.udid, "-b");
    await sim("shutdown", peer.udid);
  }
  if (!(await states()).some((x) => x.udid === peer.udid && x.state === "Shutdown"))
    throw Error("Single-guest control is not isolated");
  await wait(6500);
  await sample("single-phone-drag", "drag");
  await sample("single-phone-120hz-input", "drag120");
  await latency("single-phone-tap", phones[0], 0);
  await hold(null);
  await bind(phones[1], true);
  await frame(phones.map((x) => x.id));
  await guestAlive(1);
  await settle(phones[1].key);
  await wait(3500);
  await sample("two-phones");
  await sample("two-phones-pan", "pan");
  if (variant.includes("batch")) await comparePreviews("two");
  await use(phones[1]);
  await sample("second-phone-drag", "drag");
  await latency("second-phone-tap", phones[1], 1);
  await hold(null);
  await prepareBrowsers();
  await sample("four-visible");
  await sample("four-visible-pan", "pan");
  await use(phones[0]);
  await sample("mixed-phone-drag", "drag");
  await latency("mixed-phone-tap", phones[0], 0);
  await hold(null);
  await frame(active.map((x) => x.id));
  await use(browsers[0]);
  await pages[0].executeJavaScript(
    "globalThis.__vfWheelCount=0;addEventListener('wheel',e=>{if(e.isTrusted)globalThis.__vfWheelCount++},{passive:true});true",
  );
  await sample("mixed-browser-scroll", "scroll");
  phases.at(-1).trustedWheelEvents = await pages[0].executeJavaScript("globalThis.__vfWheelCount");
  await latency("mixed-browser-tap", browsers[0], 0, pages[0]);
  // Check root input mapping with two separated points on the displayed page.
  const panePoint = await point();
  await pages[0].executeJavaScript(
    "globalThis.__vfProbePoints=[];addEventListener('pointerdown',e=>{if(e.isTrusted)__vfProbePoints.push([e.clientX/innerWidth,e.clientY/innerHeight])},{capture:true});true",
  );
  for (const dx of [-0.2, 0.2]) {
    const pos = { x: Math.round(panePoint.x + dx * panePoint.w), y: panePoint.y };
    click(pos, "mouseDown");
    await wait(48);
    click(pos, "mouseUp");
    await wait(130);
  }
  const inputCoordinates = await pages[0].executeJavaScript("globalThis.__vfProbePoints");
  if (
    inputCoordinates.length !== 2 ||
    Math.abs(inputCoordinates[0][0] - 0.3) > 0.06 ||
    Math.abs(inputCoordinates[1][0] - 0.7) > 0.06 ||
    inputCoordinates.some(([, y]) => Math.abs(y - 0.5) > 0.1)
  )
    throw Error("Browser input mapping: " + JSON.stringify(inputCoordinates));
  await hold(null);
  await frame(active.map((x) => x.id));
  await sample("four-visible-return");
  await Promise.all(
    pages.map((p) =>
      p.executeJavaScript(
        "globalThis.__vfPeerWheels=0;addEventListener('wheel',e=>{if(e.isTrusted)globalThis.__vfPeerWheels++},{passive:true});true",
      ),
    ),
  );
  await sample("four-pan-and-scroll", "pan-and-scroll");
  phases.at(-1).browserWheelEvents = await Promise.all(
    pages.map((p) => p.executeJavaScript("globalThis.__vfPeerWheels")),
  );
  await frame(active.map((p) => p.id));
  if (variant.includes("batch")) await comparePreviews("four");
  fs.writeFileSync(
    path.join(out, variant + "-grid.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  const pageFacts = await Promise.all(
    pages.map((p) =>
      p.executeJavaScript(
        '({url:location.href,title:document.title,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],canvases:[...document.querySelectorAll("canvas")].map(c=>[c.width,c.height])})',
      ),
    ),
  );
  return {
    variant,
    display: { hz: info.displayFrequency, dpr: info.scaleFactor },
    inputCoordinates,
    pageFacts,
    phases,
    latencies,
  };
};
