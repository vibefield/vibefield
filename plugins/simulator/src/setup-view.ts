// THE SHEET'S LOOK (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts"): the simulator's settings as a sheet
// on its glass — from under the Dynamic Island to the screen's foot (setup-dialog.ts places it), VibeField's chrome on the
// phone and never the window's dialog. The solid material, padded 22 20 30: the heading at 19/650 with the kit's `close` 14
// in a 28 round on the ready fill; the sub line at 12 in tertiary ink, the Xcode on this Mac; the choices as pills — a
// label at 12/600 in secondary ink over a 36 pill on the ready fill, corners 12, the value at 13/500 and `chevron` 12 turned
// down, opening its list of the bar's rows in the sheet (§8 "A choice's list": a `check` 14 column, the current one
// checked); a link at 12 in secondary ink, underlined; a note at 12; and at its foot the inverted solid as its one primary,
// 38 tall, corners 19, 13/600, with a link under it. Tokens only (DESIGN.md §2): the ready fill is the foreground at 8%,
// pressed 14%, as the bar's.
import type { SimulatorSetupStatus } from "@vibefield/plugin-sdk/desk";
import { glyphSvg } from "@vibefield/plugin-sdk/ui-dom";

/** The kit's drawings the sheet wears (DESIGN.md §13). */
export const SHEET_GLYPHS = {
  close: glyphSvg("close", { size: 14 }),
  chevron: glyphSvg("chevron", { size: 12, turn: 90 }),
  check: glyphSvg("check", { size: 14 }),
  step: glyphSvg("check", { size: 12 }),
} as const;

const READY = "color-mix(in srgb, var(--vf-foreground) 8%, transparent)";
const PRESSED = "color-mix(in srgb, var(--vf-foreground) 14%, transparent)";

export const setupStyles = `
.vf-sim-setup {
  position:absolute; z-index:4; inset:auto; box-sizing:border-box; margin:0; padding:0; border:0;
  max-width:none; max-height:none; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin;
  pointer-events:auto; background:var(--vf-chrome-solid); color:var(--vf-text-primary);
  font:13px/1.45 var(--vf-font-sans);
}
.vf-sim-setup * {box-sizing:border-box}
.vf-sim-setup [hidden] {display:none!important}
.vf-sim-setup form {display:flex; flex-direction:column; min-height:100%; margin:0; padding:22px 20px 30px}
.vf-sim-setup header {display:flex; gap:8px; align-items:center; justify-content:space-between}
.vf-sim-setup h2 {margin:0; font-size:19px; font-weight:650; letter-spacing:-.035em; line-height:1.2}
.vf-sim-setup h2:focus {outline:none}
.vf-sim-setup p {margin:0; color:var(--vf-text-secondary); font-size:12px}
.vf-sim-setup [data-xcode] {margin-top:4px; color:var(--vf-text-tertiary)}
.vf-sim-setup button {border:0; padding:0; background:transparent; color:inherit; font:inherit; cursor:pointer}
.vf-sim-setup [data-cancel] {display:grid; flex:none; place-items:center; width:28px; height:28px; border-radius:50%; color:var(--vf-text-secondary); background:${READY}}
.vf-sim-setup [data-cancel]:hover {color:var(--vf-text-primary); background:${PRESSED}}
.vf-sim-setup [data-cancel] svg {display:block}
.vf-sim-setup [data-guide], .vf-sim-setup [data-picker] {margin-top:18px}
.vf-sim-setup ol {padding:0; list-style:none; margin:0}
.vf-sim-setup li {position:relative; display:grid; grid-template-columns:23px 1fr; gap:9px; padding:0 0 18px}
.vf-sim-setup li+li {padding-bottom:0}
.vf-sim-setup li:first-child::after {content:""; position:absolute; left:10px; top:25px; bottom:3px; width:1px; background:var(--vf-hairline-strong)}
.vf-sim-setup [data-marker] {display:grid; place-items:center; width:22px; height:22px; border:1px solid var(--vf-hairline-strong); border-radius:50%; font-size:11px; font-weight:650}
.vf-sim-setup [data-state=current] [data-marker] {background:var(--vf-foreground); color:var(--vf-foreground-inverse); border-color:transparent}
.vf-sim-setup [data-state=complete] [data-marker] {background:${READY}; color:var(--vf-text-primary); border-color:transparent}
.vf-sim-setup [data-state=pending] {color:var(--vf-text-secondary)}
.vf-sim-setup li p {margin-top:5px}
.vf-sim-setup strong {display:block; padding-top:1px; font-size:14px; font-weight:620}
.vf-sim-setup .vf-sim-choice {display:grid; gap:6px; margin-bottom:12px}
.vf-sim-setup .vf-sim-label {color:var(--vf-text-secondary); font-size:12px; font-weight:600; line-height:1.2}
.vf-sim-setup .vf-sim-pill {display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-width:0; height:36px; padding:0 12px; border-radius:12px; color:var(--vf-text-primary); background:${READY}; font:500 13px/1 var(--vf-font-sans); text-align:left; transition:background-color 120ms ease}
.vf-sim-setup .vf-sim-pill:hover, .vf-sim-setup .vf-sim-pill[aria-expanded=true] {background:${PRESSED}}
.vf-sim-setup .vf-sim-pill-value {min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.vf-sim-setup .vf-sim-pill[data-placeholder] .vf-sim-pill-value {color:var(--vf-text-secondary)}
.vf-sim-setup .vf-sim-chevron {display:inline-flex; flex:none; color:var(--vf-text-tertiary)}
.vf-sim-setup .vf-sim-list {display:flex; flex-direction:column; gap:1px; padding:4px; border-radius:16px; box-shadow:inset 0 0 0 1px var(--vf-hairline-strong)}
.vf-sim-setup .vf-sim-row {display:flex; align-items:center; width:100%; min-height:34px; padding:0 10px; border-radius:12px; color:var(--vf-text-primary); font:500 13px/1.2 var(--vf-font-sans); text-align:left; transition:background-color 120ms ease}
.vf-sim-setup .vf-sim-row:hover, .vf-sim-setup .vf-sim-row:focus {background:${READY}; outline:none}
.vf-sim-setup .vf-sim-row:focus-visible {outline:2px solid var(--vf-select); outline-offset:-2px}
.vf-sim-setup .vf-sim-row[aria-disabled=true] {color:var(--vf-text-tertiary); background:transparent; cursor:default}
.vf-sim-setup .vf-sim-check {display:inline-flex; width:22px; flex:none; color:var(--vf-text-primary)}
.vf-sim-setup .vf-sim-row[aria-checked=false] .vf-sim-check svg {visibility:hidden}
.vf-sim-setup .vf-sim-row-label {min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.vf-sim-setup [data-manage], .vf-sim-setup [data-refresh] {justify-self:start; padding:4px 0; text-align:left; color:var(--vf-text-secondary); font-size:12px; text-decoration:underline; text-underline-offset:3px}
.vf-sim-setup [data-refresh] {justify-self:center}
.vf-sim-setup [data-components] {margin-top:6px}
.vf-sim-setup [role=status]:empty {display:none}
.vf-sim-setup [role=status] {margin-top:12px}
.vf-sim-setup footer {display:grid; gap:8px; margin-top:auto; padding-top:18px}
.vf-sim-setup [data-primary], .vf-sim-setup [type=submit] {height:38px; padding:0 16px; border-radius:19px; color:var(--vf-foreground-inverse); background:var(--vf-foreground); font:600 13px/1 var(--vf-font-sans); transition:opacity 120ms ease, transform 120ms ease}
.vf-sim-setup [data-primary]:hover, .vf-sim-setup [type=submit]:hover {opacity:.9}
.vf-sim-setup [data-primary]:active, .vf-sim-setup [type=submit]:active {transform:scale(.96)}
.vf-sim-setup button:disabled {opacity:.5; cursor:default; transform:none}
.vf-sim-setup button:focus-visible {outline:2px solid var(--vf-select); outline-offset:2px}
@media (prefers-reduced-motion: reduce) {
  .vf-sim-setup .vf-sim-pill, .vf-sim-setup .vf-sim-row, .vf-sim-setup [data-primary], .vf-sim-setup [type=submit] {transition:none}
}
`;

