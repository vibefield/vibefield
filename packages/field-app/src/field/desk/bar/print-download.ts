import { type CanvasEngine, type Entity, PrefabId, selectedEntities } from "@vibecook/ice";
import type { StoredBlob } from "@vibecook/ice/desk/kit";
import { PHOTO_TYPE } from "@vibecook/ice/desk/objects";
import { type PictureSaveResult, pictureSaveTypeOf } from "@vibefield/contracts";
import { sayOnLine } from "../../../frame/line-door";
import { type FieldHost, peekHost } from "../../../host";
import { getRendererLogger } from "../../../logging";
import { type DeskBlobStore, deskBlobs } from "../desk-blobs";

// DOWNLOAD… (item 578, 2026-11-19; DESIGN.md §8 "The bar grown"). The grown menu's row for ONE selected print whose
// picture this desk holds: the picture is saved where the person chooses, as the desk holds it, never re-encoded.
// The save is main's (a page may not write the person's disk): this hands the host's door the picture's bytes and
// nothing else, and main reads their format, makes the name and opens its own save panel. So the row is offered only
//  · for exactly one selected object that is a print (`desk.photo`) naming a picture (its `blob`),
//  · whose bytes the desk's store holds NOW (a print still waiting for its picture offers none),
//  · in a format the save door takes (`pictureSaveTypeOf`: a format it would refuse is never offered),
//  · where a save door exists (a harness without the shell has no disk to save to).
// Taped or on a desk one can only read, it is still offered: saving moves nothing. It is the HOST's act, like Make a
// card and Comment, never a kind's: it runs no engine op and writes nothing to the document.
// Its words, said once on the status line: "Saved to ‹folder›" with the folder's own name, or the one sentence for a
// picture that could not be saved, whatever the cause; the cause goes to the log. A cancelled panel says nothing.

export const DOWNLOAD_WORDS = {
  /** the folder's own name, never a path; a disk's own top has none, and then no place is named */
  saved: (folder: string): string => (folder === "" ? "Saved" : `Saved to ${folder}`),
  failed: "Couldn't save this picture. Try again, or choose another place.",
} as const;

/** What a download reads the desk through: its engine, nothing else of the mount. */
export interface DownloadDesk {
  readonly engine: Pick<CanvasEngine, "world" | "catalog">;
}

export interface DownloadSeams {
  /** the desk's byte store (left out: the page's one store) */
  readonly blobs?: Pick<DeskBlobStore, "held">;
  /** the save door's host (undefined: the window's; null: none) */
  readonly host?: Pick<FieldHost, "pictures"> | null;
  /** the selection (left out: the engine's own, read now) */
  readonly selected?: readonly Entity[];
  /** the status line (left out: the frame's) */
  readonly say?: (words: string) => void;
}

/** A cell of a print's props, as far as this reads it. */
type BlobCell = { readonly blob?: unknown } | undefined;

/** The hash a print names its picture by: its `blob` cell, read from its type's own groups. "" when it names none. */
function blobOf(engine: DownloadDesk["engine"], entity: Entity): string {
  for (const group of engine.catalog.widget(PHOTO_TYPE)?.groups ?? []) {
    const cell = engine.world.get(entity, group.component) as BlobCell;
    if (typeof cell?.blob === "string") return cell.blob;
  }
  return "";
}

/** The one selected print's picture as this desk holds it, in a format the save door takes; null for anything else. */
export function downloadablePicture(
  desk: DownloadDesk,
  entities: readonly Entity[],
  blobs: Pick<DeskBlobStore, "held"> = deskBlobs(),
): StoredBlob | null {
  const one = entities[0];
  if (entities.length !== 1 || one === undefined) return null;
  if (desk.engine.world.get(one, PrefabId)?.id !== PHOTO_TYPE) return null;
  const hash = blobOf(desk.engine, one);
  const picture = hash === "" ? undefined : blobs.held(hash);
  return picture === undefined || pictureSaveTypeOf(picture.bytes) === null ? null : picture;
}

const doorOf = (seams: DownloadSeams): FieldHost["pictures"] =>
  (seams.host === undefined ? peekHost() : seams.host)?.pictures;

/** Whether the Download row is offered for this selection: a save door exists, and the selection is one print whose
 * picture it can save. Asked each time the bar reads the selection, so it reads no file and makes nothing. */
export function downloadable(
  desk: DownloadDesk,
  entities: readonly Entity[],
  seams: DownloadSeams = {},
): boolean {
  if (entities.length !== 1 || doorOf(seams) === undefined) return false;
  return downloadablePicture(desk, entities, seams.blobs) !== null;
}

export type DownloadOutcome = "saved" | "cancelled" | "failed" | "none";

/** Take the row: the selected print's picture through the host's save door, and the line told what became of it.
 * `none`: the row was offered in vain (the selection changed under it), and nothing is asked or said. */
export async function downloadPrint(
  desk: DownloadDesk,
  seams: DownloadSeams = {},
): Promise<DownloadOutcome> {
  const door = doorOf(seams);
  const selected = seams.selected ?? selectedEntities(desk.engine.world);
  const picture = door === undefined ? null : downloadablePicture(desk, selected, seams.blobs);
  if (door === undefined || picture === null) return "none";
  const say = seams.say ?? sayOnLine;
  const failed = (reason: string): DownloadOutcome => {
    getRendererLogger()
      .child({ component: "desk.download" })
      .warn("renderer.desk.picture_save_failed", "A print's picture was not saved", { reason });
    say(DOWNLOAD_WORDS.failed);
    return "failed";
  };
  let result: PictureSaveResult;
  try {
    result = await door.save(picture.bytes);
  } catch {
    // the bridge's own error names a channel and may name a path: the log is told that it threw, nothing more
    return failed("door-threw");
  }
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "refused") return failed(result.reason);
  say(DOWNLOAD_WORDS.saved(result.folder));
  return "saved";
}
