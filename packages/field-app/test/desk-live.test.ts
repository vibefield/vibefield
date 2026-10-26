// PT-2 — THE DESK'S LIVE SERVICE (surfaces/live/desk-live.ts): ICE's `LIVE` contract over the window's LSF pool, with a FAKE pool,
// presentation and writer (desk-live-fixture.ts) — an arrival is one `arrived()`; `take()` presents the newest frame once into ICE's
// writer on the desk's device (labelled `<kind>/live <key>`, from the frame's `visibleRect`) and releases its lease; an UNSEEN face's
// frame is taken and closed, no redraw; the demand map; the state and the words; close; a remount's service makes its writers on its
// own device; the capability gate's refusal is a failed face with the words; the mint names the page and the durable key.
// PT-4 — the page as a device sees it: the spec's device and scheme are the source's emulation at the mint and an `emulate` told
// down the lane as it goes live and whenever the spec moves (`respec` — the viewport's demand first); the desk's pages share ONE
// persistent profile; the favicon rides the face's words (`extra.favicon`); a page is called by its title, else its spec's label.
// (PT-5b's stills and its cap: desk-live-stills.test.ts, desk-live-cap.test.ts.)
import { liveBrowserFailure } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  DESK_PROFILE,
  emulationOf,
  fpsBucket,
  type LiveFavicon,
  liveDemandIntent,
  liveInputEvents,
} from "../src/surfaces/live/desk-live";
import {
  attached,
  browserAt,
  documentOf,
  fakePresentation,
  LAPTOP_TOLD,
  PAGE,
  PHONE_PAGE,
  PHONE_TOLD,
  SEEN,
  setup,
  UNSEEN,
} from "./desk-live-fixture";

