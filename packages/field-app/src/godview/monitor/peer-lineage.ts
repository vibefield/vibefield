import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";

/**
 * Item 465 (2026-11-18) — A PEER DESKTOP'S HAND-OFF, read off its rows. This
 * window pairs its OWN hand-offs itself (`PaneTransitions`, its deck's memory)
 * and knows their rollback; a peer's are on the wire alone: the peer's remote
 * cut says `terminal.succeeds` on a session born in another's place (item 464),
 * and the mesh board relays it whole (`peerJoins`, `window-local.ts`). Without
 * this a peer's launch drew two bodies here, its shell's and its agent's, until
 * the shell's row left.
 *
 * The rule is the phone's for its home's rows (`RemoteWindowRows.swift`'s
 * `Heirs`, item 464), read over every peer's rows, each session keyed by its
 * desktop (`peerKey`); the phone reads its peers by the same rule (item 465),
 * so the two screens draw a peer's hand-off body for body (Q-J1 (a)):
 *   · the successor wears the body its predecessor's row wore, and that row is
 *     not drawn while the claim is said, unless it was typed into
 *     (`inputUsed`: its owner kept it), when it is drawn as `retained:<id>`;
 *   · the lineage outlives a frame: a successor arriving after its
 *     predecessor's row left still takes the body (the last `DEPARTED_LIMIT`
 *     departed sessions keep theirs), and when a claim stops being said while
 *     the hidden predecessor stands, each takes its own body back;
 *   · a peer's row wears its own id where it wears its own body: no pane here
 *     joins a peer's row, so the window's rule never names its session.
 * Nothing here mounts, attaches or hides a row from the model: only the
 * drawing yields (PRESENTATION LINEAGE ONLY, `AgentSessionTerminal.succeeds`).
 */

/** How many departed sessions keep their body (`RemoteLineage.departedLimit`). */
export const DEPARTED_LIMIT = 64;

/** The lineage the window's rows carry from frame to frame beside their visual ids. */
export interface PeerLineage {
  /** a session → the visual id its body wore when a row last stood for it */
  readonly bySession: ReadonlyMap<string, string>;
  /** the sessions no row stands for any more, oldest first, at most `DEPARTED_LIMIT` */
  readonly departed: readonly string[];
  /** a drawn row → the session whose body it wears, while its claim is still said */
  readonly inherited: ReadonlyMap<string, string>;
}

export const NO_PEER_LINEAGE: PeerLineage = Object.freeze({
  bySession: new Map<string, string>(),
  departed: Object.freeze([]),
  inherited: new Map<string, string>(),
});

export type PeerReading =
  | { readonly kind: "own" }
  | { readonly kind: "wears"; readonly body: string }
  | { readonly kind: "hidden" };

const OWN: PeerReading = Object.freeze({ kind: "own" });
const HIDDEN: PeerReading = Object.freeze({ kind: "hidden" });
const wears = (body: string): PeerReading => ({ kind: "wears", body });

/** One frame's reading of the peers' lineage, made before any row is drawn. */
export interface PeerHeirs {
  reading(row: AgentView): PeerReading;
  /** the lineage after this frame: `drawn` each drawn row's visual id, `visuals` each row's */
  next(drawn: ReadonlyMap<string, string>, visuals: ReadonlyMap<string, string>): PeerLineage;
}

/**
 * `rows`: the peers' rows in drawing order; `sessionByRow` and `succeedsByRow`
 * the peers' joins (`peerJoins`); `previous` each row drawn last frame's
 * visual id; `lineage` the last frame's.
 */
