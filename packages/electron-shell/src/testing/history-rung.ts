// smoke:godview's History rung (AR-8c), its renderer read and its verdict, held apart from smoke.ts so a test can
// read them over a page (item 263): ⌘3 shows rosetta's room on the cover's glass — mounted in History's slot as a
// HOST surface, holding either its columns or an honest state said in words, never a blank.
//
// *2026-11-08 (item 263; HG-2, the room behind glass):* before its past the room's consent slot holds only
// `HistoryConsentMarker`, a hidden span, and the card that says its state stands in the view's own layer over the
// frosted sample (HG-D1, `HistoryGlass.tsx`). So while the slot holds the marker, the honest state is the card's
// words. And the room is the view's OWN: the sample behind the glass is a second rosetta room, inert, with its own
// `.ah-frame` under a `.vf-history-room` of its own, so `.vf-history .ah-frame` would take it too.

/** The view's own room in History's cover, never the sample's behind the glass. */
export const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history > .vf-history-room .ah-frame')`;

/** The card behind glass, which says the room's state while it waits for consent. */
const HISTORY_CARD = `document.querySelector('[data-cover-view="history"] .vf-history > .vf-history-glass .vf-history-glass-card')`;

/** What the rung reads of the room: its surface, its columns, its projects, its words, and the card's words while the
 * room's slot holds HG-2's marker (null otherwise); "no room" before it stands. */
export const HISTORY_FACE = `(() => {
  const room = ${HISTORY_ROOM};
  if (!room) return "no room";
  const said = (at) => (at?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 240);
  return JSON.stringify({
    surface: room.getAttribute("data-ah-surface"),
    columns: room.querySelector(".ah-cols") !== null,
    projects: room.querySelectorAll(".ah-project-list-item").length,
    words: said(room),
    card: room.querySelector(".vf-history-consent-marker") === null ? null : said(${HISTORY_CARD}),
  });
})()`;

/** The face the rung reads, as `HISTORY_FACE` writes it. */
export interface HistoryFace {
  surface: string | null;
  columns: boolean;
  projects: number;
  words: string;
  /** the card's words while the room waits for consent, else null */
  card: string | null;
}

/** The rung's verdict: a HOST surface holding its columns or an honest state said in words — its own, or the card's
 * while it waits for consent — never a blank. */
export function historyFaceShows(answer: string): boolean {
  if (answer === "no room") return false;
  const face = JSON.parse(answer) as HistoryFace;
  return (
    face.surface === "host" &&
    (face.columns || face.words.length > 0 || (face.card ?? "").length > 0)
  );
}
