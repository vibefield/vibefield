// DS-L3 — a rows snapshot in pages: the ONE pager for every source of the
// rows shape (`contracts/src/rows.ts`; design-06 §8). A snapshot above
// `ROWS.SNAPSHOT_PAGE_BYTES` goes out as pages at one `{epoch, revision}`,
// every page but the last saying `more: true`.
//
// Item 60 (2026-10-26) — moved here from catalog-rows.ts so the revisioned
// path's doors page by the same rule (`RevisionedSubscription`'s `pages`; the
// session tail first): one declared shape, one pager. Rows follow the asker,
// bytes follow the link (registries.ts, `WS_MAX_INBOUND_BYTES`).

/** The envelope a snapshot page or a delta adds around its rows, counted
 * generously so a page stays under its budget once framed. */
export const FRAME_OVERHEAD_BYTES = 512;

/** A row and its encoded size, the page meter. */
export interface MeteredRow<Row> {
  readonly row: Row;
  readonly bytes: number;
}

/** One page: the snapshot's own members, its share of the rows, and which page
 * of how many it is. `page`/`pages` are passthrough members over the base's
 * shape: a reader that assembles by `more` alone assumes pages arrive in order,
 * and one path does not deliver them so — FielddClient hands a replayed
 * subscribe's OPEN answer (page 0) to its listener after the continuation
 * pages that followed it on the wire. With the index a reader assembles any
 * order. */
export type SnapshotPage<Base, Row> = Base & {
  rows: Row[];
  more?: true;
  page: number;
  pages: number;
};

/** The snapshot `base` over `rows` as pages under `pageBytes`. A single row
 * larger than a page travels alone; no rows is one empty page. */
export function snapshotPages<Base extends object, Row>(
  base: Base,
  rows: Iterable<MeteredRow<Row>>,
  pageBytes: number,
): SnapshotPage<Base, Row>[] {
  const chunks: Row[][] = [];
  let chunk: Row[] = [];
  let bytes = FRAME_OVERHEAD_BYTES;
  for (const held of rows) {
    if (chunk.length > 0 && bytes + held.bytes + 1 > pageBytes) {
      chunks.push(chunk);
      chunk = [];
      bytes = FRAME_OVERHEAD_BYTES;
    }
    chunk.push(held.row);
    bytes += held.bytes + 1;
  }
  chunks.push(chunk);
  return chunks.map((pageRows, page) => ({
    ...base,
    rows: pageRows,
    ...(page < chunks.length - 1 ? { more: true as const } : {}),
    page,
    pages: chunks.length,
  }));
}

/** A row metered by its JSON encoding, for a source that holds no encodings of
 * its own. */
export function meterRow<Row>(row: Row): MeteredRow<Row> {
  return { row, bytes: Buffer.byteLength(JSON.stringify(row), "utf8") };
}