export function peerHeirs(
  rows: readonly AgentView[],
  sessionByRow: ReadonlyMap<string, string>,
  succeedsByRow: ReadonlyMap<string, string>,
  previous: ReadonlyMap<string, string>,
  lineage: PeerLineage,
): PeerHeirs {
  /** a session → the first row, in drawing order, that stands for it */
  const standsFor = new Map<string, string>();
  /** a predecessor session → its successor's row: the first claimant in drawing order */
  const successorOf = new Map<string, string>();
  /** a successor's row → the predecessor session it claims */
  const claimOf = new Map<string, string>();
  /** a predecessor drawn again after its successor's claim lapsed → the body it wore */
  const restored = new Map<string, string>();
  /** the rows whose claim lapsed while their predecessor's hidden row still stands */
  const lapsed = new Set<string>();
  for (const row of rows) {
    const session = sessionByRow.get(row.id);
    if (session !== undefined && !standsFor.has(session)) standsFor.set(session, row.id);
  }
  for (const row of rows) {
    // a later claimant of the same session has no claim, and a claim of a
    // session nothing here has ever stood for changes nothing
    const claim = succeedsByRow.get(row.id);
    if (claim === undefined || successorOf.has(claim)) continue;
    if (!standsFor.has(claim) && !lineage.bySession.has(claim)) continue;
    successorOf.set(claim, row.id);
    claimOf.set(row.id, claim);
  }
  // a row that inherited a body and no longer claims it, while the row it took
  // it from stands and was hidden last frame: the wire's lapse (a rollback on
  // the peer reads here as one), so each takes its own body back. Gone, or
  // drawn last frame (retained), the predecessor leaves the row the body it wears.
  for (const row of rows) {
    const was = lineage.inherited.get(row.id);
    if (was === undefined || claimOf.get(row.id) === was) continue;
    const back = standsFor.get(was);
    if (back === undefined || back === row.id || previous.has(back)) continue;
    if (!claimOf.has(row.id)) lapsed.add(row.id);
    if (!successorOf.has(was)) restored.set(back, lineage.bySession.get(was) ?? back);
  }
  return {
    reading(row) {
      const session = sessionByRow.get(row.id);
      const heir = session === undefined ? undefined : successorOf.get(session);
      if (heir !== undefined && heir !== row.id) {
        // the owner kept a predecessor that was typed into: the successor keeps
        // the body, and it gets one of its own (`pane-transitions.ts:64-67`)
        return row.inputUsed === true ? wears(`retained:${row.id}`) : HIDDEN;
      }
      const claim = claimOf.get(row.id);
      if (claim !== undefined) {
        const kept = lineage.inherited.get(row.id) === claim ? previous.get(row.id) : undefined;
        const first = standsFor.get(claim);
        return wears(
          kept ??
            lineage.bySession.get(claim) ??
            (first === undefined ? undefined : previous.get(first)) ??
            first ??
            claim,
        );
      }
      if (lapsed.has(row.id)) return wears(row.id);
      const body = restored.get(row.id);
      return body === undefined ? OWN : wears(body);
    },
    next(drawn, visuals) {
      const bySession = new Map(lineage.bySession);
      const standing = new Set<string>();
      const written = new Set<string>();
      for (const row of rows) {
        const session = sessionByRow.get(row.id);
        if (session === undefined) continue;
        standing.add(session);
        if (written.has(session)) continue;
        const body = drawn.get(row.id);
        if (body !== undefined) {
          bySession.set(session, body);
          written.add(session);
          continue;
        }
        const heir = successorOf.get(session);
        const heirBody = heir === undefined || heir === row.id ? undefined : visuals.get(heir);
        if (heirBody !== undefined) {
          // hidden as succeeded: the body goes on in its successor
          bySession.set(session, heirBody);
          written.add(session);
        }
      }
      const departed = lineage.departed.filter((session) => !standing.has(session));
      for (const session of [...bySession.keys()].sort()) {
        if (!standing.has(session) && !departed.includes(session)) departed.push(session);
      }
      while (departed.length > DEPARTED_LIMIT) {
        const gone = departed.shift();
        if (gone !== undefined) bySession.delete(gone);
      }
      const inherited = new Map([...claimOf].filter(([row]) => drawn.has(row)));
      return { bySession, departed, inherited };
    },
  };
}
