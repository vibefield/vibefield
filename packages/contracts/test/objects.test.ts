import { describe, expect, it } from "vitest";
import { CHIP_TYPES, ObjectRef } from "../src/objects";

const REF = "vf:obj/7hk2qx4m";

describe("what a chip can be (OB-D1 A)", () => {
  it("is exactly six types", () => {
    expect([...CHIP_TYPES]).toEqual(["text", "image", "file", "link", "session", "ref"]);
  });
});

describe("a ref is a name (OB-L1)", () => {
  it("reads vf:obj/ and eight lowercase characters, and nothing else", () => {
    expect(ObjectRef.safeParse(REF).success).toBe(true);
    for (const bad of ["vf:obj/SHORT", "vf:obj/7hk2qx4m9", "obj/7hk2qx4m", "vf:obj/7HK2QX4M", ""])
      expect(ObjectRef.safeParse(bad).success, bad).toBe(false);
  });
});
