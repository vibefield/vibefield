/** Real Electron regression for workers paused by an iframe-only auto-attach filter. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, session, type WebContents } from "electron";
import {
  configureBrowserEngineIdentity,
  ElectronBrowserSurfaceNative,
} from "../main/live-surfaces/browser-electron-native";
import type { BrowserSurfaceNativeWindow } from "../main/live-surfaces/browser-producer";

const out = process.env["VF_WORKER_OUT"];
if (!out || existsSync(join(out, "report.json")))
  throw Error("VF_WORKER_OUT must name a new output directory");
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "vf-worker-smoke-"));
app.setPath("userData", profile);
if (process.env["VF_WORKER_IDENTITY_CONTROL"] !== "1") configureBrowserEngineIdentity();
const control = process.env["VF_WORKER_FILTER_CONTROL"] === "1";
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  versions: process.versions,
  control,
  identityControl: process.env["VF_WORKER_IDENTITY_CONTROL"] === "1",
  cacheControl: process.env["VF_WORKER_CACHE_CONTROL"] === "1",
  ok: false,
};
const attachments: { type: string; waiting: boolean }[] = [];
report.attachments = attachments;
let surface: BrowserSurfaceNativeWindow | undefined;
let cacheRequests = 0;
const server = createServer((req, res) => {
  const scripts: Record<string, string> = {
    "/worker.js": "postMessage({ua:navigator.userAgent})",
    "/nested-worker.js":
      "const child=new Worker('/worker.js');child.onmessage=e=>{postMessage(e.data);child.terminate()};child.onerror=e=>{throw Error(e.message)}",
    "/shared-worker.js": "onconnect=e=>e.ports[0].postMessage({ua:navigator.userAgent})",
    "/service-worker.js":
      "oninstall=()=>skipWaiting();onactivate=e=>e.waitUntil(clients.claim());onmessage=e=>e.ports[0].postMessage({ua:navigator.userAgent})",
  };
  if (req.url === "/cache-probe") {
    cacheRequests++;
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end("cached");
  } else if (req.url && scripts[req.url]) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(scripts[req.url]);
  } else if (req.url === "/frame") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<!doctype html><script>const w=new Worker('/worker.js');w.onmessage=e=>{parent.postMessage({kind:'iframe-worker',...e.data},'*');w.terminate()}</script>",
    );
  } else if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Browser worker regression</title>");
  } else {
    res.statusCode = 404;
    res.end();
  }
});
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No fixture address");
    const origin = `http://127.0.0.1:${address.port}`;
    const frameOrigin = `http://localhost:${address.port}`;
    const native = new ElectronBrowserSurfaceNative();
    if (process.env["VF_WORKER_CACHE_CONTROL"] === "1")
      session.fromPartition("memory:worker-smoke", { cache: false });
    surface = native.createWindow({
      partition: "memory:worker-smoke",
      persistent: false,
      logicalViewport: { width: 800, height: 600 },
      initialBackingRaster: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
      requestSharedTexture: true,
    });
    surface.onPaint((p) => p.texture?.release());
    const page = surface.controlContents as unknown as WebContents;
    page.debugger.on("message", (_event, method, params) => {
      if (method === "Target.attachedToTarget")
        attachments.push({
          type: params.targetInfo?.type,
          waiting: params.waitingForDebugger === true,
        });
    });
    if (control) {
      const send = page.debugger.sendCommand.bind(page.debugger);
      page.debugger.sendCommand = (method, params, sessionId) =>
        send(
          method,
          method === "Target.setAutoAttach" ? { ...params, filter: [{ type: "iframe" }] } : params,
          sessionId,
        );
    }
    await surface.setEmulation({ ...native.engineAgent(), touchPoints: 0, colorScheme: "light" });
    const rounds: unknown[] = [];
    report.rounds = rounds;
    for (let round = 0; round < 2; round++) {
      await surface.loadURL(origin);
      const results = await page.executeJavaScript(`(async()=>{
      const run=async(kind,start)=>{
        const began=performance.now();let cleanup=()=>{},timer;
        try {
          const value=await Promise.race([
            new Promise((resolve,reject)=>{cleanup=start(resolve,reject)||cleanup}),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('worker startup timeout')),3000)})
          ]);
          return {kind,ok:true,ms:performance.now()-began,...value};
        } catch(e){return {kind,ok:false,ms:performance.now()-began,error:String(e)}}
        finally {clearTimeout(timer);cleanup()}
      };
      const dedicated=path=>(resolve,reject)=>{const w=new Worker(path);w.onmessage=e=>resolve(e.data);w.onerror=e=>reject(Error(e.message));return ()=>w.terminate()};
      return Promise.all([
        run('dedicated',dedicated('/worker.js')),
        run('nested',dedicated('/nested-worker.js')),
        run('shared',(resolve,reject)=>{const w=new SharedWorker('/shared-worker.js');w.port.onmessage=e=>resolve(e.data);w.onerror=e=>reject(Error(e.message));return ()=>w.port.close()}),
        run('service',(resolve,reject)=>{const ch=new MessageChannel();ch.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.register('/service-worker.js').then(()=>navigator.serviceWorker.ready).then(r=>r.active.postMessage('probe',[ch.port2])).catch(reject);return ()=>ch.port1.close()}),
        run('iframe',(resolve,reject)=>{const f=document.createElement('iframe');const heard=e=>{if(e.source===f.contentWindow&&e.origin===${JSON.stringify(frameOrigin)}&&e.data?.kind==='iframe-worker')resolve({ua:e.data.ua})};addEventListener('message',heard);f.src=${JSON.stringify(`${frameOrigin}/frame`)};f.onerror=()=>reject(Error('frame load failed'));document.body.append(f);return ()=>{removeEventListener('message',heard);f.remove()}})
      ]);
    })()`);
      rounds.push(results);
      report.pageUserAgent = await page.executeJavaScript("navigator.userAgent");
    }
    report.cacheValues = await page.executeJavaScript(
      "(async()=>[await(await fetch('/cache-probe')).text(),await(await fetch('/cache-probe')).text()])()",
    );
    report.cacheRequests = cacheRequests;
    report.identityConsistent = rounds.every((round) =>
      (round as { ua?: string }[]).every((result) => result.ua === report.pageUserAgent),
    );
    report.persistent = page.session.isPersistent();
    report.storagePath = page.session.storagePath;
    report.ok =
      report.persistent === false &&
      report.storagePath === null &&
      cacheRequests === 1 &&
      report.identityConsistent === true &&
      rounds.every((round) => (round as { ok: boolean }[]).every((result) => result.ok)) &&
      attachments.some((a) => a.type === "iframe");
  })
  .catch((error) => {
    report.error = String(error);
  })
  .finally(() => {
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    if (surface && !surface.isDestroyed()) surface.destroy();
    server.close();
    app.quit();
  });
app.on("will-quit", () => {
  rmSync(profile, { recursive: true, force: true });
  if (report.ok !== true) app.exit(1);
});
