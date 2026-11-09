// @vitest-environment node
/**
 * A face made ready at the play: a picture or a file written through main, oversized words read then, and a face whose
 * object has gone said in words.
 */
import { describe, expect, it } from "vitest";
import {
  type FileFace,
  type ImageFace,
  pictureFaceOf,
  type TextFace,
} from "../src/frame/cards/cards-model";
import { OUTCOME_WORDS } from "../src/frame/cards/cards-words";
import { readyFace } from "../src/frame/cards/face-ready";

const PNG: ImageFace = pictureFaceOf({
  width: 2,
  height: 2,
  src: "blob:p",
  bytes: new Blob([new Uint8Array([1])]),
});
const TEXT: TextFace = {
  id: "words",
  type: "text",
  label: "Its words",
  format: "plain",
  text: "",
  show: { as: "words", title: "", body: "", bare: true },
};
const FILE: FileFace = { id: "opml", type: "file", label: "OPML", name: "Q3 plan.opml" };

describe("readyFace", () => {
  it("passes a face that needs nothing straight through", async () => {
    const face: ImageFace = { ...PNG, path: "/tmp/a.png" };
    await expect(readyFace(face, {})).resolves.toEqual({ ok: true, face });
  });

  it("writes a picture held only as bytes, and answers its path", async () => {
    const ready = await readyFace(PNG, { writeHandPicture: async () => "/h/1.png" });
    expect(ready).toMatchObject({ ok: true, face: { path: "/h/1.png" } });
  });

  it("says so when main could not write the picture, or there is no shell to write through", async () => {
    await expect(readyFace(PNG, { writeHandPicture: async () => null })).resolves.toEqual({
      ok: false,
      note: OUTCOME_WORDS.pictureNotWritten,
    });
    await expect(readyFace(PNG, {})).resolves.toEqual({
      ok: false,
      note: OUTCOME_WORDS.pictureNotWritten,
    });
  });

  it("reads oversized words at the play, and says gone when the object has gone", async () => {
    const ready = await readyFace({ ...TEXT, atPlay: () => "fresh" }, {});
    expect(ready).toMatchObject({ ok: true, face: { text: "fresh" } });
    expect(ready.ok && "atPlay" in ready.face).toBe(false);
    await expect(readyFace({ ...TEXT, atPlay: () => null }, {})).resolves.toEqual({
      ok: false,
      note: OUTCOME_WORDS.faceGone,
    });
  });

  it("writes a file at the play under its own name", async () => {
    const wrote: Array<[string, string]> = [];
    const ready = await readyFace(
      { ...FILE, atPlay: () => "<opml/>" },
      {
        writeHandFile: async (name, text) => {
          wrote.push([name, text]);
          return "/h/1-Q3 plan.opml";
        },
      },
    );
    expect(wrote).toEqual([["Q3 plan.opml", "<opml/>"]]);
    expect(ready).toMatchObject({ ok: true, face: { path: "/h/1-Q3 plan.opml" } });
  });

  it("says gone for a file whose object has gone, or whose handler throws, and not written for a door that failed", async () => {
    const gone = { ok: false, note: OUTCOME_WORDS.faceGone };
    await expect(readyFace({ ...FILE, atPlay: () => null }, {})).resolves.toEqual(gone);
    await expect(
      readyFace(
        {
          ...FILE,
          atPlay: () => {
            throw new Error("no");
          },
        },
        {},
      ),
    ).resolves.toEqual(gone);
    await expect(
      readyFace({ ...FILE, atPlay: () => "x" }, { writeHandFile: async () => null }),
    ).resolves.toEqual({ ok: false, note: OUTCOME_WORDS.fileNotWritten });
  });
});