describe("the desk's LIVE service — a face over the window's pool", () => {
  it("opens the page's pool key apart from any panel's, paused at the page's viewport until the kind's law has seen it", () => {
    const t = setup();
    t.live.open("13918995204487956201-1", PAGE, () => {});
    expect(t.handles[0]?.key).toBe("desk:13918995204487956201-1");
    expect(t.handles[0]?.opts.initialDemand).toEqual({
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      logicalViewport: { width: 1280, height: 800 },
    });
  });

  it("mints the page on the WINDOW's client: a browser source in the desk's ONE persistent profile, born on its device, the durable key as reuseKey", async () => {
    const t = setup();
    t.live.open("13918995204487956201-1", PAGE, () => {});
    const grant = await t.handles[0]?.opts.tickets.mint();
    expect(grant?.surfaceId).toBe("surface_0123456789abcdef");
    expect(t.requests).toEqual([
      {
        method: "surface.open",
        params: {
          source: {
            kind: "browser",
            initialUrl: "http://127.0.0.1:4321/",
            // PT-5a: a desk page that stops is SAID to have stopped — never restarted behind the person
            whenStopped: "say",
            profile: { mode: "persistent", ref: "desk" },
            logicalViewport: { width: 1280, height: 800 },
            deviceScaleFactor: 2,
            emulation: {
              deviceScaleFactor: 2,
              mobile: false,
              touchPoints: 0,
              colorScheme: "light",
            },
          },
          reuseKey: "13918995204487956201-1",
        },
      },
    ]);
    await t.handles[0]?.opts.tickets.close?.("surface_0123456789abcdef");
    expect(t.requests[1]).toEqual({
      method: "surface.close",
      params: { surfaceId: "surface_0123456789abcdef" },
    });
  });

  it("an ARRIVAL is one arrived(): a frame landing, the state or the page's words moving — never at the open itself", () => {
    const { face, handle, presentation, arrived } = attached();
    // the attach moved the state: one word
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(face.take()).toBe(true); // the words moved
    presentation.land();
    expect(arrived).toHaveBeenCalledTimes(2);
    handle.set({
      browser: {
        url: "http://127.0.0.1:4321/",
        title: "Fixture",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    expect(arrived).toHaveBeenCalledTimes(3);
    // a publish that says nothing new is not an arrival
    handle.set({});
    expect(arrived).toHaveBeenCalledTimes(3);
  });

  it("TAKE presents the newest frame ONCE into ICE's writer on the desk's device — from the frame's visibleRect, at its logical size, its lease released", () => {
    const { face, presentation, writers, device } = attached();
    face.take();
    face.demand(SEEN);
    const older = presentation.land();
    const newest = presentation.land();
    expect(face.take()).toBe(true);
    expect(writers).toHaveLength(1);
    expect(writers[0]?.device).toBe(device);
    expect(writers[0]?.o).toEqual({
      label: "vibefield.browser-pane/live 13918995204487956201-1",
      width: 2560,
      height: 1600,
    });
    // its visible rect, and its LOGICAL size — the page's CSS viewport (ICE's `LiveTexture.logical`, what PT-3's hand maps into)
    expect(writers[0]?.presented).toEqual([
      { frame: newest, rect: { x: 4, y: 2, width: 2560, height: 1600 }, logical: [1280, 800] },
    ]);
    // the older one was closed on arrival of the newer, the newest after its copy: no lease outlives a take
    expect(older.close).toHaveBeenCalled();
    expect(newest.close).toHaveBeenCalledTimes(1);
    expect(face.texture()?.width).toBe(2560);
    // nothing new: nothing taken, no redraw
    expect(face.take()).toBe(false);
  });

  it("a frame whose logical size the writer would refuse is presented WITHOUT one — the texels then stand for it", () => {
    const { face, handle, writers } = attached();
    const odd = fakePresentation("live", { width: 0, height: 800 });
    handle.set({ presentation: odd as never });
    face.take();
    face.demand(SEEN);
    odd.land();
    expect(face.take()).toBe(true);
    expect(writers[0]?.presented).toEqual([
      {
        frame: expect.anything(),
        rect: { x: 4, y: 2, width: 2560, height: 1600 },
        logical: undefined,
      },
    ]);
  });

  it("an UNSEEN face's frame is taken and closed, drawn nowhere, no redraw (ruling 6) — and so is one before the desk's device", () => {
    const { face, presentation, writers, live } = attached();
    face.take();
    face.demand(UNSEEN);
    const frame = presentation.land();
    expect(face.take()).toBe(false);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(writers).toHaveLength(0);
    expect(live.stats().dropped).toBe(1);

    const t = attached({ device: () => undefined });
    t.face.take();
    t.face.demand(SEEN);
    const early = t.presentation.land();
    expect(t.face.take()).toBe(false);
    expect(early.close).toHaveBeenCalledTimes(1);
    expect(t.writers).toHaveLength(0);
  });

  it("the face's STATE reads the pool's handle and the producer's summary; its WORDS the producer's navigation truth", () => {
    const t = setup();
    const face = t.live.open("k-1", PAGE, () => {});
    const handle = t.handles[0];
    if (handle === undefined) throw new Error("no handle");
    expect(face.state()).toEqual({ is: "starting" });
    handle.set({ status: "live", presentation: fakePresentation("live") as never });
    expect(face.state()).toEqual({ is: "live" });
    handle.set({ presentation: fakePresentation("paused") as never });
    expect(face.state()).toEqual({ is: "paused" });
    handle.set({ status: "lost", presentation: null, error: new Error("the window went away") });
    const lost = face.state();
    // PT-5a: said in the SDK's word (the pool's own after it), and its retry mints the page again
    expect(lost).toMatchObject({ is: "failed", reason: "lost: the window went away" });
    if (lost.is === "failed") lost.retry?.();
    expect(handle.retried).toBe(1);

    expect(face.info()).toEqual({});
    handle.set({
      status: "live",
      presentation: fakePresentation("live") as never,
      browser: {
        url: "http://127.0.0.1:4321/page",
        title: "Fixture",
        loading: true,
        canGoBack: true,
        canGoForward: false,
      },
    });
    expect(face.info()).toEqual({
      address: "http://127.0.0.1:4321/page",
      title: "Fixture",
      loading: 0.5,
      back: true,
      forward: false,
      // PT-4: the host's word on the page's favicon — it has none
      extra: { favicon: null },
    });
  });

  it("CLOSE releases the holder, destroys the writer and frees the key; a key opened twice is a host error, said", () => {
    const { face, handle, presentation, writers, live } = attached();
    expect(() => live.open("13918995204487956201-1", PAGE, () => {})).toThrow(/open twice/);
    face.demand(SEEN);
    presentation.land();
    face.take();
    face.close();
    face.close();
    expect(handle.released).toBe(1);
    expect(writers[0]?.destroyed).toBe(1);
    expect(presentation.listeners()).toBe(0);
    expect(face.state()).toEqual({ is: "closed" });
    expect(face.take()).toBe(false);
    expect(live.stats().open).toBe(0);
    // the key is free again
    live.open("13918995204487956201-1", PAGE, () => {});
    expect(live.stats().open).toBe(1);
  });

  it("a REMOUNT's service makes its writers on ITS device — the pool's page is the same key", () => {
    const first = attached();
    first.face.demand(SEEN);
    first.presentation.land();
    first.face.take();
    first.live.dispose();
    expect(first.handles[0]?.released).toBe(1);
    const other = { id: "remounted-device" } as unknown as GPUDevice;
    const second = attached({ device: () => other });
    second.face.demand(SEEN);
    second.presentation.land();
    second.face.take();
    expect(second.handles[0]?.key).toBe(first.handles[0]?.key);
    expect(second.writers[0]?.device).toBe(other);
  });

  it("a face's ROW is what a smoke reads: the kind's ask, LSF's wire demand for its page, its words, its arrivals, presents and drops, its texture; the stats count the writers made; PT-6a (M14 — R3): and the SURFACE its page is (the pool's attachment), by which main's census counts its own frame sessions", () => {
    const { face, handle, presentation, live } = attached();
    face.take();
    expect(live.faces()).toEqual([
      {
        key: "13918995204487956201-1",
        demand: undefined,
        wire: null,
        surface: null,
        state: { is: "live" },
        info: {},
        favicon: null,
        label: "Browser",
        emulation: LAPTOP_TOLD,
        arrivals: 0,
        presented: 0,
        dropped: 0,
        inputs: 0,
        lastInput: null,
        texture: undefined,
        veiled: false,
        refused: 0,
        current: false,
        faviconBytes: 0,
        alive: true,
        rested: false,
        still: null,
        stillAt: null,
      },
    ]);
    face.demand(UNSEEN);
    presentation.land();
    face.take();
    face.demand(SEEN);
    handle.wire = { revision: 2, mode: "live", targetFps: 30 };
    handle.surfaceId = "surface_0123456789abcdef";
    handle.set({
      browser: {
        url: "http://127.0.0.1:4321/",
        title: "Fixture",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    presentation.land();
    presentation.land();
    face.take();
    expect(live.faces()).toEqual([
      {
        key: "13918995204487956201-1",
        demand: SEEN,
        wire: { revision: 2, mode: "live", targetFps: 30 },
        surface: "surface_0123456789abcdef",
        state: { is: "live" },
        info: { address: "http://127.0.0.1:4321/", title: "Fixture", back: false, forward: false },
        favicon: null,
        label: "Fixture",
        emulation: LAPTOP_TOLD,
        arrivals: 3,
        presented: 1,
        dropped: 1,
        inputs: 0,
        lastInput: null,
        texture: { width: 2560, height: 1600, revision: 1, epoch: 0, bytes: 0 },
        veiled: false,
        refused: 0,
        current: true,
        faviconBytes: 0,
        alive: true,
        rested: false,
        still: null,
        stillAt: null,
      },
    ]);
    expect(live.stats()).toMatchObject({ presented: 1, dropped: 1, writers: 1 });
    // a refused face is a row too: its state says why, and it counts nothing
    const refused = setup({ gate: () => ({ refused: "no object on this board holds this face" }) });
    refused.live.open("k-2", PAGE, () => {});
    expect(refused.live.faces()).toEqual([
      {
        key: "k-2",
        demand: undefined,
        wire: null,
        surface: null,
        state: { is: "failed", reason: "may-not: no object on this board holds this face" },
        info: {},
        favicon: null,
        label: "",
        emulation: null,
        arrivals: 0,
        presented: 0,
        dropped: 0,
        inputs: 0,
        lastInput: null,
        texture: undefined,
        veiled: false,
        refused: 0,
        current: false,
        faviconBytes: 0,
        alive: false,
        rested: false,
        still: null,
        stillAt: null,
      },
    ]);
  });

  it("the GATE's refusal is a failed face with the words — no page, no pool, nothing taken", () => {
    const t = setup({
      gate: () => ({
        refused: "FORBIDDEN_SCOPE: plugin acme.tools is not granted surface.browser",
      }),
    });
    const face = t.live.open("k-1", PAGE, () => {});
    expect(t.handles).toHaveLength(0);
    // PT-5a: the desk MAY NOT — the SDK's word, the gate's own after it, and nothing to try again
    expect(face.state()).toEqual({
      is: "failed",
      reason: "may-not: FORBIDDEN_SCOPE: plugin acme.tools is not granted surface.browser",
    });
    expect(liveBrowserFailure((face.state() as { reason: string }).reason)).toBe("may-not");
    expect(face.take()).toBe(false);
    expect(face.texture()).toBeUndefined();
    face.close();
    expect(t.live.stats()).toMatchObject({ refused: 1, open: 0 });
  });

  it("refuses a spec it cannot read, and a window with no live surfaces — each a failed face, said", () => {
    const unread = setup().live.open("k-1", { ...PAGE, viewport: "wide" }, () => {});
    expect(unread.state()).toEqual({
      is: "failed",
      reason: "may-not: not a page this desk can open",
    });
    const none = setup({ pool: () => null }).live.open("k-1", PAGE, () => {});
    expect(none.state()).toEqual({
      is: "failed",
      reason: "may-not: live pages are unavailable in this window",
    });
  });
});

describe("the demand map — the kind's LiveDemand in the pool's words (ruling 5)", () => {
  it("fps to the nearest LSF bucket not above — a live ask never under 2; paused is 0", () => {
    expect([60, 45, 30, 29, 15, 12, 10, 5, 3, 2, 1, 0].map((f) => fpsBucket(f, true))).toEqual([
      60, 30, 30, 15, 15, 10, 10, 5, 2, 2, 2, 2,
    ]);
    expect(fpsBucket(30, false)).toBe(0);
  });

  it("at rest: live at the bucket, the raster and the logical viewport, priority 50", () => {
    expect(liveDemandIntent(SEEN)).toEqual({
      mode: "live",
      targetFps: 30,
      targetRasterSize: { width: 1280, height: 800 },
      logicalViewport: { width: 1280, height: 800 },
      priority: 50,
      interactive: false,
    });
  });

  it("held: interactive at priority 80; unseen: paused at 0 fps, its layout kept", () => {
    expect(
      liveDemandIntent({ ...SEEN, fps: 60, raster: [2560, 1600], interactive: true }),
    ).toMatchObject({
      mode: "live",
      targetFps: 60,
      targetRasterSize: { width: 2560, height: 1600 },
      priority: 80,
      interactive: true,
    });
    expect(liveDemandIntent(UNSEEN)).toEqual({
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      logicalViewport: { width: 1280, height: 800 },
    });
  });

  it("a demand reaches the pool's handle as the map says, each one sent", () => {
    const { face, handle } = attached();
    face.demand(SEEN);
    face.demand(UNSEEN);
    expect(handle.demands).toEqual([liveDemandIntent(SEEN), liveDemandIntent(UNSEEN)]);
  });
});

describe("PT-3 — the face in use: its input, the page's cursor, a page navigated by its key", () => {
  it("input reaches the page's lane in the DISPLAYED frame's logical px, stamped with that frame's revision — nothing before a frame", () => {
    const { live, face, presentation, handle } = attached();
    // nothing displayed yet: nothing to map against, nothing sent
    face.input?.({ kind: "pointer", x: 10, y: 10, button: 0, buttons: 1, count: 1, phase: "down" });
    expect(handle.inputs).toEqual([]);
    expect(live.stats().inputsUnsent).toBe(1);
    face.demand(SEEN);
    presentation.land();
    expect(face.take()).toBe(true);
    // a press, its drag and its release — the frame's revision (1) on each, the point held inside its logical size
    face.input?.({
      kind: "pointer",
      x: 640,
      y: 400,
      button: 0,
      buttons: 1,
      count: 2,
      phase: "down",
    });
    face.input?.({
      kind: "pointer",
      x: 1500,
      y: -20,
      button: -1,
      buttons: 1,
      count: 0,
      phase: "move",
    });
    face.input?.({ kind: "pointer", x: 700, y: 410, button: 0, buttons: 0, count: 2, phase: "up" });
    face.input?.({ kind: "wheel", x: 10, y: 20, dx: 0, dy: 120 });
    face.input?.({ kind: "key", key: "a", code: "KeyA", phase: "down", mods: 1 | 4, repeat: true });
    face.input?.({ kind: "compose", text: "にほ", caret: 2 });
    face.input?.({ kind: "text", text: "にほん" });
    expect(handle.inputs).toEqual([
      {
        event: {
          kind: "pointer",
          action: "down",
          x: 640,
          y: 400,
          button: "left",
          clickCount: 2,
          buttons: 1,
        },
        revision: 1,
      },
      { event: { kind: "pointer", action: "move", x: 1280, y: 0, buttons: 1 }, revision: 1 },
      {
        event: { kind: "pointer", action: "up", x: 700, y: 410, button: "left", clickCount: 2 },
        revision: 1,
      },
      { event: { kind: "wheel", x: 10, y: 20, deltaX: 0, deltaY: 120 }, revision: 1 },
      {
        event: {
          kind: "key",
          action: "down",
          key: "a",
          code: "KeyA",
          modifiers: { alt: true, ctrl: false, meta: true, shift: false },
          autoRepeat: true,
        },
        revision: 1,
      },
      { event: { kind: "compose", text: "にほ", caret: 2 }, revision: 1 },
      { event: { kind: "text", text: "にほん" }, revision: 1 },
    ]);
    expect(live.stats().inputs).toBe(7);
    const row = live.faces()[0];
    expect(row?.inputs).toBe(7);
    expect(row?.lastInput).toBe("text");
    // the lane gone (a close lost the race): the face counts what it could not send
    handle.lane = false;
    face.input?.({ kind: "text", text: "x" });
    expect(live.stats().inputsUnsent).toBe(2);
  });

  it("PT-5c2 (F7): nothing is sent through a frame of a document the page has LEFT — after a commit and before the new document's first frame the face shows the one before, and an event aimed at it lands on the new document (PT-5c2's probe): unsent, counted; its first frame, and the hand goes again", () => {
    const NEXT = "http://127.0.0.1:4321/next";
    const { live, face, presentation, handle } = attached();
    handle.set({ browser: browserAt(PAGE.url) as never });
    face.demand(SEEN);
    presentation.land(documentOf(PAGE.url));
    expect(face.take()).toBe(true);
    const press = (): void =>
      face.input?.({
        kind: "pointer",
        x: 640,
        y: 400,
        button: 0,
        buttons: 1,
        count: 1,
        phase: "down",
      });
    expect(live.faces()[0]?.current).toBe(true);
    press();
    expect(handle.inputs).toHaveLength(1);
    // another document commits (the page followed its link): no frame of it yet — the face shows the one before
    handle.set({ browser: browserAt(NEXT) as never });
    const unsent = live.stats().inputsUnsent;
    press();
    face.input?.({ kind: "key", key: "a", code: "KeyA", phase: "down", mods: 0, repeat: false });
    expect(handle.inputs).toHaveLength(1);
    expect(live.stats().inputsUnsent).toBe(unsent + 2);
    // (the face's row says so: not current — what a smoke that presses after a navigation waits on)
    expect(live.faces()[0]?.current).toBe(false);
    // its first frame: the face shows the page as it stands — the hand goes again
    presentation.land(documentOf(NEXT));
    expect(face.take()).toBe(true);
    expect(live.faces()[0]?.current).toBe(true);
    press();
    expect(handle.inputs).toHaveLength(2);
  });

  it("PT-5d (G1): a RELEASE is never held back by the commit gate — a key and a button pressed while the face is current, another document commits (no frame of it yet): a move and another key's down stay unsent, and the two UPS ARE SENT (main lets up only what it holds down: a press it heard after the commit went to the new document)", () => {
    const NEXT = "http://127.0.0.1:4321/next";
    const { live, face, presentation, handle } = attached();
    handle.set({ browser: browserAt(PAGE.url) as never });
    face.demand(SEEN);
    presentation.land(documentOf(PAGE.url));
    expect(face.take()).toBe(true);
    const key = (code: string, phase: "down" | "up"): void =>
      face.input?.({
        kind: "key",
        key: code.slice(-1).toLowerCase(),
        code,
        phase,
        mods: 0,
        repeat: false,
      });
    const pointer = (phase: "down" | "move" | "up"): void =>
      face.input?.({
        kind: "pointer",
        x: 640,
        y: 400,
        button: phase === "move" ? -1 : 0,
        buttons: phase === "up" ? 0 : 1,
        count: phase === "move" ? 0 : 1,
        phase,
      });
    key("KeyQ", "down");
    pointer("down");
    expect(handle.inputs).toHaveLength(2);
    // another document commits (a redirect, a script's navigation): the face shows the one before
    handle.set({ browser: browserAt(NEXT) as never });
    const unsent = live.stats().inputsUnsent;
    pointer("move");
    key("KeyW", "down");
    expect(handle.inputs).toHaveLength(2);
    expect(live.stats().inputsUnsent).toBe(unsent + 2);
    // the releases go — through the frame shown, stamped with its revision
    key("KeyQ", "up");
    pointer("up");
    expect(handle.inputs.slice(2)).toEqual([
      {
        event: {
          kind: "key",
          action: "up",
          key: "q",
          code: "KeyQ",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        },
        revision: 1,
      },
      {
        event: { kind: "pointer", action: "up", x: 640, y: 400, button: "left", clickCount: 1 },
        revision: 1,
      },
    ]);
    expect(live.stats().inputsUnsent).toBe(unsent + 2);
  });

  it("maps what the wire can carry, and says what it cannot as the wire can say it", () => {
    const L = [1280, 800] as const;
    // the secondary button by DOM's number; a click count past the wire's three held to three
    expect(
      liveInputEvents(
        { kind: "pointer", x: 1, y: 2, button: 2, buttons: 2, count: 5, phase: "down" },
        L,
      ),
    ).toEqual([
      { kind: "pointer", action: "down", x: 1, y: 2, button: "right", clickCount: 3, buttons: 2 },
    ]);
    // a key name past the wire's bound is not sent; an IME's caret held inside its text; a long text sent in pieces
    expect(
      liveInputEvents(
        { kind: "key", key: "x".repeat(33), code: "KeyX", phase: "down", mods: 0, repeat: false },
        L,
      ),
    ).toEqual([]);
    expect(liveInputEvents({ kind: "compose", text: "ab", caret: 9 }, L)).toEqual([
      { kind: "compose", text: "ab", caret: 2 },
    ]);
    const long = liveInputEvents({ kind: "text", text: "y".repeat(16_385) }, L);
    expect(long.map((e) => (e.kind === "text" ? e.text.length : -1))).toEqual([16_384, 1]);
    expect(liveInputEvents({ kind: "text", text: "" }, L)).toEqual([]);
    // a wheel's deltas held inside the wire's bound
    expect(liveInputEvents({ kind: "wheel", x: 0, y: 0, dx: -1e9, dy: 1e9 }, L)).toEqual([
      { kind: "wheel", x: 0, y: 0, deltaX: -100_000, deltaY: 100_000 },
    ]);
  });

  it("the page's CURSOR is the face's word, and a cursor that moves is an arrival (LT2's question 8)", () => {
    const { face, handle, arrived } = attached();
    const browser = {
      url: "http://127.0.0.1:4321/",
      title: "Fixture",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    handle.set({ browser: browser as never });
    expect(face.info().cursor).toBeUndefined();
    const before = arrived.mock.calls.length;
    handle.set({ browser: { ...browser, cursor: "pointer" } as never });
    expect(face.info().cursor).toBe("pointer");
    expect(arrived.mock.calls.length).toBe(before + 1);
    // the same words again: no arrival
    handle.set({ browser: { ...browser, cursor: "pointer" } as never });
    expect(arrived.mock.calls.length).toBe(before + 1);
    handle.set({ browser: { ...browser, cursor: "text" } as never });
    expect(face.info().cursor).toBe("text");
    expect(arrived.mock.calls.length).toBe(before + 2);
  });

  it("a page is NAVIGATED by its face's key through the second service — never a key with no page open, nor a refused one", () => {
    const { live, handle, face } = attached();
    expect(live.navigation.navigate("13918995204487956201-1", { action: "back" })).toBe(true);
    expect(
      live.navigation.navigate("13918995204487956201-1", {
        action: "go",
        url: "http://127.0.0.1:4321/next",
      }),
    ).toBe(true);
    expect(handle.navigations).toEqual([
      { action: "back" },
      { action: "go", url: "http://127.0.0.1:4321/next" },
    ]);
    // a key no face holds: refused, counted
    expect(live.navigation.navigate("no-such-key", { action: "reload" })).toBe(false);
    // a face the gate refused holds no page: refused too
    const refusing = setup({
      gate: () => ({ refused: "plugin x is not granted surface.browser" }),
    });
    refusing.live.open("k2", PAGE, () => {});
    expect(refusing.live.navigation.navigate("k2", { action: "reload" })).toBe(false);
    // closed: its page is no longer the face's to navigate
    face.close();
    expect(live.navigation.navigate("13918995204487956201-1", { action: "reload" })).toBe(false);
    expect(live.stats()).toMatchObject({ navigations: 2, navigationsRefused: 2 });
  });
});

describe("PT-4 — the page as a device sees it", () => {
  const KEY = "13918995204487956201-1";
  const BROWSER = {
    url: "http://127.0.0.1:4321/",
    title: "Fixture",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };

  it("the spec's device and scheme are the page's EMULATION: its density, mobile, its fingers, its agent with its hints — the engine's own when it names none — and the scheme", () => {
    expect(emulationOf(PAGE as never)).toEqual(LAPTOP_TOLD);
    expect(emulationOf(PHONE_PAGE as never)).toEqual(PHONE_TOLD);
    // a device with no agent of its own: none named — the producer's engine says its own
    expect(
      emulationOf({ ...PAGE, device: { mobile: false, touchPoints: 0, agent: null } } as never),
    ).toEqual(LAPTOP_TOLD);
    expect(emulationOf({ ...PAGE, scheme: "dark" } as never).colorScheme).toBe("dark");
    expect(DESK_PROFILE).toBe("desk");
  });

  it("a page is minted ON its device in the desk's one profile — two faces, one profile — and a mint after a loss is made of the spec as it stands", async () => {
    const t = setup();
    t.live.open(KEY, PHONE_PAGE, () => {});
    t.live.open("k-2", PAGE, () => {});
    await t.handles[0]?.opts.tickets.mint();
    await t.handles[1]?.opts.tickets.mint();
    const sources = t.requests.map((r) => (r.params as { source: Record<string, unknown> }).source);
    expect(sources[0]).toMatchObject({
      profile: { mode: "persistent", ref: "desk" },
      logicalViewport: { width: 402, height: 874 },
      deviceScaleFactor: 3,
      emulation: PHONE_TOLD,
    });
    expect(sources[1]?.profile).toEqual(sources[0]?.profile);
    // the spec moved under the page; the lane is lost and minted again: the page is made on the device it has NOW
    t.handles[0]?.set({ status: "live", presentation: fakePresentation() as never });
    expect(t.live.navigation.respec(KEY, PAGE)).toBe(true);
    await t.handles[0]?.opts.tickets.mint();
    expect(t.requests.at(-1)?.params).toMatchObject({
      source: { logicalViewport: { width: 1280, height: 800 }, emulation: LAPTOP_TOLD },
    });
  });

  it("a lane gone LIVE is told the spec's device once — owed until then, never again while the spec stands", () => {
    const t = setup();
    t.live.open(KEY, PHONE_PAGE, () => {});
    const handle = t.handles[0];
    if (handle === undefined) throw new Error("no handle");
    // attaching: the lane takes nothing yet
    expect(handle.emulations).toEqual([]);
    handle.set({ status: "live", presentation: fakePresentation() as never });
    expect(handle.emulations).toEqual([PHONE_TOLD]);
    // its state and its words move: the device is not told again
    handle.set({ browser: BROWSER as never });
    handle.set({ browser: { ...BROWSER, cursor: "pointer" } as never });
    expect(handle.emulations).toHaveLength(1);
    expect(t.live.stats()).toMatchObject({ emulations: 1, respecs: 0 });
    // lost and live again: not told again — a mint after a loss is made of the spec as it stands
    handle.set({ status: "lost" });
    handle.set({ status: "live" });
    expect(handle.emulations).toHaveLength(1);
  });

  it("a RESPEC under the open page lays it out at the spec's viewport FIRST, then tells it its device — the same spec again tells nothing; a spec it cannot read, or a key with no page, is refused", () => {
    const { live, handle, face } = attached();
    face.demand(SEEN);
    handle.order.length = 0;
    expect(live.navigation.respec(KEY, PHONE_PAGE)).toBe(true);
    // the demand ahead of the emulation, down the one port: the kind's ask kept, at the phone's viewport
    expect(handle.order).toEqual(["demand", "emulate"]);
    expect(handle.demands.at(-1)).toMatchObject({
      mode: "live",
      logicalViewport: { width: 402, height: 874 },
    });
    expect(handle.emulations.at(-1)).toEqual(PHONE_TOLD);
    expect(live.faces()[0]).toMatchObject({
      emulation: PHONE_TOLD,
      demand: { viewport: [402, 874] },
    });
    // the same spec again, and one whose LABEL alone moved (the page went elsewhere): nothing down the port
    handle.order.length = 0;
    expect(live.navigation.respec(KEY, PHONE_PAGE)).toBe(true);
    expect(live.navigation.respec(KEY, { ...PHONE_PAGE, label: "elsewhere" })).toBe(true);
    expect(handle.order).toEqual([]);
    expect(handle.emulations).toHaveLength(2);
    // the scheme alone (the desk turned light): told, and no demand with it — the viewport stands
    expect(live.navigation.respec(KEY, { ...PHONE_PAGE, scheme: "light" })).toBe(true);
    expect(handle.order).toEqual(["emulate"]);
    expect(handle.emulations.at(-1)).toEqual({ ...PHONE_TOLD, colorScheme: "light" });
    expect(live.stats()).toMatchObject({ respecs: 4, emulations: 3 });
    // never the chrome's navigations
    expect(handle.navigations).toEqual([]);
    // refused: a spec the host cannot read, a key with no page open
    expect(live.navigation.respec(KEY, { ...PHONE_PAGE, device: { mobile: true } })).toBe(false);
    expect(live.navigation.respec("no-such-key", PHONE_PAGE)).toBe(false);
    expect(handle.emulations).toHaveLength(3);
    // a face the kind's law has not seen yet: laid out paused at the new viewport, its ask still none
    const unseen = setup();
    unseen.live.open(KEY, PAGE, () => {});
    unseen.handles[0]?.set({ status: "live", presentation: fakePresentation() as never });
    expect(unseen.live.navigation.respec(KEY, PHONE_PAGE)).toBe(true);
    expect(unseen.handles[0]?.demands.at(-1)).toEqual({
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      logicalViewport: { width: 402, height: 874 },
    });
    expect(unseen.live.faces()[0]?.demand).toBeUndefined();
  });

  it("the page's FAVICON rides the face's words — its bytes under `extra.favicon`, one object a key; `null` where the page has none; nothing before the page has spoken — and a favicon that moves is an arrival", () => {
    const { face, handle, arrived, live } = attached();
    // the page has said nothing yet: the host says nothing of its favicon
    expect(face.info()).toEqual({});
    handle.set({ browser: BROWSER as never });
    expect(face.info().extra).toEqual({ favicon: null });
    const before = arrived.mock.calls.length;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const favicon = {
      key: "0123456789abcdef",
      mediaType: "image/png",
      data: btoa(String.fromCharCode(...png)),
    };
    handle.set({ browser: { ...BROWSER, favicon } as never });
    expect(arrived.mock.calls.length).toBe(before + 1);
    const said = face.info().extra?.favicon as LiveFavicon;
    expect(said).toEqual({ key: "0123456789abcdef", type: "image/png", bytes: png });
    // the same key again: the same object — decoded once
    handle.set({ browser: { ...BROWSER, favicon, cursor: "pointer" } as never });
    expect(face.info().extra?.favicon).toBe(said);
    // a row carries its key, never its bytes
    expect(live.faces()[0]).toMatchObject({ favicon: "0123456789abcdef" });
    expect(live.faces()[0]?.info).not.toHaveProperty("extra");
    // the page lost it (a new document): none
    handle.set({ browser: BROWSER as never });
    expect(face.info().extra).toEqual({ favicon: null });
    expect(live.faces()[0]?.favicon).toBeNull();
  });

  it("PT-5a (ruling 8): the face's row says how many times the favicon's BYTES arrived on its page's port (the pool's word) — and a favicon named without bytes, which the pool never lets through, is no favicon", () => {
    const { face, handle, live } = attached();
    const NAV = {
      url: "http://127.0.0.1:4321/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const icon = { key: "0123456789abcdef", mediaType: "image/png", data: btoa("\u0089PNG") };
    handle.faviconArrivals = 1;
    handle.set({ browser: { ...NAV, favicon: icon } as never });
    expect(face.info().extra?.favicon).toMatchObject({ key: icon.key });
    expect(live.faces()[0]).toMatchObject({ faviconBytes: 1, favicon: icon.key });
    // the cursor moves: the same favicon object, no new bytes
    const first = face.info().extra?.favicon;
    handle.set({ browser: { ...NAV, favicon: icon, cursor: "pointer" } as never });
    expect(face.info().extra?.favicon).toBe(first);
    expect(live.faces()[0]).toMatchObject({ faviconBytes: 1 });
    // named without bytes by another key: none
    handle.set({
      browser: { ...NAV, favicon: { key: "fedcba9876543210", mediaType: "image/png" } } as never,
    });
    expect(face.info().extra?.favicon).toBeNull();
  });

  it("a page is CALLED by its title, else by its spec's label — and nothing where no page is open for the key (ruling 5)", () => {
    const { live, handle } = attached();
    expect(live.label(KEY)).toBe("Browser");
    handle.set({ browser: BROWSER as never });
    expect(live.label(KEY)).toBe("Fixture");
    // the face's row says the same word
    expect(live.faces()[0]?.label).toBe("Fixture");
    // a page with no title — or a blank one: its spec's label, as its kind prints its address — the label a respec brings
    expect(live.navigation.respec(KEY, { ...PAGE, label: "127.0.0.1:4321" })).toBe(true);
    for (const title of [undefined, "", "   "]) {
      handle.set({ browser: { ...BROWSER, title } as never });
      expect(live.label(KEY), JSON.stringify(title)).toBe("127.0.0.1:4321");
      expect(live.faces()[0]?.label, JSON.stringify(title)).toBe("127.0.0.1:4321");
    }
    expect(live.label("no-such-key")).toBeUndefined();
  });
});

describe("PT-5a — a page's failures are said (ruling 3)", () => {
  const NAV = {
    url: "http://127.0.0.1:4321/",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  const summary = (state: string, error?: { code: string; message: string; recovery: string }) =>
    ({
      ...fakePresentation(state as never),
      summary: { state, transport: "shared-texture", ...(error === undefined ? {} : { error }) },
    }) as never;

  it("a LOAD that failed is a failed face in the SDK's word for it — whatever the producer's state, its address kept — and its retry RELOADS the page (never a new mint)", () => {
    const { face, handle } = attached();
    for (const [reason, word] of [
      ["name-not-resolved", "name-not-resolved"],
      ["offline", "offline"],
      ["connection-refused", "connection-refused"],
      ["connection-failed", "connection-failed"],
      ["timed-out", "timed-out"],
      ["certificate", "certificate"],
      ["blocked", "blocked"],
      // PT-5b2 (ruling 6): a load that ended with no document of the page — the address is no page; the person stopped it
      // (the SDK's `stopped` is a page whose process is gone: a load stopped is its own word)
      ["no-document", "no-document"],
      ["stopped", "load-stopped"],
      ["failed", "load-failed"],
    ] as const) {
      handle.set({ browser: { ...NAV, failure: { reason } } as never });
      const state = face.state();
      expect(state, reason).toMatchObject({ is: "failed", reason: word });
      expect(liveBrowserFailure((state as { reason: string }).reason)).toBe(word);
    }
    // before its first frame (the producer still `starting`), and paused: a failed load all the same
    handle.set({ presentation: summary("starting") });
    expect(face.state()).toMatchObject({ is: "failed", reason: "load-failed" });
    handle.set({ presentation: summary("paused") });
    expect(face.state()).toMatchObject({ is: "failed", reason: "load-failed" });
    // the address that was ASKED for stays the face's word
    expect(face.info().address).toBe("http://127.0.0.1:4321/");
    const failed = face.state();
    if (failed.is !== "failed") throw new Error("not failed");
    failed.retry?.();
    expect(handle.navigations).toEqual([{ action: "reload" }]);
    expect(handle.retried).toBe(0);
    // the page commits: live again
    handle.set({ presentation: summary("live"), browser: NAV as never });
    expect(face.state()).toEqual({ is: "live" });
  });

  it("a page that STOPPED is said — its process gone `stopped`, unresponsive past the bound `unresponsive` — and its retry reloads; a source that cannot be brought back MAY NOT, with nothing to try; any other failure is `failed`", () => {
    const { face, handle } = attached();
    handle.set({ browser: NAV as never });
    const says = (code: string, recovery: string) => {
      handle.set({
        presentation: summary("failed", { code, message: "the producer's words", recovery }),
      });
      return face.state() as { is: string; reason: string; retry?: () => void };
    };
    const stopped = says("producer-crashed", "user-action");
    expect(stopped).toMatchObject({ is: "failed", reason: "stopped: the producer's words" });
    expect(liveBrowserFailure(stopped.reason)).toBe("stopped");
    stopped.retry?.();
    expect(handle.navigations).toEqual([{ action: "reload" }]);
    expect(says("frame-stalled", "user-action").reason).toBe("unresponsive: the producer's words");
    // no first paint within the producer's deadline: not the person's page hanging — a failure, tried again by a reload
    const stalled = says("frame-stalled", "automatic");
    expect(stalled.reason).toBe("failed: the producer's words");
    expect(stalled.retry).toBeTypeOf("function");
    expect(says("source-not-found", "user-action").reason).toBe(
      "load-failed: the producer's words",
    );
    const never = says("security-rejected", "permanent");
    expect(never.reason).toBe("may-not: the producer's words");
    expect(never.retry).toBeUndefined();
    // the page's address is kept through it all (the head's)
    expect(face.info().address).toBe("http://127.0.0.1:4321/");
  });

  it("a failed page's frames are NEVER shown: the engine's own error page is taken and closed, the texture HIDDEN from the moment the page fails until a frame of the page that follows lands — and nothing is sent to what nobody sees", () => {
    const { face, handle, presentation, live, writers } = attached();
    face.demand(SEEN);
    presentation.land();
    expect(face.take()).toBe(true);
    expect(face.texture()).toBeDefined();
    face.input?.({ kind: "wheel", x: 10, y: 10, dx: 0, dy: 40 });
    expect(handle.inputs).toHaveLength(1);
    // the load fails: the page that was there is not shown either (the film is the kind's to draw)
    handle.set({ browser: { ...NAV, failure: { reason: "connection-refused" } } as never });
    expect(face.take()).toBe(true);
    expect(face.texture()).toBeUndefined();
    expect(live.faces()[0]).toMatchObject({ veiled: true });
    // the engine paints its error page: taken, closed, drawn nowhere
    const error = presentation.land();
    expect(face.take()).toBe(false);
    expect(error.close).toHaveBeenCalledTimes(1);
    expect(writers[0]?.presented).toHaveLength(1);
    expect(face.texture()).toBeUndefined();
    // a press, a key: not sent
    face.input?.({ kind: "wheel", x: 10, y: 10, dx: 0, dy: 40 });
    face.input?.({ kind: "text", text: "a" });
    expect(handle.inputs).toHaveLength(1);
    // the page commits — the texture stays hidden (it still holds the old page) until its first frame lands
    handle.set({ browser: NAV as never });
    expect(face.state()).toEqual({ is: "live" });
    expect(face.take()).toBe(true);
    expect(face.texture()).toBeUndefined();
    presentation.land();
    expect(face.take()).toBe(true);
    expect(face.texture()).toBeDefined();
    // (PT-5b: the texture that held the old page was let go at the failure — the page that follows has its own)
    expect(writers).toHaveLength(2);
    expect(writers[0]?.destroyed).toBe(1);
    expect(writers[0]?.presented).toHaveLength(1);
    expect(writers[1]?.presented).toHaveLength(1);
    expect(live.faces()[0]).toMatchObject({ veiled: false });
    face.input?.({ kind: "wheel", x: 10, y: 10, dx: 0, dy: 40 });
    expect(handle.inputs).toHaveLength(2);
    // a page that stopped hides its last frame too, and a lost lane's
    handle.set({
      presentation: summary("failed", {
        code: "producer-crashed",
        message: "",
        recovery: "user-action",
      }),
    });
    expect(face.texture()).toBeUndefined();
  });

  it("what the page asked for and MAY NOT have rides the face's words (`extra.refused`, with its serial), and a new one is an arrival", () => {
    const { face, handle, arrived, live } = attached();
    handle.set({ browser: NAV as never });
    expect(face.info().extra).toEqual({ favicon: null });
    arrived.mockClear();
    handle.set({ browser: { ...NAV, refused: { what: "download", serial: 1 } } as never });
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(face.info().extra).toEqual({ favicon: null, refused: { what: "download", serial: 1 } });
    expect(live.faces()[0]).toMatchObject({ refused: 1 });
    handle.set({ browser: { ...NAV, refused: { what: "download", serial: 2 } } as never });
    expect(arrived).toHaveBeenCalledTimes(2);
    expect(face.info().extra?.refused).toEqual({ what: "download", serial: 2 });
    // BP-D1: a denied PERMISSION rides the same words, with the permission it was
    handle.set({
      browser: {
        ...NAV,
        refused: { what: "permission", permission: "camera", serial: 3 },
      } as never,
    });
    expect(arrived).toHaveBeenCalledTimes(3);
    expect(face.info().extra?.refused).toEqual({
      what: "permission",
      permission: "camera",
      serial: 3,
    });
  });

  it("PT-5d (M7 H10): the page's DOCUMENT, as its producer counts it, rides the face's words (`extra.document`) — the pane's wait for a page the document sent elsewhere ends by it moving; a producer that counts none says none", () => {
    const { face, handle } = attached();
    handle.set({ browser: { ...NAV, document: 3 } as never });
    expect(face.info().extra).toEqual({ favicon: null, document: 3 });
    handle.set({ browser: NAV as never });
    expect(face.info().extra).toEqual({ favicon: null });
  });
});

describe("PT-5a — the parked desk (ruling 5)", () => {
  const KEY = "13918995204487956201-1";
  const PAUSED = {
    mode: "paused",
    targetFps: 0,
    priority: 0,
    interactive: false,
    logicalViewport: { width: 1280, height: 800 },
  };

  it("PARKED, every page is paused — its kinds are not ticked and cannot ask — and at the UNPARK each is asked what its face LAST asked; an ask made meanwhile is kept, not sent; the same word twice is nothing", () => {
    const t = setup();
    const a = t.live.open(KEY, PAGE, () => {});
    const b = t.live.open("k-2", PAGE, () => {});
    const [ha, hb] = t.handles;
    if (ha === undefined || hb === undefined) throw new Error("no handles");
    for (const h of [ha, hb]) h.set({ status: "live", presentation: fakePresentation() as never });
    a.demand(SEEN);
    const sent = (h: typeof ha) => h.demands.length;
    const before = [sent(ha), sent(hb)];
    // the desk parks: both pages paused, at their layout — the one never asked for too
    t.live.park(true);
    expect(ha.demands.at(-1)).toEqual(PAUSED);
    expect(hb.demands.at(-1)).toEqual(PAUSED);
    expect([sent(ha), sent(hb)]).toEqual([(before[0] ?? 0) + 1, (before[1] ?? 0) + 1]);
    expect(t.live.stats()).toMatchObject({ parks: 1, parked: true });
    // parked again: nothing more
    t.live.park(true);
    expect(sent(ha)).toBe((before[0] ?? 0) + 1);
    // an ask made while parked (a kind's dispose, a late tick): kept as the face's last, never sent
    b.demand({ ...SEEN, fps: 60, interactive: true });
    expect(sent(hb)).toBe((before[1] ?? 0) + 1);
    expect(t.live.faces().find((f) => f.key === "k-2")?.demand).toMatchObject({ fps: 60 });
    // the desk runs again: each page is asked what its face last asked
    t.live.park(false);
    expect(ha.demands.at(-1)).toMatchObject({ mode: "live", targetFps: 30, priority: 50 });
    expect(hb.demands.at(-1)).toMatchObject({ mode: "live", targetFps: 60, priority: 80 });
    expect(t.live.stats()).toMatchObject({ parks: 1, parked: false });
    // running again: an ask is sent as ever
    a.demand(UNSEEN);
    expect(ha.demands.at(-1)).toMatchObject({ mode: "paused" });
    t.live.park(false);
    expect(t.live.stats().parks).toBe(1);
  });

  it("a face that never asked is paused at its spec's layout through a park and its unpark; a face opened on a parked desk stays paused until the desk runs; a closed face is told nothing", () => {
    const t = setup();
    const a = t.live.open(KEY, PAGE, () => {});
    const ha = t.handles[0];
    if (ha === undefined) throw new Error("no handle");
    ha.set({ status: "live", presentation: fakePresentation() as never });
    t.live.park(true);
    t.live.park(false);
    expect(ha.demands.slice(-2)).toEqual([PAUSED, PAUSED]);
    // opened while parked: its first ask is kept
    t.live.park(true);
    const late = t.live.open("k-late", PAGE, () => {});
    const hl = t.handles[1];
    if (hl === undefined) throw new Error("no handle");
    const opened = hl.demands.length;
    late.demand(SEEN);
    expect(hl.demands).toHaveLength(opened);
    // closed while parked: the unpark tells it nothing
    const closedAt = ha.demands.length;
    a.close();
    t.live.park(false);
    expect(ha.demands).toHaveLength(closedAt);
    expect(hl.demands.at(-1)).toMatchObject({ mode: "live", targetFps: 30 });
  });
});
