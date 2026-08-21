// A STANDALONE SCENE REPLICA — the apply stage, reimplemented.
//
// READ THIS BEFORE QUOTING A NUMBER FROM IT. The shipped worker's own
// `applyFrame` CANNOT be exercised from Node, and that is a fact about the
// artifact rather than a guess: `terminal-render.worker.js` is a flat esbuild
// bundle with ZERO export statements whose last line is `self.onmessage = ...`
// (line 3404 of 3565). There is no module surface to import, and the entry it
// does expose needs `self`, a renderer, and a WebGPU device. So the microbench
// measures **decode + standalone apply**, never "the worker's apply".
//
// What IS the worker's own code, and therefore honest to attribute:
//   * `decodeFrame` and every section decoder — imported from
//     `@vibecook/ghosttea-frame`, which the worker bundle INLINES verbatim (its
//     first line is `// ../ghosttea-frame/dist/index.js`). The decode stage's
//     numbers are the shipping decoder's.
// What is OURS, and therefore a model:
//   * the replica bookkeeping below — row storage, catalog merge, frame
//     classification. It follows the worker's shape (`applyFrame`, worker
//     lines 3203-3280: classify, find the five sections, decode glyphs/styles,
//     reset the catalog on a full frame or a resync, then write rows) closely
//     enough to be representative and is NOT the same code. A gap between this
//     number and the in-app `frameApplyMs` lane is expected, and the baseline
//     reports both rather than picking one.
import {
  decodeCursorState,
  decodeFrame,
  decodeGlyphDefinitions,
  decodeRowReplacements,
  decodeStyleDefinitions,
  type GlyphDefinition,
  SectionKind,
  type StyleDefinition,
  type TerminalFrame,
} from "@vibecook/ghosttea-frame";

/** `FrameFlag` (ghosttea-frame/dist/index.js:6-10).
 *
 * `FullSnapshot` is read by `classify` only. It deliberately plays no part in
 * the catalog-reset decision — see the comment at that decision for why. */
const FLAG_FULL_SNAPSHOT = 1 << 0;
const FLAG_CATALOG_RESET = 1 << 2;

interface ReplicaRow {
  revision: bigint;
  text: string;
  /** Packed glyph instances: 8 fields per glyph, the layout the renderer's
   * geometry builder consumes. A packed array rather than an object array for
   * the same reason the worker uses one — per-frame objects are what makes a
   * decode path allocate, and §18.4 requires the decode to be GC-free. */
  glyphs: Int32Array;
  glyphCount: number;
  /** Packed style runs: 3 fields per run. */
  styles: Int32Array;
  styleCount: number;
}

const GLYPH_FIELDS = 8;
const STYLE_FIELDS = 3;

export interface SessionReplica {
  sessionEpoch: bigint;
  layoutEpoch: bigint;
  sequence: bigint;
  awaitingResync: boolean;
  cols: number;
  rows: ReplicaRow[];
  glyphDefinitions: Map<number, GlyphDefinition>;
  styleDefinitions: Map<number, StyleDefinition>;
  cursor: { x: number; y: number; visible: boolean };
}

export function emptyReplica(): SessionReplica {
  return {
    sessionEpoch: 0n,
    layoutEpoch: 0n,
    sequence: 0n,
    awaitingResync: false,
    cols: 0,
    rows: [],
    glyphDefinitions: new Map(),
    styleDefinitions: new Map(),
    cursor: { x: 0, y: 0, visible: false },
  };
}

export type FrameClass = "apply" | "stale" | "resync";

/** The worker's `classifyFrame` shape: a frame from an older epoch is stale; a
 * sequence gap on a non-full frame needs a resync; otherwise apply. */
export function classify(replica: SessionReplica, frame: TerminalFrame): FrameClass {
  const full = (frame.flags & FLAG_FULL_SNAPSHOT) !== 0;
  if (replica.sessionEpoch !== 0n && frame.sessionEpoch < replica.sessionEpoch) return "stale";
  if (frame.sessionEpoch === replica.sessionEpoch && frame.frameSequence <= replica.sequence) {
    return "stale";
  }
  if (full) return "apply";
  if (replica.awaitingResync) return "resync";
  if (
    replica.sequence !== 0n &&
    frame.sessionEpoch === replica.sessionEpoch &&
    frame.frameSequence > replica.sequence + 1n
  ) {
    return "resync";
  }
  return "apply";
}

export interface ApplyOutcome {
  readonly klass: FrameClass;
  readonly rowsApplied: number;
  readonly glyphsDefined: number;
}

/**
 * Apply one decoded frame to a replica.
 *
 * Mirrors the worker's ordering: classify, locate the sections, decode the
 * catalog sections, reset on a full frame or a catalog reset, then write the
 * row replacements. Rows are grown, never reallocated per frame.
 */
