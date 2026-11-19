// @vitest-environment node
/**
 * Item 578 — a print's picture saved where the person chooses (DESIGN.md §8 "The bar grown": Download…): main's door,
 * its policy alone. Only a window this shell registered may ask; the picture's format is read off its bytes against a
 * closed list; main makes the name and main's own panel names the place, so no name and no path comes from the page;
 * one panel at a time; the answer names the folder, never a path; every outcome is one audit record with the bytes'
 * count, the format and the file's own name.
 */
import { SHELL_PICTURE_SAVE } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it } from "vitest";
import {
  causeOf,
  createPictureSaveDoor,
  localDay,
  type PictureSaveDoorOptions,
  type PictureSaveProposal,
  pictureSaveName,
  savedPathOf,
} from "../src/main/picture-save-door";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3, 4, 5, 6]);
const CHOSEN = "/home/person/Pictures/Trip/Picture 2026-11-19.png";

interface Sender {
  readonly id: number;
}
const WINDOW: Sender = { id: 1 };

function make(over: Partial<PictureSaveDoorOptions<Sender>> = {}) {
  const proposals: PictureSaveProposal[] = [];
  const writes: [string, number, string][] = [];
  const audits: AuditAppendV1[] = [];
  const refused: unknown[][] = [];
  const door = createPictureSaveDoor<Sender>({
    owns: (sender) => sender.id === WINDOW.id,
    choose: async (_sender, proposal) => {
      proposals.push(proposal);
      return CHOSEN;
    },
    write: async (path, bytes, how) => {
      writes.push([path, bytes.byteLength, how]);
    },
    today: () => "2026-11-19",
    audit: async (record) => {
      audits.push(record);
    },
    operationId: () => "op_picture",
    onRefused: (sender, reason, detail) => {
      refused.push(detail === undefined ? [sender.id, reason] : [sender.id, reason, detail]);
    },
    ...over,
  });
  const said = () => audits.map((record) => [record.outcome, record.reasonCode]);
  return { door, proposals, writes, audits, refused, said };
}

