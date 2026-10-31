import { SHELL_CLIPBOARD } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import { createClipboardDoor } from "../src/main/clipboard-door";

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
