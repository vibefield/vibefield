/**
 * The Peek's filters, pure (SE-D1 A "Tokens", ruled 2026-11-06 on the page The
 * Bands Meter; DESIGN.md §8 "Search — the Peek" and §9 "Search's words"; the
 * drawing is `draft/profile-meters/round4/src/p5-peek.js`, variant `tokens`).
 * A filter that is on is a token in the field — Live now's the desktop's then
 * the profile's (Godview's own, GV-D3), Everything's the project's, what was
 * said and the agent's (the popup's) — and ⌫ at the field's start takes the
 * last back. A typed name offers its filter. + Filter's one menu groups every
 * choice under the menus' eyebrow. A live run's head says where it runs, and
 * Everything says it looks through every profile while the lens is on (UM-D28).
 */
import { describe, expect, it } from "vitest";
import type { LiveFilters } from "../src/frame/find-door";
import {
  backspaceTakes,
  clearPick,
  everythingLensWords,
  filterMenu,
  KIND_WORDS,
  liveHeadWords,
  offerWords,
  type PeekFilterState,
  peekFieldTokens,
  peekOffer,
  rowProfile,
  withoutLastWord,
} from "../src/frame/peek-filters";
import type { PeekLiveRow } from "../src/frame/peek-live";
import { NO_PEEK_FILTERS, peekAgents } from "../src/frame/peek-model";

/** One of the catalog's own agents (AR-L1: the rows name no vendor). */
const [AGENT] = peekAgents();
const AGENT_ID = AGENT?.id ?? "agent";
const AGENT_LABEL = AGENT?.label ?? "Agent";

const LIVE: LiveFilters = {
  desks: [
    {
      id: "here",
      name: "MacBook Pro",
      os: "macos",
      here: true,
      note: "3 agents",
      quiet: false,
      agents: 3,
      sessions: 4,
    },
    {
      id: "studio",
      name: "studio",
      os: "linux",
      here: false,
      note: "2 agents",
      quiet: false,
      agents: 2,
      sessions: 2,
    },
    {
      id: "mini",
      name: "mini",
      os: "macos",
      here: false,
      note: "asleep",
      quiet: true,
      agents: 1,
      sessions: 1,
    },
  ],
  desk: null,
  profiles: [
    { id: "native", label: "This Mac", kind: "native", isDefault: true, sessions: 3 },
    { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true, sessions: 2 },
    { id: "client", label: "Client Billing", kind: "managed", glyph: "folder", sessions: 1 },
  ],
  profile: null,
  sessions: 7,
};

/** TS-4 — this Mac not connected: This Mac alone, and the ghost row. */
const UNCONNECTED: LiveFilters = {
  ...LIVE,
  desks: LIVE.desks.filter((desk) => desk.here),
  connect: true,
};

const PROJECTS = [
  { id: "p-billing", name: "billing-api" },
  { id: "p-field", name: "vibe-field" },
];

const state = (patch: Partial<PeekFilterState> = {}): PeekFilterState => ({
  scope: "live",
  live: LIVE,
  filters: NO_PEEK_FILTERS,
  projects: PROJECTS,
  agents: [{ id: AGENT_ID, label: AGENT_LABEL }],
  ...patch,
});

const words = (tokens: ReturnType<typeof peekFieldTokens>): string[][] =>
  tokens.map((token) => [token.filter, token.label, token.mark.kind]);

