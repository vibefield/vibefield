// @vitest-environment happy-dom
/**
 * Item 578 — DOWNLOAD… (DESIGN.md §8 "The bar grown"): the desk's half. The row is offered for exactly one selected
 * print whose picture this desk holds in a format the save door takes, and only where a save door exists; taking it
 * hands the door the picture's bytes as held, and says on the line "Saved to ‹folder›" or the one sentence for a
 * picture that could not be saved. A cancelled panel says nothing.
 */
import { type Entity, PrefabId } from "@vibecook/ice";
import { NOTE_TYPE, PHOTO_TYPE } from "@vibecook/ice/desk/objects";
import { IPC_CHANNELS, type PictureSaveResult } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_WORDS,
  downloadable,
  downloadablePicture,
  downloadPrint,
} from "../src/field/desk/bar/print-download";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const RAW = new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
const PROPS = Symbol("photo props");

interface Laid {
  readonly type: string;
  readonly blob?: string;
}

/** A desk of doubles: each entity's type and, for a print, the cell its `blob` is kept in. */
function deskOf(laid: readonly Laid[]) {
  const entities = laid.map((_, index) => (index + 1) as Entity);
  const engine = {
    world: {
      get: (entity: Entity, component: unknown) => {
        const one = laid[(entity as number) - 1];
        if (one === undefined) return undefined;
        if (component === PrefabId) return { id: one.type };
        if (component === PROPS && one.type === PHOTO_TYPE)
          return { blob: one.blob ?? "", width: 4, height: 3, angle: 0 };
        return undefined;
      },
    },
    catalog: {
      widget: (type: string) =>
        type === PHOTO_TYPE ? { groups: [{ component: PROPS }] } : { groups: [] },
    },
  };
  return { desk: { engine } as never, entities };
}

const memoryStore = () => createDeskBlobStore({ root: async () => undefined });

/** A save door that answers `result` and keeps what it was handed. */
function doorOf(result: PictureSaveResult | Error) {
  const asked: Uint8Array[] = [];
  const host = {
    pictures: {
      save: async (bytes: Uint8Array<ArrayBuffer>): Promise<PictureSaveResult> => {
        asked.push(bytes);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  return { host, asked };
}

describe("what the desk's byte store holds now (item 578)", () => {
  it("answers a picture this page has met with no read, and nothing for one it has not", async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(PNG, "image/png");
    expect(blobs.held(hash)).toEqual({ bytes: PNG, type: "image/png" });
    expect(blobs.held("0".repeat(64))).toBeUndefined();
    expect(blobs.held("not a hash")).toBeUndefined();
  });
});

describe("the print the Download row is offered for (item 578)", () => {
  it("is exactly one selected print whose picture the desk holds", async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(PNG, "image/png");
    const { desk, entities } = deskOf([{ type: PHOTO_TYPE, blob: hash }]);
    expect(downloadablePicture(desk, entities, blobs)).toEqual({ bytes: PNG, type: "image/png" });
  });

  it("is none for two objects, another kind, a print with no picture, or one whose bytes are not here", async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(PNG, "image/png");
    const two = deskOf([
      { type: PHOTO_TYPE, blob: hash },
      { type: PHOTO_TYPE, blob: hash },
    ]);
    expect(downloadablePicture(two.desk, two.entities, blobs)).toBeNull();
    const note = deskOf([{ type: NOTE_TYPE }]);
    expect(downloadablePicture(note.desk, note.entities, blobs)).toBeNull();
    const empty = deskOf([{ type: PHOTO_TYPE }]);
    expect(downloadablePicture(empty.desk, empty.entities, blobs)).toBeNull();
    const elsewhere = deskOf([{ type: PHOTO_TYPE, blob: "a".repeat(64) }]);
    expect(downloadablePicture(elsewhere.desk, elsewhere.entities, blobs)).toBeNull();
    expect(downloadablePicture(note.desk, [], blobs)).toBeNull();
  });

  it("is none for a picture in a format the save door does not take", async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(RAW, "image/x-ice-rgba");
    const { desk, entities } = deskOf([{ type: PHOTO_TYPE, blob: hash }]);
    expect(downloadablePicture(desk, entities, blobs)).toBeNull();
  });

  it("is offered only where a save door exists", async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(PNG, "image/png");
    const { desk, entities } = deskOf([{ type: PHOTO_TYPE, blob: hash }]);
    const { host } = doorOf({ status: "cancelled" });
    expect(downloadable(desk, entities, { blobs, host })).toBe(true);
    expect(downloadable(desk, entities, { blobs, host: null })).toBe(false);
    expect(downloadable(desk, entities, { blobs, host: {} })).toBe(false);
    const note = deskOf([{ type: NOTE_TYPE }]);
    expect(downloadable(note.desk, note.entities, { blobs, host })).toBe(false);
  });
});

