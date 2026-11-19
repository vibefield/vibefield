/**
 * Item 578 — a print's picture saved where the person chooses (DESIGN.md §8 "The bar grown": Download…). The door's
 * wire: the bytes are the invoke's one argument, and nothing else crosses — no name, no media type, no path. Main
 * reads the picture's format off its first bytes against a closed list, and answers saved (the folder's own name,
 * never a path), cancelled, or refused with its reason.
 */
import { describe, expect, it } from "vitest";
import {
  PICTURE_SAVE_EXTENSIONS,
  PICTURE_SAVE_TYPES,
  PictureSaveResult,
  pictureSaveTypeOf,
  SCREENSHOT_STILL,
  SHELL_PICTURE_AUDIT_ACTIONS,
  SHELL_PICTURE_SAVE,
} from "../src/index";

const bytes = (...head: number[]): Uint8Array => new Uint8Array([...head, 0, 0, 0, 0]);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

describe("the picture save door's formats (item 578)", () => {
  it("takes four formats, each with the extension its name is made with first", () => {
    expect(PICTURE_SAVE_TYPES).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    expect(PICTURE_SAVE_EXTENSIONS).toEqual({
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/gif": ["gif"],
      "image/webp": ["webp"],
    });
  });

  it("reads a picture's format off its first bytes", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const webp = bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP"));
    expect(pictureSaveTypeOf(png)).toBe("image/png");
    expect(pictureSaveTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(pictureSaveTypeOf(bytes(...ascii("GIF89a")))).toBe("image/gif");
    expect(pictureSaveTypeOf(bytes(...ascii("GIF87a")))).toBe("image/gif");
    expect(pictureSaveTypeOf(webp)).toBe("image/webp");
  });

  it("answers null for anything else: a document, a page, a program, a near miss, nothing", () => {
    for (const other of [
      new Uint8Array(0),
      bytes(...ascii("%PDF-1.7")),
      bytes(...ascii("<svg xmlns")),
      bytes(...ascii("<!doctype html>")),
      bytes(0xcf, 0xfa, 0xed, 0xfe),
      bytes(...ascii("#!/bin/sh")),
      bytes(0x89, 0x50, 0x4e, 0x47),
      bytes(0xff, 0xd8),
      bytes(...ascii("GIF88a")),
      bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")),
    ]) {
      expect(pictureSaveTypeOf(other), Array.from(other.slice(0, 12)).join(",")).toBeNull();
    }
  });
});

describe("the picture save door's bound and answers (item 578)", () => {
  it("bounds a picture as a still is bounded, and names its audit action", () => {
    expect(SHELL_PICTURE_SAVE.MAX_BYTES).toBe(SCREENSHOT_STILL.MAX_BYTES);
    expect(SHELL_PICTURE_AUDIT_ACTIONS).toEqual({ SAVE: "shell.picture.save" });
  });

  it("answers saved with the folder's name, cancelled, or refused with a reason", () => {
    expect(PictureSaveResult.parse({ status: "saved", folder: "Downloads" })).toEqual({
      status: "saved",
      folder: "Downloads",
    });
    expect(PictureSaveResult.parse({ status: "cancelled" })).toEqual({ status: "cancelled" });
    for (const reason of ["too-large", "not-a-picture", "busy", "failed"]) {
      expect(PictureSaveResult.parse({ status: "refused", reason })).toEqual({
        status: "refused",
        reason,
      });
    }
    const bytes = SHELL_PICTURE_SAVE.MAX_BYTES + 1;
    const past = { status: "refused", reason: "too-large", bytes };
    expect(PictureSaveResult.parse(past)).toEqual(past);
    // a disk's own top has no folder name: the page then says it was saved, and names no place
    expect(PictureSaveResult.parse({ status: "saved", folder: "" })).toEqual({
      status: "saved",
      folder: "",
    });
    // a tolerant reader: a later field rides along
    expect(PictureSaveResult.parse({ status: "saved", folder: "Trip", later: 1 })).toMatchObject({
      status: "saved",
      folder: "Trip",
    });
  });

  it("refuses an answer outside the contract, and a folder that is a path", () => {
    for (const bad of [
      undefined,
      "saved",
      { status: "saved" },
      { status: "saved", folder: 7 },
      { status: "saved", folder: "Pictures/Trip" },
      { status: "saved", folder: "C:\\Pictures" },
      { status: "refused" },
      { status: "refused", reason: "because" },
      { status: "refused", reason: "too-large", bytes: -1 },
      { status: "written" },
    ]) {
      expect(PictureSaveResult.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
