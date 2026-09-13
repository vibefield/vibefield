import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/registries";
import {
  SCREENSHOT_HELPER_ARGS,
  SCREENSHOT_HELPER_PROTOCOL_VERSION,
  SCREENSHOT_LIMITS,
  ScreenshotCaptureResult,
  ScreenshotErrorCode,
  ScreenshotHelperErrorCode,
  ScreenshotHelperEvent,
  ScreenshotHelperOk,
} from "../src/screenshot";

// SNAP-D2 — the helper's line protocol. The fixtures under fixtures/ are the
// contract: the Swift test harness and the Rust crate parse the SAME files, so
// a shape change here is a three-language event, never a quiet TS edit.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `screenshot-helper-event.${name}.json`), "utf8"));

const OK = {
  v: 1,
  status: "ok",
  path: "/tmp/vibefield-screenshot-1.png",
  width: 10,
  height: 8,
  scale: 2,
  displayId: 1,
  bounds: { x: 0, y: 0, width: 5, height: 4 },
} as const;

describe("ScreenshotHelperEvent — the four lines a helper may print", () => {
  it("parses every golden fixture to its status", () => {
    expect(ScreenshotHelperEvent.parse(fixture("ready")).status).toBe("ready");
    expect(ScreenshotHelperEvent.parse(fixture("cancel")).status).toBe("cancel");
    const ok = ScreenshotHelperEvent.parse(fixture("ok"));
    expect(ok).toMatchObject({ status: "ok", width: 1840, height: 960, scale: 2, displayId: 1 });
    const error = ScreenshotHelperEvent.parse(fixture("error"));
    expect(error).toMatchObject({ status: "error", code: "permission-denied" });
  });

  it("accepts the Windows helper's backslash path, fractional scale, and negative origin", () => {
    const parsed = ScreenshotHelperEvent.parse(fixture("ok-windows"));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") throw new Error("unreachable");
    expect(parsed.path).toBe(
      "C:\\Users\\me\\AppData\\Local\\Temp\\vibefield-screenshot-1757416234567.png",
    );
    expect(parsed.scale).toBe(1.5);
    // a monitor left of the primary has a negative virtual-screen x
    expect(parsed.bounds.x).toBe(-1920);
  });

  it("carries unknown fields through untouched (P3 tolerant reader)", () => {
    const raw = fixture("unknown-field") as Record<string, unknown>;
    const parsed = ScreenshotHelperEvent.parse(raw);
    expect((parsed as Record<string, unknown>)["pinned"]).toBe(false);
    expect((parsed as Record<string, unknown>)["futureField"]).toEqual(raw["futureField"]);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
  });

  it("refuses a line without the version, or with a version this reader does not speak", () => {
    const { v: _v, ...unversioned } = OK;
    expect(ScreenshotHelperEvent.safeParse(unversioned).success).toBe(false);
    expect(ScreenshotHelperEvent.safeParse({ ...OK, v: 2 }).success).toBe(false);
    expect(SCREENSHOT_HELPER_PROTOCOL_VERSION).toBe(1);
  });

  it("refuses a status it has never heard of rather than guessing", () => {
    expect(ScreenshotHelperEvent.safeParse({ v: 1, status: "maybe" }).success).toBe(false);
    expect(ScreenshotHelperEvent.safeParse({ v: 1 }).success).toBe(false);
    expect(ScreenshotHelperEvent.safeParse("not an object").success).toBe(false);
  });

  it("bounds the still: pixel dimensions, scale, display id, path", () => {
    expect(ScreenshotHelperOk.safeParse({ ...OK, width: 0 }).success).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, width: 1.5 }).success).toBe(false);
    expect(
      ScreenshotHelperOk.safeParse({ ...OK, height: SCREENSHOT_LIMITS.MAX_DIMENSION + 1 }).success,
    ).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, scale: 0 }).success).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, scale: Number.NaN }).success).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, displayId: -1 }).success).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, path: "" }).success).toBe(false);
    expect(ScreenshotHelperOk.safeParse({ ...OK, path: "/tmp/a\u0000.png" }).success).toBe(false);
    expect(
      ScreenshotHelperOk.safeParse({ ...OK, bounds: { x: 0, y: 0, width: -1, height: 1 } }).success,
    ).toBe(false);
    expect(ScreenshotHelperOk.safeParse(OK).success).toBe(true);
  });

  it("types the helper's failure instead of leaving prose to a regex", () => {
    expect(ScreenshotHelperEvent.safeParse({ v: 1, status: "error", message: "x" }).success).toBe(
      false,
    );
    expect(
      ScreenshotHelperEvent.safeParse({ v: 1, status: "error", code: "cosmic-rays", message: "x" })
        .success,
    ).toBe(false);
    expect(
      ScreenshotHelperEvent.safeParse({
        v: 1,
        status: "error",
        code: "capture-failed",
        message: "",
      }).success,
    ).toBe(false);
    expect(ScreenshotHelperErrorCode.options).toEqual([
      "permission-denied",
      "capture-failed",
      "no-displays",
      "write-failed",
    ]);
  });
});

describe("ScreenshotCaptureResult — the shell's answer", () => {
  it("is the helper's line minus the version, or a typed host error", () => {
    const { v: _v, ...still } = OK;
    expect(ScreenshotCaptureResult.parse(still)).toMatchObject({ status: "ok", width: 10 });
    expect(ScreenshotCaptureResult.parse({ status: "cancel" })).toEqual({ status: "cancel" });
    const raw = JSON.parse(
      readFileSync(join(FIXTURES, "screenshot-capture-result.error.json"), "utf8"),
    );
    expect(ScreenshotCaptureResult.parse(raw)).toMatchObject({
      status: "error",
      code: "helper-timeout",
    });
  });

  it("speaks every helper code plus the host's own, and nothing else", () => {
    for (const code of ScreenshotHelperErrorCode.options) {
      expect(ScreenshotErrorCode.options).toContain(code);
    }
    expect(ScreenshotErrorCode.options).toEqual([
      "permission-denied",
      "capture-failed",
      "no-displays",
      "write-failed",
      "unsupported-platform",
      "helper-missing",
      "busy",
      "helper-spawn-failed",
      "helper-timeout",
      "helper-exited",
      "helper-protocol",
      "disposed",
    ]);
    expect(
      ScreenshotCaptureResult.safeParse({ status: "error", code: "helper-vanished", message: "x" })
        .success,
    ).toBe(false);
  });

  it("names the IPC door and the helper flags in one place", () => {
    expect(IPC_CHANNELS.screenshotCapture).toBe("vibefield:screenshot:capture");
    expect(SCREENSHOT_HELPER_ARGS.once).toBe("--once");
    expect(SCREENSHOT_HELPER_ARGS.captureTest).toBe("--capture-test");
    expect(SCREENSHOT_LIMITS.PRE_OVERLAY_TIMEOUT_MS).toBe(20_000);
  });
});
