// @vitest-environment node
/**
 * SP-1d — Chat's draft, without a DOM (DESIGN.md §8 "Chat's composer": the draft, the chips, what a send carries).
 * The draft's own rules came back from the line's model in git (`0e2ad08bc`, the parent of HN-2's deletion); the
 * chips and the message are CH-D5's. The composer's DOM, keys and send are `chat-composer.test.tsx`'s.
 */
import { AGENT_CATALOG } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type AgentChip,
  atQueryBefore,
  type CardChip,
  chipLabel,
  type DraftChip,
  type DraftPart,
  draftAfterSend,
  draftBlank,
  draftPlaceholder,
  draftSendable,
  draftStills,
  draftText,
  insertChipAt,
  normalizeDraft,
  type SessionChip,
  spliceDraft,
} from "../src/chat/composer-draft";
import type { Card } from "../src/frame/cards/cards-model";

const AGENT = AGENT_CATALOG[0];

const agent = (over: Partial<AgentChip> = {}): AgentChip => ({
  id: "a1",
  kind: "agent",
  agent: AGENT.id,
  label: AGENT.label,
  profile: { id: "work", name: "Work" },
  named: false,
  model: null,
  ...over,
});

const session = (over: Partial<SessionChip> = {}): SessionChip => ({
  id: "s1",
  kind: "session",
  session: "run-7f3a",
  agent: AGENT.id,
  label: AGENT.label,
  handle: "vibe-field·2",
  project: "vibe-field",
  ...over,
});

const termCard: Card = {
  id: "k1",
  kind: "term",
  origin: { view: "godview", place: "vibe-field", how: "copy" },
  at: 0,
  first: "pnpm test",
  rest: "  ✓ 41 passed",
  paste: "pnpm test\n  ✓ 41 passed\n",
};

const cardChip = (card: Card, text: string): CardChip => ({ id: "c1", kind: "card", card, text });

const text = (t: string): DraftPart => ({ kind: "text", text: t });
const chipPart = (chip: DraftChip): DraftPart => ({ kind: "chip", chip });

describe('the draft (DESIGN.md §8 "Chat\'s composer")', () => {
  it("joins runs of text and drops empty ones, so two drafts that read alike are alike", () => {
    const chip = agent();
    expect(normalizeDraft([text("a"), text(""), text("b"), chipPart(chip), text("")])).toEqual([
      text("ab"),
      chipPart(chip),
    ]);
  });

  it("has something to send only with a word or a chip — never a mention still being typed", () => {
    expect(draftSendable([], null)).toBe(false);
    expect(draftSendable([text("   ")], null)).toBe(false);
    expect(draftBlank([text("   ")])).toBe(false);
    expect(draftBlank([])).toBe(true);
    expect(draftSendable([chipPart(agent())], null)).toBe(true);
    expect(draftSendable([text("@cla")], "@cla")).toBe(false);
    expect(draftSendable([text("ask @cla")], "@cla")).toBe(true);
  });

  it("opens @ only at the start of a word — never inside an address", () => {
    expect(atQueryBefore("@")).toEqual({ at: 0, query: "" });
    expect(atQueryBefore("ask @cla")).toEqual({ at: 4, query: "cla" });
    expect(atQueryBefore("mail a@b")).toBeNull();
    expect(atQueryBefore("@cla then")).toBeNull();
  });

  it("sets a chip where the @ was, with a space after it, and never splits a word", () => {
    const chip = agent();
    expect(spliceDraft([text("look @cl here")], 0, 5, 8, chip)).toEqual([
      text("look "),
      chipPart(chip),
      text(" here"),
    ]);
    expect(spliceDraft([text("see @cl")], 0, 4, 7, chip)).toEqual([
      text("see "),
      chipPart(chip),
      text(" "),
    ]);
    expect(spliceDraft([text("@cl")], 0, 0, 3)).toEqual([]);
  });

  it("sets a card's chip at the caret as a token, moved on to the word's end, and with no caret at the draft's end", () => {
    const chip = cardChip(termCard, "pnpm test");
    const at = insertChipAt([text("look at ")], { index: 0, offset: 8 }, chip);
    expect(at.parts).toEqual([text("look at "), chipPart(chip), text(" ")]);
    expect(at.caret).toBe(10);
    const inWord = insertChipAt([text("compare these")], { index: 0, offset: 10 }, chip);
    expect(inWord.parts).toEqual([text("compare these "), chipPart(chip), text(" ")]);
    expect(inWord.caret).toBe(16);
    expect(insertChipAt([], null, chip).parts).toEqual([chipPart(chip), text(" ")]);
  });

  it("says who it goes to: the spark's name", () => {
    expect(draftPlaceholder("Vela")).toBe("Message Vela…");
  });
});

