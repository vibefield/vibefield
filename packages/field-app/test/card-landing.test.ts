// @vitest-environment node
/**
 * OB-1b — the one authority for where a face lands (`draft/thinking-objects-at-work.md` §4.4): the table's reasons and
 * verbs, the bloom's hub and sole fit, the drag's label, and the seam for which runs the door can name.
 */
import { describe, expect, it } from "vitest";
import {
  bloomOf,
  type Destination,
  doorCanNameRun,
  dragLabelOf,
  faceOf,
  landing,
  needsPictureFile,
  noteRunNameable,
  refWords,
  resetRunNameCacheForTest,
} from "../src/frame/cards/card-landing";
import type {
  Face,
  FileFace,
  ImageFace,
  LinkFace,
  RefFace,
  SessionFace,
  TextFace,
} from "../src/frame/cards/cards-model";
import {
  type Card,
  type CardStub,
  fileCardOf,
  pictureCardOf,
  pictureFaceOf,
  sessionCardOf,
  textCardOf,
} from "../src/frame/cards/cards-model";

const BASE: CardStub = { id: "c", at: 0, origin: { view: "canvas", how: "copy" } };

const OUTLINE: TextFace = {
  id: "outline",
  type: "text",
  label: "Outline",
  format: "markdown",
  text: "- one\n- two",
  show: { as: "words", title: "one", body: "two", bare: true },
};
const OPML: FileFace = {
  id: "opml",
  type: "file",
  label: "OPML",
  name: "map.opml",
  path: "/x/map.opml",
};
const PICTURE: ImageFace = pictureFaceOf({
  width: 40,
  height: 20,
  src: "blob:p",
  path: "/x/p.png",
});
const LIVE: RefFace = {
  id: "ref",
  type: "ref",
  label: "Live",
  ref: "vf:obj/7hk2qx4m",
  kindName: "Mind map",
  title: "Q3 plan",
  still: { src: "blob:p", width: 40, height: 20 },
};
const ADDRESS: LinkFace = {
  id: "address",
  type: "link",
  label: "Address",
  url: "https://a.example/",
  title: "A",
};
const SESSION: SessionFace = {
  id: "session",
  type: "session",
  label: "Session",
  handle: "claude·2",
};

const AGENT: Destination = {
  at: "agent-pane",
  run: "run-1",
  handle: "claude·2",
  agentLabel: "Claude Code",
  can: true,
};
const CANNOT: Destination = { ...AGENT, agentLabel: "Copilot", can: false } as Destination;
const SHELL: Destination = { at: "shell-pane", name: "zsh" };
const CHAT: Destination = { at: "chat", spark: "s1", handle: "Vela" };
const DESK: Destination = { at: "desk" };

const card = (...faces: readonly [Face, ...Face[]]): Card => ({
  ...BASE,
  title: "Q3 plan",
  about: "Mind map",
  faces,
});

