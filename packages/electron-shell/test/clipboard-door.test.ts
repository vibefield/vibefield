import { SHELL_CLIPBOARD } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import { createClipboardDoor, createClipboardImageDoor } from "../src/main/clipboard-door";

// Item 102 — the clipboard read door's promises: a registered sender only, and
// only while its window and page are focused; a text over the bound refused whole,
// never cut; every answer and refusal audited with bytes and never the text, and
// the answer never waiting on that audit.

const registered = { id: 7 };
const stranger = { id: 99 };

function world(over: { focused?: boolean; text?: string; audit?: () => Promise<void> } = {}) {
  const read = vi.fn(() => over.text ?? "git status\n");
  const records: AuditAppendV1[] = [];
  const onRefused = vi.fn();
  const onAuditFailed = vi.fn();
  let n = 0;
  const door = createClipboardDoor({
    owns: (sender) => sender.id === registered.id,
    focused: () => over.focused ?? true,
    read,
    audit:
      over.audit ??
      (async (record) => {
        records.push(record);
      }),
    operationId: () => `op-${++n}`,
    onRefused,
    onAuditFailed,
  });
  return { door, read, records, onRefused, onAuditFailed };
}

describe("createClipboardDoor (item 102)", () => {
  it("reads the clipboard for a focused registered window and audits its bytes, never its text", async () => {
    const { door, read, records } = world({ text: "échelle\n" });
    await expect(door(registered, {})).resolves.toEqual({ status: "read", text: "échelle\n" });
    expect(read).toHaveBeenCalledOnce();
    expect(records).toEqual([
      {
        action: "shell.clipboard.read",
        target: { kind: "clipboard", id: "system" },
        phase: "outcome",
        outcome: "succeeded",
        operationId: "op-1",
        attrs: { webContentsId: 7, bytes: 9 },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("échelle");
  });

  it("refuses a stranger before reading, and audits it denied", async () => {
    const { door, read, records, onRefused } = world();
    await expect(door(stranger, {})).rejects.toThrow(/unregistered sender/);
    expect(read).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledWith(stranger, "unregistered");
    expect(records).toMatchObject([
      { outcome: "denied", reasonCode: "UNREGISTERED_SENDER", attrs: { webContentsId: 99 } },
    ]);
  });

  it("never reads for a window that is not focused: an honest refusal, audited", async () => {
    const { door, read, records } = world({ focused: false });
    await expect(door(registered, {})).resolves.toEqual({
      status: "refused",
      reason: "unfocused",
    });
    expect(read).not.toHaveBeenCalled();
    expect(records).toMatchObject([{ outcome: "denied", reasonCode: "UNFOCUSED" }]);
  });

  it("refuses a text over the bound whole, with its size, and never cuts it", async () => {
    const text = "x".repeat(SHELL_CLIPBOARD.READ_MAX_BYTES + 1);
    const { door, records } = world({ text });
    const answer = await door(registered, {});
    expect(answer).toEqual({
      status: "refused",
      reason: "too-large",
      bytes: SHELL_CLIPBOARD.READ_MAX_BYTES + 1,
    });
    expect(answer).not.toHaveProperty("text");
    expect(records).toMatchObject([
      {
        outcome: "denied",
        reasonCode: "TOO_LARGE",
        attrs: { bytes: SHELL_CLIPBOARD.READ_MAX_BYTES + 1 },
      },
    ]);
    // exactly the bound is a paste
    const at = world({ text: "x".repeat(SHELL_CLIPBOARD.READ_MAX_BYTES) });
    await expect(at.door(registered, {})).resolves.toMatchObject({ status: "read" });
  });

  it("checks the request at the seam and tolerates a future field", async () => {
    const { door, read } = world();
    await expect(door(registered, 42)).rejects.toThrow();
    await expect(door(registered, null)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(door(registered, { later: true })).resolves.toMatchObject({ status: "read" });
  });

  it("answers without waiting on the audit, and a failed append is reported, not thrown", async () => {
    let settle: (() => void) | undefined;
    const pending = world({
      audit: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    });
    await expect(pending.door(registered, {})).resolves.toMatchObject({ status: "read" });
    settle?.();
    const failing = world({ audit: () => Promise.reject(new Error("fieldd is away")) });
    await expect(failing.door(registered, {})).resolves.toMatchObject({ status: "read" });
    await vi.waitFor(() => expect(failing.onAuditFailed).toHaveBeenCalledOnce());
    const throwing = world({
      audit: () => {
        throw new Error("no client");
      },
    });
    await expect(throwing.door(registered, {})).resolves.toMatchObject({ status: "read" });
    expect(throwing.onAuditFailed).toHaveBeenCalledOnce();
  });
});

// HN-5 — the write half's promises: a registered sender sending a picture's bytes, and
// words beside them only as text, or a throw; no focus asked (LC-18); bytes or words over
// their bounds refused whole and never decoded; bytes that hold no picture refused, nothing
// written; the picture and the words in ONE write (LC-19); a marked run's record kept in
// place of the write, after every check a write passes.

/** A PNG's signature: the door never reads the bytes, its decoder does. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function picture(over: { decoded?: "empty" | "throws"; keep?: boolean } = {}) {
  const decode = vi.fn((png: Uint8Array) => {
    if (over.decoded === "throws") throw new Error("not a PNG");
    return over.decoded === "empty" ? null : { png };
  });
  const write = vi.fn();
  const kept: Array<{ bytes: number; text: string | undefined }> = [];
  const onRefused = vi.fn();
  const door = createClipboardImageDoor({
    owns: (sender) => sender.id === registered.id,
    decode,
    write,
    ...(over.keep === true
      ? {
          keep: (bytes: number, text: string | undefined) => {
            kept.push({ bytes, text });
          },
        }
      : {}),
    onRefused,
  });
  return { door, decode, write, kept, onRefused };
}

describe("createClipboardImageDoor (HN-5)", () => {
  it("decodes and writes a picture for a registered window, asking no focus (LC-18)", async () => {
    const { door, decode, write, onRefused } = picture();
    await expect(door(registered, PNG)).resolves.toEqual({ status: "written" });
    expect(decode).toHaveBeenCalledWith(PNG);
    expect(write.mock.calls).toEqual([[{ png: PNG }, undefined]]);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("writes the copy's words beside the picture in the same one write (LC-19)", async () => {
    const { door, write } = picture();
    await expect(door(registered, PNG, "Ship the desk by Friday.")).resolves.toEqual({
      status: "written",
    });
    expect(write.mock.calls).toEqual([[{ png: PNG }, "Ship the desk by Friday."]]);
  });

  it("refuses a stranger before decoding anything", async () => {
    const { door, decode, write, onRefused } = picture();
    await expect(door(stranger, PNG)).rejects.toThrow(/unregistered sender/);
    expect(decode).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledWith(stranger, "unregistered");
  });

  it("throws for a request that is not a picture's bytes, as for a malformed read", async () => {
    const { door, decode } = picture();
    const notBytes: unknown[] = [
      undefined,
      null,
      42,
      "png",
      [0x89, 0x50],
      { png: PNG },
      new Uint16Array(4),
      new DataView(new ArrayBuffer(4)),
    ];
    for (const raw of notBytes)
      await expect(door(registered, raw)).rejects.toThrow(/not a picture's bytes/);
    // words beside the picture are text, or nothing
    for (const words of [42, null, { text: "x" }, new Uint8Array(2)])
      await expect(door(registered, PNG, words)).rejects.toThrow(/the words are not text/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("refuses words past the copy door's bound whole, with their UTF-8 size", async () => {
    const half = SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES / 2;
    const { door, decode, write, onRefused } = picture();
    await expect(door(registered, PNG, "é".repeat(half + 1))).resolves.toEqual({
      status: "refused",
      reason: "too-large",
      bytes: SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES + 2,
    });
    expect(decode).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledWith(
      registered,
      "too-large",
      SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES + 2,
    );
    // exactly the bound is words the clipboard takes
    const at = picture();
    await expect(at.door(registered, PNG, "é".repeat(half))).resolves.toEqual({
      status: "written",
    });
  });

  it("refuses bytes over the bound whole, with their size, and never decodes them", async () => {
    const past = SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES + 1;
    const { door, decode, write } = picture();
    await expect(door(registered, new Uint8Array(past))).resolves.toEqual({
      status: "refused",
      reason: "too-large",
      bytes: past,
    });
    expect(decode).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    // exactly the bound is a picture
    const at = picture();
    await expect(
      at.door(registered, new Uint8Array(SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES)),
    ).resolves.toEqual({ status: "written" });
  });

  it("refuses bytes that hold no picture, empty or throwing, and writes nothing", async () => {
    for (const decoded of ["empty", "throws"] as const) {
      const { door, write, onRefused } = picture({ decoded });
      await expect(door(registered, PNG)).resolves.toEqual({
        status: "refused",
        reason: "not-an-image",
        bytes: PNG.byteLength,
      });
      expect(write).not.toHaveBeenCalled();
      expect(onRefused).toHaveBeenCalledWith(registered, "not-an-image", PNG.byteLength);
    }
  });

  it("a marked run keeps the size and the words in place of the write", async () => {
    const marked = picture({ keep: true });
    await expect(marked.door(registered, PNG)).resolves.toEqual({ status: "written" });
    await expect(marked.door(registered, PNG, "hello")).resolves.toEqual({ status: "written" });
    expect(marked.kept).toEqual([
      { bytes: PNG.byteLength, text: undefined },
      { bytes: PNG.byteLength, text: "hello" },
    ]);
    expect(marked.decode).toHaveBeenCalledTimes(2);
    expect(marked.write).not.toHaveBeenCalled();
    // after every check: an empty decode keeps nothing, words past the bound neither
    const empty = picture({ keep: true, decoded: "empty" });
    await expect(empty.door(registered, PNG)).resolves.toMatchObject({ reason: "not-an-image" });
    const wordy = picture({ keep: true });
    const past = "x".repeat(SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES + 1);
    await expect(wordy.door(registered, PNG, past)).resolves.toMatchObject({ reason: "too-large" });
    expect([...empty.kept, ...wordy.kept]).toEqual([]);
  });
});