describe('the chips (DESIGN.md §8 "Chat\'s composer", the chips)', () => {
  it("reads an agent by its label, its model and effort once chosen, and its profile when the spark has more than one", () => {
    expect(chipLabel(agent())).toBe(AGENT.label);
    expect(chipLabel(agent({ named: true }))).toBe(`${AGENT.label} · Work`);
    expect(
      chipLabel(agent({ model: { words: ["Opus 5.5", "high"], selection: { modelId: "opus" } } })),
    ).toBe(`${AGENT.label} · Opus 5.5 · high`);
  });

  it("reads a session by its handle, and a card by its name as an outcome says it", () => {
    expect(chipLabel(session())).toBe("vibe-field·2");
    expect(chipLabel(cardChip(termCard, "pnpm test"))).toBe("pnpm test");
  });
});

describe('what a send carries (DESIGN.md §8 "Chat\'s composer")', () => {
  it("joins the words as typed, their ends trimmed, and an agent chip as its words", () => {
    expect(draftText([text("  start "), chipPart(agent()), text(" on the tests  ")])).toBe(
      `start ${AGENT.label} on the tests`,
    );
    expect(
      draftText([
        text("start "),
        chipPart(
          agent({
            named: true,
            model: { words: ["Opus 5.5", "high"], selection: { modelId: "opus" } },
          }),
        ),
      ]),
    ).toBe(`start ${AGENT.label} at Opus 5.5 · high under Work`);
  });

  it("an agent chip with a profile says under, only when the spark has more than one", () => {
    expect(draftText([chipPart(agent({ named: true }))])).toBe(`${AGENT.label} under Work`);
    expect(draftText([chipPart(agent({ named: false }))])).toBe(AGENT.label);
  });

  it("a session chip carries its id, and its project's name without @'s ordinal", () => {
    expect(draftText([text("ask "), chipPart(session()), text(" to rebase")])).toBe(
      `ask ${AGENT.label} in vibe-field (session run-7f3a) to rebase`,
    );
  });

  it("a session chip whose run names no folder carries its agent and its id alone", () => {
    const bare = session({ handle: `${AGENT.label}·2`, project: null });
    expect(chipLabel(bare)).toBe(`${AGENT.label}·2`);
    expect(draftText([text("ask "), chipPart(bare)])).toBe(`ask ${AGENT.label} (session run-7f3a)`);
  });

  it("keeps a card's line breaks, setting a multi-line card on its own lines", () => {
    expect(
      draftText([
        text("why does this fail? "),
        chipPart(cardChip(termCard, "pnpm test\n  ✓ 41 passed")),
        text(" thanks"),
      ]),
    ).toBe("why does this fail?\npnpm test\n  ✓ 41 passed\nthanks");
  });

  it("never ends with a line break", () => {
    expect(draftText([text("see "), chipPart(cardChip(termCard, "a\nb"))])).toBe("see\na\nb");
    expect(draftText([text("one line\n")])).toBe("one line");
  });

  it("names the snapshot stills its card chips cite, for Send to check before the paste", () => {
    const snap: Card = {
      id: "p1",
      kind: "pict",
      origin: { view: "canvas", how: "snapshot" },
      at: 0,
      paste: "",
      title: "Snapshot",
      width: 1440,
      height: 900,
      src: "vibefield-still:one",
      path: "/stills/one.png",
    };
    expect(draftStills([chipPart(cardChip(snap, "/stills/one.png")), chipPart(agent())])).toEqual([
      "/stills/one.png",
    ]);
    expect(draftStills([chipPart(cardChip(termCard, "pnpm test"))])).toEqual([]);
  });
});

describe('what a send leaves (DESIGN.md §8 "Chat\'s composer", Send)', () => {
  it("clears what it carried and keeps what was typed or added while it ran", () => {
    const chip = session();
    const carried = [text("ask "), chipPart(chip), text(" to rebase")];
    expect(draftAfterSend(carried, carried)).toEqual([]);
    // typed on after the send was pressed: the words stay, their leading space trimmed
    expect(
      draftAfterSend(carried, [text("ask "), chipPart(chip), text(" to rebase and then push")]),
    ).toEqual([text("and then push")]);
    // a card played onto the composer meanwhile stays, the chip whole
    const card = cardChip(termCard, "pnpm test");
    expect(
      draftAfterSend(carried, [text("ask "), chipPart(chip), text(" to rebase "), chipPart(card)]),
    ).toEqual([chipPart(card)]);
    // what was sent ends with a chip: what follows it stays
    const ending = [text("tell "), chipPart(chip)];
    expect(draftAfterSend(ending, [...ending, text(" now")])).toEqual([text("now")]);
  });

  it("keeps a draft changed within what was sent whole, so no word is lost", () => {
    const chip = agent();
    const sent = [text("start "), chipPart(chip), text(" on the tests")];
    const edited = [text("start "), chipPart(chip), text(" on the docs")];
    expect(draftAfterSend(sent, edited)).toBe(edited);
    // its model chosen again meanwhile is another chip than the one sent
    const chosen = [
      text("start "),
      chipPart({ ...chip, model: { words: ["Deep"], selection: { modelId: "deep" } } }),
      text(" on the tests"),
    ];
    expect(draftAfterSend(sent, chosen)).toBe(chosen);
    const cut = [text("start ")];
    expect(draftAfterSend(sent, cut)).toBe(cut);
  });
});
