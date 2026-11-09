import { type FieldHost, peekHost } from "../../host";
import type { Face } from "./cards-model";

// A PICTURE BECOMES A FILE AT THE PLAY (OB-D10 A, §4.4): a pane or a draft takes a picture as its file's path, and a desk
// object's picture lives in the window as bytes until then. Every place a picture is played goes through here, so "written
// when it is played, and never before" stays one sentence.

/** This face with its file: as it is when it needs none (or has one); the picture written through main to the hand's folder
 * when it holds only bytes; null when main could not write it. */
export async function withPictureFile(
  face: Face,
  host: Pick<FieldHost, "writeHandPicture"> | null | undefined = peekHost(),
): Promise<Face | null> {
  if (face.type !== "image" || face.path !== undefined || face.bytes === undefined) return face;
  const write = host?.writeHandPicture;
  if (write === undefined) return null;
  const path = await write(new Uint8Array(await face.bytes.arrayBuffer()));
  return path === null ? null : { ...face, path };
}
