import type { SimulatorSetupStatus } from "@vibefield/plugin-sdk/desk";

export const setupStyles = `
.vf-sim-setup {
  box-sizing:border-box; pointer-events:auto; width:min(356px,calc(100vw - 28px));
  max-height:calc(100vh - 28px); padding:0; overflow:auto; overscroll-behavior:contain;
  border:1px solid var(--vf-hairline-strong,#0002); border-radius:18px;
  background:var(--vf-chrome-solid,#fafafa); color:var(--vf-text-primary,#242528);
  box-shadow:0 18px 60px #0003; font:13px/1.45 var(--vf-font-sans,system-ui,sans-serif);
}
.vf-sim-setup::backdrop {background:#0002}
.vf-sim-setup[data-held] {position:absolute;z-index:4;inset:auto;margin:0;max-width:none;max-height:none;border:0;box-shadow:none;scrollbar-width:thin}
.vf-sim-setup * {box-sizing:border-box}
.vf-sim-setup [hidden] {display:none!important}
.vf-sim-setup form {margin:0;padding:22px}
.vf-sim-setup[data-held] form {min-height:100%;display:flex;flex-direction:column;justify-content:center;padding:clamp(17px,6%,28px)}
.vf-sim-setup header {display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:18px}
.vf-sim-setup h2 {margin:0;font-size:19px;font-weight:650;letter-spacing:-.035em;line-height:1.2}
.vf-sim-setup p {margin:5px 0 0;color:var(--vf-text-secondary,#5e6269);font-size:12px}
.vf-sim-setup button,.vf-sim-setup select {color:inherit;font:inherit}
.vf-sim-setup button {border:0;background:transparent;cursor:pointer}
.vf-sim-setup [data-cancel] {display:grid;flex-shrink:0;place-items:center;border-radius:50%;width:28px;height:28px;padding:0;font-size:14px;line-height:1;background:var(--vf-fill-subtle,#8882)}
.vf-sim-setup ol {padding:0;list-style:none;margin:0}
.vf-sim-setup li {position:relative;display:grid;grid-template-columns:23px 1fr;gap:9px;padding:0 0 18px}
.vf-sim-setup li+li {padding-bottom:0}
.vf-sim-setup li:first-child::after {content:"";position:absolute;left:10px;top:25px;bottom:3px;width:1px;background:var(--vf-hairline-strong,#0002)}
.vf-sim-setup [data-marker] {display:grid;place-items:center;width:22px;height:22px;border:1px solid var(--vf-hairline-strong,#0003);border-radius:50%;font-size:11px;font-weight:650}
.vf-sim-setup [data-state=current] [data-marker] {background:var(--vf-text-primary,#242528);color:var(--vf-chrome-solid,#fafafa);border-color:transparent}
.vf-sim-setup [data-state=complete] [data-marker] {background:var(--vf-fill-subtle,#8882);color:var(--vf-text-primary,#242528)}
.vf-sim-setup [data-state=pending] {color:var(--vf-text-secondary,#686c72)}
.vf-sim-setup strong {display:block;padding-top:1px;font-size:14px;font-weight:620}
.vf-sim-setup label {display:grid;gap:5px;margin-bottom:12px;font-size:12px;font-weight:600}
.vf-sim-setup select {width:100%;min-width:0;height:36px;padding:0 8px;font-weight:450;border-radius:8px;border:1px solid var(--vf-hairline-strong,#0003);background:var(--vf-chrome-solid,#fafafa)}
.vf-sim-setup [data-xcode] {margin:0 0 13px}
.vf-sim-setup footer {display:grid;gap:8px;margin-top:18px}
.vf-sim-setup [data-primary],.vf-sim-setup [type=submit] {min-height:36px;padding:8px 10px;border-radius:9px;background:var(--vf-text-primary,#242528);color:var(--vf-chrome-solid,#fafafa);font-weight:600}
.vf-sim-setup [data-refresh],.vf-sim-setup [data-manage] {justify-self:start;padding:4px 0;text-align:left;color:var(--vf-text-secondary,#5e6269);font-size:12px;text-decoration:underline;text-underline-offset:3px}
.vf-sim-setup [data-refresh] {justify-self:center}
.vf-sim-setup [role=status]:empty {display:none}
.vf-sim-setup [role=status] {margin-top:12px}
.vf-sim-setup button:disabled,.vf-sim-setup select:disabled {opacity:.5;cursor:default}
.vf-sim-setup h2:focus {outline:none}
.vf-sim-setup button:focus-visible,.vf-sim-setup select:focus-visible {outline:2px solid var(--vf-select,#3978e6);outline-offset:2px}
`;

export const setupMarkup = `<form>
  <header><h2 tabindex="-1"></h2><button type="button" data-cancel aria-label="Close simulator setup" title="Close simulator setup">✕</button></header>
  <section data-guide hidden><ol aria-label="Simulator requirements" aria-live="polite">
    <li><span data-marker aria-hidden="true"></span><div><strong></strong><p></p></div></li>
    <li><span data-marker aria-hidden="true"></span><div><strong></strong><p></p></div></li>
  </ol></section>
  <section data-picker hidden>
    <p data-xcode hidden></p>
    <label>iOS version<select name="runtime" required></select></label>
    <label>iPhone model<select name="model" required></select></label>
    <button type="button" data-manage hidden>Add iOS versions…</button>
    <p data-components>Install other iOS versions in Xcode Settings → Components.</p>
  </section>
  <p role="status" aria-live="polite"></p>
  <footer><button type="button" data-primary hidden></button><button type="submit" hidden></button><button type="button" data-refresh>Refresh</button></footer>
</form>`;

const steps = {
  "install-xcode": [
    "Install Xcode",
    "Get Xcode from the Mac App Store. Open it once to finish installing its tools.",
    "Open Mac App Store",
  ],
  "select-xcode": [
    "Select Xcode",
    "In Xcode, open Settings → Locations and choose this installation under Command Line Tools.",
    "Open Xcode",
  ],
  "accept-license": [
    "Accept the Xcode license",
    "Open Xcode and accept Apple’s license agreement to continue.",
    "Open Xcode",
  ],
  "finish-xcode": [
    "Finish setting up Xcode",
    "Open Xcode and follow its prompts to install the required components.",
    "Open Xcode",
  ],
  "install-runtime": [
    "Install an iOS runtime",
    "In Xcode Settings → Components, choose an iOS version and select Download & Install.",
    "Open Xcode",
  ],
} as const;

export function showPrerequisite(
  guide: HTMLElement,
  action: HTMLButtonElement,
  status: SimulatorSetupStatus,
) {
  const stage = status.stage;
  if (!(stage in steps)) return;
  const [title, help, label] = steps[stage as keyof typeof steps];
  const needsRuntime = stage === "install-runtime";
  const [xcode, runtime] = Array.from(guide.querySelectorAll("li"));
  const row = (el: HTMLLIElement, state: string, marker: string, name: string, detail: string) => {
    el.dataset.state = state;
    if (state === "current") el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
    el.querySelector("[data-marker]")!.textContent = marker;
    el.querySelector("strong")!.textContent = name;
    el.querySelector("p")!.textContent = detail;
  };
  row(
    xcode!,
    needsRuntime ? "complete" : "current",
    needsRuntime ? "✓" : "1",
    needsRuntime ? "Xcode installed" : title,
    needsRuntime ? (status.xcodeVersion ? `Xcode ${status.xcodeVersion}` : "") : help,
  );
  row(
    runtime!,
    needsRuntime ? "current" : "pending",
    "2",
    "Install an iOS runtime",
    needsRuntime ? help : "",
  );
  action.textContent = label;
}
