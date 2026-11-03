import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalReleaseOutbox } from "../src/terminal/release-outbox";

const request = { sessionId: "shell", condition: "unused" as const };
const key = "vf-terminal-release-v1:shell:unused";
const outboxes: TerminalReleaseOutbox[] = [];
function outbox(storage: () => Storage | undefined = () => localStorage) {
  const box = new TerminalReleaseOutbox(storage);
  outboxes.push(box);
  return box;
}
afterEach(() => {
  for (const box of outboxes.splice(0)) box.disconnect();
  localStorage.clear();
});

describe("terminal cleanup delivery", () => {
  it("persists before sending and replays a lost acknowledgement after reload", async () => {
    const first = outbox();
    const send = vi.fn(async () => {
      throw new Error("lost response");
    });
    first.connect(send);
    void first.request(request);
    await first.flush();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(request);
    first.disconnect();
    const second = outbox();
    const ack = vi.fn(async () => ({ accepted: true }));
    second.connect(ack);
    await second.request(request);
    expect(ack).toHaveBeenCalledExactlyOnceWith(request);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("coalesces duplicate cleanup while preserving distinct conditions", async () => {
    const box = outbox();
    const first = box.request(request);
    expect(box.request(request)).toBe(first);
    const second = box.request({ ...request, condition: "exited" });
    const send = vi.fn(async () => ({ accepted: true }));
    box.connect(send);
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });

  it("ignores corrupt entries without blocking the runtime or deleting evidence", async () => {
    localStorage.setItem("vf-terminal-release-v1:broken", "{");
    const box = outbox();
    const send = vi.fn(async () => ({ accepted: true }));
    expect(() => box.connect(send)).not.toThrow();
    await box.request(request);
    expect(localStorage.getItem("vf-terminal-release-v1:broken")).toBe("{");
    expect(send).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("refuses unavailable storage instead of acknowledging an undeliverable obligation", async () => {
    const box = outbox(() => undefined);
    const send = vi.fn(async () => ({ accepted: true }));
    box.connect(send);
    await expect(box.request(request)).rejects.toThrow("storage is unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("requires the contracted owner acknowledgement before dropping an intent", async () => {
    const box = outbox();
    const send = vi.fn(async (): Promise<unknown> => ({ terminated: true }));
    box.connect(send);
    const pending = box.request(request);
    await box.flush();
    expect(localStorage.getItem(key)).not.toBeNull();
    send.mockResolvedValue({ accepted: true });
    await box.flush();
    await pending;
    expect(localStorage.getItem(key)).toBeNull();
  });
});