describe("the field's tokens (SE-D1)", () => {
  it("Live now's are the desktop's then the profile's, each with its mark — This Mac alone draws none (TS-4), and Everything shows neither (UM-D28)", () => {
    expect(peekFieldTokens(state())).toEqual([]);
    const both = state({ live: { ...LIVE, desk: "studio", profile: "work" } });
    expect(words(peekFieldTokens(both))).toEqual([
      ["desk", "studio", "os"],
      ["profile", "Work", "profile"],
    ]);
    expect(peekFieldTokens(both).map((token) => token.mark)).toEqual([
      { kind: "os", os: "linux" },
      { kind: "profile", glyph: "briefcase", profileKind: "managed", filled: false },
    ]);
    // the default profile's glyph is drawn filled
    expect(
      peekFieldTokens(state({ live: { ...LIVE, profile: "native" } })).map((token) => token.mark),
    ).toEqual([{ kind: "profile", glyph: undefined, profileKind: "native", filled: true }]);
    // a choice the lists no longer hold names nothing (it fell back to every one)
    expect(peekFieldTokens(state({ live: { ...LIVE, desk: "gone" } }))).toEqual([]);
    // TS-4: This Mac alone is every desktop — no token
    expect(peekFieldTokens(state({ live: UNCONNECTED }))).toEqual([]);
    // History's Live now lends no filters; Everything shows no profile or desktop
    expect(peekFieldTokens(state({ live: null }))).toEqual([]);
    expect(peekFieldTokens({ ...both, scope: "everything" })).toEqual([]);
  });

  it("Everything's are the project's, what was said — only when it is not every kind — and the agent's, in that order", () => {
    const all = state({
      scope: "everything",
      filters: { project: "p-billing", kind: "user", agent: AGENT_ID },
    });
    expect(words(peekFieldTokens(all))).toEqual([
      ["project", "billing-api", "glyph"],
      ["kind", "Prompts only", "glyph"],
      ["agent", AGENT_LABEL, "agent"],
    ]);
    expect(peekFieldTokens(all).map((token) => token.mark)).toEqual([
      { kind: "glyph", name: "folder" },
      { kind: "glyph", name: "message" },
      { kind: "agent", id: AGENT_ID },
    ]);
    expect(
      words(
        peekFieldTokens(
          state({ scope: "everything", filters: { project: null, kind: "agent", agent: null } }),
        ),
      ),
    ).toEqual([["kind", "Replies only", "glyph"]]);
    // every kind is no filter: no token
    expect(peekFieldTokens(state({ scope: "everything" }))).toEqual([]);
    // Live now's filters are not Everything's
    expect(
      peekFieldTokens(state({ scope: "everything", live: { ...LIVE, desk: "studio" } })),
    ).toEqual([]);
  });

  it("⌫ with the caret at the field's start and nothing selected takes the last token — the agent's, then what was said, then the project's; the profile's, then the desktop's", () => {
    const filters = { project: "p-field", kind: "agent" as const, agent: AGENT_ID };
    const everything = peekFieldTokens(state({ scope: "everything", filters }));
    const at0 = { start: 0, end: 0 };
    expect(backspaceTakes(everything, at0)?.filter).toBe("agent");
    expect(backspaceTakes(everything.slice(0, 2), at0)?.filter).toBe("kind");
    expect(backspaceTakes(everything.slice(0, 1), at0)?.filter).toBe("project");
    const live = peekFieldTokens(state({ live: { ...LIVE, desk: "studio", profile: "work" } }));
    expect(backspaceTakes(live, at0)?.filter).toBe("profile");
    expect(backspaceTakes(live.slice(0, 1), at0)?.filter).toBe("desk");
    // ⌫ is the words' anywhere else, and with a selection; with no token it takes nothing
    expect(backspaceTakes(live, { start: 3, end: 3 })).toBeNull();
    expect(backspaceTakes(live, { start: 0, end: 4 })).toBeNull();
    expect(backspaceTakes(live, { start: null, end: null })).toBeNull();
    expect(backspaceTakes([], at0)).toBeNull();
  });

  it("a token's × sets its one filter back to every — what was said back to every kind", () => {
    const [desk, profile] = peekFieldTokens(
      state({ live: { ...LIVE, desk: "studio", profile: "work" } }),
    );
    const filters = { project: "p-field", kind: "user" as const, agent: AGENT_ID };
    const [project, kind, agent] = peekFieldTokens(state({ scope: "everything", filters }));
    expect(
      [desk, profile, project, kind, agent].map((token) => token && clearPick(token)),
    ).toEqual([
      { filter: "desk", value: null },
      { filter: "profile", value: null },
      { filter: "project", value: null },
      { filter: "kind", value: "any" },
      { filter: "agent", value: null },
    ]);
  });
});