describe("landing: §4.4's table", () => {
  it("pastes words, paths and addresses into any pane, Return never pressed", () => {
    expect(landing(OUTLINE, AGENT)).toEqual({ lands: true, verb: "Paste", noun: "its outline" });
    expect(landing(OUTLINE, SHELL)).toEqual({ lands: true, verb: "Paste", noun: "its outline" });
    expect(landing(OPML, AGENT)).toEqual({ lands: true, verb: "Paste", noun: "the OPML's path" });
    expect(landing(PICTURE, SHELL)).toEqual({
      lands: true,
      verb: "Paste",
      noun: "the picture's path",
    });
    expect(landing(ADDRESS, AGENT)).toEqual({ lands: true, verb: "Paste", noun: "the address" });
    expect(landing(SESSION, AGENT)).toEqual({ lands: true, verb: "Paste", noun: "the session" });
  });

  it("hands a live object only to an agent the door can name, and refuses the rest in words", () => {
    expect(landing(LIVE, AGENT)).toEqual({ lands: true, verb: "Hand over", noun: "the live map" });
    expect(landing(LIVE, SHELL)).toEqual({
      lands: false,
      reason: "Nothing in this pane can work on it",
    });
    expect(landing(LIVE, CANNOT)).toEqual({
      lands: false,
      reason: "Copilot can't work on desk objects yet",
    });
    const page: RefFace = { ...LIVE, label: "Live page", kindName: "Browser pane" };
    expect(landing(page, AGENT)).toEqual({ lands: true, verb: "Hand over", noun: "the live page" });
  });

  it("makes a chip of every face in Chat, a ref's grant waiting for the send", () => {
    expect(landing(OUTLINE, CHAT)).toEqual({ lands: true, verb: "Add", noun: "its outline" });
    expect(landing(PICTURE, CHAT)).toEqual({
      lands: true,
      verb: "Add",
      noun: "the picture's path",
    });
    expect(landing(LIVE, CHAT)).toEqual({ lands: true, verb: "Add", noun: "the live map" });
  });

  it("gives the desk a note, a print, the object it already holds, and says why not for the rest", () => {
    expect(landing(OUTLINE, DESK)).toEqual({ lands: true, verb: "Place as", noun: "a note" });
    expect(landing(PICTURE, DESK)).toEqual({ lands: true, verb: "Place as", noun: "a print" });
    expect(landing(LIVE, DESK)).toEqual({ lands: true, verb: "Go to", noun: "it" });
    expect(landing(OPML, DESK)).toEqual({ lands: false, reason: "The desk can't hold a file yet" });
    expect(landing(SESSION, DESK)).toEqual({
      lands: false,
      reason: "The desk can't hold an agent yet",
    });
  });

  it("opens an address on the desk only where the desk holds the browser pane", () => {
    expect(landing(ADDRESS, DESK)).toEqual({
      lands: false,
      reason: "The desk can't open a page yet",
    });
    expect(landing(ADDRESS, { at: "desk", browser: true })).toEqual({
      lands: true,
      verb: "Open",
      noun: "a browser pane at it",
    });
  });

  it("refuses a face that holds nothing to give, in the hand's words", () => {
    const noPath: FileFace = { ...OPML, path: undefined } as unknown as FileFace;
    const { path: _p, ...noFile } = PICTURE;
    expect(landing(noPath, AGENT)).toEqual({
      lands: false,
      reason: "A file with no path can't be pasted yet",
    });
    expect(landing(noFile as ImageFace, CHAT)).toEqual({
      lands: false,
      reason: "A picture with no file can't be pasted yet",
    });
    const ofTheDesk: ImageFace = { ...(noFile as ImageFace), bytes: new Blob([]) };
    expect(landing(ofTheDesk, AGENT).lands, "it becomes a file at the play").toBe(true);
    expect(needsPictureFile(ofTheDesk)).toBe(true);
    expect(needsPictureFile(PICTURE)).toBe(false);
  });
});

