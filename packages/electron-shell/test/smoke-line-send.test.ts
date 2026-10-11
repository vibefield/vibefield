/**
 * smoke:godview's line-send rung (11h), the parts a test can hold (testing/smoke-line-send.ts): what a wait for a shell
 * marker says when it ends without one — "never created" told apart from "created empty" — the aimed session's input gate
 * read off the direct-terminal markers, and the one line of evidence the rung prints when it fails.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gateOpen,
  LINE_SEND_EVIDENCE,
  latestGate,
  lineSendEvidenceLine,
  markerFile,
  newLineSendEvidence,
  shellMarkerFailure,
} from "../src/testing/smoke-line-send";

let dir: string | null = null;
const scratch = (): string => {
  dir ??= mkdtempSync(join(tmpdir(), "vf-line-send-"));
  return dir;
};
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("a shell marker's file, as the disk holds it", () => {
  it("tells a file never created from one created empty, and counts the bytes of any other", () => {
    const absent = join(scratch(), "absent.txt");
    const empty = join(scratch(), "empty.txt");
    const other = join(scratch(), "other.txt");
    writeFileSync(empty, "");
    writeFileSync(other, "not the nonce\n");
    expect(markerFile(absent)).toEqual({ exists: false });
    expect(markerFile(empty)).toEqual({ exists: true, bytes: 0 });
    expect(markerFile(other)).toEqual({ exists: true, bytes: 14 });
  });
});

describe("what the wait says when it ends without the marker", () => {
  const path = "/tmp/fr2abc.txt";

  it("never created: the shell ran no line with that redirect", () => {
    const message = shellMarkerFailure(path, { exists: false }, "fr2abc");
    expect(message).toMatch(/^the routed pane did not create \/tmp\/fr2abc\.txt/);
    expect(message).toContain("the file does not exist");
  });

  it("created empty: a line with that redirect ran, and its command printed nothing", () => {
    const message = shellMarkerFailure(path, { exists: true, bytes: 0 }, "fr2abc");
    expect(message).not.toContain("did not create");
    expect(message).toContain("/tmp/fr2abc.txt");
    expect(message).toContain("exists and is empty (0 bytes)");
    expect(message).toContain("fr2abc");
  });

  it("created with other words: the bytes it holds, without the marker", () => {
    const message = shellMarkerFailure(path, { exists: true, bytes: 14 }, "fr2abc");
    expect(message).not.toContain("did not create");
    expect(message).toContain("holds 14 bytes without it");
  });

  it("with no marker asked for, a file that is not there is the only failure", () => {
    expect(shellMarkerFailure(path, { exists: false })).toMatch(
      /^the routed pane did not create \/tmp\/fr2abc\.txt/,
    );
  });
});

describe("the aimed session's input gate, from the direct-terminal markers", () => {
  const facts = (sessionId: string, presentationReady: boolean, inputAllowed: boolean) => ({
    sessionId,
    activationId: "a",
    phase: presentationReady ? "presenting" : "recovering",
    presentationReady,
    inputAllowed,
  });

  it("reads the session's own latest marker, never a later one of another pane", () => {
    const history = [
      facts("aimed", true, true),
      facts("aimed", false, false),
      facts("other", true, true),
    ];
    expect(latestGate(history, "aimed")).toEqual(facts("aimed", false, false));
    expect(gateOpen(latestGate(history, "aimed"))).toBe(false);
    expect(gateOpen(latestGate(history, "other"))).toBe(true);
  });

  it("is not open for a session no marker names, nor while it presents with input closed", () => {
    expect(latestGate([], "aimed")).toBeNull();
    expect(gateOpen(null)).toBe(false);
    expect(gateOpen(facts("aimed", true, false))).toBe(false);
    expect(gateOpen(facts("aimed", false, true))).toBe(false);
  });
});

describe("the rung's one line of evidence", () => {
  it("begins with nothing sampled, and says so as nulls", () => {
    expect(newLineSendEvidence("aimed")).toEqual({
      session: "aimed",
      path: null,
      inputAllowed: { b: null, Backspace: null, send: null, Return: null },
      backspaceHeardBeforeDraft: null,
      waitedMs: { inputBeforeB: null, backspaceHeard: null, inputBeforeReturn: null },
    });
  });

  it("is one line: why it failed, the file, the four samples, the Backspace, the waits, the gate now", () => {
    const evidence = newLineSendEvidence("aimed");
    evidence.path = "/tmp/fr2abc.txt";
    evidence.inputAllowed.b = true;
    evidence.inputAllowed.Backspace = false;
    evidence.inputAllowed.send = true;
    evidence.inputAllowed.Return = true;
    evidence.backspaceHeardBeforeDraft = true;
    evidence.waitedMs.inputBeforeB = 12;
    evidence.waitedMs.backspaceHeard = 3;
    evidence.waitedMs.inputBeforeReturn = 0;
    const gateNow = {
      sessionId: "aimed",
      activationId: "a",
      phase: "presenting",
      presentationReady: true,
      inputAllowed: true,
    };
    const line = lineSendEvidenceLine(
      evidence,
      new Error("the routed pane created /tmp/fr2abc.txt …"),
      { exists: true, bytes: 0 },
      gateNow,
    );
    expect(line.startsWith(LINE_SEND_EVIDENCE)).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice(LINE_SEND_EVIDENCE.length))).toEqual({
      failed: "the routed pane created /tmp/fr2abc.txt …",
      session: "aimed",
      file: { path: "/tmp/fr2abc.txt", exists: true, bytes: 0 },
      inputAllowed: { b: true, Backspace: false, send: true, Return: true },
      backspaceHeardBeforeDraft: true,
      waitedMs: { inputBeforeB: 12, backspaceHeard: 3, inputBeforeReturn: 0 },
      gateNow,
    });
  });

  it("says a rung that failed before its send began has no file yet", () => {
    const line = lineSendEvidenceLine(newLineSendEvidence("aimed"), "timed out", null, null);
    const said = JSON.parse(line.slice(LINE_SEND_EVIDENCE.length)) as Record<string, unknown>;
    expect(said["failed"]).toBe("timed out");
    expect(said["file"]).toBeNull();
    expect(said["gateNow"]).toBeNull();
    expect(said["inputAllowed"]).toEqual({ b: null, Backspace: null, send: null, Return: null });
  });
});