describe("a typed name offers its filter (SE-D1)", () => {
  it("the last word, of two letters or more, beginning a word of a profile's name or a desktop's — a profile first — with its sessions", () => {
    const work = peekOffer("deploy wo", "live", LIVE);
    expect(work).toEqual({
      kind: "offer",
      id: "offer:profile:work",
      pick: { filter: "profile", value: "work" },
      mark: { kind: "profile", glyph: "briefcase", profileKind: "managed", filled: false },
      title: "Show only Work's sessions",
      note: "2 sessions",
    });
    // any word of the name; the case is not the point
    expect(peekOffer("BILL", "live", LIVE)?.title).toBe("Show only Client Billing's sessions");
    expect(peekOffer("bill", "live", LIVE)?.note).toBe("1 session");
    // a desktop when no profile's name begins so
    expect(peekOffer("stu", "live", LIVE)).toMatchObject({
      id: "offer:desk:studio",
      pick: { filter: "desk", value: "studio" },
      mark: { kind: "os", os: "linux" },
      title: "Show only what runs on studio",
      note: "2 sessions",
    });
    // "ma" begins This Mac's "Mac" and MacBook Pro's "MacBook": the profile first
    expect(peekOffer("ma", "live", LIVE)?.pick).toEqual({ filter: "profile", value: "native" });
    // the trailing space still leaves "wo" the last word typed
    expect(peekOffer("wo ", "live", LIVE)?.pick).toEqual({ filter: "profile", value: "work" });
  });

  it("offers nothing for one letter, a word nothing begins, Everything, History's Live now, a word in quotes, a kind already chosen, or This Mac alone", () => {
    expect(peekOffer("w", "live", LIVE)).toBeNull();
    expect(peekOffer("zebra", "live", LIVE)).toBeNull();
    expect(peekOffer("", "live", LIVE)).toBeNull();
    expect(peekOffer("wo", "everything", LIVE)).toBeNull();
    expect(peekOffer("wo", "live", null)).toBeNull();
    // words in quotes still search as words
    expect(peekOffer('"deploy wo', "live", LIVE)).toBeNull();
    expect(peekOffer('"wo"', "live", LIVE)).toBeNull();
    expect(peekOffer('"deploy" wo', "live", LIVE)?.pick).toEqual({
      filter: "profile",
      value: "work",
    });
    // a profile is chosen: no other profile is offered, a desktop still is
    expect(peekOffer("wo", "live", { ...LIVE, profile: "client" })).toBeNull();
    expect(peekOffer("stu", "live", { ...LIVE, profile: "client" })?.pick).toEqual({
      filter: "desk",
      value: "studio",
    });
    // a desktop is chosen: no desktop is offered
    expect(peekOffer("stu", "live", { ...LIVE, desk: "here" })).toBeNull();
    // This Mac alone (TS-4) is every desktop: nothing to offer
    expect(peekOffer("macb", "live", UNCONNECTED)).toBeNull();
    // no profile besides This Mac: none offered
    expect(peekOffer("wo", "live", { ...LIVE, profiles: [] })).toBeNull();
  });

  it("taken, its word leaves the query, and its peek says the filter stays", () => {
    expect(withoutLastWord("deploy wo")).toBe("deploy ");
    expect(withoutLastWord("wo ")).toBe("");
    expect(withoutLastWord("wo")).toBe("");
    const offer = peekOffer("wo", "live", LIVE);
    expect(offer === null ? null : offerWords(offer)).toBe(
      "Show only Work's sessions. The field, the button and the stage keep it until you remove it.",
    );
  });
});

describe("+ Filter's menu (SE-D1)", () => {
  const rows = (groups: ReturnType<typeof filterMenu>) =>
    groups.map((group) => [
      group.eyebrow,
      group.rows.map((row) => [row.label, row.note, row.on, row.quiet]),
    ]);

  it("Live now's: Profiles, then Desktops — each with what it holds, every session's count whatever the other filter, the one standing in the ready fill", () => {
    const groups = filterMenu(state({ live: { ...LIVE, desk: "studio" } }));
    expect(rows(groups)).toEqual([
      [
        "Profiles",
        [
          ["Every profile", "7 sessions", true, false],
          ["This Mac", "3 sessions", false, false],
          ["Work", "waiting", false, false],
          ["Client Billing", "1 session", false, false],
        ],
      ],
      [
        "Desktops",
        [
          ["All desktops", "6 agents", false, false],
          ["MacBook Pro · here", "3 agents", false, false],
          ["studio", "2 agents", true, false],
          ["mini", "asleep", false, true],
        ],
      ],
    ]);
    // a pick sets one filter; the marks are the profile's glyph and the desktop's OS
    const [profiles, desks] = groups;
    expect(profiles?.rows.map((row) => row.pick)).toEqual([
      { filter: "profile", value: null },
      { filter: "profile", value: "native" },
      { filter: "profile", value: "work" },
      { filter: "profile", value: "client" },
    ]);
    expect(profiles?.rows.map((row) => row.mark?.kind ?? null)).toEqual([
      null,
      "profile",
      "profile",
      "profile",
    ]);
    expect(desks?.rows.map((row) => row.mark)).toEqual([
      null,
      { kind: "os", os: "macos" },
      { kind: "os", os: "linux" },
      { kind: "os", os: "macos" },
    ]);
  });

  it("while this Mac is not connected (TS-4): This Mac alone stands for All desktops, and the ghost row closes Desktops", () => {
    const [, desks] = filterMenu(state({ live: UNCONNECTED }));
    expect(desks?.rows.map((row) => [row.label, row.note, row.on, row.pick])).toEqual([
      ["MacBook Pro · here", "3 agents", true, { filter: "desk", value: null }],
      ["Your other devices", "Connect…", false, "connect"],
    ]);
    expect(desks?.rows[1]?.mark).toEqual({ kind: "glyph", name: "plus" });
  });

  it("offers Profiles only while a profile besides This Mac exists, Desktops only with a choice — and nothing in History's Live now", () => {
    expect(filterMenu(state({ live: { ...LIVE, profiles: [] } })).map((g) => g.eyebrow)).toEqual([
      "Desktops",
    ]);
    expect(filterMenu(state({ live: { ...LIVE, desks: [] } })).map((g) => g.eyebrow)).toEqual([
      "Profiles",
    ]);
    // nothing to filter: + Filter is not drawn
    expect(filterMenu(state({ live: { ...LIVE, desks: [], profiles: [] } }))).toEqual([]);
    expect(filterMenu(state({ live: null }))).toEqual([]);
  });

  it("Everything's: Projects, Said by and Agents — Every project and each, the three kinds, Any agent and each", () => {
    const groups = filterMenu(
      state({ scope: "everything", filters: { project: "p-field", kind: "any", agent: null } }),
    );
    expect(rows(groups)).toEqual([
      [
        "Projects",
        [
          ["Every project", null, false, false],
          ["billing-api", null, false, false],
          ["vibe-field", null, true, false],
        ],
      ],
      [
        "Said by",
        [
          ["Prompts and replies", null, true, false],
          ["Prompts only", null, false, false],
          ["Replies only", null, false, false],
        ],
      ],
      [
        "Agents",
        [
          ["Any agent", null, true, false],
          [AGENT_LABEL, null, false, false],
        ],
      ],
    ]);
    const [projects, kinds, agents] = groups;
    expect(projects?.rows.map((row) => row.mark)).toEqual([
      null,
      { kind: "glyph", name: "folder" },
      { kind: "glyph", name: "folder" },
    ]);
    expect(kinds?.rows.map((row) => row.pick)).toEqual([
      { filter: "kind", value: "any" },
      { filter: "kind", value: "user" },
      { filter: "kind", value: "agent" },
    ]);
    expect(agents?.rows.map((row) => [row.pick, row.mark])).toEqual([
      [{ filter: "agent", value: null }, null],
      [
        { filter: "agent", value: AGENT_ID },
        { kind: "agent", id: AGENT_ID },
      ],
    ]);
    // Said by's words are the tokens'
    expect(KIND_WORDS).toEqual({
      any: "Prompts and replies",
      user: "Prompts only",
      agent: "Replies only",
    });
  });
});