/** A choice of the sheet: its label over its pill, and its list under it, closed (setup-choice.ts fills and opens it). */
const choice = (name: string, label: string): string =>
  `<div class="vf-sim-choice" data-choice="${name}">
      <span class="vf-sim-label">${label}</span>
      <button type="button" class="vf-sim-pill" data-pill="${name}" aria-haspopup="menu" aria-expanded="false"><span class="vf-sim-pill-value" data-shown></span><span class="vf-sim-chevron" aria-hidden="true">${SHEET_GLYPHS.chevron}</span></button>
      <div class="vf-sim-list" role="menu" aria-label="${label}" data-list="${name}" hidden></div>
    </div>`;

export const setupMarkup = `<form>
  <header><h2 tabindex="-1"></h2><button type="button" data-cancel aria-label="Close simulator setup" title="Close simulator setup">${SHEET_GLYPHS.close}</button></header>
  <p data-xcode hidden></p>
  <section data-guide hidden><ol aria-label="Simulator requirements" aria-live="polite">
    <li><span data-marker aria-hidden="true"></span><div><strong></strong><p></p></div></li>
    <li><span data-marker aria-hidden="true"></span><div><strong></strong><p></p></div></li>
  </ol></section>
  <section data-picker hidden>
    ${choice("runtime", "iOS version")}
    ${choice("model", "iPhone model")}
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
    // a step done wears the kit's check (DESIGN.md §13); the others their number
    const mark = el.querySelector<HTMLElement>("[data-marker]")!;
    if (state === "complete") mark.innerHTML = SHEET_GLYPHS.step;
    else mark.textContent = marker;
    el.querySelector("strong")!.textContent = name;
    el.querySelector("p")!.textContent = detail;
  };
  row(
    xcode!,
    needsRuntime ? "complete" : "current",
    "1",
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