export function applyDecodedFrame(replica: SessionReplica, frame: TerminalFrame): ApplyOutcome {
  const klass = classify(replica, frame);
  if (klass !== "apply") {
    if (klass === "resync") replica.awaitingResync = true;
    return { klass, rowsApplied: 0, glyphsDefined: 0 };
  }

  const catalogReset = (frame.flags & FLAG_CATALOG_RESET) !== 0;
  const changedSession = replica.sessionEpoch !== 0n && frame.sessionEpoch !== replica.sessionEpoch;

  const rowSection = frame.sections.find((s) => s.kind === SectionKind.RowReplacements);
  const cursorSection = frame.sections.find((s) => s.kind === SectionKind.CursorState);
  const glyphSection = frame.sections.find((s) => s.kind === SectionKind.GlyphDefinitions);
  const styleSection = frame.sections.find((s) => s.kind === SectionKind.StyleDefinitions);
  if (!rowSection || !cursorSection) {
    replica.sequence = frame.frameSequence;
    replica.sessionEpoch = frame.sessionEpoch;
    return { klass, rowsApplied: 0, glyphsDefined: 0 };
  }

  const glyphDefinitions = glyphSection ? decodeGlyphDefinitions(glyphSection) : [];
  const styleDefinitions = styleSection ? decodeStyleDefinitions(styleSection) : [];

  // The reset condition is the worker's, and it is NOT "this frame is full":
  // `const resetsCatalog = changedSession || completingResync || catalogReset`
  // (terminal-render.worker.js:3266). A full snapshot re-sends every ROW while
  // still referencing glyphs the catalog already holds — the cell only ships a
  // GlyphDefinitions section when new glyphs appear — so clearing the catalog on
  // every full frame throws away definitions nothing will re-send. An earlier
  // draft did exactly that and left `yes-flood` (154 consecutive full frames)
  // with an empty catalog; `replica.test.ts` reds on it.
  const completingResync = replica.awaitingResync;
  if (catalogReset || changedSession || completingResync) {
    replica.rows = [];
    replica.glyphDefinitions.clear();
    replica.styleDefinitions.clear();
    replica.awaitingResync = false;
  }
  for (const definition of glyphDefinitions)
    replica.glyphDefinitions.set(definition.id, definition);
  for (const definition of styleDefinitions)
    replica.styleDefinitions.set(definition.id, definition);

  const cursor = decodeCursorState(cursorSection);
  replica.cursor.x = cursor.x;
  replica.cursor.y = cursor.y;
  replica.cursor.visible = cursor.visible;

  const replacements = decodeRowReplacements(rowSection);
  replica.cols = frame.cols;
  if (replica.rows.length < frame.rows) {
    for (let index = replica.rows.length; index < frame.rows; index += 1) {
      replica.rows.push({
        revision: 0n,
        text: "",
        glyphs: new Int32Array(0),
        glyphCount: 0,
        styles: new Int32Array(0),
        styleCount: 0,
      });
    }
  }

  for (const replacement of replacements) {
    const row = replica.rows[replacement.row];
    if (row === undefined) continue;
    row.revision = replacement.revision;
    row.text = replacement.text;

    const glyphs = replacement.glyphs;
    if (row.glyphs.length < glyphs.length * GLYPH_FIELDS) {
      row.glyphs = new Int32Array(glyphs.length * GLYPH_FIELDS);
    }
    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index] as (typeof glyphs)[number];
      const base = index * GLYPH_FIELDS;
      row.glyphs[base] = glyph.glyphId;
      row.glyphs[base + 1] = glyph.styleId;
      row.glyphs[base + 2] = glyph.x;
      row.glyphs[base + 3] = glyph.y;
      row.glyphs[base + 4] = glyph.width;
      row.glyphs[base + 5] = glyph.height;
      row.glyphs[base + 6] = glyph.cellStart;
      row.glyphs[base + 7] = glyph.cellSpan;
    }
    row.glyphCount = glyphs.length;

    const styles = replacement.styles;
    if (row.styles.length < styles.length * STYLE_FIELDS) {
      row.styles = new Int32Array(styles.length * STYLE_FIELDS);
    }
    for (let index = 0; index < styles.length; index += 1) {
      const run = styles[index] as (typeof styles)[number];
      const base = index * STYLE_FIELDS;
      row.styles[base] = run.styleId;
      row.styles[base + 1] = run.cellStart;
      row.styles[base + 2] = run.cellSpan;
    }
    row.styleCount = styles.length;
  }

  replica.sessionEpoch = frame.sessionEpoch;
  replica.layoutEpoch = frame.layoutEpoch;
  replica.sequence = frame.frameSequence;
  return { klass, rowsApplied: replacements.length, glyphsDefined: glyphDefinitions.length };
}

/** Decode a frame body. Separated so the bench can time decode alone. */
export function decodeFrameBody(bytes: Uint8Array): TerminalFrame {
  // `decodeFrame` takes an ArrayBuffer and indexes it from 0, so a subarray
  // view must be materialised. This copy is charged to DECODE deliberately: the
  // worker receives each frame as its own transferred ArrayBuffer and pays no
  // such copy, so the bench's decode number is a CEILING, not a like-for-like.
  // Reporting it as the decoder's cost without this note would overstate it.
  return decodeFrame(
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer),
  );
}
