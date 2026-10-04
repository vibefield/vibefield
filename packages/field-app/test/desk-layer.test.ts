// @vitest-environment node
// DK-8 — THE PALETTE A KIND'S TEST IS HANDED IS THE ONE THE PRODUCT MOUNTS. `@vibefield/plugin-sdk/testing`'s
// `productPalette` is what a plugin kind that reads a host role (the comment pad's ink — the host's `pens`) is
// driven with by the kind-conformance harness, its test and the playground; field-app's `deskLook` is what
// the desk is actually mounted with (field/desk/desk-layer.ts). They are held equal here, per theme, so a
// palette change in the product reaches every kind's test, and a kind is never judged under colours the
// product does not hand it.
import { productPalette } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { deskLook } from "../src/field/desk/desk-layer";

describe("the product's palette, as the desk is mounted and as a kind's test is handed it (DK-8)", () => {
  it("is one palette, per theme — the roles, the papers, the hand's pens and every material", () => {
    for (const name of ["light", "dark"] as const) {
      expect(productPalette[name], name).toEqual(deskLook(name).palette);
      // the role the comment pad writes with is there to be read
      expect(Object.keys((productPalette[name] as { pens?: object }).pens ?? {}), name).toEqual([
        "felt",
        "ball",
        "fountain",
        "red",
      ]);
    }
  });
});
