import { type FieldHost, peekHost } from "../../host";
import type { Face } from "./cards-model";
import { OUTCOME_WORDS } from "./cards-words";

// A FACE MADE READY AT THE PLAY (OB-D10 A, §4.4; `studies/kit.md`, press vs play). What is cheap or must be taken at the press is
// on the card already; what is not is produced here, when the person plays it: a picture held only as bytes and a file are written
// through main to the hand's folder, and words over the press's budget are read from the object as it is now. Every place a
// card is played goes through here, so "made when it is played, and never before" stays one sentence.

export type FaceReady =
  | { readonly ok: true; readonly face: Face }
  | { readonly ok: false; readonly note: string };

type Doors = Pick<FieldHost, "writeHandPicture" | "writeHandFile">;

/** What a face's producer gives now; null when its object has gone or its handler threw. */
function produced(read: () => string | null): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** This face, ready to give what it gives; or, in words, why it can't be. */
export async function readyFace(
  face: Face,
  host: Doors | null | undefined = peekHost(),
): Promise<FaceReady> {
  if (face.type === "image" && face.path === undefined && face.bytes !== undefined) {
    const write = host?.writeHandPicture;
    const path =
      write === undefined ? null : await write(new Uint8Array(await face.bytes.arrayBuffer()));
    return path === null
      ? { ok: false, note: OUTCOME_WORDS.pictureNotWritten }
      : { ok: true, face: { ...face, path } };
  }
  if (face.type === "text" && face.atPlay !== undefined) {
    const text = produced(face.atPlay);
    if (text === null) return { ok: false, note: OUTCOME_WORDS.faceGone };
    const { atPlay: _read, ...rest } = face;
    return { ok: true, face: { ...rest, text } };
  }
  if (face.type === "file" && face.path === undefined && face.atPlay !== undefined) {
    const body = produced(face.atPlay);
    if (body === null) return { ok: false, note: OUTCOME_WORDS.faceGone };
    const write = host?.writeHandFile;
    const path = write === undefined ? null : await write(face.name, body);
    if (path === null) return { ok: false, note: OUTCOME_WORDS.fileNotWritten };
    const { atPlay: _read, ...rest } = face;
    return { ok: true, face: { ...rest, path } };
  }
  return { ok: true, face };
}
