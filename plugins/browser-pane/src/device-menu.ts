import type { Entity, ObjectDomHost } from "@vibefield/plugin-sdk/desk";
import { applyPaneSettings, type PaneSettingsApi, readPaneSettings } from "./device";
import { DEVICES, type DeviceId, deviceOf } from "./devices";

/** A settings form opened by the object menu. Page controls remain on the GPU pane. */
export function mountDeviceMenu(dom: ObjectDomHost) {
  const doc = dom.container.ownerDocument;
  const sheet = doc.createElement("style");
  sheet.textContent = `
    .vf-browser-device { box-sizing:border-box; width:348px; max-width:calc(100vw - 32px); margin:0; padding:20px;
      color:var(--vf-text-primary); background:var(--vf-chrome-solid);
      border:1px solid var(--vf-hairline-strong); border-radius:18px;
      box-shadow:var(--vf-shadow-island); font:13px/1.45 var(--vf-font-sans); }
    .vf-browser-device::backdrop { background:transparent; }
    .vf-browser-device * { box-sizing:border-box; }
    .vf-browser-device form { display:flex; flex-direction:column; max-height:calc(var(--browser-pane-menu-height, 680px) - 40px); }
    .vf-browser-device .vf-browser-settings-body { overflow-y:auto; overscroll-behavior:contain; min-height:0; padding:2px; margin:-2px; }
    .vf-browser-device header, .vf-browser-device footer { flex-shrink:0; }
    .vf-browser-device header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .vf-browser-device h2 { font-size:15px; font-weight:650; margin:0; }
    .vf-browser-device p { color:var(--vf-text-secondary); font-size:11px; margin:10px 0 0; }
    .vf-browser-device label { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; font-size:12px; font-weight:550; }
    .vf-browser-device input, .vf-browser-device select, .vf-browser-device textarea { width:100%; min-width:0;
      font:13px/1.4 var(--vf-font-sans); padding:7px 9px; min-height:34px; border-radius:7px;
      border:1px solid var(--vf-hairline-strong); background:var(--vf-chrome-solid); color:inherit; }
    .vf-browser-device textarea { resize:vertical; min-height:82px; font-size:11px; }
    .vf-browser-device :focus-visible { outline:2px solid var(--vf-select); outline-offset:2px; }
    .vf-browser-device .vf-browser-row { display:flex; align-items:end; gap:10px; }
    .vf-browser-device .vf-browser-row label { flex:1; }
    .vf-browser-device button { font:inherit; color:inherit; cursor:pointer; }
    .vf-browser-device .vf-browser-icon { background:transparent; border:0; border-radius:7px; width:30px; height:30px; padding:0; }
    .vf-browser-device .vf-browser-icon:hover { background:var(--vf-chrome-surface-hover); }
    .vf-browser-device .vf-browser-rotate { flex:none; margin-bottom:14px; }
    .vf-browser-device .vf-browser-custom[hidden] { display:none; }
    .vf-browser-device footer { display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--vf-hairline-strong); margin-top:16px; padding-top:14px; }
    .vf-browser-device footer button { padding:7px 13px; border-radius:8px; border:1px solid var(--vf-hairline-strong); background:transparent; }
    .vf-browser-device footer button[type=submit] { color:var(--vf-state-on-solid); background:var(--vf-select); border-color:transparent; }
    .vf-browser-device [role=alert] { color:var(--vf-ink-danger); }
    .vf-browser-sound-note { position:absolute; bottom:24px; left:50%; transform:translateX(-50%); pointer-events:none;
      padding:8px 14px; border-radius:24px; background:var(--vf-chrome-solid); color:var(--vf-text-primary);
      box-shadow:var(--vf-shadow-island); font:13px var(--vf-font-sans); z-index:20; }
  `;
  dom.container.appendChild(sheet);
  const dialog = doc.createElement("dialog");
  dialog.className = "vf-browser-device";
  dialog.setAttribute("aria-label", "Device emulation");
  dialog.innerHTML = `
    <form>
      <header><h2>Device emulation</h2><button class="vf-browser-icon" type="button" data-close aria-label="Close device settings">✕</button></header>
      <div class="vf-browser-settings-body">
      <label>Device<select name="preset"><option value="custom">Responsive · custom viewport</option></select></label>
      <div class="vf-browser-row">
        <label>Width<input name="width" type="number" min="320" max="8192" step="1" required aria-label="Viewport width in CSS pixels"></label>
        <label>Height<input name="height" type="number" min="240" max="8192" step="1" required aria-label="Viewport height in CSS pixels"></label>
        <button class="vf-browser-icon vf-browser-rotate" type="button" data-rotate title="Rotate viewport" aria-label="Rotate viewport">⇄</button>
      </div>
      <div class="vf-browser-row">
        <label>Pixel ratio<input name="dpr" type="number" min="0.5" max="8" step="0.5" required aria-label="Device pixel ratio"></label>
        <label>Input<select name="inputMode"><option value="desktop">Desktop · pointer</option><option value="desktop-touch">Desktop · touch</option><option value="mobile">Mobile · touch</option><option value="mobile-pointer">Mobile · pointer</option></select></label>
      </div>
      <label>User agent<select name="userAgentMode"><option value="device">Device default</option><option value="browser">Browser default</option><option value="custom">Custom</option></select></label>
      <div class="vf-browser-custom" hidden>
        <label>User-agent string<textarea name="userAgent" maxlength="512" rows="3" spellcheck="false" placeholder="Mozilla/5.0 …"></textarea></label>
        <label>Navigator platform<input name="navigatorPlatform" maxlength="32" placeholder="e.g. MacIntel, Win32, Linux armv8l" spellcheck="false"></label>
      </div>
      <p data-agent-preview></p>
      <p>CSS pixels · Chromium emulation. User-agent and input changes reload the page; pixel ratio changes restart it.</p>
      <p role="alert" hidden></p>
      </div>
      <footer><button type="button" data-close>Cancel</button><button type="submit">Apply</button></footer>
    </form>`;
  const form = dialog.querySelector("form")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const preset = field("preset") as HTMLSelectElement;
  for (const device of DEVICES) {
    const option = doc.createElement("option");
    option.value = device.id;
    option.textContent = `${device.name} · ${device.width} × ${device.height}`;
    preset.appendChild(option);
  }
  let base: DeviceId = "laptop";
  let session: { api: PaneSettingsApi; entities: readonly Entity[] } | undefined;
  let restoreFocus: HTMLElement | undefined;
  const custom = dialog.querySelector<HTMLElement>(".vf-browser-custom")!;
  const error = dialog.querySelector<HTMLElement>("[role=alert]")!;
  const agentPreview = dialog.querySelector<HTMLElement>("[data-agent-preview]")!;
  const updateAgent = () => {
    const mode = field("userAgentMode").value;
    custom.hidden = mode !== "custom";
    field("userAgent").required = mode === "custom";
    const agent = mode === "device" ? deviceOf(base).agent : null;
    agentPreview.textContent =
      mode === "custom"
        ? "Custom client hints are left unspecified."
        : agent === null
          ? "Reports the bundled Chromium browser."
          : `${agent.platform} ${agent.platformVersion} · ${agent.model}`;
  };
  preset.addEventListener("change", () => {
    if (preset.value === "custom") return;
    base = deviceOf(preset.value).id;
    const d = deviceOf(base);
    field("width").value = String(d.width);
    field("height").value = String(d.height);
    field("dpr").value = String(d.dpr);
    field("inputMode").value = d.mobile ? "mobile" : "desktop";
    field("userAgentMode").value = "device";
    updateAgent();
  });
  for (const name of ["width", "height", "dpr", "inputMode"])
    field(name).addEventListener("input", () => {
      preset.value = "custom";
    });
  field("userAgentMode").addEventListener("change", updateAgent);
  dialog.querySelector("[data-rotate]")!.addEventListener("click", () => {
    const width = field("width"),
      height = field("height");
    [width.value, height.value] = [height.value, width.value];
    preset.value = "custom";
  });
  for (const button of Array.from(dialog.querySelectorAll("[data-close]")))
    button.addEventListener("click", () => dialog.close());
  // Form edits never become canvas shortcuts, drags, or page input.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  dialog.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  dialog.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    session = undefined;
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    dom.wake();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (session === undefined) return;
    const applied = applyPaneSettings(session.api, session.entities, {
      device: base,
      width: Number(field("width").value),
      height: Number(field("height").value),
      deviceScaleFactor: Number(field("dpr").value),
      inputMode: field("inputMode").value,
      userAgentMode: field("userAgentMode").value,
      userAgent: field("userAgent").value.trim(),
      navigatorPlatform: field("navigatorPlatform").value.trim(),
    });
    if (applied) dialog.close();
    else {
      error.hidden = false;
      error.textContent =
        "Could not apply these settings. Check the values and that this canvas is editable.";
    }
  });
  dom.container.appendChild(dialog);
  const note = doc.createElement("div");
  note.className = "vf-browser-sound-note";
  note.setAttribute("role", "status");
  note.hidden = true;
  dom.container.appendChild(note);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get open() {
      return dialog.open;
    },
    configure(api: PaneSettingsApi, entities: readonly Entity[]) {
      const first = entities[0];
      if (first === undefined) return;
      const settings = readPaneSettings(api.world, first);
      if (settings === undefined) return;
      session = { api, entities: [...entities] };
      base = settings.device;
      for (const [name, value] of Object.entries(settings)) {
        if (name === "device") continue;
        field(name === "deviceScaleFactor" ? "dpr" : name).value = String(value);
      }
      const d = deviceOf(base);
      preset.value =
        settings.width === d.width &&
        settings.height === d.height &&
        settings.deviceScaleFactor === d.dpr
          ? base
          : "custom";
      const heading = dialog.querySelector("h2")!;
      heading.textContent =
        entities.length === 1 ? "Device emulation" : `Device emulation · ${entities.length} panes`;
      error.hidden = true;
      updateAgent();
      restoreFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined;
      const anchor = restoreFocus?.getBoundingClientRect();
      const view = doc.defaultView!;
      // Show beside the invoking toolbar when it has focus; otherwise at the canvas's upper right.
      dialog.style.left = `${Math.max(16, Math.min(anchor?.width ? anchor.left : view.innerWidth - 380, view.innerWidth - 364))}px`;
      const top = Math.max(
        16,
        Math.min(anchor?.height ? anchor.bottom + 10 : 90, view.innerHeight - 550),
      );
      dialog.style.top = `${top}px`;
      dialog.style.setProperty("--browser-pane-menu-height", `${view.innerHeight - top - 16}px`);
      dialog.style.maxHeight = "var(--browser-pane-menu-height)";
      if (!dialog.open) dialog.showModal();
      preset.focus();
    },
    say(message: string) {
      clearTimeout(timer);
      note.textContent = message;
      note.hidden = false;
      timer = setTimeout(() => {
        note.hidden = true;
      }, 1800);
    },
    dispose() {
      clearTimeout(timer);
      dialog.close();
      dialog.remove();
      note.remove();
      sheet.remove();
    },
  };
}
