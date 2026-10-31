// THE THREAD'S ITEMS (SP-1d; DESIGN.md §8 "Chat's thread", the thread's items; VF-PM's Q2, 2026-10-31): what stands in
// a thread over its pane. THE SEAM every slice that draws in a thread extends: NS-D4's hello and its starters, CP-3's
// needs-you card (CP3-D8), SP-1e's live cards (CH-D2). One rule holds them all (`ThreadItemsView`): they stand in the
// thread's foot, over the pane's bottom rows, and never move or resize the pane, so a live agent's screen never
// reflows under them.

/** One thing that stands in a thread over its pane. Each kind joins this union with the slice that draws it, and with
 * its case in `ThreadItemsView`, which does not compile until the new kind is drawn. No kind is drawn yet. */
export type ThreadItem = never;
