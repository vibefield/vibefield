import type { ReactElement } from "react";
import "./history-space.css";

// WHAT HISTORY KEEPS ON THIS MAC (track IM, IM-1; track HD, HD-1; DESIGN.md §8 "History", the import's sign — "On
// this Mac"; §8 "Settings → History"). What was read and what is kept, one bar of the four parts on one scale, their
// legend, and the index's memory in use. It is drawn in two places from two readings of the same measure (rosetta's
// `storage` and `memory`, IM-D4): the import sign's panel hands it the room's own words (`ImportSignSpace`, R11), and
// Settings → History the ones it reads through `index.status` (`panels/history-space.ts`). Plain data in, no door.

/** One part of what is kept: the room's `ImportSignPart`, structurally. */
export interface HistorySpacePart {
  readonly key: "record" | "archive" | "search" | "media";
  readonly name: string;
  readonly note: string;
  /** its size as said ("3.70 GB"; "—" while it holds nothing) */
  readonly size: string;
  /** its bytes on disk, and in memory (the archive's, while it is built there) */
  readonly disk: number;
  readonly memory: number;
}

/** What the drawing reads: the room's `ImportSignSpace`, structurally. */
export interface HistorySpaceFacts {
  /** what this start read from the agents; null when it read nothing, or where nobody counts it */
  readonly read: string | null;
  /** what is kept on disk: the four parts together */
  readonly kept: string;
  /** the archive's share still in memory while the import builds it there */
  readonly inMemory: string | null;
  readonly parts: readonly HistorySpacePart[];
  /** the index's own memory in use; null where the platform does not say */
  readonly memory: string | null;
}

/** The bar's share of one part: its bytes over the scale every part is drawn on. */
function share(bytes: number, scale: number): string {
  return `${((bytes / scale) * 100).toFixed(2)}%`;
}

export function HistorySpace({ space }: { space: HistorySpaceFacts }): ReactElement {
  const scale = Math.max(
    1,
    space.parts.reduce((sum, part) => sum + part.disk + part.memory, 0),
  );
  return (
    <div className="vf-history-space">
      <div className="vf-history-space-figures">
        {space.read !== null && (
          <div>
            <span>Read from your agents</span>
            <b>{space.read}</b>
          </div>
        )}
        <div>
          <span>Kept on disk</span>
          <b>
            {space.kept}
            {space.inMemory !== null && <small> + {space.inMemory} in memory</small>}
          </b>
        </div>
      </div>
      <span className="vf-history-space-bar" aria-hidden="true">
        {space.parts.flatMap((part) => [
          part.disk > 0 ? (
            <i
              key={`${part.key}-disk`}
              data-part={part.key}
              style={{ width: share(part.disk, scale) }}
            />
          ) : null,
          part.memory > 0 ? (
            <i
              key={`${part.key}-memory`}
              data-part={part.key}
              data-memory=""
              style={{ width: share(part.memory, scale) }}
            />
          ) : null,
        ])}
      </span>
      <ul className="vf-history-space-legend">
        {space.parts.map((part) => (
          <li
            key={part.key}
            data-part={part.key}
            {...(part.memory > 0 && part.disk === 0 ? { "data-memory": "" } : {})}
          >
            <i aria-hidden="true" />
            <span>
              {part.name} <small>· {part.note}</small>
            </span>
            <b>{part.size}</b>
          </li>
        ))}
      </ul>
      {space.memory !== null && (
        <p className="vf-history-space-memory">
          <span>Memory in use</span>
          <b>{space.memory}</b>
        </p>
      )}
    </div>
  );
}
