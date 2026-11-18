const { app, screen, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.env.VIBEFIELD_DEV_REPO_ROOT,
  out = process.env.VF_PANE_OUTPUT;
const variant = process.env.VF_PANE_RUN || "baseline";
const save = (name, data) => {
  const file = path.join(out, name);
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2));
  fs.renameSync(file + ".tmp", file);
};
const log = (step, data) =>
  fs.appendFileSync(
    path.join(out, variant + ".jsonl"),
    JSON.stringify({ at: new Date().toISOString(), step, ...data }) + "\n",
  );
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const phoneType = "vibefield.simulator",
  browserType = "vibefield.browser-pane";
const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-11",
  runtime = process.env.VF_PANE_RUNTIME;
if (!root || !out || !process.env.FIELDD_DATA_DIR)
  throw Error("Run this benchmark through run.py in a disposable profile");
app.setName("VibeField");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.once("ready", () => require("electron").powerSaveBlocker.start("prevent-display-sleep"));
let started = false;
app.on("browser-window-created", (_e, win) => {
  const load = win.loadURL.bind(win);
  win.loadURL = (url, ...args) => {
    if (url.startsWith("vibefield-app:")) {
      const u = new URL(url);
      u.searchParams.set("simulatorBenchmark", "1");
      if (variant.includes("batch")) u.searchParams.set("simulatorPreviewBatch", "auto");
      url = u.href;
    }
    return load(url, ...args);
  };
  win.webContents.on("did-finish-load", () => {
    if (started || !win.webContents.getURL().startsWith("vibefield-app:")) return;
    started = true;
    const js = (s) => win.webContents.executeJavaScript(s, true);
    const until = async (label, fn, timeout = 45000) => {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await wait(200);
      }
      throw Error(label + " timed out: " + JSON.stringify(last));
    };
    (async () => {
      win.webContents.setBackgroundThrottling(false);
      win.setContentSize(1200, 820);
      win.setTitle("VibeField — pane performance");
      win.show();
      win.focus();
      await until(
        "board",
        () =>
          js(
            'Boolean(window.__vfDesk?.camera()?.zoom && window.__vfFieldSmoke?.widgetTypes().includes("vibefield.simulator") && !document.querySelector(".vf-splash[aria-hidden=false]"))',
          ),
        100000,
      );
      const info = screen.getDisplayMatching(win.getBounds());
      log("board", {
        electron: process.versions.electron,
        mac: process.getSystemVersion(),
        hz: info.displayFrequency,
        dpr: info.scaleFactor,
        cpu: require("node:os").cpus()[0].model,
      });
      const objs = (type) => js("__vfDesk.objects(" + JSON.stringify(type) + ")");
      await wait(1000);
      const spawn = async (type, x, y, w, h, props) => {
        const value = await js(
          "(()=>{try{return __vfFieldSmoke.spawnWidget(" +
            JSON.stringify(type) +
            "," +
            JSON.stringify({ x, y, w, h, props }) +
            ")}catch(e){return {error:String(e),stack:e.stack}}})()",
        );
        if (typeof value !== "string") throw Error("Spawn " + type + ": " + JSON.stringify(value));
        return Number(value);
      };
      const hold = async (id) => {
        await js("__vfFieldSmoke.useWidget(" + JSON.stringify(id) + ")");
        await wait(850);
      };
      const frame = async (ids) => {
        await js(
          "__vfFieldSmoke.useWidget(null);__vfFieldSmoke.frame(" + JSON.stringify(ids) + ");true",
        );
        await wait(1000);
      };
      const read = (n) => JSON.parse(fs.readFileSync(path.join(out, n), "utf8"));
      const rowsfile = path.join(out, "phones.json");
      let phones;
      if (fs.existsSync(rowsfile)) {
        const known = read("phones.json"),
          all = await objs(phoneType);
        phones = known.map((p) => ({ ...p, id: all.find((a) => a.key === p.key).entity }));
      } else {
        const ids = [];
        for (const x of [24800, 25100])
          ids.push(
            await spawn(phoneType, x, 24800, 188.71, 393.7, {
              model: deviceType,
              binding: { deviceType, runtime, dedicated: true },
            }),
          );
        const all = await until("assigned keys", async () => {
          const v = await objs(phoneType);
          return ids.every((id) => v.some((r) => r.entity === id && r.key)) && v;
        });
        phones = ids.map((id, i) => {
          const key = all.find((r) => r.entity === id).key;
          return {
            label: "phone" + (i + 1),
            id,
            key,
            name:
              "VibeField iPhone 11 [" +
              crypto.createHash("sha256").update(key).digest("hex").slice(0, 16) +
              "]",
          };
        });
        save("phones.json", phones);
      }
      await frame(phones.map((p) => p.id));
      log("phones", { phones });
      const gate = path.join(out, "guest-ready");
      await until("prepared guest workload", async () => fs.existsSync(gate), 600000);
      const results = await require("./measure.cjs")({
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
      });
      save(variant + "-result.json", { ok: true, ...results });
      log("done", {});
    })()
      .catch(async (error) => {
        log("error", { error: String(error), stack: error.stack });
        save(variant + "-result.json", { ok: false, error: String(error) });
        try {
          save(
            variant + "-failed.json",
            await js(
              "({held:__vfDesk?.held(),faces:__vfDesk?.live()?.faces?.map(f=>({key:f.key,wire:f.wire,status:f.state?.is,info:f.info?.title,simulator:f.simulator})),body:document.body.innerText.slice(0,330)})",
            ),
          );
          fs.writeFileSync(
            path.join(out, variant + "-error.png"),
            (await win.webContents.capturePage()).toPNG(),
          );
        } catch {}
      })
      .finally(() => app.quit());
  });
});
require(path.join(root, "packages/electron-shell/dist/main/index.cjs"));
