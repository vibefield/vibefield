/**
 * DK-3 — when the desk can't draw, its words (DESIGN.md §8 "When the desk can't draw"; R18).
 *
 * ICE says why in ONE string (`status().message`); the card reads it and says it in VibeField's
 * words, ICE's message verbatim in the detail slot. The four `failed` causes are told apart by
 * the message's own shape (ICE `packages/desk/src/host/layer.ts`): the device lost; no WebGPU at
 * all, and (DK-4) WebGPU with no adapter — where a Reload would not help, so none is offered; any
 * other refusal. `degraded` is the status line's banner, never the card.
 */
import { describe, expect, it } from "vitest";
import {
  BEFORE_THE_DESK,
  DEGRADED_SENTENCE,
  degradedNotice,
  failedWords,
  unavailableWords,
} from "../src/field/desk/desk-words";

// ICE's messages as its layer composes them: `${what}: ${error.message}`
const NO_GPU =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU is unavailable here (no navigator.gpu)";
const NO_ADAPTER =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU: requestAdapter() returned null";
const PIPELINES =
  "no desk — the adapter, the device or the pipelines were refused: GPUPipelineError: invalid shader module";
const LOST = "the device was lost: unknown: GPU process exited";

describe("the unavailable card's words", () => {
  it("says the device was lost, offers Reload, and carries ICE's message verbatim", () => {
    const words = failedWords(LOST);
    expect(words).toEqual({
      kind: "lost",
      title: "The desk lost its graphics device",
      body: "The graphics device was reset while the desk was drawing. Your objects are saved in this document; reload to draw them again.",
      reload: true,
      detail: LOST,
    });
  });

  it("says this computer can't draw the desk where there is no WebGPU — and offers NO Reload", () => {
    const words = failedWords(NO_GPU);
    expect(words.kind).toBe("no-webgpu");
    expect(words.title).toBe("This computer can't draw the desk");
    expect(words.body).toBe(
      "The desk draws with WebGPU, which this graphics setup doesn't offer — a remote desktop has none — so reloading won't help. Your objects are saved in this document.",
    );
    expect(words.reload).toBe(false);
    expect(words.detail).toBe(NO_GPU);
  });

  it("says this computer can't draw the desk where WebGPU finds no adapter — NO Reload (DK-4)", () => {
    // hardware acceleration off among the causes: a reload cannot help, as with no WebGPU at all
    const words = failedWords(NO_ADAPTER);
    expect(words.kind).toBe("no-adapter");
    expect(words.title).toBe("This computer can't draw the desk");
    expect(words.body).toBe(
      "The desk draws with WebGPU, and this computer's graphics offered it no adapter — hardware acceleration may be off — so reloading won't help. Your objects are saved in this document.",
    );
    expect(words.reload).toBe(false);
    expect(words.detail).toBe(NO_ADAPTER);
    expect(unavailableWords({ state: "failed", message: NO_ADAPTER })?.reload).toBe(false);
  });

  it("says the desk couldn't start its graphics for any other refusal, with Reload", () => {
    const words = failedWords(PIPELINES);
    expect(words.kind).toBe("refused");
    expect(words.title).toBe("The desk couldn't start its graphics");
    expect(words.body).toBe("Your objects are saved in this document; reload to try again.");
    expect(words.reload).toBe(true);
    expect(words.detail).toBe(PIPELINES);
  });

  it("shows the card for `failed` alone: pending, ready and degraded draw", () => {
    expect(unavailableWords({ state: "pending" })).toBeNull();
    expect(unavailableWords({ state: "ready" })).toBeNull();
    expect(unavailableWords({ state: "degraded", message: "an uncaptured GPU error" })).toBeNull();
    expect(unavailableWords({ state: "failed", message: NO_GPU })?.kind).toBe("no-webgpu");
  });

  it("says VibeField's sentence first for a degraded desk — ICE's message after it, as the detail (plan (75))", () => {
    const message = "an uncaptured GPU error — GPUValidationError: bad bind group";
    expect(DEGRADED_SENTENCE).toBe(
      "The graphics device reported an error. The desk is still drawing — Reload restarts it.",
    );
    // what happened, that the desk keeps drawing, and that Reload starts it again — never ICE's words first
    expect(degradedNotice({ state: "degraded", message })).toEqual({
      text: DEGRADED_SENTENCE,
      detail: message,
    });
    expect(degradedNotice({ state: "degraded" })).toEqual({ text: DEGRADED_SENTENCE });
    expect(degradedNotice({ state: "ready" })).toBeNull();
    expect(degradedNotice({ state: "failed", message: LOST })).toBeNull();
  });

  it("has words of its own for a board from before the desk: no Reload, no ICE message", () => {
    expect(BEFORE_THE_DESK.kind).toBe("before-the-desk");
    expect(BEFORE_THE_DESK.title).toBe("This board is from before the desk");
    expect(BEFORE_THE_DESK.reload).toBe(false);
    expect(BEFORE_THE_DESK.detail).toBeUndefined();
  });
});