describe("bloomOf and dragLabelOf (the drop's model)", () => {
  it("draws every face in the card's order; the hub is the first that fits", () => {
    const model = bloomOf(card(LIVE, OUTLINE, OPML, PICTURE), SHELL);
    expect(model.where).toBe("zsh · Godview");
    expect(model.hub).toBe("outline");
    expect(model.onlyFit).toBeNull();
    expect(model.buds.map((bud) => [bud.face, bud.lands])).toEqual([
      ["ref", false],
      ["outline", true],
      ["opml", true],
      ["picture", true],
    ]);
    expect(model.buds[0]?.reason).toBe("Nothing in this pane can work on it");
    expect(dragLabelOf(model, "zsh")).toEqual({ ok: true, label: "Let go: 3 ways into zsh" });
  });

  it("splits a bud's words, so the noun can stand at full ink and the verb at 40% (DESIGN.md §8)", () => {
    const [live, outline] = bloomOf(card(LIVE, OUTLINE), AGENT).buds;
    expect([live?.verb, live?.noun]).toEqual(["Hand over", "the live map"]);
    expect([outline?.verb, outline?.noun]).toEqual(["Paste", "its outline"]);
    const [lone] = bloomOf(textCardOf("Ship it.", BASE), AGENT).buds;
    expect([lone?.verb, lone?.noun]).toEqual(["Paste into", "claude·2"]);
    const [refused] = bloomOf(card(LIVE), SHELL).buds;
    expect([refused?.verb, refused?.noun]).toEqual(["", ""]);
  });

  it("plays one that fits alone at once, under its own verb", () => {
    const model = bloomOf(card(LIVE, OPML), DESK);
    expect(model.onlyFit).toBe("ref");
    expect(dragLabelOf(model, "The desk")).toEqual({ ok: true, label: "Go to it" });
  });

  it("refuses with the first reason when nothing fits: no ring, no bloom", () => {
    const model = bloomOf(card(OPML, SESSION), DESK);
    expect(model.hub).toBeNull();
    expect(dragLabelOf(model, "The desk")).toEqual({
      ok: false,
      label: "The desk can't hold a file yet",
    });
  });

  it("says a one-face card in the place's own sentence: nothing to choose", () => {
    const text = textCardOf("Ship it.", BASE);
    const model = bloomOf(text, AGENT);
    expect(model.onlyFit).toBe("text");
    expect(dragLabelOf(model, "claude·2").label).toBe("Paste into claude·2");
    expect(dragLabelOf(bloomOf(text, SHELL), "zsh").label).toBe("Paste into zsh");
    expect(dragLabelOf(bloomOf(text, CHAT), "Vela").label).toBe("Add to your message to Vela");
    expect(dragLabelOf(bloomOf(text, DESK), "The desk").label).toBe("Place as a note");
    const shot = pictureCardOf({ title: "S", width: 2, height: 2, src: "", path: "/s.png" }, BASE);
    expect(dragLabelOf(bloomOf(shot, DESK), "The desk").label).toBe("Place as a print");
  });

  it("lets a card from another app land anywhere until the drop says what it holds (HN-D2)", () => {
    const waiting = fileCardOf({ name: "" }, { ...BASE, waiting: true });
    expect(bloomOf(waiting, AGENT).onlyFit).toBe("file");
    expect(dragLabelOf(bloomOf(waiting, AGENT), "claude·2").label).toBe("Paste into claude·2");
  });

  it("names a session card the way a place names it", () => {
    const agent = sessionCardOf({ handle: "claude·2" }, BASE);
    expect(bloomOf(agent, DESK).hub).toBeNull();
    expect(bloomOf(agent, AGENT).onlyFit).toBe("session");
  });

  it("finds a face by its id, the first when the id names none", () => {
    const both = card(OUTLINE, OPML);
    expect(faceOf(both, "opml")).toBe(OPML);
    expect(faceOf(both, "gone")).toBe(OUTLINE);
  });
});

describe("the ref's words (§4.4)", () => {
  it("names the kind and title for the model, the ref for its tools", () => {
    expect(refWords(LIVE)).toBe(
      "the mind map “Q3 plan” (desk object vf:obj/7hk2qx4m): call object_open on it",
    );
  });

  it("names every ref of a stack", () => {
    expect(refWords({ ...LIVE, more: ["vf:obj/aaaaaaaa"] })).toBe(
      "2 desk objects (vf:obj/7hk2qx4m, vf:obj/aaaaaaaa): call object_open on each",
    );
  });
});

describe("which runs the door can name (the OB-3 seam)", () => {
  it("reads the catalog until fieldd has answered, then what fieldd said", () => {
    resetRunNameCacheForTest();
    // Claude Code's row claims a process the door can name
    expect(doorCanNameRun("run-1", "claude")).toBe(true);
    expect(doorCanNameRun("run-2", "an-agent-the-catalog-never-heard-of")).toBe(false);
    noteRunNameable("run-1", false);
    expect(doorCanNameRun("run-1", "claude")).toBe(false);
    noteRunNameable("run-2", true);
    expect(doorCanNameRun("run-2", "an-agent-the-catalog-never-heard-of")).toBe(true);
    resetRunNameCacheForTest();
    expect(doorCanNameRun("run-1", "claude")).toBe(true);
  });
});
