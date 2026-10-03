import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachGodviewRecording,
  GODVIEW_RECORD_ENV,
  godviewRecordDir,
  type RecordableWindow,
} from "../src/main/godview-recording";

// MV-0: the recorder's main-process sink. The renderer holds frames; main drains
// them over `executeJavaScript` on an interval and at close, through gzip, into
// the directory `VF_GODVIEW_RECORD` names. Dormant without it.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-godview-recording-"));
  dirs.push(dir);
  return dir;
}

/** A window whose page answers `drain()` from a queue of JSONL chunks. */
function fakeWindow(chunks: string[]): RecordableWindow & { close(): void; calls: number } {
  const closers: (() => void)[] = [];
  let destroyed = false;
  const win = {
    calls: 0,
    webContents: {
      executeJavaScript: async (_code: string, _userGesture?: boolean) => {
        win.calls += 1;
        return chunks.shift() ?? "";
      },
    },
    on: (_event: "close", listener: () => void) => {
      closers.push(listener);
    },
    isDestroyed: () => destroyed,
    close: () => {
      for (const listener of closers) listener();
      destroyed = true;
    },
  };
  return win;
}

describe("godviewRecordDir", () => {
  it("is unset by default and reads the one variable", () => {
    expect(godviewRecordDir({})).toBeUndefined();
    expect(godviewRecordDir({ [GODVIEW_RECORD_ENV]: "" })).toBeUndefined();
    expect(godviewRecordDir({ [GODVIEW_RECORD_ENV]: "/tmp/x" })).toBe("/tmp/x");
  });
});

describe("attachGodviewRecording", () => {
  it("writes a header, drains the page on the interval and once more at close, gzipped", async () => {
    vi.useFakeTimers();
    const dir = scratch();
    const win = fakeWindow(['{"kind":"fold","seq":1,"t":1,"wall":2,"rows":[]}\n', "", "LAST\n"]);
    const recording = attachGodviewRecording(win, dir, {
      drainMs: 1_000,
      now: () => new Date("2026-10-03T22:00:00.000Z"),
      header: { lane: "mv0-vf" },
    });
    expect(recording.path).toBe(join(dir, "godview-frames-2026-10-03T22-00-00-000Z.jsonl.gz"));

    await vi.advanceTimersByTimeAsync(2_100); // two interval drains: one chunk, one empty
    expect(win.calls).toBe(2);
    win.close(); // the final drain takes "LAST"
    await recording.stop(); // idempotent beside the close listener's own stop
    await vi.runAllTimersAsync();

    const files = readdirSync(dir);
    expect(files).toEqual(["godview-frames-2026-10-03T22-00-00-000Z.jsonl.gz"]);
    const text = gunzipSync(readFileSync(join(dir, files[0] as string))).toString("utf8");
    const lines = text.split("\n").filter((line) => line !== "");
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      kind: "meta",
      recorder: "vibefield-godview-frame-recorder",
      version: 1,
      lane: "mv0-vf",
      startedWall: Date.parse("2026-10-03T22:00:00.000Z"),
    });
    expect(lines.slice(1)).toEqual(['{"kind":"fold","seq":1,"t":1,"wall":2,"rows":[]}', "LAST"]);
  });

  it("drains nothing from a destroyed window and survives a page that throws", async () => {
    vi.useFakeTimers();
    const dir = scratch();
    const win = fakeWindow([]);
    win.webContents.executeJavaScript = async () => {
      throw new Error("Script failed to execute");
    };
    const recording = attachGodviewRecording(win, dir, { drainMs: 500 });
    await vi.advanceTimersByTimeAsync(1_600);
    expect(await recording.drain()).toBe(0);
    win.close();
    await recording.stop();
    const text = gunzipSync(readFileSync(recording.path)).toString("utf8");
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(1); // the header alone
  });
});
