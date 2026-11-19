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

/** Select a device using the same configuration UI a person opens from the object menu. */
export async function choosePaneDevice(
  h: Pick<PaneHands, "js" | "until" | "pressSelector">,
  device: string,
): Promise<void> {
  await h.pressSelector('[data-selection-bar] [data-act="act:device"]');
  await h.until(
    "device emulation settings",
    5000,
    `document.querySelector('.vf-browser-device')?.open===true`,
  );
  await h.js(
    `(()=>{const e=document.querySelector('.vf-browser-device [name="preset"]');e.value=${JSON.stringify(device)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await h.pressSelector('.vf-browser-device button[type="submit"]');
  await h.until(
    "device settings applied",
    5000,
    `document.querySelector('.vf-browser-device')?.open===false`,
  );
}
