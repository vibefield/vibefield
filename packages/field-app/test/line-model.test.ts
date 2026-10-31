// @vitest-environment node
/**
 * One Frame FR-2, LN-D1 — the line's model, without a DOM: the view's create and
 * its keys, the snapshot's words, the line's place (held to the hand's copy of
 * it and to the stylesheet that spells it), the words a refused input is said
 * in, and the deck's half of what Godview lends the line (its panes named as
 * the swarm names them). The line's DOM, keys and owner are
 * `composer-line.test.tsx`'s.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ScreenshotCaptureResult, ScreenshotErrorCode } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { getCaptureState, noteCapture, resetCaptureStateForTest } from "../src/frame/capture-state";
import { CARDS_LINE_RIGHT } from "../src/frame/cards/cards-model";
import { captureRefusal } from "../src/frame/cards/cards-words";
import {
  LINE_BOTTOM_PX,
  LINE_HEIGHT_PX,
  LINE_LEFT_PX,
  LINE_WIDTH_PX,
} from "../src/frame/frame-geometry";
import { foldSurface } from "../src/frame/frame-surface";
import { inputRefusalNote, inputRefusalWhy } from "../src/frame/line-door";
import {
  ariaKeys,
  createActOf,
  SNAPSHOT,
  SNAPSHOT_NO_DOOR,
  SNAPSHOT_NO_HELPER,
  snapshotKey,
} from "../src/frame/line-model";
import { linePanesOf, newTerminalOutcome } from "../src/godview/line-panes";

const here = dirname(fileURLToPath(import.meta.url));

describe("the view's one act (FR-3, FC-D3)", () => {
  it("gives each view its own create, and only Canvas a bare plus", () => {
    expect(createActOf("canvas", "mac")).toEqual({ glyph: "plus", name: "Objects", key: "B" });
    expect(createActOf("godview", "mac")).toEqual({
      glyph: "start",
      name: "New terminal",
      key: "⌘T",
    });
    expect(createActOf("godview", "other")?.key).toBe("Ctrl+T");
    // HN-7 (LN-D2): History's create is Godview's — its glyph, its name, its key
    expect(createActOf("history", "mac")).toEqual({
      glyph: "start",
      name: "New terminal",
      key: "⌘T",
    });
    expect(createActOf("history", "other")?.key).toBe("Ctrl+T");
  });

  it("names the project History shows in its create's tooltip, and only History's (HN-7)", () => {
    // DESIGN.md §8 "The line": "New terminal in vibe-field ⌘T" — the act keeps its name
    expect(createActOf("history", "mac", "vibe-field")).toEqual({
      glyph: "start",
      name: "New terminal",
      key: "⌘T",
      title: "New terminal in vibe-field",
    });
    // the project is History's alone to name; Resume and Jump to, its create until HN-7, are
    // the chosen session's acts now (`chosenSessionAct`, head-model.test.ts)
    expect(createActOf("godview", "mac", "vibe-field")).toEqual(createActOf("godview", "mac"));
    expect(createActOf("canvas", "mac", "vibe-field")?.title).toBeUndefined();
  });

  it("gives Chat its create, New spark — never Canvas's Objects in its place (SP-1c)", () => {
    // DESIGN.md §8 "The line": Chat's create opens the New spark sheet, ✦ and ⌘N; no project names it
    expect(createActOf("assistant", "mac")).toEqual({
      glyph: "sparkle",
      name: "New spark",
      key: "⌘N",
    });
    expect(createActOf("assistant", "other", "vibe-field")).toEqual({
      glyph: "sparkle",
      name: "New spark",
      key: "Ctrl+N",
    });
  });

  it("spells every key the line says as aria-keyshortcuts reads it", () => {
    expect(ariaKeys("B")).toBe("B");
    expect(ariaKeys("⌘T")).toBe("Meta+T");
    expect(ariaKeys("Ctrl+T")).toBe("Control+T");
    expect(ariaKeys("⌃⌘A")).toBe("Control+Meta+A");
    expect(ariaKeys("Alt+A")).toBe("Alt+A");
    expect(ariaKeys("⇧⌘V")).toBe("Shift+Meta+V");
  });
});

describe("the snapshot (HN-D2; SNAP-D3)", () => {
  it("names itself, says main's key the platform's way, and why it waits without a door", () => {
    expect(SNAPSHOT).toBe("Snapshot");
    expect(snapshotKey("mac")).toBe("⌃⌘A");
    expect(snapshotKey("other")).toBe("Alt+A");
    expect(SNAPSHOT_NO_DOOR).toBe("no capture here");
    expect(SNAPSHOT_NO_HELPER).toBe("no capture helper on this platform");
  });

  it("says every refusal the capture door can give in the Snap tile's words, else the tool's own reason", () => {
    // every code the contract admits, so a new one is a decision here rather than a silent default
    const said = Object.fromEntries(
      ScreenshotErrorCode.options.map((code) => [
        code,
        captureRefusal({ status: "error", code, message: "the helper said no" }),
      ]),
    );
    const own = "Not captured — the helper said no";
    expect(said).toEqual({
      "permission-denied": "Screen Recording is off — System Settings › Privacy & Security",
      "capture-failed": own,
      "no-displays": own,
      "write-failed": own,
      "unsupported-platform": "Not captured — no capture helper on this platform",
      "helper-missing": "Not captured — no capture helper on this platform",
      busy: "Not captured — one capture at a time",
      "helper-spawn-failed": own,
      "helper-timeout": own,
      "helper-exited": own,
      "helper-protocol": own,
      disposed: own,
    });
  });
});

// R-B 4 — what the tool last said of itself, from either press: the snapshot's waiting state.
describe("the snapshot's state, as the tool's last answer leaves it (capture-state.ts)", () => {
  afterEach(() => resetCaptureStateForTest());
  const refused = (code: ScreenshotErrorCode): ScreenshotCaptureResult => ({
    status: "error",
    code,
    message: "the helper said no",
  });
  const KEPT: ScreenshotCaptureResult = {
    status: "ok",
    path: "/stills/region.png",
    width: 600,
    height: 400,
    scale: 2,
    displayId: 1,
    bounds: { x: 0, y: 0, width: 300, height: 200 },
  };

  it("is ready until the tool says otherwise", () => {
    expect(getCaptureState()).toEqual({ waits: null, why: null });
  });

  it("waits where no capture helper exists — the platform has none, or the tree has not built it", () => {
    for (const code of ["helper-missing", "unsupported-platform"] as const) {
      resetCaptureStateForTest();
      noteCapture(refused(code));
      expect(getCaptureState()).toEqual({ waits: SNAPSHOT_NO_HELPER, why: null });
    }
  });

  it("says Screen Recording is off and stays pressable — a press asks the system again", () => {
    noteCapture(refused("permission-denied"));
    expect(getCaptureState()).toEqual({
      waits: null,
      why: "Screen Recording is off — System Settings › Privacy & Security",
    });
  });

  it("forgets it on a still kept, and on a cancel — the tool came up, past its permission check", () => {
    noteCapture(refused("helper-missing"));
    noteCapture(KEPT);
    expect(getCaptureState()).toEqual({ waits: null, why: null });
    noteCapture(refused("permission-denied"));
    noteCapture({ status: "cancel" });
    expect(getCaptureState()).toEqual({ waits: null, why: null });
  });

  it("leaves it as it is for one at a time and the tool's own failures, which say nothing of the door", () => {
    noteCapture(refused("permission-denied"));
    const off = getCaptureState();
    for (const code of ["busy", "capture-failed", "helper-timeout", "disposed"] as const) {
      noteCapture(refused(code));
      expect(getCaptureState()).toBe(off);
    }
    resetCaptureStateForTest();
    noteCapture(refused("busy"));
    expect(getCaptureState()).toEqual({ waits: null, why: null });
  });
});

describe("the line's place (LN-D1; DESIGN.md §10)", () => {
  it("stands 300 wide at 76, 52 tall at 20 from the foot — and the hand fans from the same right end", () => {
    const line = [LINE_LEFT_PX, LINE_WIDTH_PX, LINE_BOTTOM_PX, LINE_HEIGHT_PX];
    expect(line).toEqual([76, 300, 20, 52]);
    // the hand keeps its own copy of the line's right end; the two never drift apart
    expect(LINE_LEFT_PX + LINE_WIDTH_PX).toBe(CARDS_LINE_RIGHT);
  });

  it("is spelled the same in its stylesheet as in script (composer.css's .vf-line)", () => {
    const css = readFileSync(join(here, "../src/frame/composer.css"), "utf8");
    const rule = /^\.vf-line \{([^}]*)\}/mu.exec(css)?.[1] ?? "";
    expect(rule).toContain(`left: ${LINE_LEFT_PX}px;`);
    expect(rule).toContain(`width: ${LINE_WIDTH_PX}px;`);
    expect(rule).toContain(`bottom: ${LINE_BOTTOM_PX}px;`);
    expect(rule).toContain(`height: ${LINE_HEIGHT_PX}px;`);
    // no longer centred in the window, nor narrowed by it
    expect(rule).not.toContain("calc(");
  });
});

describe("the line's one owner (FR-4)", () => {
  it("folds a surface only when it is the one open — another's close leaves it alone", () => {
    expect(foldSurface("objects", "objects")).toBeNull();
    expect(foldSurface("palette", "objects")).toBe("palette");
    expect(foldSurface(null, "objects")).toBeNull();
  });
});

describe("what a terminal could not take (D6)", () => {
  it("says a refused input's numbers as Finder counts them, the size never reading as what fits", () => {
    const why = (bytes: number, limitBytes: number, kind: "paste" | "text" = "paste") =>
      inputRefusalWhy({ sessionId: "s", kind, bytes, limitBytes });
    // in thousands (DESIGN.md §9): one byte over 262 KB is 263, never 262
    expect(why(262_145, 262_144)).toBe("263 KB, and one paste carries 262 KB of it");
    // past a megabyte, tenths — the size up, what fits down
    expect(why(4_194_305, 4_194_304)).toBe("4.2 MB, and one paste carries 4.1 MB of it");
    expect(why(300_000, 261_958, "text")).toBe("300 KB, and typed text carries 261 KB of it");
    // the unit is chosen after the rounding: never "1000 KB"
    expect(why(999_999, 261_958)).toBe("1 MB, and one paste carries 261 KB of it");
    expect(why(2_500_000_001, 4_194_304)).toBe("2.6 GB, and one paste carries 4.1 MB of it");
  });

  it("says, of a refused input, exactly the words DESIGN.md §8 records", () => {
    // the doc wraps its lines; a sentence is the same sentence across a wrap
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    const refusal = (kind: "paste" | "text") =>
      ({ sessionId: "s", kind, bytes: 300_000, limitBytes: 261_958 }) as const;
    for (const words of [
      inputRefusalNote(refusal("paste"), "vibe-field"),
      inputRefusalNote(refusal("text"), "vibe-field"),
    ]) {
      expect(design).toContain(`"${words}"`);
    }
  });
});

describe("what the deck lends the line (FR-2)", () => {
  it("names a pane as the swarm names its body: the agent's project, else the folder", () => {
    const panes = [
      { id: "p1", session: { id: "s1", cwd: "/Users/me/vibe-field" } },
      { id: "p2", session: { id: "s2", cwd: "file://mac/Users/me/rosetta/" } },
      { id: "p3", session: { id: "s3", cwd: null } },
    ];
    const agents = new Map([
      [
        "s1",
        {
          providerId: "claude",
          providerLabel: "Claude Code",
          status: "working" as const,
          alive: true,
          project: "VibeField",
        },
      ],
    ]);
    expect(
      linePanesOf(panes, agents, "p2", (id) => (id === "s3" ? "/tmp/born" : undefined)),
    ).toEqual([
      {
        paneId: "p1",
        sessionId: "s1",
        name: "VibeField",
        runs: "Claude Code",
        state: "working",
        active: false,
      },
      { paneId: "p2", sessionId: "s2", name: "rosetta", runs: "shell", state: null, active: true },
      { paneId: "p3", sessionId: "s3", name: "born", runs: "shell", state: null, active: false },
    ]);
  });

  it("says a new terminal's outcome in the swarm's words", () => {
    expect(newTerminalOutcome({ state: "mounted", sessionId: "s9" })).toEqual({ state: "opened" });
    expect(newTerminalOutcome({ state: "failed", reason: "the floor said no" })).toEqual({
      state: "refused",
      reason: "the floor said no",
    });
    expect(newTerminalOutcome({ state: "no-pane" })).toEqual({
      state: "refused",
      reason: "no pane to open it in — open one in the deck first",
    });
  });
});