describe("taking the Download row (item 578)", () => {
  const laid = async () => {
    const blobs = memoryStore();
    const hash = await blobs.put(PNG, "image/png");
    return { blobs, ...deskOf([{ type: PHOTO_TYPE, blob: hash }]) };
  };

  it("hands the door the picture as held and says where it was saved", async () => {
    const { blobs, desk, entities } = await laid();
    const { host, asked } = doorOf({ status: "saved", folder: "Downloads" });
    const said: string[] = [];
    const outcome = await downloadPrint(desk, {
      blobs,
      host,
      selected: entities,
      say: (words) => said.push(words),
    });
    expect(outcome).toBe("saved");
    expect(asked).toEqual([PNG]);
    expect(said).toEqual(["Saved to Downloads"]);
    expect(DOWNLOAD_WORDS.saved("")).toBe("Saved");
  });

  it("says nothing when the panel was cancelled", async () => {
    const { blobs, desk, entities } = await laid();
    const { host } = doorOf({ status: "cancelled" });
    const said: string[] = [];
    expect(
      await downloadPrint(desk, { blobs, host, selected: entities, say: (w) => said.push(w) }),
    ).toBe("cancelled");
    expect(said).toEqual([]);
  });

  it("says the one sentence for every picture that could not be saved, and never the cause", async () => {
    const { blobs, desk, entities } = await laid();
    const said: string[] = [];
    // the bridge's own error, as Electron words it: it names the channel and may name a path
    const bridge = `Error invoking remote method '${IPC_CHANNELS.pictureSave}': Error: EACCES /a/b`;
    const answers: (PictureSaveResult | Error)[] = [
      { status: "refused", reason: "failed" },
      { status: "refused", reason: "too-large", bytes: 99 },
      { status: "refused", reason: "not-a-picture" },
      { status: "refused", reason: "busy" },
      new Error(bridge),
    ];
    for (const answer of answers) {
      const { host } = doorOf(answer);
      expect(
        await downloadPrint(desk, { blobs, host, selected: entities, say: (w) => said.push(w) }),
      ).toBe("failed");
    }
    expect(said).toEqual(
      answers.map(() => "Couldn't save this picture. Try again, or choose another place."),
    );
  });

  it("does nothing where the row was offered in vain: no print, no picture here, no door", async () => {
    const { blobs, desk, entities } = await laid();
    const { host, asked } = doorOf({ status: "saved", folder: "Downloads" });
    const said: string[] = [];
    const say = (words: string) => said.push(words);
    const note = deskOf([{ type: NOTE_TYPE }]);
    expect(await downloadPrint(note.desk, { blobs, host, selected: note.entities, say })).toBe(
      "none",
    );
    expect(await downloadPrint(desk, { blobs, host: null, selected: entities, say })).toBe("none");
    expect(await downloadPrint(desk, { blobs: memoryStore(), host, selected: entities, say })).toBe(
      "none",
    );
    expect(asked).toEqual([]);
    expect(said).toEqual([]);
  });
});
