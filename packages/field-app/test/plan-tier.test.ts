/**
 * DESIGN.md §8 "A plan's tier": a plan's tier record read into the mark after its
 * title. The contract's three cases stay apart (a label, the agent saying none, not read), a
 * family is two plans in view compared value to value, and the spoken name joins the label to
 * the title with a space. Labels here are made up; no agent sends one yet.
 */
import { describe, expect, it } from "vitest";
import {
  spokenPlanName,
  spokenPlanTitle,
  type TierRow,
  tierMarks,
  tierOf,
} from "../src/panels/agents/plan-tier";

describe("tierOf: the contract's three cases", () => {
  it("reads a label as given, an empty record as none, and no record as not read", () => {
    expect(tierOf({ label: "200" })).toEqual({ kind: "label", label: "200" });
    expect(tierOf({ label: "20x" })).toEqual({ kind: "label", label: "20x" });
    // as given: never cased, trimmed or measured against a word
    expect(tierOf({ label: "Pro+1.5" })).toEqual({ kind: "label", label: "Pro+1.5" });
    expect(tierOf({})).toEqual({ kind: "none" });
    expect(tierOf(undefined)).toEqual({ kind: "unread" });
  });

  it("keeps an unknown field of the record out of the reading", () => {
    // a field a later contract adds passes through the tolerant record and changes nothing
    const later = { label: "100x", since: "2026-11-17" };
    expect(tierOf(later)).toEqual({ kind: "label", label: "100x" });
  });

  it("holds an empty label as not read, so a capsule never holds nothing", () => {
    expect(tierOf({ label: "" })).toEqual({ kind: "unread" });
  });
});

describe("tierMarks: the badge, the empty capsule beside a labelled sibling, or nothing", () => {
  const row = (service: string | undefined, title: string, tier?: TierRow["tier"]): TierRow => ({
    service,
    title,
    ...(tier !== undefined ? { tier } : {}),
  });
  const pro200 = row("openai", "ChatGPT Pro", { label: "200" });
  const proUnread = row("openai", "ChatGPT Pro");
  const max20x = row("anthropic", "Claude Max", { label: "20x" });
  const maxNone = row("anthropic", "Claude Max", {});
  const maxUnread = row("anthropic", "Claude Max");

  it("draws a label as its badge, alone or among others", () => {
    expect(tierMarks([pro200])).toEqual([{ kind: "badge", label: "200" }]);
    expect(tierMarks([max20x, pro200])).toEqual([
      { kind: "badge", label: "20x" },
      { kind: "badge", label: "200" },
    ]);
  });

  it("draws the empty capsule for a tier not read beside its family's label, either order", () => {
    expect(tierMarks([pro200, proUnread])).toEqual([
      { kind: "badge", label: "200" },
      { kind: "unread" },
    ]);
    expect(tierMarks([proUnread, pro200])).toEqual([
      { kind: "unread" },
      { kind: "badge", label: "200" },
    ]);
  });

  it("draws nothing where the agent says there is no tier, even beside a label", () => {
    expect(tierMarks([max20x, maxNone])).toEqual([{ kind: "badge", label: "20x" }, undefined]);
  });

  it("draws nothing for a tier not read alone, or beside siblings with no label", () => {
    expect(tierMarks([row("github", "Copilot Individual")])).toEqual([undefined]);
    expect(tierMarks([maxUnread, maxUnread, maxNone])).toEqual([undefined, undefined, undefined]);
  });

  it("reads a family as the same service AND the same title, value to value", () => {
    // another title of the same service is another family; so is the title of another service
    const plus = row("openai", "ChatGPT Plus");
    const elsewhere = row("other", "ChatGPT Pro");
    expect(tierMarks([pro200, plus, elsewhere])).toEqual([
      { kind: "badge", label: "200" },
      undefined,
      undefined,
    ]);
    // a row that is no plan (an agent on none) is in no family, even beside a labelled one
    const agentLabelled = row(undefined, "Grok", { label: "Heavy" });
    const agentBare = row(undefined, "Grok");
    expect(tierMarks([agentLabelled, agentBare])).toEqual([
      { kind: "badge", label: "Heavy" },
      undefined,
    ]);
  });

  it("decides each row by its place among the rows, never by the object it is", () => {
    expect(tierMarks([proUnread, proUnread])).toEqual([undefined, undefined]);
    expect(tierMarks([pro200, proUnread, proUnread])).toEqual([
      { kind: "badge", label: "200" },
      { kind: "unread" },
      { kind: "unread" },
    ]);
  });
});

describe("spokenPlanName: the badge is part of the name", () => {
  it("joins the title and the label with a space, and says the title alone otherwise", () => {
    expect(spokenPlanName("ChatGPT Pro", { kind: "badge", label: "200" })).toBe("ChatGPT Pro 200");
    expect(spokenPlanName("Claude Max", { kind: "badge", label: "20x" })).toBe("Claude Max 20x");
    // the empty capsule says nothing aloud
    expect(spokenPlanName("ChatGPT Pro", { kind: "unread" })).toBe("ChatGPT Pro");
    expect(spokenPlanName("ChatGPT Pro", undefined)).toBe("ChatGPT Pro");
  });

  it("says the same name from the record alone, where no badge is drawn (the circle's words)", () => {
    expect(spokenPlanTitle("ChatGPT Pro", { label: "200" })).toBe("ChatGPT Pro 200");
    expect(spokenPlanTitle("Claude Max", {})).toBe("Claude Max");
    expect(spokenPlanTitle("Claude Max", undefined)).toBe("Claude Max");
    expect(spokenPlanTitle("Claude Max", { label: "" })).toBe("Claude Max");
  });
});
