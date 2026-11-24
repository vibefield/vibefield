import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import {
  IPC_CHANNELS,
  LAYOUT,
  LAYOUT_ROOT_LEVEL,
  VITALS_CAPTURE_CHANNELS,
  VITALS_CAPTURES,
  VITALS_PORT_CHANNEL,
} from "../src/registries";
import {
  parseVitalsCaptureName,
  VITALS_CAPTURE_KINDS,
  VitalsCaptureArmParams,
  VitalsCaptureRevealParams,
  VitalsCaptureState,
  VitalsFrameCountReply,
  VitalsFrameCountRequest,
  VitalsProfileCaptureParams,
  VitalsProfileCaptureResult,
  vitalsCaptureName,
  vitalsCapturesToRemove,
} from "../src/vitals";

// VT-5 (track VT, 2026-11-24; VT-D12 A) — the armed captures' contract: three kinds, three lengths, one folder, one
// retention rule, and the messages between the Vitals window, main, the desk's window and fieldd.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const AT = Date.UTC(2026, 10, 24, 14, 7, 0, 5);

describe("VT-5 — what may be armed", () => {
  it("is three kinds and three lengths, and nothing else", () => {
    expect(VITALS_CAPTURE_KINDS).toEqual(["trace", "profile", "frames"]);
    expect(VITALS_CAPTURES.SECONDS).toEqual([10, 20, 30]);
    for (const seconds of VITALS_CAPTURES.SECONDS) {
      expect(VitalsCaptureArmParams.safeParse({ kind: "trace", seconds }).success).toBe(true);
    }
    for (const seconds of [0, 5, 15, 31, 60, 10.5, -10]) {
      expect(
        VitalsCaptureArmParams.safeParse({ kind: "trace", seconds }).success,
        `${seconds}`,
      ).toBe(false);
    }
    expect(VitalsCaptureArmParams.safeParse({ kind: "heap", seconds: 10 }).success).toBe(false);
    expect(VitalsProfileCaptureParams.safeParse({ seconds: 600 }).success).toBe(false);
  });

  it("profiles fieldd through one local door under vitals.report, never idempotent", () => {
    const row = METHODS.find((entry) => entry.method === "vitals.profile.capture");
    expect(row).toMatchObject({
      surface: "product",
      scope: "vitals.report",
      idempotent: false,
      locality: "local",
    });
  });
});

describe("VT-5 — the files", () => {
  it("names a file by its kind and its UTC time to the millisecond, fixed width", () => {
    expect(vitalsCaptureName("trace", AT)).toBe("trace-20261124T140700005Z.json");
    expect(vitalsCaptureName("profile", AT)).toBe("profile-20261124T140700005Z.cpuprofile");
    expect(vitalsCaptureName("frames", AT)).toBe("frames-20261124T140700005Z.json");
    for (const kind of VITALS_CAPTURE_KINDS) {
      expect(parseVitalsCaptureName(vitalsCaptureName(kind, AT))).toEqual({
        kind,
        stamp: "20261124T140700005Z",
      });
    }
  });

  it("reads no path, no stranger's file and no temporary as a capture's own", () => {
    for (const name of [
      "../trace-20261124T140700005Z.json",
      "/tmp/trace-20261124T140700005Z.json",
      "trace-20261124T140700005Z.cpuprofile",
      "profile-20261124T140700005Z.json",
      ".trace-20261124T140700005Z.json.part",
      "trace-20261124T140700005Z.json.part",
      "notes.txt",
      "",
    ]) {
      expect(parseVitalsCaptureName(name), name).toBeNull();
      expect(VitalsCaptureRevealParams.safeParse({ name }).success, name).toBe(false);
    }
  });

  it("keeps the newest ten, whoever wrote them, and never names a file not its own", () => {
    const names = Array.from({ length: 13 }, (_, index) =>
      vitalsCaptureName(VITALS_CAPTURE_KINDS[index % 3] ?? "trace", AT + index * 60_000),
    );
    const shuffled = [...names.slice(7), "notes.txt", ...names.slice(0, 7), ".x.part"];
    expect(VITALS_CAPTURES.KEEP).toBe(10);
    expect(vitalsCapturesToRemove(shuffled).sort()).toEqual(names.slice(0, 3).sort());
    expect(vitalsCapturesToRemove(names.slice(0, 10))).toEqual([]);
    expect(vitalsCapturesToRemove(names, 0)).toHaveLength(13);
  });

  it("lives under the user's own root, never the VibeField root", () => {
    expect(LAYOUT.VITALS_CAPTURES_DIR).toEqual(["vitals", "captures"]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("VITALS_CAPTURES_DIR");
  });
});

describe("VT-5 — the messages", () => {
  it("parses each state the window hears", () => {
    expect(VitalsCaptureState.parse(fixture("vitals-capture-state.running.json")).state).toBe(
      "running",
    );
    const saved = VitalsCaptureState.parse(fixture("vitals-capture-state.saved.json"));
    expect(saved.state === "saved" ? saved.frames?.meanFps : null).toBe(58);
    expect(VitalsCaptureState.parse(fixture("vitals-capture-state.failed.json"))).toMatchObject({
      reason: "no-fieldd",
    });
    expect(VitalsCaptureState.parse({ state: "idle" }).state).toBe("idle");
    // a saved file is named, never pathed; a failure is a word from the list
    expect(
      VitalsCaptureState.safeParse({
        state: "saved",
        kind: "trace",
        seconds: 10,
        name: "/Users/x/trace.json",
        bytes: 1,
      }).success,
    ).toBe(false);
    expect(
      VitalsCaptureState.safeParse({ state: "failed", kind: "trace", reason: "because" }).success,
    ).toBe(false);
  });

  it("answers a profile by its name, size and samples", () => {
    const result = VitalsProfileCaptureResult.parse(
      fixture("vitals-profile-capture-result.valid.json"),
    );
    expect(result).toMatchObject({ seconds: 20, samples: 19874 });
    expect(
      VitalsProfileCaptureResult.safeParse({ ...result, name: "../../etc/passwd" }).success,
    ).toBe(false);
  });

  it("bounds the desk's frame count and its request", () => {
    const reply = VitalsFrameCountReply.parse(fixture("vitals-frame-count-reply.valid.json"));
    expect(reply.count?.frames).toBe(1190);
    expect(VitalsFrameCountRequest.safeParse({ requestId: "a", seconds: 20 }).success).toBe(true);
    expect(VitalsFrameCountRequest.safeParse({ requestId: "a", seconds: 3 }).success).toBe(false);
    expect(
      VitalsFrameCountRequest.safeParse({
        requestId: "x".repeat(VITALS_CAPTURES.REQUEST_ID_MAX + 1),
        seconds: 10,
      }).success,
    ).toBe(false);
    expect(
      VitalsFrameCountReply.safeParse({
        requestId: "a",
        count: {
          frames: VITALS_CAPTURES.FRAMES_MAX + 1,
          seconds: 10,
          slowFrames: 0,
          longFrames: 0,
          gaps: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("rides channels of their own, apart from the product window's closed bridge", () => {
    const channels = Object.values(VITALS_CAPTURE_CHANNELS) as string[];
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel).toMatch(/^vibefield:vitals:[a-z-]+:v1$/);
      expect(Object.values(IPC_CHANNELS) as string[]).not.toContain(channel);
      expect(channel).not.toBe(VITALS_PORT_CHANNEL);
    }
  });
});
