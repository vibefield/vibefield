/** Opt-in, real-canvas browser chrome and local media playback check. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { paneHeadPoint } from "./browser-pane-chrome";
import { layPane, type PaneRowsDriver, paneHands, paneToMiddle } from "./smoke-browser-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function browserPaneUi(
  d: PaneRowsDriver,
  pageUrl: string,
  mediaUrl: string,
): Promise<string[]> {
  const out = process.env["VF_BROWSER_PERF_OUT"]!;
  mkdirSync(out, { recursive: true });
  const mediaOnly = process.env["VF_BROWSER_PERF_MEDIA_ONLY"] === "1";
  const h = paneHands(d),
    report: Record<string, unknown> = {
      at: new Date().toISOString(),
      mediaUrl,
      engine: { electron: process.versions.electron, chromium: process.versions.chrome },
      mode: mediaOnly ? "playback-only" : "full-ui",
    };
  const snap = async (name: string) =>
    writeFileSync(join(out, `${name}.png`), (await d.win.capturePage()).toPNG());
  const check = (ok: unknown, why: string) => {
    if (!ok) throw Error(why);
  };
  let page: WebContents | undefined;
  const handoff = async (failed = false) => {
    d.win.setTitle("VibeField — Browser pane UI preview");
    d.win.setIgnoreMouseEvents(false);
    d.win.setFocusable(true);
    d.win.show();
    d.win.focus();
    app.focus({ steal: true });
    d.say(failed ? "BROWSER_UI_INTERACTIVE_FAILED" : "BROWSER_UI_INTERACTIVE_READY");
    await new Promise<void>((resolve) => d.win.once("closed", () => resolve()));
  };
  try {
    await h.js(`globalThis.__vfDesk.ambient('still')`);
    await h.theme("light");
    const at = await layPane(h, await h.census(), () => {});
    if (at.pane === undefined) throw Error("No pane laid");
    const e = at.pane;
    await paneToMiddle(h, e, at);
    const row = (await h.rows()).find((r) => r.entity === e)!;
    check(
      await h.js(`globalThis.__vfDesk.writeProps(${e},{url:${JSON.stringify(pageUrl)}})`),
      "Navigation refused",
    );
    await h.until(
      "GPU fixture live",
      90000,
      `globalThis.__vfDesk.live().faces.some(f=>f.key===${JSON.stringify(row.key)}&&f.state.is==='live'&&f.presented>0&&f.info.loading===undefined)`,
    );
    page = webContents
      .getAllWebContents()
      .find((p) => p.isOffscreen() && p.getURL().startsWith(pageUrl));
    if (!page) throw Error("Missing browser source");
    const id = page.id;
    const local = `globalThis.__vfDesk.local('vibefield.browser-pane')`;
    h.move(15, 15);
    await sleep(500);
    check(await h.js(`${local}.said(${e}).interactive!==true`), "Resting header is interactive");
    await snap("rest");
    const frame = await h.frame();
    if (!frame) throw Error("Missing pane frame");
    const off = await h.deskAt();
    const center = {
      x: off.left + (frame.x0 + frame.x1) / 2,
      y: off.top + (frame.y0 + frame.y1) / 2,
    };
    h.move(center.x, center.y);
    await h.until("hover instruction", 4000, `${local}.said(${e}).hint===true`);
    await snap("hover");
    // ICE recognizes two pointer taps, independently of Electron’s clickCount.
    await h.press(center);
    await h.press(center, 2);
    await h.until(
      "double click opens browser",
      10000,
      `globalThis.__vfDesk.held()?.entity===${e}&&globalThis.__vfDesk.held()?.frame?.settled===true`,
    );
    check(
      await h.js(`${local}.said(${e}).interactive===true&&${local}.said(${e}).hint!==true`),
      "Active header has wrong state",
    );
    const tools = await h.js<string[]>(
      `[...document.querySelectorAll('[data-face-row="hand"] [data-tool]')].map(e=>e.dataset.tool)`,
    );
    check(tools.join(",") === "device,sound", `Unexpected toolbar controls: ${tools}`);
    await snap("active");
    if (!mediaOnly) {
      await h.press(await paneHeadPoint(h, "address"));
      await h.until(
        "address editor",
        5000,
        `document.activeElement?.hasAttribute('data-browser-pane-address')===true`,
      );
      const editor = await h.js<{ value: string; start: number; end: number }>(
        `({value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})`,
      );
      check(
        editor.start === 0 && editor.end === editor.value.length,
        "Address was not selected on entry",
      );
      await snap("address");
      await h.press(await paneHeadPoint(h, "address"));
      await h.until(
        "native address caret",
        4000,
        `document.activeElement.hasAttribute('data-browser-pane-address')&&document.activeElement.selectionStart===document.activeElement.selectionEnd`,
      );
      await h.key("Escape");
      check(
        await h.js(`globalThis.__vfDesk.held()?.entity===${e}`),
        "Cancel address put the pane down",
      );
      // Exercise history and refresh on the object's own GPU hit targets.
      await h.press(await paneHeadPoint(h, "address"));
      await h.until(
        "address focus before typing",
        5000,
        `document.activeElement?.hasAttribute('data-browser-pane-address')===true`,
      );
      await d.win.webContents.insertText(pageUrl + "#vf-chrome-check");
      await h.key("Return");
      await h.until(
        "address navigation",
        20000,
        `${local}.page(${e}).info.address===${JSON.stringify(pageUrl + "#vf-chrome-check")}&&${local}.page(${e}).info.back===true`,
      );
      await h.press(await paneHeadPoint(h, "back"));
      await h.until(
        "GPU back",
        20000,
        `${local}.page(${e}).info.address===${JSON.stringify(pageUrl)}`,
      );
      await h.press(await paneHeadPoint(h, "forward"));
      await h.until(
        "GPU forward",
        20000,
        `${local}.page(${e}).info.address===${JSON.stringify(pageUrl + "#vf-chrome-check")}`,
      );
      await h.until(
        "page ready for refresh",
        20000,
        `${local}.page(${e}).info.loading===undefined`,
      );
      const originBeforeReload = await page.executeJavaScript("performance.timeOrigin");
      await h.press(await paneHeadPoint(h, "reload"));
      for (
        let i = 0;
        i < 80 &&
        (await page.executeJavaScript("performance.timeOrigin").catch(() => originBeforeReload)) ===
          originBeforeReload;
        i++
      )
        await sleep(100);
      check(
        (await page.executeJavaScript("performance.timeOrigin")) !== originBeforeReload,
        "GPU reload did not reload the document",
      );
      report.navigation = { address: true, back: true, forward: true, reload: true };
      d.say("BROWSER_UI_NAVIGATION_OK");
      // Custom resolution and UA, using the real settings form and one Apply.
      await h.pressSelector('[data-face-row="hand"] [data-tool="device"]');
      await h.until(
        "device settings",
        4000,
        `document.querySelector('.vf-browser-device')?.open===true`,
      );
      await h.js(
        `(()=>{const f=document.querySelector('.vf-browser-device form'); const set=(n,v)=>{const e=f.elements.namedItem(n);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}; set('width','960');set('height','640');set('dpr','2');set('userAgentMode','custom');set('userAgent','VibeField-Emulation-Test/1.0');set('navigatorPlatform','MacIntel');})()`,
      );
      await h.js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      await snap("device-settings");
      await h.theme("dark");
      await h.js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      await snap("device-settings-dark");
      await h.theme("light");
      await h.pressSelector('.vf-browser-device button[type="submit"]');
      await h.until(
        "custom device applied",
        10000,
        `globalThis.__vfDesk.objects('vibefield.browser-pane').find(r=>r.entity===${e}).props.userAgentMode==='custom'`,
      );
      await sleep(2500);
      const custom = await page.executeJavaScript(
        `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent,platform:navigator.platform})`,
      );
      report.customDevice = custom;
      check(
        custom.width === 960 &&
          custom.height === 640 &&
          custom.dpr === 2 &&
          custom.ua === "VibeField-Emulation-Test/1.0",
        "Custom device did not reach the browser",
      );
      check(page.id === id, "Device changes replaced the browser target");
      // Phone controls remain inside the object; then restore desktop for the video.
      for (const preset of ["phone", "laptop"]) {
        const previous = page.id;
        await h.pressSelector('[data-face-row="hand"] [data-tool="device"]');
        await h.until(
          "device settings reopened",
          4000,
          `document.querySelector('.vf-browser-device')?.open===true`,
        );
        await h.js(
          `(()=>{const e=document.querySelector('.vf-browser-device [name="preset"]');e.value=${JSON.stringify(preset)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await h.pressSelector('.vf-browser-device button[type="submit"]');
        await h.until(
          "device preset applied",
          5000,
          `globalThis.__vfDesk.objects('vibefield.browser-pane').find(r=>r.entity===${e}).props.device===${JSON.stringify(preset)}&&document.querySelector('.vf-browser-device')?.open===false`,
        );
        const expectedDpr = preset === "phone" ? 3 : 2;
        let replacement: WebContents | undefined;
        for (let i = 0; i < 240; i++) {
          const candidate = webContents
            .getAllWebContents()
            .find(
              (p) =>
                !p.isDestroyed() &&
                p.isOffscreen() &&
                p.id !== previous &&
                p.getURL().startsWith(pageUrl),
            );
          if (
            candidate &&
            (await candidate.executeJavaScript("devicePixelRatio").catch(() => 0)) === expectedDpr
          ) {
            replacement = candidate;
            break;
          }
          await sleep(250);
        }
        check(replacement, "Pixel-ratio change did not produce the requested device");
        page = replacement!;
        report[`${preset}Target`] = page.id;
        await h.until(
          "device shape settled",
          8000,
          `globalThis.__vfDesk.held()?.frame?.settled===true`,
        );
        await snap(preset);
      }
      d.say("BROWSER_UI_EMULATION_OK");
    }
    // Real keyboard input needs the same native focus used after handoff, including
    // noninteractive UI checks. The smoke still owns mouse input until handoff.
    d.win.setFocusable(true);
    d.win.show();
    d.win.focus();
    app.focus({ steal: true });
    // Navigate using the GPU address control and the host's normal native text input.
    await h.press(await paneHeadPoint(h, "address"));
    await h.until(
      "address focus before typing",
      5000,
      `document.activeElement?.hasAttribute('data-browser-pane-address')===true`,
    );
    await d.win.webContents.insertText(mediaUrl);
    await h.key("Return");
    const waitPage = async (label: string, expression: string, ms = 60000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await page!.executeJavaScript(expression).catch(() => false)) return;
        await sleep(250);
      }
      throw Error(`${label} timed out`);
    };
    await waitPage(
      "Media fixture",
      `location.href === ${JSON.stringify(mediaUrl)} && document.querySelector("#play")?.disabled === false`,
    );
    const pageClick = async (expression: string) => {
      // sendInputEvent does not activate a background native window like a real click.
      d.win.focus();
      app.focus({ steal: true });
      await h.until("window focused for page click", 5000, "document.hasFocus()");
      const pt = (await page!.executeJavaScript(expression)) as { x: number; y: number } | null;
      if (!pt) return false;
      const f = await h.js<HeldFrameSeen>(`globalThis.__vfDesk.held().frame`);
      const view = (await page!.executeJavaScript(`[innerWidth,innerHeight]`)) as [number, number];
      await h.press(pageOnWindow(f, view, await h.deskAt(), pt.x, pt.y));
      return true;
    };
    const buttonPoint = (id: string) =>
      `(() => { const r = document.getElementById(${JSON.stringify(id)})?.getBoundingClientRect(); return r ? {x:r.x+r.width/2, y:r.y+r.height/2} : null; })()`;
    check(await pageClick(buttonPoint("play")), "Missing media play control");
    await waitPage(
      "Decoded playback",
      "document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames > 2",
    );
    const media = () =>
      page!.executeJavaScript(
        `(() => { const v=document.querySelector("video"); return {origin:performance.timeOrigin, frames:v.getVideoPlaybackQuality().totalVideoFrames, time:v.currentTime, error:v.error?.message, paused:v.paused}; })()`,
      );
    const baseline = await media();
    let lastFrames = baseline.frames;
    if (!mediaOnly) {
      for (let i = 0; i < 60 && !page.isCurrentlyAudible(); i++) await sleep(250);
      check(page.isCurrentlyAudible(), "The media fixture did not produce audible audio");
      const before = await media();
      report.beforeMute = {
        ...before,
        sourceMuted: page.isAudioMuted(),
        audible: page.isCurrentlyAudible(),
        id: page.id,
      };
      await h.pressSelector('[data-face-row="hand"] [data-tool="sound"]');
      await sleep(700);
      check(page.isAudioMuted(), "Pane sound button did not mute its source");
      await sleep(2200);
      const muted = await media();
      check(
        muted.frames > before.frames && muted.origin === before.origin,
        "Mute interrupted video playback",
      );
      report.muted = {
        ...muted,
        sourceMuted: page.isAudioMuted(),
        audible: page.isCurrentlyAudible(),
      };
      await snap("media-muted");
      await h.pressSelector('[data-face-row="hand"] [data-tool="sound"]');
      await sleep(2500);
      const after = await media();
      check(
        !page.isAudioMuted() && after.origin === before.origin && after.frames > muted.frames,
        "Unmute reloaded or interrupted video",
      );
      report.afterUnmute = {
        ...after,
        sourceMuted: page.isAudioMuted(),
        audible: page.isCurrentlyAudible(),
        id: page.id,
      };
      await snap("media-playing");
      const sourceWindow = BrowserWindow.fromWebContents(page);
      check(sourceWindow, "Missing offscreen source window");
      const sourceBounds = sourceWindow!.getBounds(),
        hostBounds = d.win.getBounds();
      const fullscreenButton = buttonPoint("fullscreen");
      await pageClick(fullscreenButton);
      await waitPage("in-pane fullscreen", `!!document.fullscreenElement`, 8000);
      await h.until(
        "fullscreen state reaches pane",
        5000,
        `${local}.page(${e}).info.extra?.fullscreen===true`,
      );
      const fullscreenGeometry = `(()=>{const root=document.fullscreenElement,r=document.querySelector("#player")?.getBoundingClientRect();return {x:r?.x,y:r?.y,width:r?.width,height:r?.height,viewport:[innerWidth,innerHeight],root:root?.tagName,origin:performance.timeOrigin};})()`;
      report.fullscreenEntry = await page.executeJavaScript(fullscreenGeometry);
      await waitPage(
        "Fullscreen fills pane viewport",
        `(()=>{const root=document.fullscreenElement,player=document.querySelector("#player"),r=player?.getBoundingClientRect();return root&&player&&root.contains(player)&&r&&Math.abs(r.x)<1&&Math.abs(r.y)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1;})()`,
        8000,
      );
      const fullscreen = await page.executeJavaScript(fullscreenGeometry);
      check(
        JSON.stringify(sourceWindow!.getBounds()) === JSON.stringify(sourceBounds) &&
          JSON.stringify(d.win.getBounds()) === JSON.stringify(hostBounds),
        "HTML fullscreen resized a native window",
      );
      check(
        !sourceWindow!.isFullScreen() && !sourceWindow!.isVisible() && !d.win.isFullScreen(),
        "Page fullscreen escaped the canvas pane",
      );
      await snap("media-pane-fullscreen");
      await pageClick(fullscreenButton);
      await waitPage("Player button exits fullscreen", `!document.fullscreenElement`, 8000);
      await pageClick(fullscreenButton);
      await waitPage("Player button reenters fullscreen", `!!document.fullscreenElement`, 8000);
      await h.until(
        "fullscreen state before Escape",
        5000,
        `${local}.page(${e}).info.extra?.fullscreen===true`,
      );
      d.win.focus();
      app.focus({ steal: true });
      await h.until(
        "page editor focused for Escape",
        5000,
        `document.hasFocus()&&document.activeElement?.hasAttribute('data-desk-editor')===true`,
      );
      report.fullscreenFocus = await h.js(
        `({active:document.activeElement?.tagName,focused:document.hasFocus(),fullscreen:${local}.page(${e}).info.extra?.fullscreen})`,
      );
      await h.js(
        `globalThis.__vfFullscreenKey=null;document.addEventListener('keydown',function record(ev){if(ev.key!=='Escape')return;document.removeEventListener('keydown',record,true);setTimeout(()=>{globalThis.__vfFullscreenKey={key:ev.key,code:ev.code,prevented:ev.defaultPrevented,active:document.activeElement?.tagName};},0)},true)`,
      );
      await h.key("Escape");
      report.fullscreenKey = await h.js(`globalThis.__vfFullscreenKey`);
      await waitPage("Escape exits page fullscreen", `!document.fullscreenElement`, 8000);
      await h.until(
        "Escape keeps pane open",
        5000,
        `globalThis.__vfDesk.held()?.entity===${e}&&${local}.page(${e}).info.extra?.fullscreen!==true`,
      );
      check(
        (await page.executeJavaScript("performance.timeOrigin")) === before.origin,
        "Fullscreen reloaded playback",
      );
      report.fullscreen = {
        ...fullscreen,
        sourceWindowResized: false,
        hostWindowResized: false,
        escapedPanel: false,
        escapeKeptPaneOpen: true,
        playerButtonExited: true,
      };
      lastFrames = after.frames;
      d.say("BROWSER_UI_FULLSCREEN_OK");
    }

    // Count decoded frames across loops of the local clip.
    const watchedAt = Date.now();
    let progressedAt = watchedAt;
    while (Date.now() - watchedAt < 120000) {
      await sleep(2000);
      const state = await media();
      check(!state.error && !state.paused, state.error || "Media playback stopped");
      check(state.origin === baseline.origin, "The media document changed during playback");
      if (state.frames > lastFrames) {
        lastFrames = state.frames;
        progressedAt = Date.now();
      }
      check(Date.now() - progressedAt < 15000, "Media playback stalled for 15 seconds");
      report.playback = { watchedMs: Date.now() - watchedAt, ...state };
      writeFileSync(join(out, "ui-report.json"), JSON.stringify(report, null, 2));
      if (Math.floor((Date.now() - watchedAt) / 2000) % 10 === 0)
        d.say(`BROWSER_UI_PLAYBACK ${JSON.stringify(report.playback)}`);
    }
    await snap("media-sustained");
    report.ok = true;
    d.say(`BROWSER_UI_OK ${JSON.stringify(report)}`);
    writeFileSync(join(out, "ui-report.json"), JSON.stringify(report, null, 2));
    if (process.env["VF_BROWSER_PERF_INTERACTIVE"] === "1") await handoff();
    return [];
  } catch (error) {
    report.error = String(error);
    report.desk = await h
      .js(
        `({held:globalThis.__vfDesk.held(),dialog:{open:document.querySelector('.vf-browser-device')?.open,values:[...document.querySelectorAll('.vf-browser-device [name]')].map(e=>[e.name,e.value]),error:document.querySelector('.vf-browser-device [role=alert]')?.textContent},active:{tag:document.activeElement?.tagName,address:document.activeElement?.hasAttribute('data-browser-pane-address'),value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd,pointer:document.activeElement&&getComputedStyle(document.activeElement).pointerEvents},panes:globalThis.__vfDesk.objects('vibefield.browser-pane')})`,
      )
      .catch(() => null);
    report.page = await page
      ?.executeJavaScript(
        `({url:location.href,title:document.title,fullscreen:document.fullscreenElement?.getBoundingClientRect().toJSON(),player:document.querySelector("#player")?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],text:document.body?.innerText.slice(0,2000)})`,
      )
      .catch(() => null);
    await snap("failure");
    report.ok = false;
    writeFileSync(join(out, "ui-report.json"), JSON.stringify(report, null, 2));
    d.say(`BROWSER_UI_FAILED ${JSON.stringify(report)}`);
    // Keep an interactive failure inspectable and observable, without refreshing it
    // or turning a failed playback check into a success.
    if (process.env["VF_BROWSER_PERF_INTERACTIVE"] === "1" && !d.win.isDestroyed())
      await handoff(true);
    return [String(error)];
  } finally {
    writeFileSync(join(out, "ui-report.json"), JSON.stringify(report, null, 2));
  }
}
