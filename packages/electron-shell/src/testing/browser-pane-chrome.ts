import type { PaneHands } from "./smoke-browser-pane";
import type { HeldFrameSeen } from "./smoke-use-pane";

/** The head uses the same object frame as the editor, not the floating selection bar. */
export async function paneHeadPoint(
  h: Pick<PaneHands, "js" | "deskAt">,
  part: "address" | "back" | "forward" | "reload",
) {
  const at = await h.js<{
    f: HeldFrameSeen;
    S: { half: [number, number]; border: number; band: number };
    extentV: number;
  }>(`(() => {
    const held=globalThis.__vfDesk.held(); const at=globalThis.__vfDesk.local('vibefield.browser-pane').layout(held.entity);
    return {f:held.frame,S:at.G.shape,extentV:at.ext.cy-at.G.centre[1]}; })()`);
  const mm = 200 / 76.2,
    glyph = 4.2 * mm;
  const inner = at.S.half[0] - at.S.border - 0.6 * mm;
  const y = -at.S.half[1] + (at.S.band + at.S.half[1]) * 0.54;
  const back = -inner + glyph * 0.5,
    forward = back + glyph * 1.35;
  const compact = at.S.half[0] * 2 < 120 * mm;
  const capW = Math.min(Math.max(at.S.half[0] * 0.5, 40 * mm), 84 * mm);
  const address = compact ? (forward + glyph * 0.95 + inner) / 2 : 0;
  const x =
    part === "back"
      ? back
      : part === "forward"
        ? forward
        : part === "reload"
          ? (compact ? inner : capW) - glyph * 0.62
          : address;
  const off = await h.deskAt();
  return { x: off.left + at.f.cx + x * at.f.s, y: off.top + at.f.cy + (y - at.extentV) * at.f.s };
}

export async function pressPaneHead(
  h: Pick<PaneHands, "js" | "deskAt" | "press">,
  part: "back" | "reload",
): Promise<void> {
  await h.press(await paneHeadPoint(h, part));
}

/** Read the state used to draw the held pane's navigation glyphs. */
export function paneHeadControl(h: Pick<PaneHands, "js">, part: "back" | "reload") {
  return h.js<{ disabled: boolean; label: string } | null>(`(() => {
    const desk = globalThis.__vfDesk;
    const held = desk.held();
    if (!held) return null;
    const local = desk.local("vibefield.browser-pane");
    const head = local?.said(held.entity);
    if (!head?.interactive) return null;
    if (${JSON.stringify(part)} === "back") return { disabled: !head.canBack, label: "Back" };
    const state = local.page(held.entity)?.state;
    return { disabled: state?.is === "failed" && !state.retry, label: head.loading ? "Stop" : "Reload" };
  })()`);
}

/** The pane's Device pill (track OM, OM-1; DESIGN.md §8 "An act that is a choice"): on the selection bar, or the tool in
 * hand. */
const DEVICE_PILL = {
  bar: '[data-selection-bar] [data-face-row="selection"] [data-act="act:device"]',
  hand: '[data-selection-bar] [data-face-row="hand"] [data-tool="device"]',
} as const;
/** A row of the Device list, grown in the bar. */
const deviceRow = (id: string): string =>
  `[data-selection-bar][data-open] .vf-bar-list[data-choices="device"] [data-row="choice:${id}"]`;
/** Custom's fields, open under its row. */
const CUSTOM_FIELDS = "[data-selection-bar] [data-choice-fields]";
const folded = `document.querySelector("[data-selection-bar]")?.hasAttribute("data-open") === false`;

type DeviceHands = Pick<PaneHands, "js" | "until" | "pressSelector">;

/** The Device list grown from its pill as a person grows it — the pill pressed — and its rows settled (they fade in
 * nearest first), so a press lands on the row it aims at. */
export async function openPaneDevices(
  h: DeviceHands,
  where: keyof typeof DEVICE_PILL = "bar",
): Promise<void> {
  await h.pressSelector(DEVICE_PILL[where]);
  await h.until(
    "the device list",
    5000,
    `(() => { const r = document.querySelector(${JSON.stringify(deviceRow("custom"))}); return r !== null && getComputedStyle(r).opacity === "1"; })()`,
  );
}

/** Choose a device from the pane's Device list, as a person does (OM-1): the pill, then its row. */
export async function choosePaneDevice(
  h: DeviceHands,
  device: string,
  where: keyof typeof DEVICE_PILL = "bar",
): Promise<void> {
  await openPaneDevices(h, where);
  await h.pressSelector(deviceRow(device));
  await h.until("the device list folded", 5000, folded);
}

/** Custom's fields opened from the Device list: its row taken, the fields standing under it. */
export async function openPaneCustom(
  h: DeviceHands,
  where: keyof typeof DEVICE_PILL = "bar",
): Promise<void> {
  await openPaneDevices(h, where);
  await h.pressSelector(deviceRow("custom"));
  await h.until(
    "Custom's fields",
    5000,
    `document.querySelector(${JSON.stringify(`${CUSTOM_FIELDS} input[name="width"]`)}) !== null`,
  );
}

/** Custom's fields typed: each value set and its input heard, as the page's own typing reaches React. */
export async function typePaneCustom(
  h: DeviceHands,
  values: { readonly width: number; readonly height: number; readonly agent: string },
): Promise<void> {
  const typed = { width: String(values.width), height: String(values.height), agent: values.agent };
  await h.js(
    `(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; for (const [name, value] of Object.entries(${JSON.stringify(typed)})) { const e = document.querySelector(${JSON.stringify(CUSTOM_FIELDS)} + ' input[name="' + name + '"]'); set.call(e, value); e.dispatchEvent(new Event("input", { bubbles: true })); } })()`,
  );
}

/** Custom's Use pressed, the list folding. */
export async function takePaneCustom(h: DeviceHands): Promise<void> {
  await h.pressSelector(`${CUSTOM_FIELDS} [data-act="use"]`);
  await h.until("Custom used", 5000, folded);
}
