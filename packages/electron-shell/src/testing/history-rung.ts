// smoke:godview's History rung (AR-8c), its renderer read and its verdict, held apart from smoke.ts so a test can
// read them over a page (item 263): ⌘3 shows rosetta's room on the cover's glass — mounted in History's slot as a
// HOST surface, holding either its columns or an honest state said in words, never a blank.

/** History's room in the cover. */
export const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;

/** What the rung reads of the room: its surface, its columns, its projects and its words; "no room" before it stands. */
export const HISTORY_FACE = `(() => {
  const room = ${HISTORY_ROOM};
  if (!room) return "no room";
  return JSON.stringify({
    surface: room.getAttribute("data-ah-surface"),
    columns: room.querySelector(".ah-cols") !== null,
    projects: room.querySelectorAll(".ah-project-list-item").length,
    words: (room.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 240),
  });
})()`;

/** The face the rung reads, as `HISTORY_FACE` writes it. */
export interface HistoryFace {
  surface: string | null;
  columns: boolean;
  projects: number;
  words: string;
}

/** The rung's verdict: a HOST surface holding its columns or an honest state said in words, never a blank. */
export function historyFaceShows(answer: string): boolean {
  if (answer === "no room") return false;
  const face = JSON.parse(answer) as HistoryFace;
  return face.surface === "host" && (face.columns || face.words.length > 0);
}
