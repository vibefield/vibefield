// THE PHONE'S LIVE SCREEN (src/live.ts and its local): a FAKE host lending `LIVE` and counting its doors, a FAKE source whose
// faces a test fills — and ICE's own sight. A bound phone's face opens by its durable key, taken once at the open; a runtime
// entity and a desk with no `LIVE` open none. An arrival wakes; the tick takes — a frame in the same texture REDRAWS, a new
// texture or new words REMAKE the phone — and answers false (a morph aside). The demand is the law's over the sight,
// change-only: at rest its rung and rate, held native at 60, unseen paused. Nothing is ever sent (view-only). A face's words'
// texture is charged to the desk's budget under the kind's name and goes with its phone.
import type { Entity } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { createSimulatorLocal, noticeBudgetKey, SIMULATOR_KIND } from "../src";
import { fakeHost, fakeWords } from "./fakes";

const SPEC = {
  source: "ios-simulator",
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
  label: "iPhone 17 Pro",
  scheme: "light",
} as const;
const NATIVE = [1206, 2622] as const;
const KEY = "13918995204487956201-1";
const e1 = 1 as Entity;

describe("the phone's live screen — its faces", () => {
  it("opens a face per bound phone by its DURABLE key, taken once at the open; none for a runtime entity or with no LIVE", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const face = local.face(e1, SPEC, NATIVE);
    expect(t.opened).toEqual([{ key: KEY, spec: { ...SPEC } }]);
    expect(face).toBe(t.faces.get(KEY));
    // asked again with the same device: the same face, no second open
    expect(local.face(e1, SPEC, NATIVE)).toBe(face);
    expect(t.opened).toHaveLength(1);
    // a runtime entity (a tray's specimen): no durable key, no face
    expect(local.face(2 as Entity, SPEC, NATIVE)).toBeUndefined();
    // a desk with no LIVE lent: none
    expect(
      createSimulatorLocal(fakeHost({ live: false }).host).face(e1, SPEC, NATIVE),
    ).toBeUndefined();
    // what the host already holds (a stream re-attached) lands in the frame that opens it: TAKEN at the open, nothing told
    const held = fakeHost({ holds: true });
    const heldLocal = createSimulatorLocal(held.host);
    heldLocal.face(e1, SPEC, NATIVE);
    expect(heldLocal.texture(e1)?.width).toBe(603);
    expect(held.faces.get(KEY)?.take()).toBe(false);
    expect(held.n.wake).toBe(0);
  });

  it("an arrival wakes; the tick takes it — the same texture REDRAWS, a new one or new words REMAKE — and answers false", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    local.face(e1, SPEC, NATIVE);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    face.land();
    expect(t.n.wake).toBe(1);
    // the first frame: a new texture — the phone remade
    expect(local.tick?.(16)).toBe(false);
    expect(t.n.remake).toEqual([e1]);
    // a frame in the same texture: drawn again, nothing remade
    face.land();
    expect(local.tick?.(32)).toBe(false);
    expect(t.n.redraw).toBe(1);
    expect(t.n.remake).toEqual([e1]);
    // a resize (a new epoch): remade
    face.land({ epoch: 1, width: 302, height: 656 });
    local.tick?.(48);
    expect(t.n.remake).toEqual([e1, e1]);
    // new words (the face's honest state): remade
    face.is({ is: "at-rest" });
    local.tick?.(64);
    expect(t.n.remake).toEqual([e1, e1, e1]);
    expect(local.faces()).toMatchObject({ opened: 1, landed: 4, redraws: 1, remakes: 3 });
  });

  it("an ACT that appears or goes — the host's word that it can run one, a failure's retry — is new words: the phone remade, never only redrawn", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    local.face(e1, SPEC, NATIVE);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    face.land();
    face.is({ is: "off" });
    local.tick?.(16);
    const remakes = () => t.n.remake.length;
    const before = remakes();
    // the host can boot it now: its capsule is drawn — remade (a function says nothing in JSON: its presence must)
    face.is({ is: "off", act: () => {} });
    local.tick?.(32);
    expect(remakes()).toBe(before + 1);
    // the same act said again (another closure, the same word): nothing new to draw — a redraw
    face.is({ is: "off", act: () => {} });
    local.tick?.(48);
    expect(remakes()).toBe(before + 1);
    // the act goes (the host is making the device): its capsule goes — remade
    face.is({ is: "off" });
    local.tick?.(64);
    expect(remakes()).toBe(before + 2);
    // a failure with no way to try again, then the same failure with one: remade at the retry's arrival too
    face.say({ state: { is: "failed", reason: "stopped" }, info: {} });
    local.tick?.(80);
    expect(remakes()).toBe(before + 3);
    face.say({ state: { is: "failed", reason: "stopped", retry: () => {} } });
    local.tick?.(96);
    expect(remakes()).toBe(before + 4);
  });

  it("asks the law's demand over the SIGHT, change-only: at rest its rung and rate, held native at 60, unseen paused", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    local.face(e1, SPEC, NATIVE);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    // at zoom 1 on a 2× screen, a 17 Pro's display is ~350 device px: the first halving, at 30
    t.draw(local, e1, 1);
    local.tick?.(16);
    expect(face.demands.at(-1)).toEqual({
      mode: "live",
      fps: 30,
      raster: [603, 1311],
      interactive: false,
    });
    // the same again: nothing sent (change-only)
    t.draw(local, e1, 1);
    local.tick?.(32);
    expect(face.demands).toHaveLength(1);
    // far away, small: the third halving, at 12
    t.draw(local, e1, 0.3);
    local.tick?.(48);
    expect(face.demands.at(-1)).toEqual({
      mode: "live",
      fps: 12,
      raster: [151, 328],
      interactive: false,
    });
    // in hand: native, at 60, interactive
    t.draw(local, e1, 1, "hand");
    local.tick?.(64);
    expect(face.demands.at(-1)).toEqual({
      mode: "live",
      fps: 60,
      raster: [1206, 2622],
      interactive: true,
    });
    // a frame that did not draw it: paused, the last frame held
    t.skip();
    local.tick?.(80);
    expect(face.demands.at(-1)).toEqual({
      mode: "paused",
      fps: 0,
      raster: [0, 0],
      interactive: false,
    });
    // due at once while a drawn frame is owed its step, never else
    t.skip();
    expect(local.due?.(96)).toBe(96);
    local.tick?.(96);
    expect(local.due?.(112)).toBe(Number.POSITIVE_INFINITY);
  });

  it("sends a face NOTHING — view-only: a simulator's face has no input lane, and the phone asks for none", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const face = local.face(e1, SPEC, NATIVE);
    expect(face?.input).toBeUndefined();
    // the hand's pointer over the screen reaches nothing: no act offered, no act run
    local.held?.(e1, [
      {
        type: "pointer",
        phase: "down",
        x: 0,
        y: 0,
        part: "content",
        button: 0,
        buttons: 1,
        count: 1,
      },
      {
        type: "pointer",
        phase: "up",
        x: 0,
        y: 0,
        part: "content",
        button: 0,
        buttons: 0,
        count: 1,
      },
      { type: "wheel", x: 0, y: 0, dx: 0, dy: 40 },
    ]);
    expect(local.acts).toBe(0);
  });

  it("charges a face's words' texture to the desk's budget under the kind's name, lets it go at the eviction, and with its phone", () => {
    const words = fakeWords();
    const t = fakeHost({ words: words.raster, pass: true });
    const local = createSimulatorLocal(t.host);
    local.face(e1, SPEC, NATIVE);
    // the pass lays the words and says their bytes; the local charges them
    expect(
      local.notice(
        e1,
        [402, 874],
        { line: "iPhone 17 Pro is off", act: "Boot" },
        "rgb(230 232 234)",
      ),
    ).toBeDefined();
    t.pass.noticed?.(1, 4096);
    expect(t.said).toContain(`charge ${SIMULATOR_KIND} ${noticeBudgetKey(KEY)} 4096`);
    // the same words again: the same raster, nothing drawn twice
    local.notice(e1, [402, 874], { line: "iPhone 17 Pro is off", act: "Boot" }, "rgb(230 232 234)");
    expect(local.notices).toBe(1);
    // kept while the phone is seen or held — and the ledger's eviction lets the texture go through the pass
    t.draw(local, e1, 1);
    local.tick?.(16);
    expect(local.keeps?.(noticeBudgetKey(KEY))).toBe(true);
    t.evict(`${SIMULATOR_KIND} ${noticeBudgetKey(KEY)}`);
    expect(t.pass.unnoticed).toEqual([1]);
    // charged again when laid again, and released WITH ITS PHONE
    t.pass.noticed?.(1, 4096);
    local.forget?.(e1);
    expect(t.said.at(-1)).toBe(`release ${SIMULATOR_KIND} ${noticeBudgetKey(KEY)}`);
    expect(t.pass.forgot).toEqual([1]);
  });

  it("charges nothing for the face's own texture — the host's to keep and let go (the cap it shares with panes is the host's too)", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    local.face(e1, SPEC, NATIVE);
    t.faces.get(KEY)?.land();
    local.tick?.(16);
    expect(t.said.filter((s) => s.startsWith("charge"))).toEqual([]);
  });
});
