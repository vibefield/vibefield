// @vitest-environment node
/**
 * One Frame FR-2 — the line's model, without a DOM: the draft (DESIGN.md §8:
 * chips inline, the placeholder rule, the interim send's words), @'s list
 * (nearest first, filtered, a row with no door says why) and the deck's half
 * of what Godview lends the line (its panes named as the swarm names them).
 * The line's DOM, keys and owner are `composer-line.test.tsx`'s.
 */
import { describe, expect, it } from "vitest";
import { atDefaultHot, atList, atMove, atStops, atTakeable } from "../src/frame/at-list";
import {
  atQueryBefore,
  createActOf,
  type DraftPart,
  draftBlank,
  draftMessage,
  draftSendable,
  linePlaceholder,
  normalizeDraft,
  sendNote,
  spliceDraft,
} from "../src/frame/draft";
import { foldSurface } from "../src/frame/frame-surface";
import type { LinePane } from "../src/frame/line-door";
import { linePanesOf, newTerminalOutcome } from "../src/godview/line-panes";

const chip = { id: "c1", kind: "capture", label: "1440 × 900", path: "/stills/a.png" } as const;

const PANES: readonly LinePane[] = [
  { sessionId: "s-rosetta", name: "rosetta", runs: "Codex", state: "idle", active: false },
  { sessionId: "s-vibe", name: "vibe-field", runs: "Claude Code", state: "working", active: true },
  { sessionId: "s-bill", name: "billing-api", runs: "Codex", state: "blocked", active: false },
];

describe("the draft (DESIGN.md §8)", () => {
  it("joins runs of text and drops empty ones, so two drafts that read alike are alike", () => {
    expect(
      normalizeDraft([
        { kind: "text", text: "a" },
        { kind: "text", text: "" },
        { kind: "text", text: "b" },
        { kind: "chip", chip },
        { kind: "text", text: "" },
      ]),
    ).toEqual([
      { kind: "text", text: "ab" },
      { kind: "chip", chip },
    ]);
  });

  it("has something to send only with a word or a chip — never a mention still being typed", () => {
    expect(draftSendable([], null)).toBe(false);
    expect(draftSendable([{ kind: "text", text: "   " }], null)).toBe(false);
    expect(draftBlank([{ kind: "text", text: "   " }])).toBe(false);
    expect(draftSendable([{ kind: "chip", chip }], null)).toBe(true);
    expect(draftSendable([{ kind: "text", text: "@vib" }], "@vib")).toBe(false);
    expect(draftSendable([{ kind: "text", text: "ping @vib" }], "@vib")).toBe(true);
  });

  it("sends the words as typed and each chip as the path it cites", () => {
    const parts: DraftPart[] = [
      { kind: "text", text: "compare  " },
      { kind: "chip", chip },
      { kind: "text", text: " with the deck " },
    ];
    expect(draftMessage(parts)).toBe("compare /stills/a.png with the deck");
  });

  it("opens @ only at the start of a word — never inside an address", () => {
    expect(atQueryBefore("@")).toEqual({ at: 0, query: "" });
    expect(atQueryBefore("send it @vib")).toEqual({ at: 8, query: "vib" });
    expect(atQueryBefore("mail a@b")).toBeNull();
    expect(atQueryBefore("@vib then")).toBeNull();
  });

  it("sets a chip where the @ was, with a space after it, and never splits a word", () => {
    const parts: DraftPart[] = [{ kind: "text", text: "look @cl here" }];
    expect(spliceDraft(parts, 0, 5, 8, chip)).toEqual([
      { kind: "text", text: "look " },
      { kind: "chip", chip },
      { kind: "text", text: " here" },
    ]);
    expect(spliceDraft([{ kind: "text", text: "see @cl" }], 0, 4, 7, chip)).toEqual([
      { kind: "text", text: "see " },
      { kind: "chip", chip },
      { kind: "text", text: " " },
    ]);
    expect(spliceDraft([{ kind: "text", text: "@vib" }], 0, 0, 4)).toEqual([]);
  });

  it("says who it goes to: the one way in at rest, the aim's name once aimed", () => {
    expect(linePlaceholder(null)).toBe("Message, or type @ to add…");
    expect(linePlaceholder({ sessionId: "s", name: "vibe-field" })).toBe("Message vibe-field…");
  });

  it("says what the interim send did, and why when it is not what was aimed at", () => {
    expect(sendNote({ kind: "pasted", name: "vibe-field" })).toBe("Pasted into vibe-field");
    expect(sendNote({ kind: "copied" })).toBe("Copied — no agent takes a message from here yet");
    expect(sendNote({ kind: "copied-off-screen", name: "rosetta" })).toBe(
      "Copied — rosetta's pane is not on screen",
    );
    expect(sendNote({ kind: "copy-refused" })).toBe("Not sent — the clipboard refused it");
  });

  it("gives each view its own create, and only Canvas a bare plus (FR-3, FC-D3)", () => {
    expect(createActOf("canvas", "mac")).toEqual({ glyph: "plus", name: "Objects", key: "B" });
    expect(createActOf("godview", "mac")).toEqual({
      glyph: "start",
      name: "New terminal",
      key: "⌘T",
    });
    expect(createActOf("godview", "other").key).toBe("Ctrl+T");
    expect(createActOf("history", "mac")).toEqual({
      glyph: "resume",
      name: "Resume this session",
      key: null,
    });
  });
});