describe("a live run's words (SE-D1, UM-D28)", () => {
  const live = (patch: Partial<PeekLiveRow>): PeekLiveRow =>
    ({
      kind: "live",
      id: "row",
      title: "Run the billing migration tests",
      state: "working",
      when: "working",
      folder: "billing-api",
      agent: AGENT_LABEL,
      remote: null,
      profile: null,
      lines: [],
      floorSessionId: null,
      ...patch,
    }) as PeekLiveRow;

  it("the live peek's head: folder, agent, profile as its row says one, where it runs, its state", () => {
    const own = live({ profile: "work" });
    expect(liveHeadWords(own, rowProfile(own, LIVE), "This Mac")).toBe(
      `billing-api · ${AGENT_LABEL} · Work · on this Mac · working`,
    );
    // off the Mac, the device's own word
    expect(liveHeadWords(own, rowProfile(own, LIVE), "This PC")).toBe(
      `billing-api · ${AGENT_LABEL} · Work · on this PC · working`,
    );
    // a peer's run says its desktop and no profile
    const away = live({
      remote: { name: "studio", os: "linux" },
      state: "blocked",
      when: "waiting",
    });
    expect(liveHeadWords(away, rowProfile(away, LIVE), "This Mac")).toBe(
      `billing-api · ${AGENT_LABEL} · on studio · waiting`,
    );
    // a shell with no folder says what it has
    const shell = live({ folder: null, agent: "shell", state: "shell", when: "a shell" });
    expect(liveHeadWords(shell, null, "This Mac")).toBe("shell · on this Mac · a shell");
  });

  it("a row says its profile only while a profile besides This Mac is offered (UM-D12), and only one the lists hold", () => {
    const own = live({ profile: "work" });
    expect(rowProfile(own, LIVE)?.label).toBe("Work");
    expect(rowProfile(own, { ...LIVE, profiles: [] })).toBeNull();
    expect(rowProfile(own, null)).toBeNull();
    expect(rowProfile(live({ profile: "gone" }), LIVE)).toBeNull();
    expect(rowProfile(live({ profile: null }), LIVE)).toBeNull();
  });

  it("Everything looks through every profile, and says so while the lens is on (UM-D28)", () => {
    expect(everythingLensWords({ ...LIVE, profile: "work" })).toBe(
      " · every profile; Work comes back on Live now",
    );
    expect(everythingLensWords(LIVE)).toBe("");
    expect(everythingLensWords({ ...LIVE, desk: "studio" })).toBe("");
    expect(everythingLensWords(null)).toBe("");
  });
});
