import type { DeskLayerStatus } from "@vibecook/ice/desk";

// WHEN THE DESK CAN'T DRAW — its words (DESIGN.md §8 "When the desk can't draw", DK-D32 ruled
// 2026-10-02; R18): the layer's status said in VibeField's words, never ICE's black screen, never a
// blank. ICE says WHY in one string (`status().message`), so the card reads it: the device lost
// (`the device was lost: <reason>: <message>`), no WebGPU (a boot refusal ending `WebGPU is
// unavailable here (no navigator.gpu)` — reloading won't help, so no Reload), any other refusal
// (`no desk — the adapter, the device or the pipelines were refused: …`). The message itself rides
// the card's detail slot VERBATIM. `degraded` (an uncaptured GPU error; the desk still draws) is the
// status line's banner, not the card. And a board from BEFORE the desk (ruling 7, DK-D13…D16) is
// refused at open — never opened, never converted — with words of its own.

export type DeskUnavailableKind = "lost" | "no-webgpu" | "refused" | "before-the-desk";

export interface DeskUnavailableWords {
  readonly kind: DeskUnavailableKind;
  /** What happened (the card's 14/600 line). */
  readonly title: string;
  /** What to do (the card's 12.5/400 line). */
  readonly body: string;
  /** Whether a Reload (a desk remount, not a window reload) could help. */
  readonly reload: boolean;
  /** ICE's message, verbatim — the detail slot; absent for a board refused before any desk. */
  readonly detail?: string;
}

const NO_WEBGPU = "WebGPU is unavailable here (no navigator.gpu)";
const LOST = "the device was lost";

/** The card for a `failed` desk, by what ICE said. */
export function failedWords(message: string | undefined): DeskUnavailableWords {
  const detail = message ?? "";
  if (detail.startsWith(LOST)) {
    return {
      kind: "lost",
      title: "The desk lost its graphics device",
      body: "The graphics device was reset while the desk was drawing. Your objects are saved in this document; reload to draw them again.",
      reload: true,
      detail,
    };
  }
  if (detail.endsWith(NO_WEBGPU)) {
    return {
      kind: "no-webgpu",
      title: "This computer can't draw the desk",
      body: "The desk draws with WebGPU, which this graphics setup doesn't offer — a remote desktop has none — so reloading won't help. Your objects are saved in this document.",
      reload: false,
      detail,
    };
  }
  return {
    kind: "refused",
    title: "The desk couldn't start its graphics",
    body: "Your objects are saved in this document; reload to try again.",
    reload: true,
    detail,
  };
}

/** The card for a board refused at open: it is from before the desk (DK-D13 — dropped, never converted). */
export const BEFORE_THE_DESK: DeskUnavailableWords = {
  kind: "before-the-desk",
  title: "This board is from before the desk",
  body: "It was made before boards were drawn on the desk, so it doesn't open here. Delete it from the fields explorer — the name pill opens it — or choose another field.",
  reload: false,
};

/** The card's words for a status, or null while the desk draws (`pending`, `ready`, `degraded`). */
export function unavailableWords(status: DeskLayerStatus): DeskUnavailableWords | null {
  return status.state === "failed" ? failedWords(status.message) : null;
}

/** The status line's banner for a `degraded` desk (R18): ICE's message, with a Reload, the desk
 * drawing on beneath it. */
export function degradedNotice(status: DeskLayerStatus): string | null {
  return status.state === "degraded" ? (status.message ?? "The desk hit a graphics error") : null;
}