describe("the line's one owner (FR-4)", () => {
  it("folds a surface only when it is the one open — the tray's Esc leaves @ alone", () => {
    expect(foldSurface("objects", "objects")).toBeNull();
    expect(foldSurface("at", "objects")).toBe("at");
    expect(foldSurface(null, "at")).toBeNull();
  });
});

describe("@'s list (DESIGN.md §8, FC-D1)", () => {
  const clipboard = [
    { id: "a", label: "1440 × 900", path: "/a.png", url: null },
    { id: "b", label: "820 × 512", path: "/b.png", url: null },
    { id: "c", label: "640 × 400", path: "/c.png", url: null },
    { id: "d", label: "320 × 200", path: "/d.png", url: null },
  ];
  const list = (query = "", view: "canvas" | "godview" = "godview", canCapture = true) =>
    atList({ view, panes: PANES, clipboard, canCapture, query });

  it("reads bottom-up, nearest first: the active pane against the line, Add above", () => {
    const l = list();
    expect(l.sendEyebrow).toBe("Send to a pane");
    expect(list("", "canvas").sendEyebrow).toBe("Send to");
    expect(l.send.map((row) => row.name)).toEqual(["billing-api", "rosetta", "vibe-field"]);
    expect(l.send.at(-1)?.sub).toBe("Claude Code · the active pane");
    expect(l.add.map((row) => row.id)).toEqual(["clipboard", "file", "capture", "past"]);
    expect(atDefaultHot(l)).toBe("send:s-vibe");
  });

  it("names each pane's state in words, with the swarm's dots", () => {
    const byName = new Map(list().send.map((row) => [row.name, row]));
    expect(byName.get("vibe-field")).toMatchObject({ state: "working", dot: "green" });
    expect(byName.get("billing-api")).toMatchObject({ state: "waiting on you", dot: "orange" });
    expect(byName.get("rosetta")).toMatchObject({ state: "idle", dot: null });
  });

  it("offers the clipboard's three newest, and says how many it holds", () => {
    const clip = list().add[0];
    expect(clip?.kind).toBe("clip");
    if (clip?.kind !== "clip") return;
    expect(clip.minis.map((mini) => mini.id)).toEqual(["a", "b", "c"]);
    expect(clip.count).toBe(4);
  });

  it("says why a row with no door cannot be taken, and never offers it", () => {
    const l = list("", "godview", false);
    const why = new Map(l.add.flatMap((row) => (row.kind === "add" ? [[row.id, row.why]] : [])));
    expect(why.get("file")).toBe("No file door on the desktop yet");
    expect(why.get("past")).toBe("No past-session door on the line yet");
    expect(why.get("capture")).toBe("No capture here");
    expect(atStops(l).map((row) => row.id)).toEqual([
      "clipboard",
      "send:s-bill",
      "send:s-rosetta",
      "send:s-vibe",
    ]);
    expect(atTakeable({ kind: "clip", id: "clipboard", minis: [], count: 0 })).toBe(false);
  });

  it("filters both groups as the word after the @ grows", () => {
    expect(list("ros").send.map((row) => row.name)).toEqual(["rosetta"]);
    expect(list("ros").add).toEqual([]);
    expect(list("cap").add.map((row) => row.id)).toEqual(["capture"]);
    expect(list("cap").sendQuiet).toBe("No pane matches “cap”");
    expect(
      atList({ view: "canvas", panes: [], clipboard, canCapture: true, query: "" }).sendQuiet,
    ).toBe("No panes open yet");
  });

  it("moves the hot row away from the line on ↑ and toward it on ↓, stopping at the ends", () => {
    const l = list();
    expect(atMove(l, "send:s-vibe", "up")).toBe("send:s-rosetta");
    expect(atMove(l, "send:s-vibe", "down")).toBe("send:s-vibe");
    expect(atMove(l, "clipboard", "up")).toBe("clipboard");
    expect(atMove(l, null, "up")).toBe("send:s-vibe");
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
      { sessionId: "s1", name: "VibeField", runs: "Claude Code", state: "working", active: false },
      { sessionId: "s2", name: "rosetta", runs: "shell", state: null, active: true },
      { sessionId: "s3", name: "born", runs: "shell", state: null, active: false },
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
