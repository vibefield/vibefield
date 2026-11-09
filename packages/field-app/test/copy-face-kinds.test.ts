/**
 * OB-D2 — the faces a card of a desk object carries, from the kind's agent half: a built-in's or a plugin's declaration, in
 * the kind's order. No agent half, Picture only and no Live. `text` is read at the press unless it is over budget; `file`
 * always waits for the play; a face that cannot be produced then says `gone` (null).
 */
import { OBJECT_LIMITS, type ObjectRef } from "@vibefield/contracts";
import type { AgentHalf } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { type CopiedObject, kindFacesOf } from "../src/field/desk/copy/copy-face";
import type { FileFace, ImageFace, RefFace, TextFace } from "../src/frame/cards/cards-model";
import { pictureFaceOf } from "../src/frame/cards/cards-model";

const REF = "vf:obj/7hk2qx4m" as ObjectRef;
const PICTURE: ImageFace = pictureFaceOf({
  width: 40,
  height: 20,
  src: "blob:pic",
  bytes: new Blob([]),
});
const words = (title: string) => ({ type: "t", title, state: null, label: title });

const NOTE_HALF: AgentHalf = {
  summary: () => ({}),
  faces: { words: (api) => String(api.props()["text"] ?? "") },
};
const NOTE: CopiedObject = {
  type: "desk.note",
  words: words("Note"),
  props: { text: "Ship it by Friday. Then the covers." },
  key: "k1",
  agent: {
    faces: [
      { type: "ref", id: "live", label: "Live" },
      { type: "text", id: "words", label: "Its words", format: "plain" },
      { type: "image", id: "picture", label: "Picture" },
    ],
    half: NOTE_HALF,
  },
};
const inputs = (over: Partial<Parameters<typeof kindFacesOf>[0]> = {}) => ({
  objects: [NOTE] as readonly CopiedObject[],
  picture: PICTURE as ImageFace | null,
  refs: [REF] as readonly ObjectRef[],
  title: "Ship it by Friday.",
  readNow: (object: CopiedObject) => object.props as Readonly<Record<string, unknown>> | null,
  ...over,
});

describe("kindFacesOf: a card's faces, from the kind's agent half", () => {
  it("offers a note Live, its words and its Picture, in the kind's order, the still the same capture", () => {
    const faces = kindFacesOf(inputs());
    expect(faces.map((face) => [face.id, face.type, face.label])).toEqual([
      ["live", "ref", "Live"],
      ["words", "text", "Its words"],
      ["picture", "image", "Picture"],
    ]);
    const live = faces[0] as RefFace;
    expect(live).toMatchObject({ ref: REF, kindName: "Note", title: "Ship it by Friday." });
    expect(live.still).toEqual({ src: "blob:pic", width: 40, height: 20 });
    expect((faces[1] as TextFace).text).toBe("Ship it by Friday. Then the covers.");
  });

  it("deals without Live when fieldd named no ref, honestly", () => {
    expect(kindFacesOf(inputs({ refs: [] })).map((face) => face.type)).toEqual(["text", "image"]);
  });

  it("has no Live without its picture: a ref's still is that same capture", () => {
    expect(kindFacesOf(inputs({ picture: null })).map((face) => face.type)).toEqual(["text"]);
  });

  it("gives a kind with no agent half its Picture and nothing else", () => {
    const plain: CopiedObject = {
      type: "x.clock",
      words: words("Clock"),
      props: { text: "words" },
      key: "k",
    };
    const faces = kindFacesOf(inputs({ objects: [plain] }));
    expect(faces.map((face) => face.type)).toEqual(["image"]);
  });

  it("adds the host's Picture, last, to a kind that does not declare one (§4.2)", () => {
    const pad: CopiedObject = {
      ...NOTE,
      agent: { faces: (NOTE.agent?.faces ?? []).slice(0, 2), half: NOTE_HALF },
    };
    expect(kindFacesOf(inputs({ objects: [pad] })).map((face) => face.type)).toEqual([
      "ref",
      "text",
      "image",
    ]);
  });

  it("offers several selected as one Live naming every ref, and one Picture", () => {
    const more = "vf:obj/aaaaaaaa" as ObjectRef;
    const faces = kindFacesOf(
      inputs({ objects: [NOTE, NOTE], refs: [REF, more], title: "2 objects" }),
    );
    expect(faces.map((face) => face.type)).toEqual(["ref", "image"]);
    expect(faces[0]).toMatchObject({
      ref: REF,
      more: [more],
      kindName: "2 objects",
      title: "2 objects",
    });
  });

  it("offers no Live for a selection only partly named: a Live speaks for every object or none", () => {
    const faces = kindFacesOf(inputs({ objects: [NOTE, NOTE], refs: [REF], title: "2 objects" }));
    expect(faces.map((face) => face.type)).toEqual(["image"]);
  });

  it("reads a face from the object as its kind declares it, at the press too", () => {
    const faces = kindFacesOf(inputs({ readNow: () => ({ text: "as declared" }) }));
    expect((faces[1] as TextFace).text).toBe("as declared");
    const gone = kindFacesOf(inputs({ readNow: () => null }));
    expect(gone.map((face) => face.type)).toEqual(["ref", "image"]);
  });

  it("leaves out an empty text face, and one whose handler throws", () => {
    const empty: CopiedObject = { ...NOTE, props: { text: "" } };
    expect(kindFacesOf(inputs({ objects: [empty] })).map((face) => face.type)).toEqual([
      "ref",
      "image",
    ]);
    const broken: CopiedObject = {
      ...NOTE,
      agent: {
        faces: NOTE.agent?.faces ?? [],
        half: {
          summary: () => ({}),
          faces: {
            words: () => {
              throw new Error("no");
            },
          },
        },
      },
    };
    expect(kindFacesOf(inputs({ objects: [broken] })).map((face) => face.type)).toEqual([
      "ref",
      "image",
    ]);
  });

  it("waits for the play with words over the budget, reading them fresh then, and null once it is gone", () => {
    const long = "x".repeat(OBJECT_LIMITS.TOOL_BYTES + 1);
    let now: Readonly<Record<string, unknown>> | null = { text: long };
    const faces = kindFacesOf(
      inputs({ objects: [{ ...NOTE, props: { text: long } }], readNow: () => now }),
    );
    const text = faces[1] as TextFace;
    expect(text.text).toBe("");
    now = { text: "fresh words" };
    expect(text.atPlay?.()).toBe("fresh words");
    now = null;
    expect(text.atPlay?.()).toBeNull();
  });

  it("always waits for the play with a file, named for the object; a link is read at the press", () => {
    const map: CopiedObject = {
      type: "x.map",
      words: words("Mind map"),
      props: { body: "<opml/>", url: "https://a.example/" },
      key: "k",
      agent: {
        faces: [
          { type: "ref", id: "live", label: "Live" },
          { type: "file", id: "opml", label: "OPML", mime: "text/x-opml" },
          { type: "link", id: "address", label: "Address" },
        ],
        half: {
          summary: () => ({}),
          faces: {
            opml: (api) => String(api.props()["body"]),
            address: (api) => String(api.props()["url"]),
          },
        },
      },
    };
    const faces = kindFacesOf(inputs({ objects: [map], title: "Q3 plan" }));
    const file = faces[1] as FileFace;
    expect(file).toMatchObject({ name: "Q3 plan.opml", mime: "text/x-opml", label: "OPML" });
    expect(file.path).toBeUndefined();
    expect(file.atPlay?.()).toBe("<opml/>");
    expect(faces[2]).toMatchObject({ type: "link", url: "https://a.example/", title: "Q3 plan" });
  });
});