describe("the picture save door (item 578)", () => {
  it("proposes its own name in Downloads' place, writes where the panel says, and answers the folder's name", async () => {
    const { door, proposals, writes, audits } = make();
    expect(await door(WINDOW, PNG)).toEqual({ status: "saved", folder: "Trip" });
    expect(proposals).toEqual([
      { name: "Picture 2026-11-19.png", folder: null, extensions: ["png"] },
    ]);
    expect(writes).toEqual([[CHOSEN, PNG.byteLength, "replace"]]);
    expect(audits).toEqual([
      {
        action: "shell.picture.save",
        target: { kind: "picture", id: "desk-print" },
        phase: "outcome",
        outcome: "succeeded",
        operationId: "op_picture",
        attrs: {
          webContentsId: 1,
          bytes: PNG.byteLength,
          mediaType: "image/png",
          name: "Picture 2026-11-19.png",
        },
      },
    ]);
    // the record names the file, never the place it went to
    expect(JSON.stringify(audits)).not.toContain("/home");
    expect(JSON.stringify(audits)).not.toContain("Trip");
  });

  it("names a picture by its own format, read off its bytes", async () => {
    const { door, proposals, audits } = make({
      choose: async (_sender, proposal) => {
        proposals.push(proposal);
        return "/home/person/Desktop/sea.jpeg";
      },
    });
    expect(await door(WINDOW, JPEG)).toEqual({ status: "saved", folder: "Desktop" });
    expect(proposals).toEqual([
      { name: "Picture 2026-11-19.jpg", folder: null, extensions: ["jpg", "jpeg"] },
    ]);
    expect(audits[0]?.attrs).toMatchObject({ mediaType: "image/jpeg", name: "sea.jpeg" });
    expect(pictureSaveName("2026-01-02", "image/webp")).toBe("Picture 2026-01-02.webp");
    // the day is the person's own, read off their calendar and never UTC's
    expect(localDay(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
    expect(localDay(new Date(2026, 10, 19, 0, 1))).toBe("2026-11-19");
    expect(pictureSaveName("2026-01-02", "image/gif")).toBe("Picture 2026-01-02.gif");
  });

  it("proposes the folder it last saved to in this run; a cancel and a failure leave it", async () => {
    let answer: string | null = CHOSEN;
    let fails = false;
    const { door, proposals } = make({
      choose: async (_sender, proposal) => {
        proposals.push(proposal);
        return answer;
      },
      write: async () => {
        if (fails) throw new Error("EACCES: permission denied");
      },
    });
    await door(WINDOW, PNG);
    answer = null;
    await door(WINDOW, PNG);
    answer = "/home/person/Locked/a.png";
    fails = true;
    await door(WINDOW, PNG);
    fails = false;
    answer = "/home/person/Desktop/b.png";
    await door(WINDOW, PNG);
    await door(WINDOW, PNG);
    expect(proposals.map((proposal) => proposal.folder)).toEqual([
      null,
      "/home/person/Pictures/Trip",
      "/home/person/Pictures/Trip",
      "/home/person/Pictures/Trip",
      "/home/person/Desktop",
    ]);
  });

  it("a cancelled panel writes nothing and is said as cancelled", async () => {
    const { door, writes, said, refused } = make({ choose: async () => null });
    expect(await door(WINDOW, PNG)).toEqual({ status: "cancelled" });
    expect(writes).toEqual([]);
    expect(said()).toEqual([["cancelled", "USER_CANCELLED"]]);
    expect(refused).toEqual([]);
  });

  it("refuses bytes that are no picture of its formats, before any panel", async () => {
    const { door, proposals, writes, said, refused } = make();
    const text = (words: string): Uint8Array => new TextEncoder().encode(words);
    for (const other of [text("%PDF-1.7 ..."), text("<svg xmlns='x'/>"), text("#!/bin/sh\n")]) {
      expect(await door(WINDOW, other)).toEqual({ status: "refused", reason: "not-a-picture" });
    }
    expect(await door(WINDOW, new Uint8Array(0))).toEqual({
      status: "refused",
      reason: "not-a-picture",
    });
    expect(proposals).toEqual([]);
    expect(writes).toEqual([]);
    expect(said()).toEqual(Array.from({ length: 4 }, () => ["denied", "NOT_A_PICTURE"]));
    expect(refused[0]).toEqual([1, "not-a-picture", { bytes: 12 }]);
  });

  it("refuses a picture past the bound whole, with its size, before any panel", async () => {
    const { door, proposals, writes, said } = make();
    const past = new Uint8Array(SHELL_PICTURE_SAVE.MAX_BYTES + 1);
    past.set(PNG);
    expect(await door(WINDOW, past)).toEqual({
      status: "refused",
      reason: "too-large",
      bytes: SHELL_PICTURE_SAVE.MAX_BYTES + 1,
    });
    expect(proposals).toEqual([]);
    expect(writes).toEqual([]);
    expect(said()).toEqual([["denied", "TOO_LARGE"]]);
  });

  it("throws at a stranger and at a request that is not bytes, and opens no panel", async () => {
    const { door, proposals, said, refused } = make();
    await expect(door({ id: 9 }, PNG)).rejects.toThrow(/unregistered sender/);
    for (const raw of [undefined, "picture", { bytes: PNG }, Array.from(PNG), PNG.buffer]) {
      await expect(door(WINDOW, raw)).rejects.toThrow(/picture's bytes/);
    }
    expect(proposals).toEqual([]);
    expect(said()).toEqual([["denied", "UNREGISTERED_SENDER"]]);
    expect(refused).toEqual([[9, "unregistered"]]);
  });

  it("gives a name without its format's extension that extension, and never writes it over a file", async () => {
    const { door, writes, audits } = make({
      choose: async () => "/home/person/Desktop/holiday",
    });
    expect(await door(WINDOW, PNG)).toEqual({ status: "saved", folder: "Desktop" });
    expect(writes).toEqual([["/home/person/Desktop/holiday.png", PNG.byteLength, "new"]]);
    expect(audits[0]?.attrs).toMatchObject({ name: "holiday.png" });
    expect(savedPathOf("/a/b/x.PNG", "image/png")).toEqual({ path: "/a/b/x.PNG", how: "replace" });
    expect(savedPathOf("/a/b/x.jpeg", "image/jpeg")).toEqual({
      path: "/a/b/x.jpeg",
      how: "replace",
    });
    expect(savedPathOf("/a/b/x.png", "image/jpeg")).toEqual({ path: "/a/b/x.png.jpg", how: "new" });
    expect(savedPathOf("/a/b/x.app", "image/gif")).toEqual({ path: "/a/b/x.app.gif", how: "new" });
  });

  it("opens one panel at a time: a second ask while one is open is refused as busy", async () => {
    let close: (path: string | null) => void = () => undefined;
    const { door, proposals, said } = make({
      choose: (_sender, proposal) => {
        proposals.push(proposal);
        return new Promise<string | null>((resolve) => {
          close = resolve;
        });
      },
    });
    const first = door(WINDOW, PNG);
    await Promise.resolve();
    expect(await door(WINDOW, PNG)).toEqual({ status: "refused", reason: "busy" });
    close(null);
    expect(await first).toEqual({ status: "cancelled" });
    const next = door(WINDOW, PNG);
    await Promise.resolve();
    close(CHOSEN);
    expect(await next).toEqual({ status: "saved", folder: "Trip" });
    expect(proposals).toHaveLength(2);
    expect(said()).toEqual([
      ["denied", "BUSY"],
      ["cancelled", "USER_CANCELLED"],
      ["succeeded", undefined],
    ]);
  });

  it("says a panel that failed and a write that failed as failed, the cause to the log alone", async () => {
    const panel = make({
      choose: async () => {
        throw new TypeError(`no window to parent the panel for ${CHOSEN}`);
      },
    });
    expect(await panel.door(WINDOW, PNG)).toEqual({ status: "refused", reason: "failed" });
    expect(panel.said()).toEqual([["failed", "DIALOG_FAILED"]]);
    // no code: the error's class name, never its message
    expect(panel.refused).toEqual([[1, "failed", { bytes: PNG.byteLength, error: "TypeError" }]]);
    expect(JSON.stringify([panel.refused, panel.audits])).not.toContain("/home");
    // a file error's message carries the path it failed at: the log is told its code instead
    const full = Object.assign(new Error(`ENOSPC: no space left on device, write '${CHOSEN}'`), {
      code: "ENOSPC",
    });
    const disk = make({
      write: async () => {
        throw full;
      },
    });
    expect(await disk.door(WINDOW, PNG)).toEqual({ status: "refused", reason: "failed" });
    expect(disk.said()).toEqual([["failed", "WRITE_FAILED"]]);
    expect(disk.refused).toEqual([[1, "failed", { bytes: PNG.byteLength, error: "ENOSPC" }]]);
    expect(JSON.stringify([disk.refused, disk.audits])).not.toContain("/home");
    expect(causeOf(full)).toBe("ENOSPC");
    // and the door is open again after either
    expect(await panel.door(WINDOW, PNG)).toEqual({ status: "refused", reason: "failed" });
  });

  it("tells the log a failure's code, else its class name, and never its message", () => {
    const at = `open '${CHOSEN}'`;
    const denied = Object.assign(new Error(`EACCES: permission denied, ${at}`), { code: "EACCES" });
    expect(causeOf(denied)).toBe("EACCES");
    // no code, or one that is no word: the class name
    expect(causeOf(new Error(`could not write ${CHOSEN}`))).toBe("Error");
    expect(causeOf(new RangeError(`too long: ${CHOSEN}`))).toBe("RangeError");
    expect(causeOf(Object.assign(new Error(at), { code: 13 }))).toBe("Error");
    expect(causeOf(Object.assign(new Error(at), { code: "" }))).toBe("Error");
    // a nameless error, and a thing thrown that is no error at all: "Error", never the thing itself
    expect(causeOf(Object.assign(new Error(at), { name: "" }))).toBe("Error");
    for (const thrown of [CHOSEN, { message: CHOSEN }, { path: CHOSEN }, null, undefined, 7]) {
      expect(causeOf(thrown)).toBe("Error");
    }
    // bounded, whatever a code or a name is made to be
    expect(causeOf({ code: "E".repeat(500) })).toHaveLength(64);
    expect(causeOf(Object.assign(new Error(at), { name: "N".repeat(500) }))).toHaveLength(64);
  });

  it("never waits on the audit, and a record that cannot be appended is the caller's warn line", async () => {
    const failures: unknown[] = [];
    const { door } = make({
      audit: async () => {
        throw new Error("fieldd audit service is unavailable");
      },
      onAuditFailed: (error) => failures.push(error),
    });
    expect(await door(WINDOW, PNG)).toEqual({ status: "saved", folder: "Trip" });
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toHaveLength(1);
  });
});
